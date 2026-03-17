from __future__ import annotations

import os
from typing import Any

from src.config.constants import ConnectorType
from src.connectors.base import BaseConnector, ContentItemCreate, FetchResult
from src.connectors.registry import register_connector
from src.utils.hashing import canonicalize_url


@register_connector(ConnectorType.YOUTUBE)
class YouTubeConnector(BaseConnector):
    """YouTube Data API v3 connector.

    Fetches videos from a channel using the search endpoint.
    source.url_or_handle should be the channel ID.
    """

    connector_type = ConnectorType.YOUTUBE
    BASE_URL = "https://www.googleapis.com/youtube/v3"

    @property
    def api_key(self) -> str:
        return os.environ.get("YOUTUBE_API_KEY", "")

    async def fetch(self, since_cursor: str | None = None) -> FetchResult:
        await self.rate_limiter.acquire(self.connector_type)

        channel_id = self.source.url_or_handle
        params: dict[str, Any] = {
            "key": self.api_key,
            "channelId": channel_id,
            "part": "snippet",
            "order": "date",
            "type": "video",
            "maxResults": self.config.get("max_results", 25),
        }
        if since_cursor:
            params["publishedAfter"] = since_cursor

        response = await self.http.get(f"{self.BASE_URL}/search", params=params)
        response.raise_for_status()
        data = response.json()

        raw_items = []
        latest_time: str | None = None

        for item in data.get("items", []):
            snippet = item.get("snippet", {})
            published = snippet.get("publishedAt", "")
            video_id = item.get("id", {}).get("videoId", "")

            if latest_time is None and published:
                latest_time = published

            raw_items.append({
                "video_id": video_id,
                "title": snippet.get("title"),
                "description": snippet.get("description"),
                "published_at": published,
                "channel_title": snippet.get("channelTitle"),
                "thumbnails": snippet.get("thumbnails", {}),
            })

        # Fetch video statistics for engagement data
        if raw_items:
            video_ids = [item["video_id"] for item in raw_items if item["video_id"]]
            stats = await self._fetch_stats(video_ids)
            for item in raw_items:
                item["statistics"] = stats.get(item["video_id"], {})

        return FetchResult(
            raw_items=raw_items,
            new_cursor=latest_time or since_cursor,
            metadata={"channel_id": channel_id, "total_results": data.get("pageInfo", {}).get("totalResults", 0)},
        )

    async def _fetch_stats(self, video_ids: list[str]) -> dict[str, dict]:
        """Fetch video statistics in a single batch request."""
        await self.rate_limiter.acquire(self.connector_type)

        params = {
            "key": self.api_key,
            "id": ",".join(video_ids[:50]),
            "part": "statistics",
        }
        response = await self.http.get(f"{self.BASE_URL}/videos", params=params)
        response.raise_for_status()
        data = response.json()

        return {
            item["id"]: item.get("statistics", {})
            for item in data.get("items", [])
        }

    def normalize(self, raw_item: dict[str, Any]) -> ContentItemCreate:
        video_id = raw_item.get("video_id", "")
        url = f"https://www.youtube.com/watch?v={video_id}" if video_id else ""
        stats = raw_item.get("statistics", {})

        return ContentItemCreate(
            url=url,
            canonical_url=canonicalize_url(url) if url else None,
            connector_type=self.connector_type,
            title=raw_item.get("title"),
            text_content=raw_item.get("description"),
            publish_time=raw_item.get("published_at"),
            engagement_snapshot={
                "views": int(stats.get("viewCount", 0)),
                "likes": int(stats.get("likeCount", 0)),
                "comments": int(stats.get("commentCount", 0)),
            } if stats else None,
            raw_data=raw_item,
        )
