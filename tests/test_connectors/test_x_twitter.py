"""Tests for X/Twitter connector."""
from __future__ import annotations

import os

import httpx
import pytest
import respx

from src.connectors.x_twitter import XTwitterConnector
from tests.test_connectors.conftest import make_source

TWITTER_API = "https://api.twitter.com/2"


def _tweets_response(tweets: list[dict], result_count: int | None = None) -> dict:
    """Build a mock X API v2 response."""
    return {
        "data": tweets,
        "meta": {"result_count": result_count or len(tweets)},
    }


def _tweet(tweet_id: str, text: str, created_at: str = "2026-01-15T12:00:00Z") -> dict:
    """Raw API format (as returned by X API v2 — key is 'id')."""
    return {
        "id": tweet_id,
        "text": text,
        "created_at": created_at,
        "public_metrics": {
            "like_count": 10,
            "retweet_count": 5,
            "reply_count": 2,
            "impression_count": 1000,
        },
        "entities": {},
    }


def _normalized_tweet(tweet_id: str, text: str, created_at: str = "2026-01-15T12:00:00Z") -> dict:
    """Post-fetch format (as produced by XTwitterConnector.fetch — key is 'tweet_id')."""
    return {
        "tweet_id": tweet_id,
        "text": text,
        "created_at": created_at,
        "public_metrics": {
            "like_count": 10,
            "retweet_count": 5,
            "reply_count": 2,
            "impression_count": 1000,
        },
        "entities": {},
    }


class TestXTwitterFetch:
    @respx.mock
    async def test_fetch_basic(self, noop_rate_limiter):
        """Basic fetch returns tweets and sets cursor to latest tweet ID."""
        source = make_source("x_twitter", url_or_handle="12345", config={"username": "testuser"})

        respx.get(f"{TWITTER_API}/users/12345/tweets").mock(
            return_value=httpx.Response(
                200,
                json=_tweets_response([
                    _tweet("999", "Hello world"),
                    _tweet("998", "Second tweet"),
                ]),
            )
        )

        async with httpx.AsyncClient() as client:
            connector = XTwitterConnector(source, client, noop_rate_limiter)
            with pytest.MonkeyPatch.context() as mp:
                mp.setenv("X_BEARER_TOKEN", "fake-token")
                result = await connector.fetch()

        assert len(result.raw_items) == 2
        assert result.new_cursor == "999"
        assert result.raw_items[0]["tweet_id"] == "999"

    @respx.mock
    async def test_fetch_with_since_cursor(self, noop_rate_limiter):
        """since_cursor should be forwarded as since_id parameter."""
        source = make_source("x_twitter", url_or_handle="12345")

        route = respx.get(f"{TWITTER_API}/users/12345/tweets").mock(
            return_value=httpx.Response(200, json=_tweets_response([]))
        )

        async with httpx.AsyncClient() as client:
            connector = XTwitterConnector(source, client, noop_rate_limiter)
            with pytest.MonkeyPatch.context() as mp:
                mp.setenv("X_BEARER_TOKEN", "fake-token")
                result = await connector.fetch(since_cursor="500")

        assert route.called
        request = route.calls[0].request
        assert "since_id=500" in str(request.url)
        # When no new data, cursor should fallback to since_cursor
        assert result.new_cursor == "500"

    @respx.mock
    async def test_fetch_empty_response(self, noop_rate_limiter):
        """Empty response should return empty list and preserve cursor."""
        source = make_source("x_twitter", url_or_handle="12345")

        respx.get(f"{TWITTER_API}/users/12345/tweets").mock(
            return_value=httpx.Response(200, json={"meta": {"result_count": 0}})
        )

        async with httpx.AsyncClient() as client:
            connector = XTwitterConnector(source, client, noop_rate_limiter)
            with pytest.MonkeyPatch.context() as mp:
                mp.setenv("X_BEARER_TOKEN", "fake-token")
                result = await connector.fetch(since_cursor="100")

        assert result.raw_items == []
        assert result.new_cursor == "100"

    @respx.mock
    async def test_fetch_rate_limit_429(self, noop_rate_limiter):
        """429 response should raise an HTTP error."""
        source = make_source("x_twitter", url_or_handle="12345")

        respx.get(f"{TWITTER_API}/users/12345/tweets").mock(
            return_value=httpx.Response(429, json={"title": "Too Many Requests"})
        )

        async with httpx.AsyncClient() as client:
            connector = XTwitterConnector(source, client, noop_rate_limiter)
            with pytest.MonkeyPatch.context() as mp:
                mp.setenv("X_BEARER_TOKEN", "fake-token")
                with pytest.raises(httpx.HTTPStatusError):
                    await connector.fetch()

    @respx.mock
    async def test_max_results_config(self, noop_rate_limiter):
        """max_results from config should be sent as parameter."""
        source = make_source("x_twitter", url_or_handle="12345", config={"max_results": 5})

        route = respx.get(f"{TWITTER_API}/users/12345/tweets").mock(
            return_value=httpx.Response(200, json=_tweets_response([]))
        )

        async with httpx.AsyncClient() as client:
            connector = XTwitterConnector(source, client, noop_rate_limiter)
            with pytest.MonkeyPatch.context() as mp:
                mp.setenv("X_BEARER_TOKEN", "fake-token")
                await connector.fetch()

        request = route.calls[0].request
        assert "max_results=5" in str(request.url)


