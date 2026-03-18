"""Tests for the deduplication pipeline stage."""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.content import ContentItem
from src.pipeline.dedupe import check_duplicates


def _make_normalized_item(
    url: str = "https://example.com/post",
    content_hash: str = "abc123",
    **kwargs,
) -> dict:
    defaults = {
        "source_id": "src-1",
        "connector_type": "rss",
        "url": url,
        "canonical_url": url,
        "title": "Test",
        "text_content": "Content",
        "publish_time": None,
        "fetch_time": None,
        "engagement_snapshot": None,
        "tags": [],
        "content_hash": content_hash,
        "is_duplicate": False,
        "duplicate_of_id": None,
        "quality_score": 0.0,
        "signal_score": 0.0,
        "raw_data": {},
    }
    defaults.update(kwargs)
    return defaults


class TestCheckDuplicatesEmpty:
    async def test_empty_list(self, session: AsyncSession):
        result = await check_duplicates([], session)
        assert result == []


class TestCheckDuplicatesWithinBatch:
    async def test_batch_url_dedup(self, session: AsyncSession):
        """Two items with the same URL in the same batch — second should be marked duplicate."""
        items = [
            _make_normalized_item(url="https://example.com/1", content_hash="h1"),
            _make_normalized_item(url="https://example.com/1", content_hash="h2"),
        ]
        result = await check_duplicates(items, session)

        assert result[0]["is_duplicate"] is False
        assert result[1]["is_duplicate"] is True

    async def test_batch_hash_dedup(self, session: AsyncSession):
        """Same content hash, different URLs — second should be duplicate."""
        items = [
            _make_normalized_item(url="https://a.com/1", content_hash="same_hash"),
            _make_normalized_item(url="https://b.com/2", content_hash="same_hash"),
        ]
        result = await check_duplicates(items, session)

        assert result[0]["is_duplicate"] is False
        assert result[1]["is_duplicate"] is True

    async def test_different_items_not_duplicates(self, session: AsyncSession):
        items = [
            _make_normalized_item(url="https://a.com/1", content_hash="h1"),
            _make_normalized_item(url="https://b.com/2", content_hash="h2"),
        ]
        result = await check_duplicates(items, session)
        assert all(not item["is_duplicate"] for item in result)


class TestCheckDuplicatesAgainstDB:
    async def test_url_match_against_existing(self, session: AsyncSession):
        """Items matching existing DB URLs should be flagged."""
        # Insert existing content
        existing = ContentItem(
            id=str(uuid.uuid4()),
            source_id="src-1",
            connector_type="rss",
            url="https://example.com/existing",
            canonical_url="https://example.com/existing",
            text_content="Existing content",
            content_hash="existing_hash",
        )
        session.add(existing)
        await session.flush()

        items = [
            _make_normalized_item(url="https://example.com/existing", content_hash="new_hash"),
            _make_normalized_item(url="https://example.com/new", content_hash="brand_new"),
        ]
        result = await check_duplicates(items, session)

        assert result[0]["is_duplicate"] is True
        assert result[0]["duplicate_of_id"] == existing.id
        assert result[1]["is_duplicate"] is False

    async def test_hash_match_against_existing(self, session: AsyncSession):
        """Same content hash in DB should flag duplicate even with different URL."""
        existing = ContentItem(
            id=str(uuid.uuid4()),
            source_id="src-1",
            connector_type="rss",
            url="https://example.com/original",
            text_content="Same content",
            content_hash="shared_hash",
            is_duplicate=False,
        )
        session.add(existing)
        await session.flush()

        items = [
            _make_normalized_item(url="https://other.com/repost", content_hash="shared_hash"),
        ]
        result = await check_duplicates(items, session)

        assert result[0]["is_duplicate"] is True
        assert result[0]["duplicate_of_id"] == existing.id

    async def test_canonical_url_match(self, session: AsyncSession):
        """Canonical URL matching should also detect duplicates."""
        existing = ContentItem(
            id=str(uuid.uuid4()),
            source_id="src-1",
            connector_type="rss",
            url="https://example.com/post?utm_source=twitter",
            canonical_url="https://example.com/post",
            text_content="Content",
            content_hash="unique_hash_1",
        )
        session.add(existing)
        await session.flush()

        items = [
            _make_normalized_item(
                url="https://example.com/post",
                content_hash="unique_hash_2",
                canonical_url="https://example.com/post",
            ),
        ]
        result = await check_duplicates(items, session)
        assert result[0]["is_duplicate"] is True
