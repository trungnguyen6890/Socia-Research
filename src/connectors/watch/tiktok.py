from __future__ import annotations

from typing import Any

from src.config.constants import ConnectorType
from src.connectors.base import BaseConnector, ContentItemCreate, FetchResult
from src.connectors.registry import register_connector


@register_connector(ConnectorType.TIKTOK_WATCH)
class TikTokWatchConnector(BaseConnector):
    """Watch-only stub for TikTok. No automated fetching."""

    connector_type = ConnectorType.TIKTOK_WATCH

    async def fetch(self, since_cursor: str | None = None) -> FetchResult:
        raise NotImplementedError(
            "TikTok watch is manual-only. Add content items through the admin interface."
        )

    def normalize(self, raw_item: dict[str, Any]) -> ContentItemCreate:
        return ContentItemCreate(
            url=raw_item.get("url", ""),
            connector_type=self.connector_type,
            title=raw_item.get("title"),
            text_content=raw_item.get("text"),
            publish_time=raw_item.get("publish_time"),
            raw_data=raw_item,
        )
