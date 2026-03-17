from __future__ import annotations

import json

from fastapi import APIRouter, Depends, Form, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.admin.templates_config import templates
from src.admin.deps import get_db
from src.config.constants import ConnectorType, SourceMode
from src.models.source import Source

router = APIRouter()


@router.get("/")
async def list_sources(request: Request, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Source).order_by(Source.created_at.desc()))
    sources = result.scalars().all()
    return templates.TemplateResponse("sources/list.html", {
        "request": request,
        "sources": sources,
    })


@router.get("/new")
async def new_source_form(request: Request):
    return templates.TemplateResponse("sources/form.html", {
        "request": request,
        "source": None,
        "connector_types": list(ConnectorType),
        "source_modes": list(SourceMode),
    })


@router.post("/new")
async def create_source(
    request: Request,
    name: str = Form(...),
    connector_type: str = Form(...),
    source_mode: str = Form(...),
    url_or_handle: str = Form(""),
    config_json: str = Form("{}"),
    tags_str: str = Form(""),
    priority: int = Form(5),
    db: AsyncSession = Depends(get_db),
):
    try:
        config = json.loads(config_json)
    except json.JSONDecodeError:
        config = {}

    tags = [t.strip() for t in tags_str.split(",") if t.strip()]

    source = Source(
        name=name,
        connector_type=connector_type,
        source_mode=source_mode,
        url_or_handle=url_or_handle,
        config=config,
        tags=tags,
        priority=priority,
    )
    db.add(source)
    await db.commit()
    return RedirectResponse(url="/admin/sources", status_code=303)


@router.get("/{source_id}/edit")
async def edit_source_form(source_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    source = await db.get(Source, source_id)
    return templates.TemplateResponse("sources/form.html", {
        "request": request,
        "source": source,
        "connector_types": list(ConnectorType),
        "source_modes": list(SourceMode),
    })


@router.post("/{source_id}/edit")
async def update_source(
    source_id: str,
    request: Request,
    name: str = Form(...),
    connector_type: str = Form(...),
    source_mode: str = Form(...),
    url_or_handle: str = Form(""),
    config_json: str = Form("{}"),
    tags_str: str = Form(""),
    priority: int = Form(5),
    is_active: bool = Form(False),
    db: AsyncSession = Depends(get_db),
):
    source = await db.get(Source, source_id)
    if source is None:
        return RedirectResponse(url="/admin/sources", status_code=303)

    try:
        config = json.loads(config_json)
    except json.JSONDecodeError:
        config = source.config

    source.name = name
    source.connector_type = connector_type
    source.source_mode = source_mode
    source.url_or_handle = url_or_handle
    source.config = config
    source.tags = [t.strip() for t in tags_str.split(",") if t.strip()]
    source.priority = priority
    source.is_active = is_active

    await db.commit()
    return RedirectResponse(url="/admin/sources", status_code=303)


@router.post("/{source_id}/toggle")
async def toggle_source(source_id: str, db: AsyncSession = Depends(get_db)):
    source = await db.get(Source, source_id)
    if source:
        source.is_active = not source.is_active
        await db.commit()
    return RedirectResponse(url="/admin/sources", status_code=303)


@router.post("/{source_id}/delete")
async def delete_source(source_id: str, db: AsyncSession = Depends(get_db)):
    source = await db.get(Source, source_id)
    if source:
        await db.delete(source)
        await db.commit()
    return RedirectResponse(url="/admin/sources", status_code=303)
