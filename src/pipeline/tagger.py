from __future__ import annotations

import re
from typing import Any

from src.config.constants import MatchMode
from src.models.keyword import Keyword


def apply_tags(
    items: list[dict[str, Any]],
    keywords: list[Keyword],
) -> list[dict[str, Any]]:
    """Apply keyword-based tags to content items.

    For each item, checks title + text_content against all active keywords.
    Matched keyword categories become tags.
    """
    if not keywords:
        return items

    # Pre-compile regex patterns
    compiled: list[tuple[Keyword, re.Pattern | None]] = []
    for kw in keywords:
        if kw.match_mode == MatchMode.REGEX:
            try:
                compiled.append((kw, re.compile(kw.keyword, re.IGNORECASE)))
            except re.error:
                continue
        else:
            compiled.append((kw, None))

    for item in items:
        text = f"{item.get('title') or ''} {item.get('text_content') or ''}".lower()
        matched_tags: set[str] = set(item.get("tags") or [])

        for kw, pattern in compiled:
            kw_lower = kw.keyword.lower()

            if kw.match_mode == MatchMode.EXACT:
                if kw_lower == text.strip():
                    matched_tags.add(kw.category)
            elif kw.match_mode == MatchMode.CONTAINS:
                if kw_lower in text:
                    matched_tags.add(kw.category)
            elif kw.match_mode == MatchMode.REGEX and pattern:
                if pattern.search(text):
                    matched_tags.add(kw.category)

        item["tags"] = sorted(matched_tags)

    return items
