from __future__ import annotations

import structlog
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.pipeline.runner import run_source_pipeline
from src.utils.rate_limiter import RateLimiter

logger = structlog.get_logger()


async def run_source_job(
    source_id: str,
    session_factory: async_sessionmaker[AsyncSession],
    rate_limiter: RateLimiter,
) -> None:
    """APScheduler job: run the pipeline for a single source."""
    logger.info("job_started", source_id=source_id)

    async with session_factory() as session:
        result = await run_source_pipeline(
            source_id=source_id,
            session=session,
            rate_limiter=rate_limiter,
        )

    logger.info("job_finished", source_id=source_id, result=result)