class TestXTwitterNormalize:
    def test_normalize_tweet(self, noop_rate_limiter):
        """Normalize should produce correct URL and engagement data."""
        source = make_source("x_twitter", url_or_handle="12345", config={"username": "testuser"})
        connector = XTwitterConnector(source, httpx.AsyncClient(), noop_rate_limiter)

        item = connector.normalize(_normalized_tweet("999", "Hello world", "2026-01-15T12:00:00Z"))

        assert item.url == "https://x.com/testuser/status/999"
        assert item.text_content == "Hello world"
        assert item.publish_time == "2026-01-15T12:00:00Z"
        assert item.engagement_snapshot["likes"] == 10
        assert item.engagement_snapshot["retweets"] == 5

    def test_normalize_missing_username_falls_back_to_user_id(self, noop_rate_limiter):
        """When username is not in config, use url_or_handle (user ID)."""
        source = make_source("x_twitter", url_or_handle="12345")
        connector = XTwitterConnector(source, httpx.AsyncClient(), noop_rate_limiter)

        item = connector.normalize(_normalized_tweet("999", "Test"))
        assert "12345" in item.url

    def test_normalize_empty_metrics(self, noop_rate_limiter):
        """Empty public_metrics should produce None engagement_snapshot."""
        source = make_source("x_twitter", url_or_handle="12345")
        connector = XTwitterConnector(source, httpx.AsyncClient(), noop_rate_limiter)

        raw = {"tweet_id": "1", "text": "hi", "created_at": None, "public_metrics": {}, "entities": {}}
        item = connector.normalize(raw)
        # Empty dict is falsy, so engagement_snapshot should be None
        assert item.engagement_snapshot is None


class TestXTwitterAntiBot:
    """Verify anti-bot behavior for X/Twitter connector."""

    @respx.mock
    async def test_bearer_token_sent_in_header(self, noop_rate_limiter):
        """Authorization header must use Bearer scheme."""
        source = make_source("x_twitter", url_or_handle="12345")

        route = respx.get(f"{TWITTER_API}/users/12345/tweets").mock(
            return_value=httpx.Response(200, json=_tweets_response([]))
        )

        async with httpx.AsyncClient() as client:
            connector = XTwitterConnector(source, client, noop_rate_limiter)
            with pytest.MonkeyPatch.context() as mp:
                mp.setenv("X_BEARER_TOKEN", "my-secret-token")
                await connector.fetch()

        auth_header = route.calls[0].request.headers.get("authorization", "")
        assert auth_header == "Bearer my-secret-token"

    @respx.mock
    async def test_small_batch_size_default(self, noop_rate_limiter):
        """Default max_results should be 10 (conservative to avoid rate limits)."""
        source = make_source("x_twitter", url_or_handle="12345")

        route = respx.get(f"{TWITTER_API}/users/12345/tweets").mock(
            return_value=httpx.Response(200, json=_tweets_response([]))
        )

        async with httpx.AsyncClient() as client:
            connector = XTwitterConnector(source, client, noop_rate_limiter)
            with pytest.MonkeyPatch.context() as mp:
                mp.setenv("X_BEARER_TOKEN", "fake")
                await connector.fetch()

        request = route.calls[0].request
        assert "max_results=10" in str(request.url)

    @respx.mock
    async def test_rate_limiter_called_before_request(self, strict_rate_limiter):
        """Rate limiter should be invoked BEFORE making the HTTP request."""
        source = make_source("x_twitter", url_or_handle="12345")

        call_order: list[str] = []

        original_acquire = strict_rate_limiter.acquire

        async def tracked_acquire(ctype):
            call_order.append("acquire")
            # Don't actually wait - just track the call
            return

        strict_rate_limiter.acquire = tracked_acquire

        route = respx.get(f"{TWITTER_API}/users/12345/tweets").mock(
            side_effect=lambda req: (call_order.append("http"), httpx.Response(200, json=_tweets_response([])))[1]
        )

        async with httpx.AsyncClient() as client:
            connector = XTwitterConnector(source, client, strict_rate_limiter)
            with pytest.MonkeyPatch.context() as mp:
                mp.setenv("X_BEARER_TOKEN", "fake")
                await connector.fetch()

        assert call_order == ["acquire", "http"]
