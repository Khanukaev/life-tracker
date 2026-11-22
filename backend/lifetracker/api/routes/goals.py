import uuid
from collections.abc import Sequence

from fastapi import APIRouter, status

from lifetracker.api.deps import Now, SessionDep, UserId
from lifetracker.db.models import Goal
from lifetracker.schemas.goals import (
    GoalCreate,
    GoalDetailOut,
    GoalOut,
    GoalUpdate,
    SubtaskIn,
    SubtaskUpdate,
)
from lifetracker.services import goals

router = APIRouter(prefix="/goals", tags=["goals"])


@router.get("", response_model=list[GoalOut])
async def list_goals(
    session: SessionDep, user_id: UserId, archived: bool | None = None
) -> Sequence[Goal]:
    return await goals.list_goals(session, user_id, archived=archived)


@router.post("", response_model=GoalDetailOut, status_code=status.HTTP_201_CREATED)
async def create_goal(body: GoalCreate, session: SessionDep, user_id: UserId) -> GoalDetailOut:
    return await goals.create_goal(session, user_id, body)


@router.get("/{goal_id}", response_model=GoalDetailOut)
async def get_goal(goal_id: uuid.UUID, session: SessionDep, user_id: UserId) -> GoalDetailOut:
    return await goals.get_goal(session, user_id, goal_id)


@router.patch("/{goal_id}", response_model=GoalDetailOut)
async def update_goal(
    goal_id: uuid.UUID, body: GoalUpdate, session: SessionDep, user_id: UserId
) -> GoalDetailOut:
    return await goals.update_goal(session, user_id, goal_id, body)


@router.delete("/{goal_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_goal(goal_id: uuid.UUID, session: SessionDep, user_id: UserId) -> None:
    await goals.delete_goal(session, user_id, goal_id)


@router.post(
    "/{goal_id}/subtasks", response_model=GoalDetailOut, status_code=status.HTTP_201_CREATED
)
async def add_subtask(
    goal_id: uuid.UUID, body: SubtaskIn, session: SessionDep, user_id: UserId
) -> GoalDetailOut:
    return await goals.add_subtask(session, user_id, goal_id, body)


@router.patch("/{goal_id}/subtasks/{subtask_id}", response_model=GoalDetailOut)
async def update_subtask(
    goal_id: uuid.UUID,
    subtask_id: uuid.UUID,
    body: SubtaskUpdate,
    session: SessionDep,
    user_id: UserId,
    now: Now,
) -> GoalDetailOut:
    return await goals.update_subtask(session, user_id, goal_id, subtask_id, body, now)


@router.delete("/{goal_id}/subtasks/{subtask_id}", response_model=GoalDetailOut)
async def delete_subtask(
    goal_id: uuid.UUID, subtask_id: uuid.UUID, session: SessionDep, user_id: UserId
) -> GoalDetailOut:
    return await goals.delete_subtask(session, user_id, goal_id, subtask_id)
