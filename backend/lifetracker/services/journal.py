"""What Claude changed through MCP: one short line per change, in Russian, for the user.

The next review Claude saves takes the lines written since its previous review
(«Что Claude изменил»), so nothing changes in the tracker unnoticed.
"""

import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from lifetracker.db.models import ClaudeAction

MAX_LINES = 30


def record(session: AsyncSession, user_id: uuid.UUID, what: str, now: datetime) -> None:
    """Add a line; it is committed together with the change it describes."""
    session.add(ClaudeAction(user_id=user_id, what=what[:300], at=now))


async def since(session: AsyncSession, user_id: uuid.UUID, after: datetime | None) -> list[str]:
    stmt = select(ClaudeAction.what).where(ClaudeAction.user_id == user_id)
    if after is not None:
        stmt = stmt.where(ClaudeAction.at > after)
    rows = await session.scalars(stmt.order_by(ClaudeAction.at, ClaudeAction.id).limit(MAX_LINES))
    return list(rows)
