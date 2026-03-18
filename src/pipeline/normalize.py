from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from dateutil import parser as dateparser

from src.connectors.base import ContentItemCreate
from src.utils.hashing import canonicalize_url, content_hash

_CONTENT_TYPE_MAP: dict[str, str] = {
    "x_browser": "tweet", "x_twitter": "tweet", "x_rss": "tweet",
    "youtube": "video", "tiktok_watch": "video",
    "facebook_page": "post", "facebook_profile_watch": "post",
    "instagram_pro": "post", "threads_watch": "post",
    "telegram": "message",
    "rss": "article", "website": "article",
}


def _detect_language(text: str) -> str:
    if not text or len(text) < 10:
        return "unknown"
    if any(c in text for c in "àáâãèéêìíòóôõùúăđơưạảấầẩẫậắặẵẻẽếềệỉịọỏốồổỗộớờởỡợụủứừửữựỳỷỹ"):
        return "vi"
    if any("\u4e00" <= c <= "\u9fff" for c in text):
        return "zh"
    if any("\u3040" <= c <= "\u30ff" for c in text):
        return "ja"
    if any("\uac00" <= c <= "\ud7af" for c in text):
        return "ko"
    if any("\u0600" <= c <= "\u06ff" for c in text):
        return "ar"
    if any("\u0400" <= c <= "\u04ff" for c in text):
        return "ru"
    return "en"


def normalize_item(item: ContentItemCreate, source_id: str) -> dict[str, Any]:
    """Convert a ContentItemCreate into a dict ready for ContentItem insertion."""
    text = item.text_content or ""
    url = item.url or ""

    publish_time = None
    if item.publish_time:
        try:
            publish_time = dateparser.parse(item.publish_time)
            if publish_time and publish_time.tzinfo is None:
                publish_time = publish_time.replace(tzinfo=timezone.utc)
        except (ValueError, TypeError):
            pass

    is_truncated = text.endswith("…") or text.endswith("...")

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
        "content_type": item.content_type or _CONTENT_TYPE_MAP.get(item.connector_type, "article"),
        "language": _detect_language(text),
        "author_name": item.author_name,
        "has_media": item.has_media,
        "is_truncated": is_truncated,
    }
