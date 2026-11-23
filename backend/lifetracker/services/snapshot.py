"""Load everything the domain formulas need for one user in a fixed number of queries.

A snapshot is the bridge between the database and the pure domain functions:
ORM rows -> domain dataclasses (`Ctx`, `Task`, `Goal`). Seven queries no matter how
many habits, days or goals the user has — no N+1.
"""

import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from lifetracker.core.errors import NotFoundError
from lifetracker.db import models as m
from lifetracker.domain.dates import logical_now, time_to_task_min
from lifetracker.domain.energy import EnergyDay, energy_day
from lifetracker.domain.habits import STREAK_LOOKBACK
from lifetracker.domain.model import (
    Ctx,
    DayRec,
    FeelRec,
    Goal,
    Habit,
    Settings,
    SleepRec,
    Subtask,
    Task,
)


def _min(t: time) -> int:
    return t.hour * 60 + t.minute


@dataclass
class Snapshot:
    user: m.User
    settings_row: m.UserSettings
    ctx: Ctx
    habit_rows: list[m.Habit]
    task_rows: dict[uuid.UUID, m.Task]
    tasks: list[Task]
    goals: list[Goal]
    goal_rows: list[m.Goal]
    spheres: list[m.Sphere]
    _energy: dict[date, EnergyDay] = field(default_factory=dict)

    def energy(self, k: date) -> EnergyDay:
        """Memoised energy model for a day (several views need the same day)."""
        if k not in self._energy:
            self._energy[k] = energy_day(k, self.ctx)
        return self._energy[k]


def to_domain_habit(h: m.Habit) -> Habit:
    return Habit(
        id=h.id, type=h.type, name=h.name, sphere=h.sphere_id, active=h.active,
        config=h.config, sched=h.sched_kind, sched_n=h.sched_n, sched_pattern=h.sched_pattern,
        sched_anchor=h.sched_anchor,
    )  # fmt: skip


def to_domain_task(t: m.Task) -> Task:
    return Task(
        id=t.id, title=t.title, date=t.date,
        start=time_to_task_min(_min(t.start_time)) if t.start_time else None,
        dur=t.duration_min, energy=t.energy, importance=t.importance, done=t.done,
        sphere=t.sphere_id,
    )  # fmt: skip


def to_domain_goal(g: m.Goal) -> Goal:
    return Goal(
        id=g.id, title=g.title, kind=g.kind, habits=list(g.habit_ids), target=g.target,
        window=g.window_days, manual_pct=g.manual_pct, deadline=g.deadline, archived=g.archived,
        subtasks=[Subtask(s.title, s.done, s.deadline) for s in g.subtasks],
    )  # fmt: skip


async def load_snapshot(
    session: AsyncSession,
    user_id: uuid.UUID,
    now: datetime,
    *,
    until: date | None = None,
    tasks_from: date | None = None,
    with_spheres: bool = False,
) -> Snapshot:
    """Data from the start of history (capped at ~400 days) up to `until` + 1 day."""
    row = (
        await session.execute(
            select(m.User, m.UserSettings)
            .join(m.UserSettings, m.UserSettings.user_id == m.User.id)
            .where(m.User.id == user_id)
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError("User not found")
    user, st = row
    ln = logical_now(now, user.timezone)
    today = ln.day
    last = max(until or today, today) + timedelta(days=1)
    first = max(user.start_date, today - timedelta(days=STREAK_LOOKBACK + 7))

    habit_rows = list(
        await session.scalars(
            select(m.Habit)
            .where(m.Habit.user_id == user_id)
            .order_by(m.Habit.position, m.Habit.created_at)
        )
    )
    # Plain column tuples instead of ORM entities: thousands of rows, no identity map cost.
    days: dict[date, DayRec] = {}
    day_rows = await session.execute(
        select(m.Day.date, m.Day.sleep_bed, m.Day.sleep_wake, m.Day.sleep_quality, m.Day.feel,
               m.Day.backfill)
        .where(m.Day.user_id == user_id, m.Day.date.between(first, last))
    )  # fmt: skip
    for k, bed, wake, quality, feel, backfill in day_rows:
        sleep = SleepRec(_min(bed), _min(wake), quality or "ok") if bed and wake else None
        days[k] = DayRec(sleep=sleep, feel=[FeelRec(**f) for f in feel], backfill=backfill)
    log_rows = await session.execute(
        select(m.HabitLog.date, m.HabitLog.habit_id, m.HabitLog.value).where(
            m.HabitLog.user_id == user_id, m.HabitLog.date.between(first, last)
        )
    )
    for k, habit_id, value in log_rows:
        rec = days.get(k)
        if rec is None:
            rec = days[k] = DayRec()
        rec.values[habit_id] = value

    t_from = tasks_from or (today - timedelta(days=31))
    task_rows = {
        t.id: t
        for t in await session.scalars(
            select(m.Task).where(
                m.Task.user_id == user_id,
                or_(
                    m.Task.date.between(min(t_from, today), last),
                    (m.Task.date < today) & ~m.Task.done,  # overdue, for alerts
                ),
            )
        )
    }
    goal_rows = list(
        await session.scalars(
            select(m.Goal)
            .where(m.Goal.user_id == user_id)
            .options(selectinload(m.Goal.subtasks), selectinload(m.Goal.habit_links))
            .order_by(m.Goal.position, m.Goal.created_at)
        )
    )
    spheres = (
        list(
            await session.scalars(
                select(m.Sphere).where(m.Sphere.user_id == user_id).order_by(m.Sphere.position)
            )
        )
        if with_spheres
        else []
    )
    ctx = Ctx(
        today=today,
        start_date=user.start_date,
        settings=Settings(
            bed_target=_min(st.bed_target), sleep_need_h=st.sleep_need_h,
            usual_bed=_min(st.usual_bed), usual_wake=_min(st.usual_wake),
            bias=list(st.model_bias), model_n=st.model_n,
        ),
        habits=[to_domain_habit(h) for h in habit_rows],
        days=days,
        now_min=ln.minute,
    )  # fmt: skip
    return Snapshot(
        user=user, settings_row=st, ctx=ctx, habit_rows=habit_rows, task_rows=task_rows,
        tasks=[to_domain_task(t) for t in task_rows.values()],
        goals=[to_domain_goal(g) for g in goal_rows], goal_rows=goal_rows, spheres=spheres,
    )  # fmt: skip
