"""Tests for Instagram Pro connector."""
from __future__ import annotations

import httpx
import pytest
import respx

from src.connectors.instagram_pro import InstagramProConnector
from tests.test_connectors.conftest import make_source

IG_API = "https://graph.facebook.com/v19.0"


def _media_response(items: list[dict]) -> dict:
    return {"data": items}


def _media(media_id: str, caption: str, ts: str = "2026-01-15T12:00:00+0000") -> dict:
    return {
        "id": media_id,
        "caption": caption,
        "timestamp": ts,
        "permalink": f"https://instagram.com/p/{media_id}",
        "like_count": 50,
        "comments_count": 10,
        "media_type": "IMAGE",
    }


class TestInstagramProFetch:
    @respx.mock
    async def test_fetch_basic(self, noop_rate_limiter):
        source = make_source("instagram_pro", url_or_handle="ig_user_123")

        respx.get(f"{IG_API}/ig_user_123/media").mock(
            return_value=httpx.Response(200, json=_media_response([
                _media("m1", "Photo 1"),
                _media("m2", "Photo 2", "2026-01-14T12:00:00+0000"),
            ]))
        )

        async with httpx.AsyncClient() as client:
            connector = InstagramProConnector(source, client, noop_rate_limiter)
            with pytest.MonkeyPatch.context() as mp:
                mp.setenv("IG_ACCESS_TOKEN", "fake-ig-token")
                result = await connector.fetch()

        assert len(result.raw_items) == 2
        assert result.new_cursor == "2026-01-15T12:00:00+0000"

    @respx.mock
    async def test_since_cursor(self, noop_rate_limiter):
        source = make_source("instagram_pro", url_or_handle="ig_user_123")

        route = respx.get(f"{IG_API}/ig_user_123/media").mock(
            return_value=httpx.Response(200, json=_media_response([]))
        )

        async with httpx.AsyncClient() as client:
            connector = InstagramProConnector(source, client, noop_rate_limiter)
            with pytest.MonkeyPatch.context() as mp:
                mp.setenv("IG_ACCESS_TOKEN", "fake")
                await connector.fetch(since_cursor="2026-01-01T00:00:00+0000")

        request = route.calls[0].request
        assert "since=" in str(request.url)

    @respx.mock
    async def test_fields_requested(self, noop_rate_limiter):
        """Verify the connector requests all needed fields."""
        source = make_source("instagram_pro", url_or_handle="ig_user_123")

        route = respx.get(f"{IG_API}/ig_user_123/media").mock(
            return_value=httpx.Response(200, json=_media_response([]))
        )

        async with httpx.AsyncClient() as client:
            connector = InstagramProConnector(source, client, noop_rate_limiter)
            with pytest.MonkeyPatch.context() as mp:
                mp.setenv("IG_ACCESS_TOKEN", "fake")
                await connector.fetch()

        request_url = str(route.calls[0].request.url)
        for field in ["caption", "timestamp", "permalink", "like_count", "comments_count"]:
            assert field in request_url


class TestInstagramProNormalize:
    def test_normalize_media(self, noop_rate_limiter):
        source = make_source("instagram_pro", url_or_handle="ig_user_123")
        connector = InstagramProConnector(source, httpx.AsyncClient(), noop_rate_limiter)

        raw = {
            "media_id": "m1", "caption": "Great photo", "timestamp": "2026-01-15T12:00:00+0000",
            "permalink": "https://instagram.com/p/m1", "like_count": 50, "comments_count": 10,
            "media_type": "IMAGE",
        }
        item = connector.normalize(raw)

        assert item.url == "https://instagram.com/p/m1"
        assert item.text_content == "Great photo"
        assert item.engagement_snapshot["likes"] == 50
        assert item.engagement_snapshot["media_type"] == "IMAGE"
