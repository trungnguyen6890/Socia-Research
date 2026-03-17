from __future__ import annotations

import os
from typing import Any

from src.config.constants import ConnectorType
from src.connectors.base import BaseConnector, ContentItemCreate, FetchResult
from src.connectors.registry import register_connector
from src.utils.hashing import canonicalize_url


@register_connector(ConnectorType.INSTAGRAM_PRO)
class InstagramProConnector(BaseConnector):
    """Instagram Professional Account Graph API connector.

    source.url_or_handle should be the Instagram business/creator account user ID.
    """

    connector_type = ConnectorType.INSTAGRAM_PRO
    BASE_URL = "https://graph.facebook.com/v19.0"

    @property
    def access_token(self) -> str:
        return os.environ.get("IG_ACCESS_TOKEN", "")

    async def fetch(self, since_cursor: str | None = None) -> FetchResult:
        await self.rate_limiter.acquire(self.connector_type)

        user_id = self.source.url_or_handle
        params: dict[str, Any] = {
            "access_token": self.access_token,
            "fields": "id,caption,timestamp,permalink,like_count,comments_count,media_type,media_url",
            "limit": self.config.get("max_results", 25),
        }
        if since_cursor:
            params["since"] = since_cursor

        response = await self.http.get(f"{self.BASE_URL}/{user_id}/media", params=params)
        response.raise_for_status()
        data = response.json()

        raw_items = []
        latest_time: str | None = None

        for media in data.get("data", []):
            timestamp = media.get("timestamp", "")
            if latest_time is None and timestamp:
                latest_time = timestamp

            raw_items.append({
                "media_id": media.get("id", ""),
                "caption": media.get("caption", ""),
                "timestamp": timestamp,
                "permalink": media.get("permalink", ""),
                "like_count": media.get("like_count", 0),
                "comments_count": media.get("comments_count", 0),
                "media_type": media.get("media_type", ""),
            })

        return FetchResult(
            raw_items=raw_items,
            new_cursor=latest_time or since_cursor,
            metadata={"user_id": user_id, "media_fetched": len(raw_items)},
        )

    def normalize(self, raw_item: dict[str, Any]) -> ContentItemCreate:
        url = raw_item.get("permalink", "")
        return ContentItemCreate(
            url=url,
            canonical_url=canonicalize_url(url) if url else None,
            connector_type=self.connector_type,
            title=None,
            text_content=raw_item.get("caption"),
            publish_time=raw_item.get("timestamp"),
            engagement_snapshot={
                "likes": raw_item.get("like_count", 0),
                "comments": raw_item.get("comments_count", 0),
                "media_type": raw_item.get("media_type", ""),
            },
            raw_data=raw_item,
        )
