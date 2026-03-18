from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field

from src.config.settings import RateLimitConfig


@dataclass
class _Bucket:
    tokens: float
    last_refill: float
    config: RateLimitConfig
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class RateLimiter:
    """Per-connector async token bucket rate limiter.

    Key design choices for scale (100-1000 sources):
    - Per-bucket locks: YouTube waiters don't block X/Twitter acquires.
    - Re-check after sleep: Prevents thundering herd — only ONE waiter
      proceeds per refilled token, others re-queue.
    - Ordered queue: asyncio.Lock is FIFO, ensuring fairness among sources.
    """

    def __init__(self, limits: dict[str, RateLimitConfig]) -> None:
        self._buckets: dict[str, _Bucket] = {}
        for key, cfg in limits.items():
            self._buckets[key] = _Bucket(
                tokens=float(cfg.requests_per_window),
                last_refill=time.monotonic(),
                config=cfg,
            )

    async def acquire(self, connector_type: str) -> None:
        """Block until a request slot is available for this connector type."""
        if connector_type not in self._buckets:
            return  # No limit configured, allow freely

        bucket = self._buckets[connector_type]

        while True:
            async with bucket.lock:
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

                # Calculate wait time for next token
                wait_time = (1.0 - bucket.tokens) / refill_rate

            # Sleep OUTSIDE lock so other connector types aren't blocked,
            # then LOOP BACK to re-check (prevents thundering herd).
            await asyncio.sleep(wait_time)
