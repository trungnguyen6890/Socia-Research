from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from src.admin.templates_config import templates
from src.admin.deps import get_db
from src.models.content import ContentItem
from src.models.source import Source

router = APIRouter()

PAGE_SIZE = 50


@router.get("/")
async def list_content(
    request: Request,
    page: int = Query(1, ge=1),
    source_id: str = Query(None),
    tag: str = Query(None),
    search: str = Query(None),
    min_score: float = Query(None),
    hide_duplicates: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    query = select(ContentItem).order_by(ContentItem.fetch_time.desc())

    if source_id:
        query = query.where(ContentItem.source_id == source_id)
    if hide_duplicates:
        query = query.where(ContentItem.is_duplicate == False)  # noqa: E712
    if min_score is not None:
        query = query.where(ContentItem.quality_score >= min_score)
    if search:
        pattern = f"%{search}%"
        query = query.where(
            or_(
                ContentItem.title.ilike(pattern),
                ContentItem.text_content.ilike(pattern),
            )
        )

    # Count total
    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar() or 0

    # Paginate
    offset = (page - 1) * PAGE_SIZE
    items = (await db.execute(query.offset(offset).limit(PAGE_SIZE))).scalars().all()

    # Sources for filter dropdown
    sources = (await db.execute(select(Source).order_by(Source.name))).scalars().all()

    total_pages = max(1, (total + PAGE_SIZE - 1) // PAGE_SIZE)

    return templates.TemplateResponse("content/list.html", {
        "request": request,
        "items": items,
        "sources": sources,
        "page": page,
        "total_pages": total_pages,
        "total": total,
        "source_id": source_id,
        "tag": tag,
        "search": search or "",
        "min_score": min_score,
        "hide_duplicates": hide_duplicates,
    })


@router.get("/{item_id}")
async def content_detail(item_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    item = await db.get(ContentItem, item_id)
    source = await db.get(Source, item.source_id) if item else None
    return templates.TemplateResponse("content/detail.html", {
        "request": request,
        "item": item,
        "source": source,
    })
