"""Goals, their steps and the change history ("who changed what": me or Claude)."""

import uuid
from collections.abc import Sequence
from datetime import date, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from lifetracker.core.errors import DomainValidationError, NotFoundError
from lifetracker.db.models import Goal, GoalHabit, GoalHistory, GoalSubtask, Habit
from lifetracker.domain.dates import fmt_date_short
from lifetracker.domain.enums import Actor, GoalKind
from lifetracker.schemas.goals import (
    GoalCreate,
    GoalDetailOut,
    GoalOut,
    GoalUpdate,
    HistoryOut,
    SubtaskIn,
    SubtaskUpdate,
)
from lifetracker.services.common import apply_patch, next_position, resolve_client_id
from lifetracker.services.spheres import ensure_sphere

HISTORY_LIMIT = 30

# Labels for the history log, as in `goalDiff` of the reference app.
FIELD_LABELS = {
    "title": "название",
    "criterion": "критерий",
    "deadline": "дедлайн",
    "stage": "этап",
    "kind": "тип",
    "target": "цель, дней",
    "window_days": "окно, дней",
    "manual_pct": "прогресс, %",
}


def _fmt(key: str, value: Any) -> str:
    if value is None or value == "":
        return "—"
    if key == "deadline" and isinstance(value, date):
        return fmt_date_short(value)
    return str(value)


def _with_children() -> Any:
    return (selectinload(Goal.subtasks), selectinload(Goal.habit_links))


async def _load(session: AsyncSession, user_id: uuid.UUID, goal_id: uuid.UUID) -> Goal:
    goal = await session.scalar(
        select(Goal)
        .where(Goal.id == goal_id, Goal.user_id == user_id)
        .options(*_with_children())
        .execution_options(populate_existing=True)
    )
    if goal is None:
        raise NotFoundError("Goal not found")
    return goal


async def _ensure_habits(
    session: AsyncSession, user_id: uuid.UUID, habit_ids: Sequence[uuid.UUID]
) -> None:
    if not habit_ids:
        return
    owned = set(
        await session.scalars(
            select(Habit.id).where(Habit.user_id == user_id, Habit.id.in_(habit_ids))
        )
    )
    if owned != set(habit_ids):
        raise NotFoundError("Habit not found")


def _log(session: AsyncSession, goal_id: uuid.UUID, by: Actor, what: str) -> None:
    session.add(GoalHistory(goal_id=goal_id, by=by, what=what))


async def list_goals(
    session: AsyncSession, user_id: uuid.UUID, *, archived: bool | None = None
) -> Sequence[Goal]:
    """One query for goals + one per child collection (no N+1)."""
    stmt = select(Goal).where(Goal.user_id == user_id).options(*_with_children())
    if archived is not None:
        stmt = stmt.where(Goal.archived == archived)
    return (await session.scalars(stmt.order_by(Goal.position, Goal.created_at))).all()


async def get_goal(session: AsyncSession, user_id: uuid.UUID, goal_id: uuid.UUID) -> GoalDetailOut:
    goal = await _load(session, user_id, goal_id)
    history = await session.scalars(
        select(GoalHistory)
        .where(GoalHistory.goal_id == goal.id)
        .order_by(GoalHistory.at.desc(), GoalHistory.id.desc())
        .limit(HISTORY_LIMIT)
    )
    return GoalDetailOut(
        **GoalOut.model_validate(goal).model_dump(),
        history=[HistoryOut.model_validate(h) for h in history],
    )


async def create_goal(
    session: AsyncSession, user_id: uuid.UUID, data: GoalCreate, *, by: Actor = Actor.ME
) -> GoalDetailOut:
    existing = await resolve_client_id(session, Goal, data.id, user_id)
    if existing is not None:
        return await get_goal(session, user_id, existing.id)
    await ensure_sphere(session, user_id, data.sphere_id)
    await _ensure_habits(session, user_id, data.habit_ids)
    goal = Goal(
        user_id=user_id,
        **data.model_dump(exclude={"id", "habit_ids", "subtasks"}),
        archived=False,
        position=await next_position(session, Goal, user_id),
    )
    if data.id is not None:
        goal.id = data.id
    goal.habit_links = [
        GoalHabit(habit_id=h, user_id=user_id) for h in dict.fromkeys(data.habit_ids)
    ]
    goal.subtasks = [
        GoalSubtask(title=s.title, deadline=s.deadline, done=False, position=i, **_id(s))
        for i, s in enumerate(data.subtasks)
    ]
    session.add(goal)
    await session.flush()
    _log(session, goal.id, by, "Цель создана")
    await session.commit()
    return await get_goal(session, user_id, goal.id)


def _id(s: SubtaskIn) -> dict[str, uuid.UUID]:
    return {"id": s.id} if s.id is not None else {}


