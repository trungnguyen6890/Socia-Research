from __future__ import annotations

import os
from typing import Any

from src.config.constants import ConnectorType
from src.connectors.base import BaseConnector, ContentItemCreate, FetchResult
from src.connectors.registry import register_connector
from src.utils.hashing import canonicalize_url


@register_connector(ConnectorType.TELEGRAM)
class TelegramConnector(BaseConnector):
    """Telegram channel connector using Telethon.

    source.url_or_handle should be the channel username or ID.
    Requires telethon optional dependency.
    """

    connector_type = ConnectorType.TELEGRAM

    async def fetch(self, since_cursor: str | None = None) -> FetchResult:
        try:
            from telethon import TelegramClient
        except ImportError:
            raise ImportError(
                "Telethon is required for Telegram connector. "
                "Install with: pip install socia-research[telegram]"
            )

        await self.rate_limiter.acquire(self.connector_type)

        api_id = os.environ.get("TELEGRAM_API_ID", "")
        api_hash = os.environ.get("TELEGRAM_API_HASH", "")
        channel = self.source.url_or_handle

        min_id = int(since_cursor) if since_cursor else 0
        limit = self.config.get("max_results", 50)

        client = TelegramClient("socia_session", int(api_id), api_hash)
        raw_items = []
        latest_id: int | None = None

        async with client:
            async for message in client.iter_messages(channel, limit=limit, min_id=min_id):
                if latest_id is None:
                    latest_id = message.id

                raw_items.append({
                    "message_id": message.id,
                    "text": message.text or "",
                    "date": message.date.isoformat() if message.date else None,
                    "views": message.views,
                    "forwards": message.forwards,
                    "replies": message.replies.replies if message.replies else 0,
                    "media_type": type(message.media).__name__ if message.media else None,
                })

        return FetchResult(
            raw_items=raw_items,
            new_cursor=str(latest_id) if latest_id else since_cursor,
            metadata={"channel": channel, "messages_fetched": len(raw_items)},
        )

    def normalize(self, raw_item: dict[str, Any]) -> ContentItemCreate:
        channel = self.source.url_or_handle
        msg_id = raw_item.get("message_id", "")
        url = f"https://t.me/{channel}/{msg_id}" if msg_id else ""

        return ContentItemCreate(
            url=url,
            canonical_url=url,
            connector_type=self.connector_type,
            title=None,
            text_content=raw_item.get("text"),
            publish_time=raw_item.get("date"),
            engagement_snapshot={
                "views": raw_item.get("views", 0),
                "forwards": raw_item.get("forwards", 0),
                "replies": raw_item.get("replies", 0),
            },
            raw_data=raw_item,
            content_type="message",
            author_name=channel,
            has_media=raw_item.get("media_type") is not None,
        )
