from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.admin.templates_config import templates
from src.admin.deps import get_db
from src.models.content import ContentItem
from src.models.run_log import RunLog
from src.models.source import Source
from src.utils.time_utils import utc_now

router = APIRouter()


@router.get("/")
async def dashboard(request: Request, db: AsyncSession = Depends(get_db)):
    now = utc_now()
    day_ago = now - timedelta(hours=24)

    # Stats queries
    total_items = (await db.execute(select(func.count(ContentItem.id)))).scalar() or 0
    items_today = (await db.execute(
        select(func.count(ContentItem.id)).where(ContentItem.fetch_time >= day_ago)
    )).scalar() or 0
    active_sources = (await db.execute(
        select(func.count(Source.id)).where(Source.is_active == True)  # noqa: E712
    )).scalar() or 0
    total_sources = (await db.execute(select(func.count(Source.id)))).scalar() or 0

    # Recent errors
    recent_errors = (await db.execute(
        select(RunLog)
        .where(RunLog.status == "error")
        .order_by(RunLog.started_at.desc())
        .limit(5)
    )).scalars().all()

    # Recent runs
    recent_runs = (await db.execute(
        select(RunLog)
        .order_by(RunLog.started_at.desc())
        .limit(10)
    )).scalars().all()

    return templates.TemplateResponse("dashboard.html", {
        "request": request,
        "total_items": total_items,
        "items_today": items_today,
        "active_sources": active_sources,
        "total_sources": total_sources,
        "recent_errors": recent_errors,
        "recent_runs": recent_runs,
    })
