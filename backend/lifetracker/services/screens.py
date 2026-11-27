"""Aggregates for the Profile and Tasks screens."""

import uuid
from datetime import date, datetime, timedelta
from typing import cast

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from lifetracker.db import models as m
from lifetracker.domain.enums import EnergyZone, ScheduleKind
from lifetracker.domain.habits import streak_of
from lifetracker.domain.slots import energy_left, is_overdue, suggest_with_fallback
from lifetracker.schemas.tasks import TaskOut, TaskView
from lifetracker.schemas.views import (
    ListTask,
    ProfileHabit,
    ProfileView,
    SlotOut,
    TaskCounts,
    TasksView,
    ZoneLoadOut,
)
from lifetracker.services import tasks as task_service
from lifetracker.services.snapshot import load_snapshot, to_domain_task

UPCOMING_DAYS = 14


async def task_counts(session: AsyncSession, user_id: uuid.UUID, today: date) -> TaskCounts:
    """All tab counters in a single query (COUNT … FILTER)."""
    t = m.Task
    open_ = ~t.done
    row = (
        await session.execute(
            select(
                func.count().filter(t.date.is_(None) & open_),
                func.count().filter((t.date == today) & open_),
                func.count().filter((t.date < today) & open_),
                func.count().filter((t.date < today) & open_ & t.important),
                func.count().filter(
                    (t.date > today) & (t.date <= today + timedelta(days=UPCOMING_DAYS)) & open_
                ),
                func.count().filter(t.done),
            ).where(t.user_id == user_id)
        )
    ).one()
    return TaskCounts(
        inbox=row[0], today=row[1], overdue=row[2], overdue_important=row[3], upcoming=row[4],
        done=min(row[5], task_service.DONE_LIMIT),
    )  # fmt: skip


def _schedule_label(h: m.Habit) -> str:
    if h.sched_kind == ScheduleKind.WEEKDAYS:
        return "По будням"
    if h.sched_kind == ScheduleKind.CYCLE:
        return f"По графику {h.sched_pattern}"
    return "Каждый день"


async def profile_view(session: AsyncSession, user_id: uuid.UUID, now: datetime) -> ProfileView:
    snap = await load_snapshot(session, user_id, now)
    ctx = snap.ctx
    habits = sorted(snap.habit_rows, key=lambda h: (not h.active, h.position))
    return ProfileView(
        tasks=await task_counts(session, user_id, ctx.today),
        habits=[
            ProfileHabit(
                id=h.id, name=h.name, type=h.type, active=h.active,
                schedule_label=_schedule_label(h),
                streak=streak_of([h.id], ctx) if h.active else 0,
            )
            for h in habits
        ],
    )  # fmt: skip


async def tasks_view(
    session: AsyncSession, user_id: uuid.UUID, now: datetime, view: str
) -> TasksView:
    # Tasks up to the "2 weeks" horizon so slot suggestions see the busy intervals.
    snap = await load_snapshot(
        session, user_id, now, until=now.date() + timedelta(days=UPCOMING_DAYS + 1)
    )
    ctx = snap.ctx
    horizon = ctx.today + timedelta(days=UPCOMING_DAYS)
    if view == "energy":
        rows = [
            t for t in snap.task_rows.values()
            if not t.done and t.date is not None and t.date <= ctx.today
        ]  # fmt: skip
    else:
        rows = list(await task_service.list_tasks(session, user_id, now, view=TaskView(view)))

    items: list[ListTask] = []
    for row in rows:
        t = to_domain_task(row)
        zone = None
        if t.date is not None and t.start is not None and ctx.today <= t.date <= horizon:
            zone = snap.energy(t.date).zone_at(t.start)
        low = t.energy == EnergyZone.FOCUS and zone in ("recharge", "sleep") and not t.done
        slot = None
        if low and t.date is not None:
            s = suggest_with_fallback(t.date, t.dur, t.energy, ctx, snap.tasks, snap.energy, t.id)
            best = s.alternative or s.best
            if best:
                slot = SlotOut(
                    date=best.day, start=best.start, end=best.end, fit=round(best.fit, 3),
                    avg=best.avg, zone=best.zone,
                )  # fmt: skip
        items.append(
            ListTask(
                **TaskOut.model_validate(row).model_dump(),
                overdue=is_overdue(t, ctx),
                low_energy=low,
                slot=slot,
            )
        )
    if view == "energy":
        items.sort(key=lambda x: (not x.important, x.date or ctx.today))
    loads = []
    if view == "energy":
        loads = [
            ZoneLoadOut(zone=z.zone, need_min=z.need_min, free_min=z.free_min,
                        task_ids=[cast(uuid.UUID, i) for i in z.task_ids])
            for z in energy_left(ctx, snap.tasks, snap.energy(ctx.today))
        ]  # fmt: skip
    important_today = sum(
        1 for t in snap.tasks if t.date == ctx.today and t.important and not t.done
    )
    return TasksView(
        view=view, counts=await task_counts(session, user_id, ctx.today), items=items,
        loads=loads, important_today=important_today,
    )  # fmt: skip
