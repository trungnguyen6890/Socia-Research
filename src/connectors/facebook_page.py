from __future__ import annotations

import os
from typing import Any

from src.config.constants import ConnectorType
from src.connectors.base import BaseConnector, ContentItemCreate, FetchResult
from src.connectors.registry import register_connector
from src.utils.hashing import canonicalize_url


@register_connector(ConnectorType.FACEBOOK_PAGE)
class FacebookPageConnector(BaseConnector):
    """Facebook Page Graph API connector.

    source.url_or_handle should be the page ID.
    """

    connector_type = ConnectorType.FACEBOOK_PAGE
    BASE_URL = "https://graph.facebook.com/v19.0"

    @property
    def access_token(self) -> str:
        return os.environ.get("FB_ACCESS_TOKEN", "")

    async def fetch(self, since_cursor: str | None = None) -> FetchResult:
        await self.rate_limiter.acquire(self.connector_type)

        page_id = self.source.url_or_handle
        params: dict[str, Any] = {
            "access_token": self.access_token,
            "fields": "id,message,created_time,permalink_url,shares,likes.summary(true),comments.summary(true)",
            "limit": self.config.get("max_results", 25),
        }
        if since_cursor:
            params["since"] = since_cursor

        response = await self.http.get(f"{self.BASE_URL}/{page_id}/posts", params=params)
        response.raise_for_status()
        data = response.json()

        raw_items = []
        latest_time: str | None = None

        for post in data.get("data", []):
            created_time = post.get("created_time", "")
            if latest_time is None and created_time:
                latest_time = created_time

            raw_items.append({
                "post_id": post.get("id", ""),
                "message": post.get("message", ""),
                "created_time": created_time,
                "permalink_url": post.get("permalink_url", ""),
                "shares": post.get("shares", {}).get("count", 0),
                "likes": post.get("likes", {}).get("summary", {}).get("total_count", 0),
                "comments": post.get("comments", {}).get("summary", {}).get("total_count", 0),
            })

        return FetchResult(
            raw_items=raw_items,
            new_cursor=latest_time or since_cursor,
            metadata={"page_id": page_id, "posts_fetched": len(raw_items)},
        )

    def normalize(self, raw_item: dict[str, Any]) -> ContentItemCreate:
        url = raw_item.get("permalink_url", "")
        return ContentItemCreate(
            url=url,
            canonical_url=canonicalize_url(url) if url else None,
            connector_type=self.connector_type,
            title=None,
            text_content=raw_item.get("message"),
            publish_time=raw_item.get("created_time"),
            engagement_snapshot={
                "likes": raw_item.get("likes", 0),
                "shares": raw_item.get("shares", 0),
                "comments": raw_item.get("comments", 0),
            },
            raw_data=raw_item,
        )
