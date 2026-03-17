from __future__ import annotations

from fastapi import APIRouter, Depends, Form, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.admin.templates_config import templates
from src.admin.deps import get_db
from src.models.schedule import Schedule
from src.models.source import Source

router = APIRouter()


@router.get("/")
async def list_schedules(request: Request, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Schedule, Source)
        .outerjoin(Source, Schedule.source_id == Source.id)
        .order_by(Schedule.created_at.desc())
    )
    rows = result.all()
    schedules = [{"schedule": s, "source": src} for s, src in rows]
    return templates.TemplateResponse("schedules/list.html", {
        "request": request,
        "schedules": schedules,
    })


@router.get("/new")
async def new_schedule_form(request: Request, db: AsyncSession = Depends(get_db)):
    sources = (await db.execute(
        select(Source).where(Source.is_active == True).order_by(Source.name)  # noqa: E712
    )).scalars().all()
    return templates.TemplateResponse("schedules/form.html", {
        "request": request,
        "schedule": None,
        "sources": sources,
    })


@router.post("/new")
async def create_schedule(
    source_id: str = Form(...),
    cron_expression: str = Form("*/30 * * * *"),
    db: AsyncSession = Depends(get_db),
):
    schedule = Schedule(source_id=source_id, cron_expression=cron_expression)
    db.add(schedule)
    await db.commit()
    return RedirectResponse(url="/admin/schedules", status_code=303)


@router.get("/{schedule_id}/edit")
async def edit_schedule_form(schedule_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    schedule = await db.get(Schedule, schedule_id)
    sources = (await db.execute(
        select(Source).where(Source.is_active == True).order_by(Source.name)  # noqa: E712
    )).scalars().all()
    return templates.TemplateResponse("schedules/form.html", {
        "request": request,
        "schedule": schedule,
        "sources": sources,
    })


@router.post("/{schedule_id}/edit")
async def update_schedule(
    schedule_id: str,
    source_id: str = Form(...),
    cron_expression: str = Form("*/30 * * * *"),
    is_active: bool = Form(False),
    db: AsyncSession = Depends(get_db),
):
    schedule = await db.get(Schedule, schedule_id)
    if schedule:
        schedule.source_id = source_id
        schedule.cron_expression = cron_expression
        schedule.is_active = is_active
        await db.commit()
    return RedirectResponse(url="/admin/schedules", status_code=303)


@router.post("/{schedule_id}/delete")
async def delete_schedule(schedule_id: str, db: AsyncSession = Depends(get_db)):
    schedule = await db.get(Schedule, schedule_id)
    if schedule:
        await db.delete(schedule)
        await db.commit()
    return RedirectResponse(url="/admin/schedules", status_code=303)
