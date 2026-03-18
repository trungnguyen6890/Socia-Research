from __future__ import annotations

from typing import Any

import feedparser

from src.config.constants import ConnectorType
from src.connectors.base import BaseConnector, ContentItemCreate, FetchResult
from src.connectors.registry import register_connector
from src.utils.hashing import canonicalize_url


@register_connector(ConnectorType.RSS)
class RSSConnector(BaseConnector):
    connector_type = ConnectorType.RSS

    async def fetch(self, since_cursor: str | None = None) -> FetchResult:
        await self.rate_limiter.acquire(self.connector_type)

        feed_url = self.source.url_or_handle
        response = await self.http.get(feed_url)
        response.raise_for_status()

        feed = feedparser.parse(response.text)
        raw_items = []
        latest_id: str | None = None

        for entry in feed.entries:
            entry_id = getattr(entry, "id", None) or getattr(entry, "link", "")

            # Skip items we've already seen
            if since_cursor and entry_id == since_cursor:
                break

            if latest_id is None:
                latest_id = entry_id

            raw_items.append({
                "id": entry_id,
                "title": getattr(entry, "title", None),
                "link": getattr(entry, "link", ""),
                "summary": getattr(entry, "summary", None),
                "content": self._extract_content(entry),
                "published": getattr(entry, "published", None),
                "author": getattr(entry, "author", None),
                "tags": [t.get("term", "") for t in getattr(entry, "tags", [])],
            })

        return FetchResult(
            raw_items=raw_items,
            new_cursor=latest_id or since_cursor,
            metadata={"feed_title": getattr(feed.feed, "title", ""), "entry_count": len(raw_items)},
        )

    def normalize(self, raw_item: dict[str, Any]) -> ContentItemCreate:
        url = raw_item.get("link", "")
        text = raw_item.get("content") or raw_item.get("summary") or ""

        return ContentItemCreate(
            url=url,
            canonical_url=canonicalize_url(url) if url else None,
            connector_type=self.connector_type,
            title=raw_item.get("title"),
            text_content=text,
            publish_time=raw_item.get("published"),
            engagement_snapshot=None,
            raw_data=raw_item,
            content_type="article",
            author_name=raw_item.get("author"),
            has_media=False,
        )

    @staticmethod
    def _extract_content(entry: Any) -> str | None:
        """Extract full content from RSS entry if available."""
        content_list = getattr(entry, "content", None)
        if content_list and isinstance(content_list, list):
            return content_list[0].get("value", "")
        return None
