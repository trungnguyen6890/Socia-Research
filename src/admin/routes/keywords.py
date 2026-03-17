from __future__ import annotations

from fastapi import APIRouter, Depends, Form, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.admin.templates_config import templates
from src.admin.deps import get_db
from src.config.constants import MatchMode
from src.models.keyword import Keyword

router = APIRouter()


@router.get("/")
async def list_keywords(request: Request, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Keyword).order_by(Keyword.category, Keyword.keyword))
    keywords = result.scalars().all()
    return templates.TemplateResponse("keywords/list.html", {
        "request": request,
        "keywords": keywords,
    })


@router.get("/new")
async def new_keyword_form(request: Request):
    return templates.TemplateResponse("keywords/form.html", {
        "request": request,
        "keyword": None,
        "match_modes": list(MatchMode),
    })


@router.post("/new")
async def create_keyword(
    request: Request,
    keyword: str = Form(...),
    category: str = Form("general"),
    match_mode: str = Form("contains"),
    db: AsyncSession = Depends(get_db),
):
    kw = Keyword(keyword=keyword, category=category, match_mode=match_mode)
    db.add(kw)
    await db.commit()
    return RedirectResponse(url="/admin/keywords", status_code=303)


@router.get("/{keyword_id}/edit")
async def edit_keyword_form(keyword_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    kw = await db.get(Keyword, keyword_id)
    return templates.TemplateResponse("keywords/form.html", {
        "request": request,
        "keyword": kw,
        "match_modes": list(MatchMode),
    })


@router.post("/{keyword_id}/edit")
async def update_keyword(
    keyword_id: str,
    keyword: str = Form(...),
    category: str = Form("general"),
    match_mode: str = Form("contains"),
    is_active: bool = Form(False),
    db: AsyncSession = Depends(get_db),
):
    kw = await db.get(Keyword, keyword_id)
    if kw:
        kw.keyword = keyword
        kw.category = category
        kw.match_mode = match_mode
        kw.is_active = is_active
        await db.commit()
    return RedirectResponse(url="/admin/keywords", status_code=303)


@router.post("/{keyword_id}/delete")
async def delete_keyword(keyword_id: str, db: AsyncSession = Depends(get_db)):
    kw = await db.get(Keyword, keyword_id)
    if kw:
        await db.delete(kw)
        await db.commit()
    return RedirectResponse(url="/admin/keywords", status_code=303)
