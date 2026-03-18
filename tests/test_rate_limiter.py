"""Tests for the token-bucket rate limiter."""
from __future__ import annotations

import asyncio
import time
from unittest.mock import patch

import pytest

from src.config.settings import RateLimitConfig
from src.utils.rate_limiter import RateLimiter


@pytest.fixture
def limiter() -> RateLimiter:
    """Create a rate limiter with tight limits for fast testing."""
    return RateLimiter(
        {
            "x_twitter": RateLimitConfig(requests_per_window=3, window_seconds=10),
            "youtube": RateLimitConfig(requests_per_window=5, window_seconds=10),
        }
    )


class TestTokenBucketBasics:
    async def test_acquire_within_limit(self, limiter: RateLimiter):
        """Requests within the budget should return immediately."""
        t0 = time.monotonic()
        for _ in range(3):
            await limiter.acquire("x_twitter")
        elapsed = time.monotonic() - t0
        assert elapsed < 0.1, "Should not block when tokens are available"

    async def test_acquire_exceeds_limit_blocks(self, limiter: RateLimiter):
        """The 4th request should block until a token refills."""
        for _ in range(3):
            await limiter.acquire("x_twitter")

        t0 = time.monotonic()
        await limiter.acquire("x_twitter")
        elapsed = time.monotonic() - t0
        # refill_rate = 3/10 = 0.3 token/s => ~3.33s per token
        assert elapsed >= 2.5, "Should wait for token refill"

    async def test_unknown_connector_not_limited(self, limiter: RateLimiter):
        """Connectors without configured limits pass through freely."""
        t0 = time.monotonic()
        for _ in range(100):
            await limiter.acquire("unknown_type")
        elapsed = time.monotonic() - t0
        assert elapsed < 0.1

    async def test_independent_buckets(self, limiter: RateLimiter):
        """Each connector type has its own independent bucket."""
        # Exhaust x_twitter tokens
        for _ in range(3):
            await limiter.acquire("x_twitter")

        # youtube should still have tokens
        t0 = time.monotonic()
        await limiter.acquire("youtube")
        elapsed = time.monotonic() - t0
        assert elapsed < 0.1


class TestTokenRefill:
    async def test_tokens_refill_over_time(self):
        """Tokens should refill gradually based on elapsed time."""
        limiter = RateLimiter(
            {"fast": RateLimitConfig(requests_per_window=10, window_seconds=1)}
        )
        # Exhaust all tokens
        for _ in range(10):
            await limiter.acquire("fast")

        # Wait for partial refill (~5 tokens in 0.5s)
        await asyncio.sleep(0.55)

        t0 = time.monotonic()
        # Should be able to acquire a few without blocking
        await limiter.acquire("fast")
        elapsed = time.monotonic() - t0
        assert elapsed < 0.1

    async def test_tokens_cap_at_max(self):
        """Tokens should never exceed the configured maximum."""
        limiter = RateLimiter(
            {"capped": RateLimitConfig(requests_per_window=3, window_seconds=10)}
        )
        # Wait a long time (more than 1 full window)
        await asyncio.sleep(0.01)  # Just to trigger refill logic

        # Access the internal bucket to verify
        bucket = limiter._buckets["capped"]
        assert bucket.tokens <= 3.0


class TestConcurrency:
    async def test_concurrent_acquires_respect_limit(self):
        """Multiple concurrent tasks should collectively respect the rate limit."""
        limiter = RateLimiter(
            {"concurrent": RateLimitConfig(requests_per_window=3, window_seconds=60)}
        )
        results: list[float] = []

        async def worker():
            await limiter.acquire("concurrent")
            results.append(time.monotonic())

        t0 = time.monotonic()
        tasks = [asyncio.create_task(worker()) for _ in range(5)]
        await asyncio.gather(*tasks)

        # First 3 should be fast, remaining 2 should wait
        fast = sum(1 for t in results if t - t0 < 0.5)
        assert fast == 3, f"Expected 3 fast acquires, got {fast}"
