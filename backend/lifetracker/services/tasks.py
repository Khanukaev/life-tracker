"""Tasks. Critical tasks always come first in every list."""

import uuid
from collections.abc import Sequence
from datetime import date, datetime, timedelta

from sqlalchemy import case, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from lifetracker.core.errors import DomainValidationError
from lifetracker.db.models import Task
from lifetracker.domain.enums import Actor, Importance
from lifetracker.schemas.tasks import TaskCreate, TaskUpdate, TaskView
from lifetracker.services.clock import user_now
from lifetracker.services.common import apply_patch, get_owned, resolve_client_id

UPCOMING_DAYS = 14
DONE_LIMIT = 60

IMPORTANCE_RANK: ColumnElement[int] = case(
    (Task.importance == Importance.CRITICAL, 0),
    (Task.importance == Importance.IMPORTANT, 1),
    else_=2,
)


async def list_tasks(
    session: AsyncSession,
    user_id: uuid.UUID,
    now: datetime,
    *,
    view: TaskView | None = None,
    on: date | None = None,
) -> Sequence[Task]:
    stmt = select(Task).where(Task.user_id == user_id)
    if on is not None:
        stmt = stmt.where(Task.date == on).order_by(
            Task.done, IMPORTANCE_RANK, Task.start_time.nulls_last(), Task.created_at
        )
        return (await session.scalars(stmt)).all()

    today = (await user_now(session, user_id, now)).day
    match view:
        case TaskView.INBOX:
            stmt = stmt.where(Task.date.is_(None), ~Task.done).order_by(
                IMPORTANCE_RANK, Task.created_at
            )
        case TaskView.TODAY | None:
            stmt = stmt.where(Task.date == today).order_by(
                Task.done, IMPORTANCE_RANK, Task.start_time.nulls_last(), Task.created_at
            )
        case TaskView.OVERDUE:
            stmt = stmt.where(~Task.done, Task.date < today).order_by(
                IMPORTANCE_RANK, Task.date, Task.start_time.nulls_last()
            )
        case TaskView.UPCOMING:
            stmt = stmt.where(
                ~Task.done, Task.date > today, Task.date <= today + timedelta(days=UPCOMING_DAYS)
            ).order_by(IMPORTANCE_RANK, Task.date, Task.start_time.nulls_last())
        case TaskView.DONE:
            stmt = stmt.where(Task.done).order_by(Task.done_at.desc()).limit(DONE_LIMIT)
    return (await session.scalars(stmt)).all()


async def get_task(session: AsyncSession, user_id: uuid.UUID, task_id: uuid.UUID) -> Task:
    return await get_owned(session, Task, task_id, user_id, what="Task")


async def create_task(
    session: AsyncSession, user_id: uuid.UUID, data: TaskCreate, *, by: Actor = Actor.ME
) -> Task:
    existing = await resolve_client_id(session, Task, data.id, user_id)
    if existing is not None:
        return existing
    task = Task(user_id=user_id, created_by=by, done=False, **data.model_dump(exclude={"id"}))
    if data.id is not None:
        task.id = data.id
    session.add(task)
    await session.commit()
    return task


async def update_task(
    session: AsyncSession, user_id: uuid.UUID, task_id: uuid.UUID, data: TaskUpdate, now: datetime
) -> Task:
    task = await get_task(session, user_id, task_id)
    fields = data.model_dump(exclude_unset=True)
    changed = apply_patch(task, fields, nullable={"date", "start_time"})
    if task.start_time is not None and task.date is None:
        if "date" in changed:  # moved to the inbox: the time no longer means anything
            task.start_time = None
        else:
            raise DomainValidationError("start_time requires a date")
    if "done" in changed:
        task.done_at = now if task.done else None
    await session.commit()
    return task


async def delete_task(session: AsyncSession, user_id: uuid.UUID, task_id: uuid.UUID) -> None:
    task = await get_task(session, user_id, task_id)
    await session.delete(task)
    await session.commit()


async def move_overdue_to_today(session: AsyncSession, user_id: uuid.UUID, now: datetime) -> int:
    """Move every unfinished past task to today and drop its time, so it can be re-slotted."""
    today = (await user_now(session, user_id, now)).day
    result = await session.execute(
        update(Task)
        .where(Task.user_id == user_id, ~Task.done, Task.date < today)
        .values(date=today, start_time=None)
        .returning(Task.id)
    )
    moved = len(result.all())
    await session.commit()
    return moved
