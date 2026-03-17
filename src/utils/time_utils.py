from __future__ import annotations

from datetime import datetime, timezone


def utc_now() -> datetime:
    """Return current time as timezone-aware UTC datetime."""
    return datetime.now(timezone.utc)


def ensure_utc(dt: datetime | None) -> datetime | None:
    """Ensure a datetime is timezone-aware UTC. Returns None if input is None."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def iso_format(dt: datetime | None) -> str | None:
    """Format datetime as ISO 8601 string, or None."""
    if dt is None:
        return None
    return dt.isoformat()
