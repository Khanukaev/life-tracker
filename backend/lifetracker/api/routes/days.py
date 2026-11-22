import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Query

from lifetracker.api.deps import Now, SessionDep, UserId
from lifetracker.schemas.days import DayOut, HabitValueIn, SleepIn
from lifetracker.services import days

router = APIRouter(prefix="/days", tags=["days"])


@router.get("", response_model=list[DayOut])
async def list_days(
    session: SessionDep,
    user_id: UserId,
    start: Annotated[date, Query(alias="from")],
    end: Annotated[date, Query(alias="to")],
) -> list[DayOut]:
    """Days with any data in the range (inclusive, at most 92 days)."""
    return await days.get_days(session, user_id, start, end)


@router.get("/{day}", response_model=DayOut)
async def get_day(day: date, session: SessionDep, user_id: UserId) -> DayOut:
    return await days.get_day(session, user_id, day)


@router.put("/{day}/sleep", response_model=DayOut)
async def set_sleep(
    day: date, body: SleepIn, session: SessionDep, user_id: UserId, now: Now
) -> DayOut:
    return await days.set_sleep(session, user_id, day, body, now)


@router.delete("/{day}/sleep", response_model=DayOut)
async def clear_sleep(day: date, session: SessionDep, user_id: UserId, now: Now) -> DayOut:
    return await days.clear_sleep(session, user_id, day, now)


@router.put("/{day}/habits/{habit_id}", response_model=DayOut)
async def set_habit_value(
    day: date,
    habit_id: uuid.UUID,
    body: HabitValueIn,
    session: SessionDep,
    user_id: UserId,
    now: Now,
) -> DayOut:
    return await days.set_habit_value(session, user_id, day, habit_id, body.value, now)


@router.delete("/{day}/habits/{habit_id}", response_model=DayOut)
async def clear_habit_value(
    day: date, habit_id: uuid.UUID, session: SessionDep, user_id: UserId, now: Now
) -> DayOut:
    return await days.clear_habit_value(session, user_id, day, habit_id, now)
