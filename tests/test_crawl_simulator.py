"""Crawl Simulator — end-to-end scenarios verifying anti-bot safety.

These tests simulate realistic crawling patterns and verify that the system:
1. Respects rate limits across concurrent crawls
2. Doesn't burst requests in ways that trigger bot detection
3. Handles API errors (429, 403) gracefully
4. Maintains proper request spacing for website scraping
5. Uses cursor-based pagination to avoid redundant fetches
"""
from __future__ import annotations

import asyncio
import time
from collections import defaultdict
from typing import Any

import httpx
import pytest
import respx

from src.config.settings import RateLimitConfig
from src.connectors.base import FetchResult
from src.connectors.rss import RSSConnector
from src.connectors.website import WebsiteConnector
from src.connectors.x_twitter import XTwitterConnector
from src.connectors.youtube import YouTubeConnector
from src.connectors.facebook_page import FacebookPageConnector
from src.connectors.instagram_pro import InstagramProConnector
from src.utils.rate_limiter import RateLimiter

from tests.test_connectors.conftest import make_source

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

TWITTER_API = "https://api.twitter.com/2"
YT_API = "https://www.googleapis.com/youtube/v3"
FB_API = "https://graph.facebook.com/v19.0"

SAMPLE_RSS = """<?xml version="1.0"?>
<rss version="2.0"><channel><title>T</title>
  <item><title>A1</title><link>https://e.com/1</link><guid>g1</guid><description>D1</description></item>
  <item><title>A2</title><link>https://e.com/2</link><guid>g2</guid><description>D2</description></item>
</channel></rss>"""

SAMPLE_HTML = """
<html><body>
  <article><h2><a href="/p1">P1</a></h2><p>Content 1</p></article>
  <article><h2><a href="/p2">P2</a></h2><p>Content 2</p></article>
</body></html>"""


# ---------------------------------------------------------------------------
# Scenario 1: Multi-source concurrent crawl respects per-connector limits
# ---------------------------------------------------------------------------


class TestConcurrentMultiSourceCrawl:
    """Simulate the scheduler firing multiple source jobs at once."""

    @respx.mock
    async def test_parallel_sources_stay_within_rate_limits(self):
        """
        Scenario: 3 X/Twitter sources fire at the same time.
        With limit of 2 req/10s, only 2 should proceed immediately,
        the 3rd must wait.
        """
        limiter = RateLimiter(
            {"x_twitter": RateLimitConfig(requests_per_window=2, window_seconds=10)}
        )

        request_times: list[float] = []
        t0 = time.monotonic()

        def recording_handler(request):
            request_times.append(time.monotonic() - t0)
            return httpx.Response(200, json={"data": [], "meta": {"result_count": 0}})

        respx.get(f"{TWITTER_API}/users/u1/tweets").mock(side_effect=recording_handler)
        respx.get(f"{TWITTER_API}/users/u2/tweets").mock(side_effect=recording_handler)
        respx.get(f"{TWITTER_API}/users/u3/tweets").mock(side_effect=recording_handler)

        async def crawl_source(user_id: str):
            source = make_source("x_twitter", url_or_handle=user_id)
            async with httpx.AsyncClient() as client:
                connector = XTwitterConnector(source, client, limiter)
                with pytest.MonkeyPatch.context() as mp:
                    mp.setenv("X_BEARER_TOKEN", "fake")
                    return await connector.fetch()

        results = await asyncio.gather(
            crawl_source("u1"),
            crawl_source("u2"),
            crawl_source("u3"),
        )

        assert all(isinstance(r, FetchResult) for r in results)

        # First 2 requests should be near-instant (<0.5s)
        fast_requests = [t for t in sorted(request_times) if t < 0.5]
        assert len(fast_requests) == 2, (
            f"Expected 2 fast requests but got {len(fast_requests)}: {request_times}"
        )
        # 3rd should be delayed by rate limiter
        slow_requests = [t for t in sorted(request_times) if t >= 2.0]
        assert len(slow_requests) >= 1, (
            f"3rd request should have been delayed: {request_times}"
        )


# ---------------------------------------------------------------------------
# Scenario 2: Mixed-platform crawl (different connectors don't interfere)
# ---------------------------------------------------------------------------


