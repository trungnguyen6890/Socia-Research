from __future__ import annotations

from fastapi import APIRouter, Depends, Form, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.admin.templates_config import templates
from src.admin.deps import get_db
from src.models.goal import Goal
from src.models.keyword import Keyword

router = APIRouter()


@router.get("/")
async def list_goals(request: Request, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Goal).order_by(Goal.priority, Goal.name))
    goals = result.scalars().all()
    return templates.TemplateResponse("goals/list.html", {
        "request": request,
        "goals": goals,
    })


@router.get("/new")
async def new_goal_form(request: Request, db: AsyncSession = Depends(get_db)):
    keywords = (await db.execute(
        select(Keyword).where(Keyword.is_active == True).order_by(Keyword.category)  # noqa: E712
    )).scalars().all()
    return templates.TemplateResponse("goals/form.html", {
        "request": request,
        "goal": None,
        "all_keywords": keywords,
        "selected_keyword_ids": [],
    })


@router.post("/new")
async def create_goal(
    request: Request,
    name: str = Form(...),
    description: str = Form(""),
    priority: int = Form(5),
    db: AsyncSession = Depends(get_db),
):
    form_data = await request.form()
    keyword_ids = form_data.getlist("keyword_ids")

    goal = Goal(name=name, description=description, priority=priority)

    if keyword_ids:
        keywords = (await db.execute(
            select(Keyword).where(Keyword.id.in_(keyword_ids))
        )).scalars().all()
        goal.keywords = list(keywords)

    db.add(goal)
    await db.commit()
    return RedirectResponse(url="/admin/goals", status_code=303)


@router.get("/{goal_id}/edit")
async def edit_goal_form(goal_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    goal = await db.get(Goal, goal_id)
    all_keywords = (await db.execute(
        select(Keyword).where(Keyword.is_active == True).order_by(Keyword.category)  # noqa: E712
    )).scalars().all()
    selected_ids = [kw.id for kw in (goal.keywords or [])] if goal else []
    return templates.TemplateResponse("goals/form.html", {
        "request": request,
        "goal": goal,
        "all_keywords": all_keywords,
        "selected_keyword_ids": selected_ids,
    })


@router.post("/{goal_id}/edit")
async def update_goal(
    goal_id: str,
    request: Request,
    name: str = Form(...),
    description: str = Form(""),
    priority: int = Form(5),
    is_active: bool = Form(False),
    db: AsyncSession = Depends(get_db),
):
    goal = await db.get(Goal, goal_id)
    if not goal:
        return RedirectResponse(url="/admin/goals", status_code=303)

    form_data = await request.form()
    keyword_ids = form_data.getlist("keyword_ids")

    goal.name = name
    goal.description = description
    goal.priority = priority
    goal.is_active = is_active

    if keyword_ids:
        keywords = (await db.execute(
            select(Keyword).where(Keyword.id.in_(keyword_ids))
        )).scalars().all()
        goal.keywords = list(keywords)
    else:
        goal.keywords = []

    await db.commit()
    return RedirectResponse(url="/admin/goals", status_code=303)


@router.post("/{goal_id}/delete")
async def delete_goal(goal_id: str, db: AsyncSession = Depends(get_db)):
    goal = await db.get(Goal, goal_id)
    if goal:
        await db.delete(goal)
        await db.commit()
    return RedirectResponse(url="/admin/goals", status_code=303)
