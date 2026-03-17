from __future__ import annotations

from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession

from src.models.base import get_session_factory

_session_factory = None


def set_session_factory(factory):
    global _session_factory
    _session_factory = factory


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    if _session_factory is None:
        factory = get_session_factory()
    else:
        factory = _session_factory

    async with factory() as session:
        yield session
