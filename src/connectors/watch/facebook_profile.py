from __future__ import annotations

from typing import Any

from src.config.constants import ConnectorType
from src.connectors.base import BaseConnector, ContentItemCreate, FetchResult
from src.connectors.registry import register_connector


@register_connector(ConnectorType.FACEBOOK_PROFILE_WATCH)
class FacebookProfileWatchConnector(BaseConnector):
    """Watch-only stub for Facebook profiles. No automated fetching."""

    connector_type = ConnectorType.FACEBOOK_PROFILE_WATCH

    async def fetch(self, since_cursor: str | None = None) -> FetchResult:
        raise NotImplementedError(
            "Facebook profile watch is manual-only. "
            "Add content items through the admin interface."
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
