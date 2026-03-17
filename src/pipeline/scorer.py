from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Any

from src.models.goal import Goal


def score_items(
    items: list[dict[str, Any]],
    goals: list[Goal],
) -> list[dict[str, Any]]:
    """Score items for quality and signal relevance.

    Quality score (0-1): weighted sum of content richness signals.
    Signal score (0-1): relevance to active research goals.
    """
    # Build goal keyword sets for signal scoring
    goal_categories: list[set[str]] = []
    for goal in goals:
        cats = set()
        for kw in (goal.keywords or []):
            cats.add(kw.category)
        goal_categories.append(cats)

    now = datetime.now(timezone.utc)

    for item in items:
        item["quality_score"] = _quality_score(item, now)
        item["signal_score"] = _signal_score(item, goal_categories)

    return items


def _quality_score(item: dict[str, Any], now: datetime) -> float:
    """Calculate quality score based on content richness."""
    score = 0.0
    text = item.get("text_content") or ""
    title = item.get("title") or ""
    engagement = item.get("engagement_snapshot")
    publish_time = item.get("publish_time")
    is_dup = item.get("is_duplicate", False)

    # Has meaningful text (0.2)
    if len(text) > 10:
        score += 0.2

    # Text length bonus (0.15)
    if len(text) > 100:
        score += 0.15

    # Has title (0.15)
    if title:
        score += 0.15

    # Has engagement data (0.2)
    if engagement and any(v for v in engagement.values() if isinstance(v, (int, float)) and v > 0):
        score += 0.2

    # Recency bonus (0.15) - within last 24 hours
    if publish_time and isinstance(publish_time, datetime):
        if (now - publish_time) < timedelta(hours=24):
            score += 0.15

    # Not duplicate (0.15)
    if not is_dup:
        score += 0.15

    return round(min(score, 1.0), 3)


def _signal_score(item: dict[str, Any], goal_categories: list[set[str]]) -> float:
    """Calculate signal score based on goal relevance."""
    if not goal_categories:
        return 0.1  # Baseline when no goals defined

    item_tags = set(item.get("tags") or [])
    if not item_tags:
        return 0.1

    # Score based on how many goals this item's tags match
    matches = 0
    for goal_cats in goal_categories:
        if item_tags & goal_cats:
            matches += 1

    if matches == 0:
        return 0.1

    # Scale: matching 1 goal = 0.4, all goals = 1.0
    return round(min(0.4 + (0.6 * (matches - 1) / max(len(goal_categories) - 1, 1)), 1.0), 3)