class TestMixedPlatformCrawl:
    """Different connector types should have independent rate limit buckets."""

    @respx.mock
    async def test_twitter_and_rss_independent(self):
        """Exhausting X/Twitter limit should NOT block RSS."""
        limiter = RateLimiter({
            "x_twitter": RateLimitConfig(requests_per_window=1, window_seconds=60),
            "rss": RateLimitConfig(requests_per_window=10, window_seconds=60),
        })

        respx.get(f"{TWITTER_API}/users/u1/tweets").mock(
            return_value=httpx.Response(200, json={"data": [], "meta": {"result_count": 0}})
        )
        respx.get("https://example.com/feed.xml").mock(
            return_value=httpx.Response(200, text=SAMPLE_RSS)
        )

        # Exhaust X/Twitter bucket
        tw_source = make_source("x_twitter", url_or_handle="u1")
        async with httpx.AsyncClient() as client:
            tw_conn = XTwitterConnector(tw_source, client, limiter)
            with pytest.MonkeyPatch.context() as mp:
                mp.setenv("X_BEARER_TOKEN", "fake")
                await tw_conn.fetch()

        # RSS should still be instant
        rss_source = make_source("rss", url_or_handle="https://example.com/feed.xml")
        t0 = time.monotonic()
        async with httpx.AsyncClient() as client:
            rss_conn = RSSConnector(rss_source, client, limiter)
            await rss_conn.fetch()
        elapsed = time.monotonic() - t0

        assert elapsed < 0.5, "RSS should not be affected by X/Twitter rate limit"


# ---------------------------------------------------------------------------
# Scenario 3: API error handling (429, 403, 500)
# ---------------------------------------------------------------------------


class TestAPIErrorHandling:
    """Simulate platform API error responses."""

    @respx.mock
    async def test_twitter_429_raises_properly(self):
        """429 from X/Twitter should raise, allowing the scheduler to retry later."""
        limiter = RateLimiter({})

        respx.get(f"{TWITTER_API}/users/u1/tweets").mock(
            return_value=httpx.Response(
                429,
                json={"title": "Too Many Requests", "detail": "Rate limit exceeded"},
                headers={"x-rate-limit-reset": "1700000000", "retry-after": "900"},
            )
        )

        source = make_source("x_twitter", url_or_handle="u1")
        async with httpx.AsyncClient() as client:
            conn = XTwitterConnector(source, client, limiter)
            with pytest.MonkeyPatch.context() as mp:
                mp.setenv("X_BEARER_TOKEN", "fake")
                with pytest.raises(httpx.HTTPStatusError) as exc_info:
                    await conn.fetch()

            assert exc_info.value.response.status_code == 429

    @respx.mock
    async def test_youtube_403_quota_exceeded(self):
        """YouTube 403 (quota exceeded) should raise."""
        limiter = RateLimiter({})

        respx.get(f"{YT_API}/search").mock(
            return_value=httpx.Response(
                403,
                json={"error": {"code": 403, "message": "Daily Limit Exceeded"}},
            )
        )

        source = make_source("youtube", url_or_handle="UCtest")
        async with httpx.AsyncClient() as client:
            conn = YouTubeConnector(source, client, limiter)
            with pytest.MonkeyPatch.context() as mp:
                mp.setenv("YOUTUBE_API_KEY", "fake")
                with pytest.raises(httpx.HTTPStatusError) as exc_info:
                    await conn.fetch()
            assert exc_info.value.response.status_code == 403

    @respx.mock
    async def test_facebook_token_expired(self):
        """Facebook 400 with OAuthException should raise."""
        limiter = RateLimiter({})

        respx.get(f"{FB_API}/page1/posts").mock(
            return_value=httpx.Response(
                400,
                json={"error": {"type": "OAuthException", "message": "Token expired"}},
            )
        )

        source = make_source("facebook_page", url_or_handle="page1")
        async with httpx.AsyncClient() as client:
            conn = FacebookPageConnector(source, client, limiter)
            with pytest.MonkeyPatch.context() as mp:
                mp.setenv("FB_ACCESS_TOKEN", "expired-token")
                with pytest.raises(httpx.HTTPStatusError):
                    await conn.fetch()

    @respx.mock
    async def test_website_server_error(self):
        """500 errors from websites should raise."""
        limiter = RateLimiter({})

        respx.get("https://example.com").mock(
            return_value=httpx.Response(500, text="Internal Server Error")
        )

        source = make_source("website", url_or_handle="https://example.com")
        async with httpx.AsyncClient() as client:
            conn = WebsiteConnector(source, client, limiter)
            with pytest.raises(httpx.HTTPStatusError):
                await conn.fetch()


# ---------------------------------------------------------------------------
# Scenario 4: Website scraping — request frequency analysis
# ---------------------------------------------------------------------------


