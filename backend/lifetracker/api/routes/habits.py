import uuid
from collections.abc import Sequence

from fastapi import APIRouter, status

from lifetracker.api.deps import Now, SessionDep, UserId
from lifetracker.db.models import Habit
from lifetracker.schemas.habits import HabitCreate, HabitOut, HabitUpdate
from lifetracker.services import habits

router = APIRouter(prefix="/habits", tags=["habits"])


@router.get("", response_model=list[HabitOut])
async def list_habits(
    session: SessionDep, user_id: UserId, active: bool | None = None
) -> Sequence[Habit]:
    return await habits.list_habits(session, user_id, active=active)


@router.post("", response_model=HabitOut, status_code=status.HTTP_201_CREATED)
async def create_habit(body: HabitCreate, session: SessionDep, user_id: UserId, now: Now) -> Habit:
    return await habits.create_habit(session, user_id, body, now)


@router.get("/{habit_id}", response_model=HabitOut)
async def get_habit(habit_id: uuid.UUID, session: SessionDep, user_id: UserId) -> Habit:
    return await habits.get_habit(session, user_id, habit_id)


@router.patch("/{habit_id}", response_model=HabitOut)
async def update_habit(
    habit_id: uuid.UUID, body: HabitUpdate, session: SessionDep, user_id: UserId, now: Now
) -> Habit:
    return await habits.update_habit(session, user_id, habit_id, body, now)


@router.delete("/{habit_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_habit(habit_id: uuid.UUID, session: SessionDep, user_id: UserId) -> None:
    await habits.delete_habit(session, user_id, habit_id)
