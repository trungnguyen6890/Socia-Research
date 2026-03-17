from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

STATIC_DIR = Path(__file__).parent / "static"


def create_admin_app() -> FastAPI:
    """Create the admin sub-application."""
    from src.admin.routes import dashboard, sources, keywords, goals, schedules, content

    admin = FastAPI(title="Socia Research Admin")

    admin.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

    admin.include_router(dashboard.router)
    admin.include_router(sources.router, prefix="/sources", tags=["sources"])
    admin.include_router(keywords.router, prefix="/keywords", tags=["keywords"])
    admin.include_router(goals.router, prefix="/goals", tags=["goals"])
    admin.include_router(schedules.router, prefix="/schedules", tags=["schedules"])
    admin.include_router(content.router, prefix="/content", tags=["content"])

    return admin
