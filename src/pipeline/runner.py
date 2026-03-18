from __future__ import annotations

import structlog
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config.constants import WATCH_ONLY_CONNECTORS, RunStatus
from src.connectors.registry import get_connector
from src.models.content import ContentItem
from src.models.goal import Goal
from src.models.keyword import Keyword
from src.models.run_log import RunLog
from src.models.source import Source
from src.pipeline.dedupe import check_duplicates
from src.pipeline.normalize import normalize_item
from src.pipeline.scorer import score_items
from src.pipeline.tagger import apply_tags
from src.utils.http_client import create_http_client
from src.utils.rate_limiter import RateLimiter

logger = structlog.get_logger()


async def run_source_pipeline(
    source_id: str,
    session: AsyncSession,
    rate_limiter: RateLimiter,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Run the full pipeline for a single source.

    Pipeline: fetch -> normalize -> dedupe -> tag -> score -> store
    Returns summary dict with status and counts.
    """
    # Load source
    source = await session.get(Source, source_id)
    if source is None:
        raise ValueError(f"Source not found: {source_id}")

    if not source.is_active:
        logger.info("source_inactive", source_id=source_id)
        return {"status": "skipped", "reason": "inactive"}

    if source.connector_type in WATCH_ONLY_CONNECTORS:
        logger.info("watch_only_source", source_id=source_id)
        return {"status": "skipped", "reason": "watch_only"}

    # Create run log
    run_log = RunLog(source_id=source_id, status=RunStatus.RUNNING)
    if not dry_run:
        session.add(run_log)
        await session.flush()

    try:
        # 1. Fetch via connector
        async with create_http_client() as http_client:
            connector = get_connector(source, http_client, rate_limiter)
            items_raw, new_cursor = await connector.fetch_and_normalize(
                since_cursor=source.last_cursor
            )

        logger.info("fetched_items", source_id=source_id, count=len(items_raw))

        if not items_raw:
            run_log.status = RunStatus.SUCCESS
            run_log.items_fetched = 0
            run_log.finished_at = datetime.now(timezone.utc)
            if not dry_run:
                await session.commit()
            return {"status": "success", "items_fetched": 0}

        # 2. Normalize
        normalized = [normalize_item(item, source_id) for item in items_raw]

        # 3. Dedupe
        normalized = await check_duplicates(normalized, session)

        # 4. Tag
        keywords_result = await session.execute(
            select(Keyword).where(Keyword.is_active == True)  # noqa: E712
        )
        active_keywords = list(keywords_result.scalars().all())
        normalized = apply_tags(normalized, active_keywords)

        # 5. Score
        goals_result = await session.execute(
            select(Goal).where(Goal.is_active == True)  # noqa: E712
        )
        active_goals = list(goals_result.scalars().all())
        normalized = score_items(normalized, active_goals)

        # 6. Store
        if not dry_run:
            for item_data in normalized:
                content_item = ContentItem(**item_data)
                session.add(content_item)

            # Update source cursor
            if new_cursor:
                source.last_cursor = new_cursor
            source.last_fetched_at = datetime.now(timezone.utc)

            run_log.status = RunStatus.SUCCESS
            run_log.items_fetched = len(normalized)
            run_log.finished_at = datetime.now(timezone.utc)

            await session.commit()

        logger.info(
            "pipeline_complete",
            source_id=source_id,
            items_fetched=len(normalized),
            duplicates=sum(1 for i in normalized if i["is_duplicate"]),
        )

        return {
            "status": "success",
            "items_fetched": len(normalized),
            "duplicates": sum(1 for i in normalized if i["is_duplicate"]),
            "new_cursor": new_cursor,
        }

    except Exception as e:
        logger.error("pipeline_error", source_id=source_id, error=str(e))
        run_log.status = RunStatus.ERROR
        run_log.error_message = str(e)
        run_log.finished_at = datetime.now(timezone.utc)
        if not dry_run:
            await session.commit()
        return {"status": "error", "error": str(e)}
