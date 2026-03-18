from __future__ import annotations

import hashlib
import random

import structlog
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.config.settings import get_settings
from src.models.schedule import Schedule
from src.models.source import Source
from src.scheduler.jobs import run_source_job
from src.utils.http_client import create_http_client
from src.utils.rate_limiter import RateLimiter

logger = structlog.get_logger()


class SchedulerEngine:
    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self.scheduler = AsyncIOScheduler()
        self.session_factory = session_factory
        self.rate_limiter = self._build_rate_limiter()
        self._http_client = None

    def _build_rate_limiter(self) -> RateLimiter:
        settings = get_settings()
        return RateLimiter(settings.rate_limits)

    async def _get_http_client(self):
        """Shared HTTP client across all jobs — avoids per-job client creation."""
        if self._http_client is None:
            self._http_client = create_http_client()
        return self._http_client

    async def load_schedules(self) -> None:
        """Load all active schedules from DB and register as APScheduler jobs."""
        async with self.session_factory() as session:
            result = await session.execute(
                select(Schedule, Source)
                .join(Source, Schedule.source_id == Source.id)
                .where(Schedule.is_active == True)  # noqa: E712
                .where(Source.is_active == True)  # noqa: E712
            )
            rows = result.all()

        for schedule, source in rows:
            self._add_job(schedule, source)

        logger.info("schedules_loaded", count=len(rows))

    def _stagger_seconds(self, source_id: str, max_spread: int = 300) -> int:
        """Deterministic stagger: hash source_id to get 0..max_spread seconds.

        Prevents all cron jobs with the same expression from firing at the
        exact same second. Deterministic so restarts don't shuffle the schedule.
        """
        digest = hashlib.md5(source_id.encode()).hexdigest()
        return int(digest[:8], 16) % max_spread

    def _add_job(self, schedule: Schedule, source: Source) -> None:
        """Register a single source pipeline job with staggered start."""
        job_id = f"source_{source.id}"

        # Remove existing job if any
        if self.scheduler.get_job(job_id):
            self.scheduler.remove_job(job_id)

        try:
            trigger = CronTrigger.from_crontab(schedule.cron_expression)
        except ValueError:
            logger.error("invalid_cron", source_id=source.id, cron=schedule.cron_expression)
            return

        # Stagger: add a deterministic jitter so jobs don't all fire at second 0
        stagger = self._stagger_seconds(source.id)
        trigger.jitter = stagger

        self.scheduler.add_job(
            run_source_job,
            trigger=trigger,
            id=job_id,
            name=f"Fetch: {source.name}",
            kwargs={
                "source_id": source.id,
                "session_factory": self.session_factory,
                "rate_limiter": self.rate_limiter,
            },
            replace_existing=True,
            misfire_grace_time=300,
        )
        logger.info(
            "job_registered",
            source_id=source.id,
            cron=schedule.cron_expression,
            stagger_seconds=stagger,
        )

    async def trigger_now(self, source_id: str) -> None:
        """Immediately trigger a pipeline run for a source."""
        http_client = await self._get_http_client()
        await run_source_job(
            source_id=source_id,
            session_factory=self.session_factory,
            rate_limiter=self.rate_limiter,
            http_client=http_client,
        )

    def start(self) -> None:
        self.scheduler.start()
        logger.info("scheduler_started")

    async def shutdown(self) -> None:
        self.scheduler.shutdown(wait=False)
        if self._http_client is not None:
            await self._http_client.aclose()
            self._http_client = None
        logger.info("scheduler_stopped")