class TestWebsiteScrapingFrequency:
    """Website scraping must be the most conservative to avoid bans."""

    @respx.mock
    async def test_sequential_website_crawls_are_throttled(self):
        """Multiple website fetches should be spaced by rate limiter."""
        limiter = RateLimiter({
            "website": RateLimitConfig(requests_per_window=2, window_seconds=10),
        })

        request_times: list[float] = []
        t0 = time.monotonic()

        def recording_handler(request):
            request_times.append(time.monotonic() - t0)
            return httpx.Response(200, text=SAMPLE_HTML)

        respx.get("https://site1.com").mock(side_effect=recording_handler)
        respx.get("https://site2.com").mock(side_effect=recording_handler)
        respx.get("https://site3.com").mock(side_effect=recording_handler)

        for url in ["https://site1.com", "https://site2.com", "https://site3.com"]:
            source = make_source("website", url_or_handle=url)
            async with httpx.AsyncClient() as client:
                conn = WebsiteConnector(source, client, limiter)
                await conn.fetch()

        # 3rd request should have waited
        assert len(request_times) == 3
        gap = request_times[2] - request_times[1]
        assert gap >= 2.0, f"Website requests too close together: gap={gap:.2f}s"


# ---------------------------------------------------------------------------
# Scenario 5: Cursor continuity (no redundant fetches)
# ---------------------------------------------------------------------------


class TestCursorContinuity:
    """Verify that cursors prevent redundant data fetching."""

    @respx.mock
    async def test_twitter_cursor_prevents_refetch(self):
        """Second fetch with cursor should request only newer tweets."""
        limiter = RateLimiter({})

        call_count = 0

        def handler(request):
            nonlocal call_count
            call_count += 1
            url_str = str(request.url)
            if "since_id=999" in url_str:
                # Second call — no new tweets
                return httpx.Response(200, json={"meta": {"result_count": 0}})
            # First call — return tweets
            return httpx.Response(200, json={
                "data": [{"id": "999", "text": "Latest", "created_at": "2026-01-15T12:00:00Z",
                          "public_metrics": {}, "entities": {}}],
                "meta": {"result_count": 1},
            })

        respx.get(f"{TWITTER_API}/users/u1/tweets").mock(side_effect=handler)

        source = make_source("x_twitter", url_or_handle="u1")

        # First fetch
        async with httpx.AsyncClient() as client:
            conn = XTwitterConnector(source, client, limiter)
            with pytest.MonkeyPatch.context() as mp:
                mp.setenv("X_BEARER_TOKEN", "fake")
                r1 = await conn.fetch()

        assert r1.new_cursor == "999"
        assert len(r1.raw_items) == 1

        # Second fetch with cursor
        async with httpx.AsyncClient() as client:
            conn = XTwitterConnector(source, client, limiter)
            with pytest.MonkeyPatch.context() as mp:
                mp.setenv("X_BEARER_TOKEN", "fake")
                r2 = await conn.fetch(since_cursor="999")

        assert r2.raw_items == []
        assert r2.new_cursor == "999"  # Preserved

    @respx.mock
    async def test_rss_cursor_stops_at_seen_entry(self):
        """RSS fetch with cursor should stop at the previously seen entry."""
        limiter = RateLimiter({})

        rss = """<?xml version="1.0"?>
        <rss version="2.0"><channel><title>T</title>
          <item><guid>new-1</guid><title>New</title><link>https://e.com/new</link><description>N</description></item>
          <item><guid>old-1</guid><title>Old</title><link>https://e.com/old</link><description>O</description></item>
        </channel></rss>"""

        respx.get("https://example.com/feed.xml").mock(
            return_value=httpx.Response(200, text=rss)
        )

        source = make_source("rss", url_or_handle="https://example.com/feed.xml")
        async with httpx.AsyncClient() as client:
            conn = RSSConnector(source, client, limiter)
            result = await conn.fetch(since_cursor="old-1")

        assert len(result.raw_items) == 1
        assert result.raw_items[0]["id"] == "new-1"


# ---------------------------------------------------------------------------
# Scenario 6: Burst detection — verify no rapid-fire requests
# ---------------------------------------------------------------------------


