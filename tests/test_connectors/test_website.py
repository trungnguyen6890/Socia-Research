"""Tests for Website connector."""
from __future__ import annotations

import httpx
import pytest
import respx

from src.connectors.website import WebsiteConnector
from tests.test_connectors.conftest import make_source

SAMPLE_HTML = """
<!DOCTYPE html>
<html>
<body>
  <article>
    <h2><a href="/post-1">Post One</a></h2>
    <p>First post content</p>
    <time>2026-01-15</time>
  </article>
  <article>
    <h2><a href="/post-2">Post Two</a></h2>
    <p>Second post content</p>
    <time>2026-01-14</time>
  </article>
  <article>
    <h2><a href="https://external.com/post-3">Post Three</a></h2>
    <p>Third post content</p>
    <time>2026-01-13</time>
  </article>
</body>
</html>
"""


class TestWebsiteFetch:
    @respx.mock
    async def test_fetch_with_default_selectors(self, noop_rate_limiter):
        """Default selectors should find <article> elements."""
        source = make_source("website", url_or_handle="https://blog.example.com")

        respx.get("https://blog.example.com").mock(
            return_value=httpx.Response(200, text=SAMPLE_HTML)
        )

        async with httpx.AsyncClient() as client:
            connector = WebsiteConnector(source, client, noop_rate_limiter)
            result = await connector.fetch()

        assert len(result.raw_items) == 3
        assert result.new_cursor == "https://blog.example.com/post-1"

    @respx.mock
    async def test_relative_urls_resolved(self, noop_rate_limiter):
        """Relative links should be converted to absolute URLs."""
        source = make_source("website", url_or_handle="https://blog.example.com")

        respx.get("https://blog.example.com").mock(
            return_value=httpx.Response(200, text=SAMPLE_HTML)
        )

        async with httpx.AsyncClient() as client:
            connector = WebsiteConnector(source, client, noop_rate_limiter)
            result = await connector.fetch()

        links = [item["link"] for item in result.raw_items]
        assert links[0] == "https://blog.example.com/post-1"
        assert links[1] == "https://blog.example.com/post-2"
        # External URL stays as-is
        assert links[2] == "https://external.com/post-3"

    @respx.mock
    async def test_cursor_skips_seen_url(self, noop_rate_limiter):
        """Items matching the since_cursor URL should be skipped."""
        source = make_source("website", url_or_handle="https://blog.example.com")

        respx.get("https://blog.example.com").mock(
            return_value=httpx.Response(200, text=SAMPLE_HTML)
        )

        async with httpx.AsyncClient() as client:
            connector = WebsiteConnector(source, client, noop_rate_limiter)
            result = await connector.fetch(since_cursor="https://blog.example.com/post-2")

        # post-2 should be skipped; post-1 and post-3 should remain
        links = [item["link"] for item in result.raw_items]
        assert "https://blog.example.com/post-2" not in links
        assert len(result.raw_items) == 2

    @respx.mock
    async def test_custom_selectors(self, noop_rate_limiter):
        """Custom CSS selectors from config should be used."""
        custom_html = """
        <div class="news">
          <div class="item">
            <span class="headline">Breaking News</span>
            <a class="readmore" href="/breaking">Read</a>
            <div class="body">News body text</div>
          </div>
        </div>
        """
        source = make_source(
            "website",
            url_or_handle="https://news.example.com",
            config={
                "item_selector": ".item",
                "title_selector": ".headline",
                "link_selector": ".readmore",
                "text_selector": ".body",
            },
        )

        respx.get("https://news.example.com").mock(
            return_value=httpx.Response(200, text=custom_html)
        )

        async with httpx.AsyncClient() as client:
            connector = WebsiteConnector(source, client, noop_rate_limiter)
            result = await connector.fetch()

        assert len(result.raw_items) == 1
        assert result.raw_items[0]["title"] == "Breaking News"
        assert result.raw_items[0]["text"] == "News body text"

    @respx.mock
    async def test_empty_page(self, noop_rate_limiter):
        source = make_source("website", url_or_handle="https://empty.example.com")

        respx.get("https://empty.example.com").mock(
            return_value=httpx.Response(200, text="<html><body></body></html>")
        )

        async with httpx.AsyncClient() as client:
            connector = WebsiteConnector(source, client, noop_rate_limiter)
            result = await connector.fetch()

        assert result.raw_items == []


class TestWebsiteNormalize:
    def test_normalize(self, noop_rate_limiter):
        source = make_source("website", url_or_handle="https://blog.example.com")
        connector = WebsiteConnector(source, httpx.AsyncClient(), noop_rate_limiter)

        raw = {"title": "Post", "link": "https://blog.example.com/post-1", "text": "Content", "time": "2026-01-15"}
        item = connector.normalize(raw)

        assert item.url == "https://blog.example.com/post-1"
        assert item.title == "Post"
        assert item.engagement_snapshot is None


class TestWebsiteAntiBot:
    """Website scraping anti-bot considerations."""

    @respx.mock
    async def test_single_request_per_fetch(self, noop_rate_limiter):
        """Website connector should make exactly 1 HTTP request per fetch."""
        source = make_source("website", url_or_handle="https://blog.example.com")

        route = respx.get("https://blog.example.com").mock(
            return_value=httpx.Response(200, text=SAMPLE_HTML)
        )

        async with httpx.AsyncClient() as client:
            connector = WebsiteConnector(source, client, noop_rate_limiter)
            await connector.fetch()

        assert route.call_count == 1

    @respx.mock
    async def test_low_default_rate_limit(self):
        """Website should have the lowest rate limit (10 req/60s in config)."""
        # This is a config-level check, not a connector test, but validates the principle
        from src.config.settings import load_settings
        settings = load_settings()
        website_limit = settings.rate_limits.get("website")
        if website_limit:
            assert website_limit.requests_per_window <= 10
            assert website_limit.window_seconds >= 60
