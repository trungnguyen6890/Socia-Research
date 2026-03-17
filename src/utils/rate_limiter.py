from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass

from src.config.settings import RateLimitConfig


@dataclass
class _Bucket:
    tokens: float
    last_refill: float
    config: RateLimitConfig


class RateLimiter:
    """Per-connector async token bucket rate limiter."""

    def __init__(self, limits: dict[str, RateLimitConfig]) -> None:
        self._buckets: dict[str, _Bucket] = {}
        for key, cfg in limits.items():
            self._buckets[key] = _Bucket(
                tokens=float(cfg.requests_per_window),
                last_refill=time.monotonic(),
                config=cfg,
            )
        self._lock = asyncio.Lock()

    async def acquire(self, connector_type: str) -> None:
        """Block until a request slot is available for this connector type."""
        if connector_type not in self._buckets:
            return  # No limit configured, allow freely

        async with self._lock:
            bucket = self._buckets[connector_type]
            now = time.monotonic()

            # Refill tokens based on elapsed time
            elapsed = now - bucket.last_refill
            refill_rate = bucket.config.requests_per_window / bucket.config.window_seconds
            bucket.tokens = min(
                float(bucket.config.requests_per_window),
                bucket.tokens + elapsed * refill_rate,
            )
            bucket.last_refill = now

            if bucket.tokens >= 1.0:
                bucket.tokens -= 1.0
                return

            # Need to wait for a token
            wait_time = (1.0 - bucket.tokens) / refill_rate
            bucket.tokens = 0.0
            bucket.last_refill = now

        await asyncio.sleep(wait_time)
