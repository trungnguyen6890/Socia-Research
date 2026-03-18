from __future__ import annotations

import os
from typing import Any

from src.config.constants import ConnectorType
from src.connectors.base import BaseConnector, ContentItemCreate, FetchResult
from src.connectors.registry import register_connector
from src.utils.hashing import canonicalize_url


@register_connector(ConnectorType.X_TWITTER)
class XTwitterConnector(BaseConnector):
    """X/Twitter API v2 connector.

    source.url_or_handle should be the user ID (numeric).
    config can include 'username' for URL generation.
    """

    connector_type = ConnectorType.X_TWITTER
    BASE_URL = "https://api.twitter.com/2"

    @property
    def bearer_token(self) -> str:
        return os.environ.get("X_BEARER_TOKEN", "")

    async def fetch(self, since_cursor: str | None = None) -> FetchResult:
        await self.rate_limiter.acquire(self.connector_type)

        user_id = self.source.url_or_handle
        params: dict[str, Any] = {
            "tweet.fields": "created_at,public_metrics,entities,text",
            "max_results": self.config.get("max_results", 10),
        }
        if since_cursor:
            params["since_id"] = since_cursor

        headers = {"Authorization": f"Bearer {self.bearer_token}"}
        response = await self.http.get(
            f"{self.BASE_URL}/users/{user_id}/tweets",
            params=params,
            headers=headers,
        )
        response.raise_for_status()
        data = response.json()

        raw_items = []
        latest_id: str | None = None

        for tweet in data.get("data", []):
            tweet_id = tweet.get("id", "")
            if latest_id is None:
                latest_id = tweet_id

            raw_items.append({
                "tweet_id": tweet_id,
                "text": tweet.get("text", ""),
                "created_at": tweet.get("created_at"),
                "public_metrics": tweet.get("public_metrics", {}),
                "entities": tweet.get("entities", {}),
            })

        return FetchResult(
            raw_items=raw_items,
            new_cursor=latest_id or since_cursor,
            metadata={"user_id": user_id, "result_count": data.get("meta", {}).get("result_count", 0)},
        )

    def normalize(self, raw_item: dict[str, Any]) -> ContentItemCreate:
        tweet_id = raw_item.get("tweet_id", "")
        username = self.config.get("username", self.source.url_or_handle)
        url = f"https://x.com/{username}/status/{tweet_id}" if tweet_id else ""
        metrics = raw_item.get("public_metrics", {})

        return ContentItemCreate(
            url=url,
            canonical_url=canonicalize_url(url) if url else None,
            connector_type=self.connector_type,
            title=None,
            text_content=raw_item.get("text"),
            publish_time=raw_item.get("created_at"),
            engagement_snapshot={
                "likes": metrics.get("like_count", 0),
                "retweets": metrics.get("retweet_count", 0),
                "replies": metrics.get("reply_count", 0),
                "impressions": metrics.get("impression_count", 0),
            } if metrics else None,
            raw_data=raw_item,
            content_type="tweet",
            author_name=username,
            has_media=False,
        )
