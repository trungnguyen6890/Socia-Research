from __future__ import annotations

import structlog
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.config.settings import get_settings
from src.models.schedule import Schedule
from src.models.source import Source
from src.scheduler.jobs import run_source_job
from src.utils.rate_limiter import RateLimiter

logger = structlog.get_logger()


class SchedulerEngine:
    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self.scheduler = AsyncIOScheduler()
        self.session_factory = session_factory
        self.rate_limiter = self._build_rate_limiter()

    def _build_rate_limiter(self) -> RateLimiter:
        settings = get_settings()
        return RateLimiter(settings.rate_limits)

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

    def _add_job(self, schedule: Schedule, source: Source) -> None:
        """Register a single source pipeline job."""
        job_id = f"source_{source.id}"

        # Remove existing job if any
        if self.scheduler.get_job(job_id):
            self.scheduler.remove_job(job_id)

        try:
            trigger = CronTrigger.from_crontab(schedule.cron_expression)
        except ValueError:
            logger.error("invalid_cron", source_id=source.id, cron=schedule.cron_expression)
            return

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
        logger.info("job_registered", source_id=source.id, cron=schedule.cron_expression)

    async def trigger_now(self, source_id: str) -> None:
        """Immediately trigger a pipeline run for a source."""
        await run_source_job(
            source_id=source_id,
            session_factory=self.session_factory,
            rate_limiter=self.rate_limiter,
        )

    def start(self) -> None:
        self.scheduler.start()
        logger.info("scheduler_started")

    def shutdown(self) -> None:
        self.scheduler.shutdown(wait=False)
        logger.info("scheduler_stopped")
