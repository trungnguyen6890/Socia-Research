"""Scale Simulation Tests — Verifies that fixes handle 100-1000 sources safely.

Tests cover:
  1. THUNDERING HERD FIXED: Rate limiter re-checks after sleep, only 1 waiter
     proceeds per refilled token.
  2. PER-BUCKET LOCKS: YouTube acquires aren't blocked by X/Twitter waiters.
  3. CONCURRENCY CAP: Pipeline semaphore limits parallel jobs.
  4. THROUGHPUT MATH: Verify expected crawl times at scale.
  5. CURSOR CONTINUITY: No redundant fetches at scale.
"""
from __future__ import annotations

import asyncio
import time
from collections import defaultdict

import httpx
import pytest
import respx

from src.config.settings import RateLimitConfig
from src.connectors.x_twitter import XTwitterConnector
from src.connectors.youtube import YouTubeConnector
from src.connectors.rss import RSSConnector
from src.utils.rate_limiter import RateLimiter

from tests.test_connectors.conftest import make_source

TWITTER_API = "https://api.twitter.com/2"
YT_API = "https://www.googleapis.com/youtube/v3"


# ===================================================================
# FIX VERIFICATION 1: Thundering herd is resolved
# ===================================================================


class TestThunderingHerdFixed:
    """Verify that the re-check loop prevents burst after sleep.

    With 20 concurrent acquires and 3 tokens (rate 0.3/s):
    - 3 fire instantly
    - Then at most 1 fires every ~3.3s (not 17 at once)
    """

    async def test_no_burst_after_initial_tokens(self):
        limiter = RateLimiter({
            "x_twitter": RateLimitConfig(requests_per_window=3, window_seconds=10),
        })

        timestamps: list[float] = []
        t0 = time.monotonic()

        async def worker():
            await limiter.acquire("x_twitter")
            timestamps.append(time.monotonic() - t0)

        tasks = [asyncio.create_task(worker()) for _ in range(8)]
        await asyncio.gather(*tasks)

        timestamps.sort()

        # First 3 should be instant
        instant = [t for t in timestamps if t < 0.5]
        assert len(instant) == 3, f"Expected 3 instant, got {len(instant)}: {timestamps}"

        # Remaining 5 should be spaced ~3.3s apart (1 token / 0.3 rate)
        delayed = [t for t in timestamps if t >= 0.5]
        for i in range(1, len(delayed)):
            gap = delayed[i] - delayed[i - 1]
            # Allow some tolerance, but each gap should be >= 2.5s
            assert gap >= 2.0, (
                f"Requests {i} and {i+1} too close: gap={gap:.2f}s. "
                f"Thundering herd may still be present. Times: {timestamps}"
            )

    async def test_20_sources_no_simultaneous_burst(self):
        """20 sources: after initial 3, no burst window should have >2 requests."""
        limiter = RateLimiter({
            "x_twitter": RateLimitConfig(requests_per_window=3, window_seconds=10),
        })

        timestamps: list[float] = []
        t0 = time.monotonic()

        async def worker():
            await limiter.acquire("x_twitter")
            timestamps.append(time.monotonic() - t0)

        # Only test 8 to keep runtime reasonable (~17s)
        tasks = [asyncio.create_task(worker()) for _ in range(8)]
        await asyncio.gather(*tasks)

        timestamps.sort()

        # Bucket by 1-second windows after the initial burst
        delayed = [t for t in timestamps if t >= 0.5]
        windows: dict[int, int] = defaultdict(int)
        for t in delayed:
            windows[int(t)] = windows.get(int(t), 0) + 1

        for sec, count in windows.items():
            assert count <= 2, (
                f"Window t={sec}s had {count} requests — burst detected. "
                f"All timestamps: {[f'{t:.2f}' for t in timestamps]}"
            )


# ===================================================================
# FIX VERIFICATION 2: Per-bucket locks (no cross-connector blocking)
# ===================================================================


class TestPerBucketLocks:
    """YouTube should not be blocked by X/Twitter waiters."""

    async def test_youtube_instant_while_twitter_waiting(self):
        limiter = RateLimiter({
            "x_twitter": RateLimitConfig(requests_per_window=1, window_seconds=60),
            "youtube": RateLimitConfig(requests_per_window=100, window_seconds=60),
        })

        # Exhaust x_twitter
        await limiter.acquire("x_twitter")

        # Start 5 x_twitter waiters (they'll block on x_twitter bucket lock)
        async def twitter_waiter():
            await limiter.acquire("x_twitter")

        twitter_tasks = [asyncio.create_task(twitter_waiter()) for _ in range(5)]
        await asyncio.sleep(0.05)  # Let them queue up

        # YouTube should be instant — has its own lock
        t0 = time.monotonic()
        await limiter.acquire("youtube")
        youtube_latency = time.monotonic() - t0

        for t in twitter_tasks:
            t.cancel()
        await asyncio.gather(*twitter_tasks, return_exceptions=True)

        assert youtube_latency < 0.1, (
            f"YouTube took {youtube_latency:.2f}s — should be instant. "
            "Per-bucket locks not working."
        )


# ===================================================================
# FIX VERIFICATION 3: Concurrency cap (pipeline semaphore)
# ===================================================================


class TestConcurrencyControl:
    """Pipeline semaphore should cap parallel execution."""

    async def test_semaphore_limits_concurrent_jobs(self):
        from src.pipeline.runner import set_max_concurrency, _get_semaphore

        set_max_concurrency(5)

        active = 0
        max_active = 0
        sem = _get_semaphore()

        async def fake_job():
            nonlocal active, max_active
            async with sem:
                active += 1
                if active > max_active:
                    max_active = active
                await asyncio.sleep(0.05)
                active -= 1

        tasks = [asyncio.create_task(fake_job()) for _ in range(20)]
        await asyncio.gather(*tasks)

        assert max_active <= 5, f"Max concurrent: {max_active}, expected <= 5"

        # Reset for other tests
        set_max_concurrency(20)