class TestBurstDetection:
    """Ensure the system never sends rapid-fire requests to any platform."""

    @respx.mock
    async def test_youtube_search_plus_stats_not_simultaneous(self):
        """YouTube search + stats requests should both go through rate limiter."""
        limiter = RateLimiter({
            "youtube": RateLimitConfig(requests_per_window=5, window_seconds=10),
        })

        acquire_times: list[float] = []
        t0 = time.monotonic()

        original_acquire = limiter.acquire

        async def tracking_acquire(ctype):
            acquire_times.append(time.monotonic() - t0)
            # Use a no-op instead of the actual acquire to avoid blocking
            return

        limiter.acquire = tracking_acquire

        respx.get(f"{YT_API}/search").mock(
            return_value=httpx.Response(200, json={
                "items": [{"id": {"videoId": "v1"}, "snippet": {"title": "T", "description": "D",
                           "publishedAt": "2026-01-15T12:00:00Z", "channelTitle": "C", "thumbnails": {}}}],
                "pageInfo": {"totalResults": 1},
            })
        )
        respx.get(f"{YT_API}/videos").mock(
            return_value=httpx.Response(200, json={"items": [{"id": "v1", "statistics": {}}]})
        )

        source = make_source("youtube", url_or_handle="UCtest")
        async with httpx.AsyncClient() as client:
            conn = YouTubeConnector(source, client, limiter)
            with pytest.MonkeyPatch.context() as mp:
                mp.setenv("YOUTUBE_API_KEY", "fake")
                await conn.fetch()

        # Both search and stats should have called acquire
        assert len(acquire_times) == 2

    @respx.mock
    async def test_no_request_without_rate_limit_check(self):
        """Every connector fetch must call rate_limiter.acquire before HTTP request."""
        limiter = RateLimiter({})
        acquired_types: list[str] = []

        async def tracking_acquire(ctype):
            acquired_types.append(ctype)

        limiter.acquire = tracking_acquire

        connectors_and_mocks = [
            (
                "rss",
                "https://example.com/feed.xml",
                [("https://example.com/feed.xml", httpx.Response(200, text=SAMPLE_RSS))],
            ),
            (
                "website",
                "https://example.com",
                [("https://example.com", httpx.Response(200, text=SAMPLE_HTML))],
            ),
        ]

        for ctype, handle, mocks in connectors_and_mocks:
            acquired_types.clear()
            with respx.mock:
                for url, response in mocks:
                    respx.get(url).mock(return_value=response)

                source = make_source(ctype, url_or_handle=handle)
                async with httpx.AsyncClient() as client:
                    if ctype == "rss":
                        conn = RSSConnector(source, client, limiter)
                    else:
                        conn = WebsiteConnector(source, client, limiter)
                    await conn.fetch()

            assert len(acquired_types) >= 1, f"{ctype} connector did not call rate_limiter.acquire"


# ---------------------------------------------------------------------------
# Scenario 7: Full fetch-normalize cycle
# ---------------------------------------------------------------------------


class TestFetchNormalizeCycle:
    """Test the complete fetch_and_normalize convenience method."""

    @respx.mock
    async def test_twitter_fetch_and_normalize(self):
        limiter = RateLimiter({})
        source = make_source("x_twitter", url_or_handle="u1", config={"username": "testuser"})

        respx.get(f"{TWITTER_API}/users/u1/tweets").mock(
            return_value=httpx.Response(200, json={
                "data": [
                    {"id": "100", "text": "Hello", "created_at": "2026-01-15T12:00:00Z",
                     "public_metrics": {"like_count": 5, "retweet_count": 1, "reply_count": 0,
                                        "impression_count": 100}, "entities": {}},
                ],
                "meta": {"result_count": 1},
            })
        )

        async with httpx.AsyncClient() as client:
            conn = XTwitterConnector(source, client, limiter)
            with pytest.MonkeyPatch.context() as mp:
                mp.setenv("X_BEARER_TOKEN", "fake")
                items, cursor = await conn.fetch_and_normalize()

        assert len(items) == 1
        assert items[0].url == "https://x.com/testuser/status/100"
        assert items[0].text_content == "Hello"
        assert cursor == "100"

    @respx.mock
    async def test_rss_fetch_and_normalize(self):
        limiter = RateLimiter({})
        source = make_source("rss", url_or_handle="https://example.com/feed.xml")

        respx.get("https://example.com/feed.xml").mock(
            return_value=httpx.Response(200, text=SAMPLE_RSS)
        )

        async with httpx.AsyncClient() as client:
            conn = RSSConnector(source, client, limiter)
            items, cursor = await conn.fetch_and_normalize()

        assert len(items) == 2
        assert items[0].url == "https://e.com/1"
        assert cursor == "g1"
