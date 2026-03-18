"""Tests for YouTube connector."""
from __future__ import annotations

import httpx
import pytest
import respx

from src.connectors.youtube import YouTubeConnector
from tests.test_connectors.conftest import make_source

YT_API = "https://www.googleapis.com/youtube/v3"


def _search_response(items: list[dict]) -> dict:
    return {
        "items": items,
        "pageInfo": {"totalResults": len(items)},
    }


def _video_item(video_id: str, title: str, published: str = "2026-01-15T12:00:00Z") -> dict:
    return {
        "id": {"videoId": video_id},
        "snippet": {
            "title": title,
            "description": f"Description for {title}",
            "publishedAt": published,
            "channelTitle": "Test Channel",
            "thumbnails": {},
        },
    }


def _stats_response(stats: dict[str, dict]) -> dict:
    return {
        "items": [
            {"id": vid, "statistics": s}
            for vid, s in stats.items()
        ]
    }


class TestYouTubeFetch:
    @respx.mock
    async def test_fetch_basic(self, noop_rate_limiter):
        """Fetch should return videos with statistics."""
        source = make_source("youtube", url_or_handle="UCtest123")

        respx.get(f"{YT_API}/search").mock(
            return_value=httpx.Response(200, json=_search_response([
                _video_item("vid1", "Video 1", "2026-01-15T12:00:00Z"),
                _video_item("vid2", "Video 2", "2026-01-14T12:00:00Z"),
            ]))
        )
        respx.get(f"{YT_API}/videos").mock(
            return_value=httpx.Response(200, json=_stats_response({
                "vid1": {"viewCount": "1000", "likeCount": "50", "commentCount": "10"},
                "vid2": {"viewCount": "500", "likeCount": "20", "commentCount": "5"},
            }))
        )

        async with httpx.AsyncClient() as client:
            connector = YouTubeConnector(source, client, noop_rate_limiter)
            with pytest.MonkeyPatch.context() as mp:
                mp.setenv("YOUTUBE_API_KEY", "fake-key")
                result = await connector.fetch()

        assert len(result.raw_items) == 2
        assert result.new_cursor == "2026-01-15T12:00:00Z"
        assert result.raw_items[0]["statistics"]["viewCount"] == "1000"

    @respx.mock
    async def test_fetch_with_cursor_sends_publishedAfter(self, noop_rate_limiter):
        """since_cursor should map to publishedAfter parameter."""
        source = make_source("youtube", url_or_handle="UCtest123")

        search_route = respx.get(f"{YT_API}/search").mock(
            return_value=httpx.Response(200, json=_search_response([]))
        )

        async with httpx.AsyncClient() as client:
            connector = YouTubeConnector(source, client, noop_rate_limiter)
            with pytest.MonkeyPatch.context() as mp:
                mp.setenv("YOUTUBE_API_KEY", "fake-key")
                await connector.fetch(since_cursor="2026-01-01T00:00:00Z")

        request = search_route.calls[0].request
        assert "publishedAfter=2026-01-01T00" in str(request.url)

    @respx.mock
    async def test_fetch_consumes_two_rate_limit_tokens(self, noop_rate_limiter):
        """YouTube fetch makes 2 API calls (search + stats) = 2 rate limit acquires."""
        source = make_source("youtube", url_or_handle="UCtest123")

        acquire_count = 0
        original = noop_rate_limiter.acquire

        async def counting_acquire(ctype):
            nonlocal acquire_count
            acquire_count += 1

        noop_rate_limiter.acquire = counting_acquire

        respx.get(f"{YT_API}/search").mock(
            return_value=httpx.Response(200, json=_search_response([
                _video_item("vid1", "V1"),
            ]))
        )
        respx.get(f"{YT_API}/videos").mock(
            return_value=httpx.Response(200, json=_stats_response({"vid1": {}}))
        )

        async with httpx.AsyncClient() as client:
            connector = YouTubeConnector(source, client, noop_rate_limiter)
            with pytest.MonkeyPatch.context() as mp:
                mp.setenv("YOUTUBE_API_KEY", "fake-key")
                await connector.fetch()

        assert acquire_count == 2, "Should acquire rate limit for both search and stats calls"

    @respx.mock
    async def test_api_key_sent_as_query_param(self, noop_rate_limiter):
        """API key should appear as 'key' query parameter, not in headers."""
        source = make_source("youtube", url_or_handle="UCtest123")

        route = respx.get(f"{YT_API}/search").mock(
            return_value=httpx.Response(200, json=_search_response([]))
        )

        async with httpx.AsyncClient() as client:
            connector = YouTubeConnector(source, client, noop_rate_limiter)
            with pytest.MonkeyPatch.context() as mp:
                mp.setenv("YOUTUBE_API_KEY", "my-yt-key")
                await connector.fetch()

        request = route.calls[0].request
        assert "key=my-yt-key" in str(request.url)
        # Key should NOT be in Authorization header
        assert "authorization" not in {k.lower() for k in request.headers.keys()} or \
               "my-yt-key" not in request.headers.get("authorization", "")

    @respx.mock
    async def test_stats_batch_limited_to_50(self, noop_rate_limiter):
        """Video IDs batch for stats should be capped at 50."""
        source = make_source("youtube", url_or_handle="UCtest123", config={"max_results": 25})

        # Create 60 videos
        videos = [_video_item(f"vid{i}", f"V{i}") for i in range(60)]
        respx.get(f"{YT_API}/search").mock(
            return_value=httpx.Response(200, json=_search_response(videos))
        )
        stats_route = respx.get(f"{YT_API}/videos").mock(
            return_value=httpx.Response(200, json=_stats_response({}))
        )

        async with httpx.AsyncClient() as client:
            connector = YouTubeConnector(source, client, noop_rate_limiter)
            with pytest.MonkeyPatch.context() as mp:
                mp.setenv("YOUTUBE_API_KEY", "fake")
                await connector.fetch()

        request = stats_route.calls[0].request
        # Count comma-separated IDs in the 'id' param
        url_str = str(request.url)
        # The id parameter should have at most 50 IDs
        id_param = [p for p in url_str.split("&") if p.startswith("id=")][0]
        ids = id_param.split("=")[1].split("%2C")  # URL-encoded commas
        assert len(ids) <= 50


class TestYouTubeNormalize:
    def test_normalize_video(self, noop_rate_limiter):
        source = make_source("youtube", url_or_handle="UCtest123")
        connector = YouTubeConnector(source, httpx.AsyncClient(), noop_rate_limiter)

        raw = {
            "video_id": "abc123",
            "title": "Test Video",
            "description": "A description",
            "published_at": "2026-01-15T12:00:00Z",
            "channel_title": "Test Channel",
            "thumbnails": {},
            "statistics": {"viewCount": "1000", "likeCount": "50", "commentCount": "10"},
        }
        item = connector.normalize(raw)

        assert item.url == "https://www.youtube.com/watch?v=abc123"
        assert item.title == "Test Video"
        assert item.engagement_snapshot["views"] == 1000
        assert item.engagement_snapshot["likes"] == 50

    def test_normalize_no_stats(self, noop_rate_limiter):
        source = make_source("youtube", url_or_handle="UCtest123")
        connector = YouTubeConnector(source, httpx.AsyncClient(), noop_rate_limiter)

        raw = {"video_id": "abc123", "title": "T", "description": "", "published_at": "", "statistics": {}}
        item = connector.normalize(raw)
        assert item.engagement_snapshot is None