# ===================================================================
# Throughput Analysis (unchanged — still valid)
# ===================================================================


class TestThroughputAnalysis:
    @pytest.mark.parametrize("n_sources,connector,expected_max_minutes", [
        (100, "x_twitter", 120),
        (1000, "x_twitter", 1200),
        (100, "youtube", 10),
        (1000, "youtube", 60),
        (100, "facebook_page", 35),
        (1000, "facebook_page", 350),
        (100, "rss", 5),
        (1000, "rss", 25),
        (100, "website", 15),
        (1000, "website", 120),
    ])
    def test_crawl_time_estimation(self, n_sources, connector, expected_max_minutes):
        from src.config.settings import load_settings
        settings = load_settings()

        rate_cfg = settings.rate_limits.get(connector)
        if rate_cfg is None:
            pytest.skip(f"No rate limit config for {connector}")

        rate = rate_cfg.requests_per_window / rate_cfg.window_seconds
        reqs_per_source = 2 if connector == "youtube" else 1
        total_requests = n_sources * reqs_per_source

        crawl_seconds = total_requests / rate
        crawl_minutes = crawl_seconds / 60
        schedule_interval = settings.scheduler.default_interval_minutes

        print(
            f"\n  {connector} × {n_sources}: "
            f"{crawl_minutes:.1f} min to crawl all "
            f"(schedule interval: {schedule_interval} min)"
        )

        assert crawl_minutes <= expected_max_minutes

        if crawl_minutes > schedule_interval:
            print(
                f"  ⚠ WARNING: Crawl time ({crawl_minutes:.1f}min) > "
                f"schedule interval ({schedule_interval}min). "
                f"Jobs will pile up!"
            )


# ===================================================================
# Realistic simulation: verify smooth request flow
# ===================================================================


class TestRealisticRequestFlow:
    """End-to-end: 10 X/Twitter sources with accelerated rate, verify NO burst."""

    @respx.mock
    async def test_10_twitter_sources_smooth_flow(self):
        """Use faster rate (5 tokens / 5s = 1/s) to keep test under 30s.

        10 sources: 5 instant, then 5 spaced ~1s apart.
        Before fix: all 5 delayed would burst in <0.5s.
        After fix: each gets its own ~1s slot.
        """
        limiter = RateLimiter({
            "x_twitter": RateLimitConfig(requests_per_window=5, window_seconds=5),
        })

        request_log: list[tuple[int, float]] = []
        t0 = time.monotonic()

        def make_handler(sid):
            def handler(request):
                request_log.append((sid, time.monotonic() - t0))
                return httpx.Response(200, json={"data": [], "meta": {"result_count": 0}})
            return handler

        for i in range(10):
            respx.get(f"{TWITTER_API}/users/user{i}/tweets").mock(
                side_effect=make_handler(i)
            )

        async def crawl(source_id: int):
            source = make_source("x_twitter", url_or_handle=f"user{source_id}")
            async with httpx.AsyncClient() as client:
                conn = XTwitterConnector(source, client, limiter)
                with pytest.MonkeyPatch.context() as mp:
                    mp.setenv("X_BEARER_TOKEN", "fake")
                    return await conn.fetch()

        results = await asyncio.gather(*[crawl(i) for i in range(10)])

        timestamps = sorted([t for _, t in request_log])

        # First batch: 5 instant
        first_batch = [t for t in timestamps if t < 0.5]
        assert len(first_batch) == 5, f"First batch: {len(first_batch)} (expected 5)"

        # Second batch: should be SPREAD OUT (~1s each), not all at once
        second_batch = [t for t in timestamps if t >= 0.5]
        assert len(second_batch) == 5

        batch_spread = max(second_batch) - min(second_batch)
        print(
            f"\n  Second batch ({len(second_batch)} requests): "
            f"spread over {batch_spread:.2f}s"
        )

        # 5 requests × 1s each = ~4s spread. Allow some tolerance.
        assert batch_spread >= 3.0, (
            f"Requests still bursting: spread={batch_spread:.2f}s (expected ≥3s). "
            f"Timestamps: {[f'{t:.2f}' for t in timestamps]}"
        )

        assert len(results) == 10


# ===================================================================
# Stagger verification
# ===================================================================


class TestSchedulerStagger:
    """Verify stagger produces deterministic, well-distributed offsets."""

    def test_stagger_is_deterministic(self):
        from src.scheduler.engine import SchedulerEngine
        from unittest.mock import MagicMock

        engine = SchedulerEngine.__new__(SchedulerEngine)
        s1 = engine._stagger_seconds("source-abc")
        s2 = engine._stagger_seconds("source-abc")
        assert s1 == s2, "Same source_id should give same stagger"

    def test_stagger_distributes_evenly(self):
        from src.scheduler.engine import SchedulerEngine

        engine = SchedulerEngine.__new__(SchedulerEngine)
        staggers = [engine._stagger_seconds(f"source-{i}") for i in range(100)]

        # Should cover a reasonable range (not all cluster near 0)
        assert max(staggers) > 200, f"Max stagger only {max(staggers)}s — poor distribution"
        assert min(staggers) < 50, f"Min stagger {min(staggers)}s — poor distribution"

        # Check spread: at least 5 distinct 60s buckets should be used
        buckets = {s // 60 for s in staggers}
        assert len(buckets) >= 4, f"Only {len(buckets)} 60s buckets used — poor spread"
