"""Shared fixtures for connector tests."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import httpx
import pytest

from src.config.settings import RateLimitConfig
from src.utils.rate_limiter import RateLimiter


@dataclass
class FakeSource:
    """Lightweight stand-in for Source that avoids SQLAlchemy instrumentation."""
    id: str = "test-source-id"
    name: str = "Test Source"
    connector_type: str = ""
    source_mode: str = "official_api"
    url_or_handle: str = "test_handle"
    config: dict[str, Any] = field(default_factory=dict)
    tags: list[str] = field(default_factory=list)
    priority: int = 5
    is_active: bool = True
    last_fetched_at: Any = None
    last_cursor: str | None = None


@pytest.fixture
def noop_rate_limiter() -> RateLimiter:
    """Rate limiter that never blocks (empty config)."""
    return RateLimiter({})


@pytest.fixture
def strict_rate_limiter() -> RateLimiter:
    """Rate limiter with very tight limits for testing blocking behaviour."""
    return RateLimiter(
        {
            "x_twitter": RateLimitConfig(requests_per_window=1, window_seconds=60),
            "youtube": RateLimitConfig(requests_per_window=1, window_seconds=60),
            "facebook_page": RateLimitConfig(requests_per_window=1, window_seconds=60),
            "instagram_pro": RateLimitConfig(requests_per_window=1, window_seconds=60),
            "rss": RateLimitConfig(requests_per_window=1, window_seconds=60),
            "website": RateLimitConfig(requests_per_window=1, window_seconds=60),
            "telegram": RateLimitConfig(requests_per_window=1, window_seconds=60),
        }
    )


def make_source(
    connector_type: str,
    url_or_handle: str = "test_handle",
    config: dict[str, Any] | None = None,
) -> FakeSource:
    """Create a FakeSource for testing without touching the DB."""
    return FakeSource(
        connector_type=connector_type,
        url_or_handle=url_or_handle,
        config=config or {},
    )
