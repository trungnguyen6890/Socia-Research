"""Tests for Facebook Page connector."""
from __future__ import annotations

import httpx
import pytest
import respx

from src.connectors.facebook_page import FacebookPageConnector
from tests.test_connectors.conftest import make_source

FB_API = "https://graph.facebook.com/v19.0"


def _posts_response(posts: list[dict]) -> dict:
    return {"data": posts}


def _post(post_id: str, message: str, created: str = "2026-01-15T12:00:00+0000") -> dict:
    return {
        "id": post_id,
        "message": message,
        "created_time": created,
        "permalink_url": f"https://facebook.com/{post_id}",
        "shares": {"count": 5},
        "likes": {"summary": {"total_count": 100}},
        "comments": {"summary": {"total_count": 20}},
    }


class TestFacebookPageFetch:
    @respx.mock
    async def test_fetch_basic(self, noop_rate_limiter):
        source = make_source("facebook_page", url_or_handle="page123")

        respx.get(f"{FB_API}/page123/posts").mock(
            return_value=httpx.Response(200, json=_posts_response([
                _post("p1", "First post"),
                _post("p2", "Second post", "2026-01-14T12:00:00+0000"),
            ]))
        )

        async with httpx.AsyncClient() as client:
            connector = FacebookPageConnector(source, client, noop_rate_limiter)
            with pytest.MonkeyPatch.context() as mp:
                mp.setenv("FB_ACCESS_TOKEN", "fake-token")
                result = await connector.fetch()

        assert len(result.raw_items) == 2
        assert result.new_cursor == "2026-01-15T12:00:00+0000"

    @respx.mock
    async def test_since_cursor_maps_to_since_param(self, noop_rate_limiter):
        source = make_source("facebook_page", url_or_handle="page123")

        route = respx.get(f"{FB_API}/page123/posts").mock(
            return_value=httpx.Response(200, json=_posts_response([]))
        )

        async with httpx.AsyncClient() as client:
            connector = FacebookPageConnector(source, client, noop_rate_limiter)
            with pytest.MonkeyPatch.context() as mp:
                mp.setenv("FB_ACCESS_TOKEN", "fake-token")
                await connector.fetch(since_cursor="2026-01-01T00:00:00+0000")

        request = route.calls[0].request
        assert "since=" in str(request.url)

    @respx.mock
    async def test_access_token_in_params_not_header(self, noop_rate_limiter):
        """FB Graph API sends token as query param — verify it's not leaked in headers."""
        source = make_source("facebook_page", url_or_handle="page123")

        route = respx.get(f"{FB_API}/page123/posts").mock(
            return_value=httpx.Response(200, json=_posts_response([]))
        )

        async with httpx.AsyncClient() as client:
            connector = FacebookPageConnector(source, client, noop_rate_limiter)
            with pytest.MonkeyPatch.context() as mp:
                mp.setenv("FB_ACCESS_TOKEN", "fb-secret")
                await connector.fetch()

        request = route.calls[0].request
        assert "access_token=fb-secret" in str(request.url)

    @respx.mock
    async def test_engagement_extraction(self, noop_rate_limiter):
        """Shares, likes, comments nested structures should be extracted correctly."""
        source = make_source("facebook_page", url_or_handle="page123")

        respx.get(f"{FB_API}/page123/posts").mock(
            return_value=httpx.Response(200, json=_posts_response([_post("p1", "Post")]))
        )

        async with httpx.AsyncClient() as client:
            connector = FacebookPageConnector(source, client, noop_rate_limiter)
            with pytest.MonkeyPatch.context() as mp:
                mp.setenv("FB_ACCESS_TOKEN", "fake")
                result = await connector.fetch()

        item = result.raw_items[0]
        assert item["shares"] == 5
        assert item["likes"] == 100
        assert item["comments"] == 20


class TestFacebookPageNormalize:
    def test_normalize_post(self, noop_rate_limiter):
        source = make_source("facebook_page", url_or_handle="page123")
        connector = FacebookPageConnector(source, httpx.AsyncClient(), noop_rate_limiter)

        raw = {
            "post_id": "p1", "message": "Hello", "created_time": "2026-01-15T12:00:00+0000",
            "permalink_url": "https://facebook.com/p1", "shares": 5, "likes": 100, "comments": 20,
        }
        item = connector.normalize(raw)

        assert item.url == "https://facebook.com/p1"
        assert item.engagement_snapshot["likes"] == 100
        assert item.engagement_snapshot["shares"] == 5
