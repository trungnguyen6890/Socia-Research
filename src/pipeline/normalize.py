from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from dateutil import parser as dateparser

from src.connectors.base import ContentItemCreate
from src.utils.hashing import canonicalize_url, content_hash


def normalize_item(item: ContentItemCreate, source_id: str) -> dict[str, Any]:
    """Convert a ContentItemCreate into a dict ready for ContentItem insertion."""
    text = item.text_content or ""
    url = item.url or ""

    # Parse publish time
    publish_time = None
    if item.publish_time:
        try:
            publish_time = dateparser.parse(item.publish_time)
            if publish_time and publish_time.tzinfo is None:
                publish_time = publish_time.replace(tzinfo=timezone.utc)
        except (ValueError, TypeError):
            pass

    return {
        "source_id": source_id,
        "connector_type": item.connector_type,
        "url": url,
        "canonical_url": item.canonical_url or (canonicalize_url(url) if url else None),
        "title": item.title,
        "text_content": text,
        "publish_time": publish_time,
        "fetch_time": datetime.now(timezone.utc),
        "engagement_snapshot": item.engagement_snapshot,
        "tags": [],
        "content_hash": content_hash(f"{item.title or ''} {text}") if (item.title or text) else None,
        "is_duplicate": False,
        "duplicate_of_id": None,
        "quality_score": 0.0,
        "signal_score": 0.0,
        "raw_data": item.raw_data,
    }
