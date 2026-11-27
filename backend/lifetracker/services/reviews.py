"""Claude's writing in the app: reviews of a day, week or month, and plans for a day.

Claude writes them through MCP; the Mini App reads them and can add a plan's items to
the day in one tap. The server itself never calls an LLM.
"""

import uuid
from collections.abc import Sequence
from datetime import date, datetime, time
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from lifetracker.core.errors import ConflictError, DomainValidationError
from lifetracker.db.models import Review, Task
from lifetracker.domain.enums import Actor, ReviewAuthor, ReviewKind
from lifetracker.services import journal
from lifetracker.services.clock import user_now
from lifetracker.services.common import get_owned

LIST_LIMIT = 60
PLAN_MAX_ITEMS = 8


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


async def latest_plan(session: AsyncSession, user_id: uuid.UUID, day: date) -> Review | None:
    return await session.scalar(
        select(Review)
        .where(Review.user_id == user_id, Review.kind == ReviewKind.PLAN, Review.date == day)
        .order_by(Review.at.desc(), Review.id.desc())
        .limit(1)
    )


async def save_review(
    session: AsyncSession,
    user_id: uuid.UUID,
    kind: ReviewKind,
    text: str,
    now: datetime,
    *,
    on: date | None = None,
    by: ReviewAuthor = ReviewAuthor.CLAUDE,
    used_note: bool = False,
) -> Review:
    """A review takes along what Claude changed since its previous review."""
    if kind == ReviewKind.PLAN:
        raise DomainValidationError("Plans are saved with their items: use save_plan")
    day = on or (await user_now(session, user_id, now)).day
    previous = await session.scalar(
        select(Review.at)
        .where(Review.user_id == user_id, Review.kind != ReviewKind.PLAN)
        .order_by(Review.at.desc())
        .limit(1)
    )
    changes = await journal.since(session, user_id, previous) if by == ReviewAuthor.CLAUDE else []
    review = Review(
        user_id=user_id, kind=kind, date=day, body=text.strip(), by=by, at=now,
        used_note=used_note, changes=changes,
    )  # fmt: skip
    session.add(review)
    await session.commit()
    return review


async def save_plan(
    session: AsyncSession,
    user_id: uuid.UUID,
    items: list[dict[str, Any]],
    now: datetime,
    *,
    on: date | None = None,
    text: str = "",
) -> Review:
    """Claude's plan for a day: up to 8 items (title, optional start and duration, a note).
    A newer plan for the same day replaces the older one on the Today screen."""
    if not items:
        raise DomainValidationError("A plan needs at least one item")
    day = on or (await user_now(session, user_id, now)).day
    plan = Review(
        user_id=user_id, kind=ReviewKind.PLAN, date=day, body=text.strip(),
        by=ReviewAuthor.CLAUDE, at=now, items=items[:PLAN_MAX_ITEMS], changes=[],
    )  # fmt: skip
    session.add(plan)
    await session.commit()
    return plan


def _start(s: str | None) -> time | None:
    if not s:
        return None
    h, m = s.split(":")
    return time(int(h), int(m))


async def apply_plan(
    session: AsyncSession, user_id: uuid.UUID, review_id: uuid.UUID, now: datetime
) -> list[Task]:
    """«Добавить в день»: every item becomes a task on the plan's day, created by Claude."""
    plan = await get_review(session, user_id, review_id)
    if plan.kind != ReviewKind.PLAN or not plan.items:
        raise DomainValidationError("Only a plan can be added to the day")
    if plan.applied_at is not None:
        raise ConflictError("This plan is already in the day")
    tasks = [
        Task(
            user_id=user_id, title=str(it["title"])[:200], description=str(it.get("note") or ""),
            date=plan.date, start_time=_start(it.get("start")),
            duration_min=int(it.get("dur") or 30), created_by=Actor.CLAUDE,
        )
        for it in plan.items
    ]  # fmt: skip
    session.add_all(tasks)
    plan.applied_at = now
    await session.commit()
    return tasks
