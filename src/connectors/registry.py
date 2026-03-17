from __future__ import annotations

from typing import Type

import httpx

from src.config.constants import ConnectorType
from src.connectors.base import BaseConnector
from src.models.source import Source
from src.utils.rate_limiter import RateLimiter

_REGISTRY: dict[str, Type[BaseConnector]] = {}


def register_connector(connector_type: str):
    """Decorator to register a connector class."""
    def wrapper(cls: Type[BaseConnector]):
        _REGISTRY[connector_type] = cls
        return cls
    return wrapper


def get_connector(
    source: Source,
    http_client: httpx.AsyncClient,
    rate_limiter: RateLimiter,
) -> BaseConnector:
    """Instantiate the correct connector for a given source."""
    cls = _REGISTRY.get(source.connector_type)
    if cls is None:
        raise ValueError(f"No connector registered for type: {source.connector_type}")
    return cls(source=source, http_client=http_client, rate_limiter=rate_limiter)


def available_connectors() -> list[str]:
    """Return list of registered connector type names."""
    return list(_REGISTRY.keys())
