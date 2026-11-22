import uuid
from collections.abc import Sequence
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Query, status

from lifetracker.api.deps import Now, SessionDep, UserId
from lifetracker.db.models import Task
from lifetracker.schemas.tasks import MovedOut, TaskCreate, TaskOut, TaskUpdate, TaskView
from lifetracker.services import tasks

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.get("", response_model=list[TaskOut])
async def list_tasks(
    session: SessionDep,
    user_id: UserId,
    now: Now,
    view: TaskView | None = None,
    on: Annotated[date | None, Query(alias="date", description="Tasks of a specific day")] = None,
) -> Sequence[Task]:
    return await tasks.list_tasks(session, user_id, now, view=view, on=on)


@router.post("", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
async def create_task(body: TaskCreate, session: SessionDep, user_id: UserId) -> Task:
    return await tasks.create_task(session, user_id, body)


@router.post("/move-overdue", response_model=MovedOut)
async def move_overdue(session: SessionDep, user_id: UserId, now: Now) -> MovedOut:
    return MovedOut(moved=await tasks.move_overdue_to_today(session, user_id, now))


@router.get("/{task_id}", response_model=TaskOut)
async def get_task(task_id: uuid.UUID, session: SessionDep, user_id: UserId) -> Task:
    return await tasks.get_task(session, user_id, task_id)


@router.patch("/{task_id}", response_model=TaskOut)
async def update_task(
    task_id: uuid.UUID, body: TaskUpdate, session: SessionDep, user_id: UserId, now: Now
) -> Task:
    return await tasks.update_task(session, user_id, task_id, body, now)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(task_id: uuid.UUID, session: SessionDep, user_id: UserId) -> None:
    await tasks.delete_task(session, user_id, task_id)
