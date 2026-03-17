from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

import httpx

from src.config.constants import ConnectorType
from src.models.source import Source
from src.utils.rate_limiter import RateLimiter


@dataclass
class FetchResult:
    """Result from a connector fetch operation."""
    raw_items: list[dict[str, Any]] = field(default_factory=list)
    new_cursor: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class ContentItemCreate:
    """Normalized content item ready for pipeline processing."""
    url: str
    connector_type: str
    title: str | None = None
    text_content: str | None = None
    publish_time: str | None = None  # ISO 8601 string
    engagement_snapshot: dict[str, Any] | None = None
    raw_data: dict[str, Any] | None = None
    canonical_url: str | None = None


class BaseConnector(ABC):
    """Abstract base class for all source connectors."""

    connector_type: ConnectorType

    def __init__(
        self,
        source: Source,
        http_client: httpx.AsyncClient,
        rate_limiter: RateLimiter,
    ) -> None:
        self.source = source
        self.http = http_client
        self.rate_limiter = rate_limiter
        self.config: dict[str, Any] = source.config or {}

    @abstractmethod
    async def fetch(self, since_cursor: str | None = None) -> FetchResult:
        """Fetch new items since cursor. Returns FetchResult with raw items + new cursor."""
        ...

    @abstractmethod
    def normalize(self, raw_item: dict[str, Any]) -> ContentItemCreate:
        """Convert raw connector output to the standard ContentItemCreate schema."""
        ...

    async def fetch_and_normalize(
        self, since_cursor: str | None = None
    ) -> tuple[list[ContentItemCreate], str | None]:
        """Convenience: fetch + normalize in one call."""
        result = await self.fetch(since_cursor)
        items = [self.normalize(raw) for raw in result.raw_items]
        return items, result.new_cursor