async def update_goal(
    session: AsyncSession,
    user_id: uuid.UUID,
    goal_id: uuid.UUID,
    data: GoalUpdate,
    *,
    by: Actor = Actor.ME,
) -> GoalDetailOut:
    goal = await _load(session, user_id, goal_id)
    fields = data.model_dump(exclude_unset=True, exclude={"habit_ids"})
    if "sphere_id" in fields:
        await ensure_sphere(session, user_id, fields["sphere_id"])

    before = {k: getattr(goal, k) for k in FIELD_LABELS}
    changed = apply_patch(
        goal,
        fields,
        nullable={"deadline", "target", "window_days", "manual_pct", "sphere_id"},
    )
    notes = [
        f"{label}: {_fmt(k, before[k])} → {_fmt(k, getattr(goal, k))}"
        for k, label in FIELD_LABELS.items()
        if k in changed
    ]
    if "sphere_id" in changed:
        notes.append("сфера")

    if data.habit_ids is not None:
        new_ids = list(dict.fromkeys(data.habit_ids))
        if set(new_ids) != set(goal.habit_ids):
            await _ensure_habits(session, user_id, new_ids)
            # Diff instead of replacing the list: re-inserting a kept (goal, habit) pair
            # before its old row is deleted would violate the primary key.
            keep = set(new_ids)
            for link in [x for x in goal.habit_links if x.habit_id not in keep]:
                goal.habit_links.remove(link)
            present = set(goal.habit_ids)
            goal.habit_links.extend(
                GoalHabit(habit_id=h, user_id=user_id) for h in new_ids if h not in present
            )
            notes.append("привычки")

    if goal.kind in (GoalKind.STREAK, GoalKind.COUNT) and not goal.habit_links:
        raise DomainValidationError("streak and count goals need at least one habit")
    if goal.kind == GoalKind.STREAK and goal.target is None:
        goal.target = 10
    if goal.kind == GoalKind.COUNT:
        goal.window_days = goal.window_days or 7
        goal.target = goal.target or goal.window_days

    if "archived" in changed:
        _log(
            session, goal.id, by, "Перенесена в архив" if goal.archived else "Возвращена из архива"
        )
    if notes:
        _log(session, goal.id, by, "Изменено: " + "; ".join(notes))
    await session.commit()
    return await get_goal(session, user_id, goal.id)


async def delete_goal(session: AsyncSession, user_id: uuid.UUID, goal_id: uuid.UUID) -> None:
    goal = await _load(session, user_id, goal_id)
    await session.delete(goal)
    await session.commit()


async def add_subtask(
    session: AsyncSession,
    user_id: uuid.UUID,
    goal_id: uuid.UUID,
    data: SubtaskIn,
    *,
    by: Actor = Actor.ME,
) -> GoalDetailOut:
    goal = await _load(session, user_id, goal_id)
    if data.id is not None and any(s.id == data.id for s in goal.subtasks):
        return await get_goal(session, user_id, goal.id)  # idempotent retry
    position = await session.scalar(
        select(func.coalesce(func.max(GoalSubtask.position) + 1, 0)).where(
            GoalSubtask.goal_id == goal.id
        )
    )
    goal.subtasks.append(
        GoalSubtask(
            title=data.title,
            deadline=data.deadline,
            done=False,
            position=position or 0,
            **_id(data),
        )
    )
    _log(session, goal.id, by, f"Добавлен шаг «{data.title}»")
    await session.commit()
    return await get_goal(session, user_id, goal.id)


def _find_subtask(goal: Goal, subtask_id: uuid.UUID) -> GoalSubtask:
    for s in goal.subtasks:
        if s.id == subtask_id:
            return s
    raise NotFoundError("Step not found")


async def update_subtask(
    session: AsyncSession,
    user_id: uuid.UUID,
    goal_id: uuid.UUID,
    subtask_id: uuid.UUID,
    data: SubtaskUpdate,
    now: datetime,
    *,
    by: Actor = Actor.ME,
) -> GoalDetailOut:
    goal = await _load(session, user_id, goal_id)
    sub = _find_subtask(goal, subtask_id)
    old_title = sub.title
    changed = apply_patch(sub, data.model_dump(exclude_unset=True), nullable={"deadline"})
    if "done" in changed:
        sub.done_at = now if sub.done else None
        _log(
            session,
            goal.id,
            by,
            f"{'Выполнен шаг' if sub.done else 'Снята отметка'} «{sub.title}»",
        )
    if "title" in changed:
        _log(session, goal.id, by, f"Шаг «{old_title}» → «{sub.title}»")
    if "deadline" in changed:
        _log(session, goal.id, by, f"Срок шага «{sub.title}»: {_fmt('deadline', sub.deadline)}")
    await session.commit()
    return await get_goal(session, user_id, goal.id)


async def delete_subtask(
    session: AsyncSession,
    user_id: uuid.UUID,
    goal_id: uuid.UUID,
    subtask_id: uuid.UUID,
    *,
    by: Actor = Actor.ME,
) -> GoalDetailOut:
    goal = await _load(session, user_id, goal_id)
    sub = _find_subtask(goal, subtask_id)
    goal.subtasks.remove(sub)
    _log(session, goal.id, by, f"Удалён шаг «{sub.title}»")
    await session.commit()
    return await get_goal(session, user_id, goal.id)
