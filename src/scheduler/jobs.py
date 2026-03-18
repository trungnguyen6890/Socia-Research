from __future__ import annotations

import httpx
import structlog
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.pipeline.runner import run_source_pipeline
from src.utils.rate_limiter import RateLimiter

logger = structlog.get_logger()


async def run_source_job(
    source_id: str,
    session_factory: async_sessionmaker[AsyncSession],
    rate_limiter: RateLimiter,
    http_client: httpx.AsyncClient | None = None,
) -> None:
    """APScheduler job: run the pipeline for a single source.

    Args:
        source_id: Source to fetch.
        session_factory: DB session factory.
        rate_limiter: Shared rate limiter instance.
        http_client: Optional shared HTTP client (avoids per-job client creation).
    """
    logger.info("job_started", source_id=source_id)

    async with session_factory() as session:
        result = await run_source_pipeline(
            source_id=source_id,
            session=session,
            rate_limiter=rate_limiter,
            http_client=http_client,
        )

    logger.info("job_finished", source_id=source_id, result=result)
