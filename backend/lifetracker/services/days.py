"""Days: sleep, habit values and the backfill flag."""

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from lifetracker.core.errors import DomainValidationError
from lifetracker.db.models import Day, Habit, HabitLog, User
from lifetracker.domain.enums import HabitType
from lifetracker.schemas.days import DayOut, FeelOut, SleepIn, SleepOut, night_minutes
from lifetracker.services.clock import user_now
from lifetracker.services.common import get_owned

MAX_RANGE_DAYS = 92


def _day_out(d: date, day: Day | None, logs: dict[uuid.UUID, Any]) -> DayOut:
    sleep = None
    if day is not None and day.sleep_bed and day.sleep_wake and day.sleep_quality:
        night = night_minutes(
            day.sleep_bed.hour * 60 + day.sleep_bed.minute,
            day.sleep_wake.hour * 60 + day.sleep_wake.minute,
        )
        sleep = SleepOut(
            bed=day.sleep_bed,
            wake=day.sleep_wake,
            quality=day.sleep_quality,
            duration_min=night[1] - night[0] if night else 0,
        )
    return DayOut(
        date=d,
        sleep=sleep,
        feel=[FeelOut.model_validate(f) for f in (day.feel if day else [])],
        backfill=day.backfill if day else False,
        habits=logs,
    )


async def get_days(
    session: AsyncSession, user_id: uuid.UUID, start: date, end: date
) -> list[DayOut]:
    """Days that have any data in [start, end]. Two queries regardless of the range size."""
    if end < start or (end - start).days >= MAX_RANGE_DAYS:
        raise DomainValidationError(f"Range must be 1..{MAX_RANGE_DAYS} days")
    days = {
        d.date: d
        for d in await session.scalars(
            select(Day).where(Day.user_id == user_id, Day.date.between(start, end))
        )
    }
    logs: dict[date, dict[uuid.UUID, Any]] = {}
    for log in await session.scalars(
        select(HabitLog).where(HabitLog.user_id == user_id, HabitLog.date.between(start, end))
    ):
        logs.setdefault(log.date, {})[log.habit_id] = log.value
    keys = sorted(set(days) | set(logs))
    return [_day_out(k, days.get(k), logs.get(k, {})) for k in keys]


async def get_day(session: AsyncSession, user_id: uuid.UUID, d: date) -> DayOut:
    found = await get_days(session, user_id, d, d)
    return found[0] if found else _day_out(d, None, {})


async def _touch_day(
    session: AsyncSession, user_id: uuid.UUID, d: date, now: datetime, **values: Any
) -> None:
    """Upsert the day row; writes to past days are flagged as backfill (never unflagged)."""
    today = (await user_now(session, user_id, now)).day
    if d > today:
        raise DomainValidationError("Cannot log a future day")
    backfill = d < today
    stmt = insert(Day).values(user_id=user_id, date=d, backfill=backfill, feel=[], **values)
    stmt = stmt.on_conflict_do_update(
        index_elements=[Day.user_id, Day.date],
        set_={
            "backfill": Day.backfill | stmt.excluded.backfill,
            "updated_at": func.now(),
            **{k: stmt.excluded[k] for k in values},
        },
    )
    await session.execute(stmt)
    # Data older than the account (e.g. a forgotten day) moves the start of history back.
    await session.execute(
        update(User).where(User.id == user_id, User.start_date > d).values(start_date=d)
    )


async def set_sleep(
    session: AsyncSession, user_id: uuid.UUID, d: date, data: SleepIn, now: datetime
) -> DayOut:
    """Sleep of the night that ended on the morning of ``d``."""
    await _touch_day(
        session,
        user_id,
        d,
        now,
        sleep_bed=data.bed,
        sleep_wake=data.wake,
        sleep_quality=data.quality,
    )
    await session.commit()
    return await get_day(session, user_id, d)


async def clear_sleep(session: AsyncSession, user_id: uuid.UUID, d: date, now: datetime) -> DayOut:
    await _touch_day(session, user_id, d, now, sleep_bed=None, sleep_wake=None, sleep_quality=None)
    await session.commit()
    return await get_day(session, user_id, d)


def validate_value(habit: Habit, value: Any) -> Any:
    """Each habit type accepts exactly one value shape."""
    match habit.type:
        case HabitType.BEDTIME:
            raise DomainValidationError("Bedtime is derived from sleep and cannot be logged")
        case HabitType.CHECK if isinstance(value, bool):
            return value
        case HabitType.WATER if _is_int(value) and 0 <= value <= 100:
            return value
        case HabitType.MINUTES if _is_int(value) and 0 <= value <= 1440:
            return value
        case HabitType.DUAL if (
            isinstance(value, dict)
            and set(value) == {"a", "b"}
            and all(isinstance(v, bool) for v in value.values())
        ):
            return value
    raise DomainValidationError(f"Invalid value for a {habit.type} habit")


def _is_int(v: Any) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


async def set_habit_value(
    session: AsyncSession,
    user_id: uuid.UUID,
    d: date,
    habit_id: uuid.UUID,
    value: Any,
    now: datetime,
) -> DayOut:
    habit = await get_owned(session, Habit, habit_id, user_id, what="Habit")
    clean = validate_value(habit, value)
    await _touch_day(session, user_id, d, now)
    stmt = insert(HabitLog).values(habit_id=habit_id, date=d, user_id=user_id, value=clean)
    await session.execute(
        stmt.on_conflict_do_update(
            index_elements=[HabitLog.habit_id, HabitLog.date],
            set_={"value": stmt.excluded.value, "updated_at": func.now()},
        )
    )
    await session.commit()
    return await get_day(session, user_id, d)


async def clear_habit_value(
    session: AsyncSession, user_id: uuid.UUID, d: date, habit_id: uuid.UUID, now: datetime
) -> DayOut:
    await get_owned(session, Habit, habit_id, user_id, what="Habit")
    await _touch_day(session, user_id, d, now)
    await session.execute(
        delete(HabitLog).where(
            HabitLog.user_id == user_id, HabitLog.habit_id == habit_id, HabitLog.date == d
        )
    )
    await session.commit()
    return await get_day(session, user_id, d)
