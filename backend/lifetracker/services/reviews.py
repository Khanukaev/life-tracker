"""Reviews ("разборы") of a day or a week. Claude writes them through MCP `save_review`;
the Mini App only reads them. The server itself never calls an LLM."""

import uuid
from collections.abc import Sequence
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from lifetracker.db.models import Review
from lifetracker.domain.enums import ReviewAuthor, ReviewKind
from lifetracker.services.clock import user_now
from lifetracker.services.common import get_owned

LIST_LIMIT = 60


async def list_reviews(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    kind: ReviewKind | None = None,
    limit: int = LIST_LIMIT,
) -> Sequence[Review]:
    stmt = select(Review).where(Review.user_id == user_id)
    if kind is not None:
        stmt = stmt.where(Review.kind == kind)
    stmt = stmt.order_by(Review.at.desc(), Review.id.desc()).limit(min(limit, LIST_LIMIT))
    return (await session.scalars(stmt)).all()


async def get_review(session: AsyncSession, user_id: uuid.UUID, review_id: uuid.UUID) -> Review:
    return await get_owned(session, Review, review_id, user_id, what="Review")


async def save_review(
    session: AsyncSession,
    user_id: uuid.UUID,
    kind: ReviewKind,
    text: str,
    now: datetime,
    *,
    on: date | None = None,
    by: ReviewAuthor = ReviewAuthor.CLAUDE,
) -> Review:
    day = on or (await user_now(session, user_id, now)).day
    review = Review(user_id=user_id, kind=kind, date=day, body=text.strip(), by=by)
    session.add(review)
    await session.commit()
    return review
