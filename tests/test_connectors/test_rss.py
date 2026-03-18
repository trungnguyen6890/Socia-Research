"""Tests for RSS connector."""
from __future__ import annotations

import httpx
import pytest
import respx

from src.connectors.rss import RSSConnector
from tests.test_connectors.conftest import make_source

SAMPLE_RSS = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <item>
      <title>Article 1</title>
      <link>https://example.com/article-1</link>
      <guid>entry-1</guid>
      <description>Summary of article 1</description>
      <pubDate>Wed, 15 Jan 2026 12:00:00 GMT</pubDate>
      <author>Author One</author>
    </item>
    <item>
      <title>Article 2</title>
      <link>https://example.com/article-2</link>
      <guid>entry-2</guid>
      <description>Summary of article 2</description>
      <pubDate>Tue, 14 Jan 2026 12:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Article 3</title>
      <link>https://example.com/article-3</link>
      <guid>entry-3</guid>
      <description>Old article</description>
      <pubDate>Mon, 13 Jan 2026 12:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>"""


class TestRSSFetch:
    @respx.mock
    async def test_fetch_all_entries(self, noop_rate_limiter):
        """Without cursor, all entries should be returned."""
        source = make_source("rss", url_or_handle="https://example.com/feed.xml")

        respx.get("https://example.com/feed.xml").mock(
            return_value=httpx.Response(200, text=SAMPLE_RSS)
        )

        async with httpx.AsyncClient() as client:
            connector = RSSConnector(source, client, noop_rate_limiter)
            result = await connector.fetch()

        assert len(result.raw_items) == 3
        assert result.new_cursor == "entry-1"

    @respx.mock
    async def test_fetch_stops_at_cursor(self, noop_rate_limiter):
        """Fetch should stop when it encounters the since_cursor entry."""
        source = make_source("rss", url_or_handle="https://example.com/feed.xml")

        respx.get("https://example.com/feed.xml").mock(
            return_value=httpx.Response(200, text=SAMPLE_RSS)
        )

        async with httpx.AsyncClient() as client:
            connector = RSSConnector(source, client, noop_rate_limiter)
            result = await connector.fetch(since_cursor="entry-2")

        # Should only return entry-1 (stops at entry-2)
        assert len(result.raw_items) == 1
        assert result.raw_items[0]["id"] == "entry-1"

    @respx.mock
    async def test_fetch_empty_feed(self, noop_rate_limiter):
        empty_rss = '<?xml version="1.0"?><rss version="2.0"><channel><title>Empty</title></channel></rss>'
        source = make_source("rss", url_or_handle="https://example.com/empty.xml")

        respx.get("https://example.com/empty.xml").mock(
            return_value=httpx.Response(200, text=empty_rss)
        )

        async with httpx.AsyncClient() as client:
            connector = RSSConnector(source, client, noop_rate_limiter)
            result = await connector.fetch()

        assert result.raw_items == []

    @respx.mock
    async def test_cursor_preserved_when_no_new_items(self, noop_rate_limiter):
        """If cursor matches first entry, no items and cursor should be preserved."""
        source = make_source("rss", url_or_handle="https://example.com/feed.xml")

        respx.get("https://example.com/feed.xml").mock(
            return_value=httpx.Response(200, text=SAMPLE_RSS)
        )

        async with httpx.AsyncClient() as client:
            connector = RSSConnector(source, client, noop_rate_limiter)
            result = await connector.fetch(since_cursor="entry-1")

        assert result.raw_items == []
        assert result.new_cursor == "entry-1"


class TestRSSNormalize:
    def test_normalize_entry(self, noop_rate_limiter):
        source = make_source("rss", url_or_handle="https://example.com/feed.xml")
        connector = RSSConnector(source, httpx.AsyncClient(), noop_rate_limiter)

        raw = {
            "id": "entry-1",
            "title": "Article 1",
            "link": "https://example.com/article-1",
            "summary": "Summary text",
            "content": None,
            "published": "Wed, 15 Jan 2026 12:00:00 GMT",
            "author": "Author One",
            "tags": ["tech"],
        }
        item = connector.normalize(raw)

        assert item.url == "https://example.com/article-1"
        assert item.title == "Article 1"
        assert item.text_content == "Summary text"
        assert item.engagement_snapshot is None  # RSS has no engagement

    def test_normalize_prefers_content_over_summary(self, noop_rate_limiter):
        source = make_source("rss", url_or_handle="https://example.com/feed.xml")
        connector = RSSConnector(source, httpx.AsyncClient(), noop_rate_limiter)

        raw = {
            "id": "1", "title": "T", "link": "https://example.com/1",
            "summary": "Short", "content": "Full content here",
            "published": None, "author": None, "tags": [],
        }
        item = connector.normalize(raw)
        assert item.text_content == "Full content here"


class TestRSSAntiBot:
    """RSS-specific anti-bot checks."""

    @respx.mock
    async def test_rate_limiter_acquired(self, noop_rate_limiter):
        """Rate limiter should be called even for simple RSS fetches."""
        source = make_source("rss", url_or_handle="https://example.com/feed.xml")
        acquired = False
        original = noop_rate_limiter.acquire

        async def track(ctype):
            nonlocal acquired
            acquired = True

        noop_rate_limiter.acquire = track

        respx.get("https://example.com/feed.xml").mock(
            return_value=httpx.Response(200, text=SAMPLE_RSS)
        )

        async with httpx.AsyncClient() as client:
            connector = RSSConnector(source, client, noop_rate_limiter)
            await connector.fetch()

        assert acquired
