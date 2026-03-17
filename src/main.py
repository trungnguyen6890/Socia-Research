from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

import structlog
import uvicorn
from fastapi import FastAPI

from src.admin.app import create_admin_app
from src.admin.deps import set_session_factory
from src.config.settings import get_settings
from src.models.base import Base, get_engine, get_session_factory
from src.scheduler.engine import SchedulerEngine

# Import all connectors to trigger registration
import src.connectors.rss  # noqa: F401
import src.connectors.website  # noqa: F401
import src.connectors.youtube  # noqa: F401
import src.connectors.x_twitter  # noqa: F401
import src.connectors.telegram_connector  # noqa: F401
import src.connectors.facebook_page  # noqa: F401
import src.connectors.instagram_pro  # noqa: F401
import src.connectors.watch.facebook_profile  # noqa: F401
import src.connectors.watch.tiktok  # noqa: F401
import src.connectors.watch.threads  # noqa: F401

logger = structlog.get_logger()

scheduler_engine: SchedulerEngine | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global scheduler_engine

    settings = get_settings()
    engine = get_engine()
    session_factory = get_session_factory(engine)

    # Create tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Set session factory for admin dependency injection
    set_session_factory(session_factory)

    # Start scheduler
    scheduler_engine = SchedulerEngine(session_factory)
    await scheduler_engine.load_schedules()
    scheduler_engine.start()

    logger.info("app_started", host=settings.server.host, port=settings.server.port)

    yield

    # Shutdown
    if scheduler_engine:
        scheduler_engine.shutdown()
    await engine.dispose()
    logger.info("app_stopped")


def create_app() -> FastAPI:
    app = FastAPI(title="Socia Research Bot", lifespan=lifespan)

    # Mount admin UI
    admin_app = create_admin_app()
    app.mount("/admin", admin_app)

    @app.get("/")
    async def root():
        return {"status": "ok", "service": "socia-research", "admin": "/admin/"}

    @app.get("/health")
    async def health():
        return {"status": "healthy"}

    return app


app = create_app()


if __name__ == "__main__":
    settings = get_settings()
    uvicorn.run(
        "src.main:app",
        host=settings.server.host,
        port=settings.server.port,
        reload=True,
    )
