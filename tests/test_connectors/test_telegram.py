"""Tests for Telegram connector (mocked Telethon client)."""
from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from src.connectors.telegram_connector import TelegramConnector
from tests.test_connectors.conftest import make_source


def _make_message(msg_id: int, text: str, views: int = 100, forwards: int = 5, replies: int = 2):
    """Create a mock Telethon message object."""
    msg = SimpleNamespace()
    msg.id = msg_id
    msg.text = text
    msg.date = datetime(2026, 1, 15, 12, 0, 0, tzinfo=timezone.utc)
    msg.views = views
    msg.forwards = forwards
    msg.replies = SimpleNamespace(replies=replies)
    msg.media = None
    return msg


class TestTelegramFetch:
    @patch("src.connectors.telegram_connector.TelegramConnector.fetch")
    async def test_fetch_basic(self, mock_fetch, noop_rate_limiter):
        """Test basic fetch returns messages."""
        from src.connectors.base import FetchResult

        mock_fetch.return_value = FetchResult(
            raw_items=[
                {
                    "message_id": 100,
                    "text": "Hello Telegram",
                    "date": "2026-01-15T12:00:00+00:00",
                    "views": 500,
                    "forwards": 10,
                    "replies": 3,
                    "media_type": None,
                },
                {
                    "message_id": 99,
                    "text": "Earlier message",
                    "date": "2026-01-14T12:00:00+00:00",
                    "views": 200,
                    "forwards": 2,
                    "replies": 1,
                    "media_type": None,
                },
            ],
            new_cursor="100",
            metadata={"channel": "test_channel", "messages_fetched": 2},
        )

        source = make_source("telegram", url_or_handle="test_channel")
        async with httpx.AsyncClient() as client:
            connector = TelegramConnector(source, client, noop_rate_limiter)
            result = await connector.fetch()

        assert len(result.raw_items) == 2
        assert result.new_cursor == "100"

    async def test_normalize_message(self, noop_rate_limiter):
        """Normalize should construct t.me URL and extract engagement."""
        source = make_source("telegram", url_or_handle="test_channel")
        connector = TelegramConnector(source, httpx.AsyncClient(), noop_rate_limiter)

        raw = {
            "message_id": 42,
            "text": "Hello from Telegram",
            "date": "2026-01-15T12:00:00+00:00",
            "views": 500,
            "forwards": 10,
            "replies": 3,
            "media_type": None,
        }
        item = connector.normalize(raw)

        assert item.url == "https://t.me/test_channel/42"
        assert item.text_content == "Hello from Telegram"
        assert item.engagement_snapshot["views"] == 500
        assert item.engagement_snapshot["forwards"] == 10

    async def test_normalize_empty_message(self, noop_rate_limiter):
        source = make_source("telegram", url_or_handle="test_channel")
        connector = TelegramConnector(source, httpx.AsyncClient(), noop_rate_limiter)

        raw = {
            "message_id": "", "text": "", "date": None,
            "views": 0, "forwards": 0, "replies": 0, "media_type": None,
        }
        item = connector.normalize(raw)
        assert item.url == ""
        assert item.text_content == ""

    async def test_telethon_import_error_message(self, noop_rate_limiter):
        """If telethon is not installed, a clear error message should be raised."""
        source = make_source("telegram", url_or_handle="test_channel")

        with patch.dict("sys.modules", {"telethon": None}):
            connector = TelegramConnector(source, httpx.AsyncClient(), noop_rate_limiter)
            with pytest.raises(ImportError, match="Telethon is required"):
                await connector.fetch()
