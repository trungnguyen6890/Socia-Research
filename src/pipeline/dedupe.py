from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.content import ContentItem


async def check_duplicates(
    items: list[dict[str, Any]],
    session: AsyncSession,
) -> list[dict[str, Any]]:
    """Check items for duplicates against existing content in DB.

    Marks duplicates by setting is_duplicate=True and duplicate_of_id.
    Uses both URL and content_hash for matching.
    """
    if not items:
        return items

    # Collect URLs and hashes for batch lookup
    urls = [i["url"] for i in items if i["url"]]
    hashes = [i["content_hash"] for i in items if i["content_hash"]]

    existing_by_url: dict[str, str] = {}
    existing_by_hash: dict[str, str] = {}

    if urls:
        result = await session.execute(
            select(ContentItem.id, ContentItem.url, ContentItem.canonical_url)
            .where(ContentItem.url.in_(urls) | ContentItem.canonical_url.in_(urls))
        )
        for row in result:
            existing_by_url[row.url] = row.id
            if row.canonical_url:
                existing_by_url[row.canonical_url] = row.id

    if hashes:
        result = await session.execute(
            select(ContentItem.id, ContentItem.content_hash)
            .where(ContentItem.content_hash.in_(hashes))
            .where(ContentItem.is_duplicate == False)  # noqa: E712
        )
        for row in result:
            if row.content_hash:
                existing_by_hash[row.content_hash] = row.id

    # Also dedupe within the current batch
    seen_urls: dict[str, int] = {}
    seen_hashes: dict[str, int] = {}

    for idx, item in enumerate(items):
        url = item["url"]
        canonical = item.get("canonical_url", url)
        h = item["content_hash"]

        # Check against DB
        dup_id = existing_by_url.get(url) or existing_by_url.get(canonical) or existing_by_hash.get(h)
        if dup_id:
            item["is_duplicate"] = True
            item["duplicate_of_id"] = dup_id
            continue

        # Check within batch
        if url and url in seen_urls:
            item["is_duplicate"] = True
            continue
        if h and h in seen_hashes:
            item["is_duplicate"] = True
            continue

        if url:
            seen_urls[url] = idx
        if h:
            seen_hashes[h] = idx

    return items
