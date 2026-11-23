import uuid
from collections.abc import Sequence
from datetime import datetime

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from lifetracker.core.errors import ConflictError, DomainValidationError
from lifetracker.db.models import Habit
from lifetracker.domain.enums import HabitType, ScheduleKind
from lifetracker.schemas.habits import (
    CycleSchedule,
    EverySchedule,
    HabitCreate,
    HabitUpdate,
    Schedule,
    normalize_config,
)
from lifetracker.services.clock import user_now
from lifetracker.services.common import apply_patch, get_owned, next_position, resolve_client_id
from lifetracker.services.spheres import ensure_sphere


async def list_habits(
    session: AsyncSession, user_id: uuid.UUID, *, active: bool | None = None
) -> Sequence[Habit]:
    stmt = select(Habit).where(Habit.user_id == user_id)
    if active is not None:
        stmt = stmt.where(Habit.active == active)
    return (await session.scalars(stmt.order_by(Habit.position, Habit.created_at))).all()


async def get_habit(session: AsyncSession, user_id: uuid.UUID, habit_id: uuid.UUID) -> Habit:
    return await get_owned(session, Habit, habit_id, user_id, what="Habit")


async def _apply_schedule(
    session: AsyncSession, user_id: uuid.UUID, habit: Habit, sched: Schedule, now: datetime
) -> None:
    habit.sched_kind = sched.kind
    habit.sched_n = sched.n if isinstance(sched, EverySchedule) else None
    if isinstance(sched, CycleSchedule):
        habit.sched_pattern = sched.pattern
        habit.sched_anchor = sched.anchor or (await user_now(session, user_id, now)).day
    else:
        habit.sched_pattern = None
        habit.sched_anchor = None


async def _bedtime_exists(session: AsyncSession, user_id: uuid.UUID) -> bool:
    found = await session.scalar(
        select(Habit.id).where(Habit.user_id == user_id, Habit.type == HabitType.BEDTIME)
    )
    return found is not None


async def create_habit(
    session: AsyncSession, user_id: uuid.UUID, data: HabitCreate, now: datetime
) -> Habit:
    existing = await resolve_client_id(session, Habit, data.id, user_id)
    if existing is not None:
        return existing
    if data.type == HabitType.BEDTIME and await _bedtime_exists(session, user_id):
        raise ConflictError("Bedtime habit already exists")
    await ensure_sphere(session, user_id, data.sphere_id)
    habit = Habit(
        user_id=user_id,
        name=data.name,
        type=data.type,
        sphere_id=data.sphere_id,
        config=data.config,
        active=data.active,
        position=data.position
        if data.position is not None
        else await next_position(session, Habit, user_id),
        sched_kind=ScheduleKind.DAILY,
    )
    if data.id is not None:
        habit.id = data.id
    await _apply_schedule(session, user_id, habit, data.schedule, now)
    session.add(habit)
    await session.commit()
    return habit


async def update_habit(
    session: AsyncSession, user_id: uuid.UUID, habit_id: uuid.UUID, data: HabitUpdate, now: datetime
) -> Habit:
    habit = await get_habit(session, user_id, habit_id)
    fields = data.model_dump(exclude_unset=True, exclude={"schedule", "config"})
    if "sphere_id" in fields:
        await ensure_sphere(session, user_id, fields["sphere_id"])
    apply_patch(habit, fields, nullable={"sphere_id"})
    if data.config is not None:
        try:
            habit.config = normalize_config(habit.type, data.config)
        except ValidationError as e:
            raise DomainValidationError(f"Invalid config for {habit.type} habit") from e
    if data.schedule is not None:
        await _apply_schedule(session, user_id, habit, data.schedule, now)
    await session.commit()
    return habit


async def delete_habit(session: AsyncSession, user_id: uuid.UUID, habit_id: uuid.UUID) -> None:
    """Deleting removes its logs too; to keep history, deactivate instead."""
    habit = await get_habit(session, user_id, habit_id)
    await session.delete(habit)
    await session.commit()
