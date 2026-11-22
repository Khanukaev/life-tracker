import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from lifetracker.core.errors import NotFoundError
from lifetracker.db.models import User
from lifetracker.domain.dates import LogicalNow, logical_now


async def user_now(session: AsyncSession, user_id: uuid.UUID, now: datetime) -> LogicalNow:
    """The user's logical day and minute (05:00–05:00 in their own time zone)."""
    tz = await session.scalar(select(User.timezone).where(User.id == user_id))
    if tz is None:
        raise NotFoundError("User not found")
    return logical_now(now, tz)
