"""Aggregates for the Profile, Tasks and Goals screens."""

import uuid
from datetime import date, datetime, timedelta
from typing import cast

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from lifetracker.db import models as m
from lifetracker.domain.dates import add_days
from lifetracker.domain.enums import EnergyZone, GoalKind, Importance, ScheduleKind
from lifetracker.domain.goals import goal_overdue, goal_progress
from lifetracker.domain.habits import day_ok, streak_of
from lifetracker.domain.score import day_score
from lifetracker.domain.slots import energy_left, is_overdue, suggest_with_fallback
from lifetracker.schemas.tasks import TaskOut, TaskView
from lifetracker.schemas.views import (
    DayCell,
    GoalCard,
    GoalProgressOut,
    GoalsView,
    HistoryItem,
    ListTask,
    ProfileHabit,
    ProfileSphere,
    ProfileView,
    SlotOut,
    TaskCounts,
    TasksView,
    ZoneLoadOut,
)
from lifetracker.services import tasks as task_service
from lifetracker.services.snapshot import Snapshot, load_snapshot, to_domain_task

UPCOMING_DAYS = 14
BASE_HOLD_DAYS, BASE_HOLD_PCT = 14, 70
MAX_CELLS = 31


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
                func.count().filter(
                    (t.date < today) & open_ & (t.importance == Importance.CRITICAL)
                ),
                func.count().filter(
                    (t.date > today) & (t.date <= today + timedelta(days=UPCOMING_DAYS)) & open_
                ),
                func.count().filter(t.done),
            ).where(t.user_id == user_id)
        )
    ).one()
    return TaskCounts(
        inbox=row[0], today=row[1], overdue=row[2], overdue_critical=row[3], upcoming=row[4],
        done=min(row[5], task_service.DONE_LIMIT),
    )  # fmt: skip


def _goal_card(snap: Snapshot, g: m.Goal, spheres: dict[uuid.UUID, str]) -> GoalCard:
    ctx = snap.ctx
    dg = next(x for x in snap.goals if x.id == g.id)
    p = goal_progress(dg, ctx)
    cells: list[DayCell] = []
    if g.kind == GoalKind.COUNT:
        w = min(g.window_days or 7, MAX_CELLS)
        cells = [
            DayCell(
                date=add_days(ctx.today, -i), ok=day_ok(dg.habits, add_days(ctx.today, -i), ctx)
            )
            for i in range(w - 1, -1, -1)
        ]
    steps = [
        {
            "id": str(s.id), "title": s.title, "done": s.done,
            "deadline": s.deadline.isoformat() if s.deadline else None,
            "overdue": bool(not s.done and s.deadline and s.deadline < ctx.today),
        }
        for s in g.subtasks
    ]  # fmt: skip
    return GoalCard(
        id=g.id, title=g.title, criterion=g.criterion, kind=g.kind, stage=g.stage,
        deadline=g.deadline, sphere_id=g.sphere_id,
        sphere_name=spheres.get(g.sphere_id) if g.sphere_id else None, archived=g.archived,
        progress=GoalProgressOut(pct=p.pct, label=p.label, cur=p.cur, t=p.t),
        overdue=goal_overdue(dg, ctx), overdue_steps=sum(1 for s in steps if s["overdue"]),
        steps=steps, cells=cells,
    )  # fmt: skip


async def goals_view(session: AsyncSession, user_id: uuid.UUID, now: datetime) -> GoalsView:
    snap = await load_snapshot(session, user_id, now, with_spheres=True)
    spheres = {s.id: s.name for s in snap.spheres}
    cards = [_goal_card(snap, g, spheres) for g in snap.goal_rows]
    hist_rows = await session.execute(
        select(m.GoalHistory, m.Goal.title)
        .join(m.Goal, m.Goal.id == m.GoalHistory.goal_id)
        .where(m.Goal.user_id == user_id)
        .order_by(m.GoalHistory.at.desc(), m.GoalHistory.id.desc())
        .limit(5)
    )
    ctx = snap.ctx
    recent = [
        day_score(add_days(ctx.today, -i), ctx, snap.tasks) for i in range(1, BASE_HOLD_DAYS + 1)
    ]
    holds = all(s is not None and s.pct > BASE_HOLD_PCT for s in recent)
    return GoalsView(
        base=[c for c in cards if not c.archived and c.stage == 1],
        next=[c for c in cards if not c.archived and c.stage == 2],
        archived=[c for c in cards if c.archived],
        history=[
            HistoryItem(
                goal_id=h.goal_id, goal_title=title, by=h.by, what=h.what, at=h.at.isoformat()
            )
            for h, title in hist_rows
        ],
        base_holds=holds,
    )


def _schedule_label(h: m.Habit) -> str:
    if h.sched_kind == ScheduleKind.EVERY:
        return "Через день" if h.sched_n == 2 else f"Раз в {h.sched_n} дн."
    if h.sched_kind == ScheduleKind.CYCLE:
        return f"По графику {h.sched_pattern}"
    return "Каждый день"


async def profile_view(session: AsyncSession, user_id: uuid.UUID, now: datetime) -> ProfileView:
    snap = await load_snapshot(session, user_id, now, with_spheres=True)
    ctx = snap.ctx
    spheres = {s.id: s.name for s in snap.spheres}
    active_goals = [g for g in snap.goal_rows if not g.archived]
    open_by_sphere = dict(
        (
            await session.execute(
                select(m.Task.sphere_id, func.count())
                .where(m.Task.user_id == user_id, ~m.Task.done, m.Task.sphere_id.is_not(None))
                .group_by(m.Task.sphere_id)
            )
        ).all()
    )
    habits = sorted(snap.habit_rows, key=lambda h: (not h.active, h.position))
    return ProfileView(
        goals=[_goal_card(snap, g, spheres) for g in active_goals[:3]],
        goals_total=len(active_goals),
        tasks=await task_counts(session, user_id, ctx.today),
        habits=[
            ProfileHabit(
                id=h.id, name=h.name, type=h.type, active=h.active,
                sphere_name=spheres.get(h.sphere_id) if h.sphere_id else None,
                schedule_label=_schedule_label(h),
                streak=streak_of([h.id], ctx) if h.active else 0,
            )
            for h in habits
        ],
        spheres=[
            ProfileSphere(
                id=s.id, name=s.name,
                count=sum(1 for h in snap.habit_rows if h.sphere_id == s.id and h.active)
                + int(open_by_sphere.get(s.id, 0)),
            )
            for s in snap.spheres
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
        rank = {Importance.CRITICAL: 0, Importance.IMPORTANT: 1, Importance.NORMAL: 2}
        items.sort(key=lambda x: (rank[x.importance], x.date or ctx.today))
    loads = []
    if view == "energy":
        loads = [
            ZoneLoadOut(zone=z.zone, need_min=z.need_min, free_min=z.free_min,
                        task_ids=[cast(uuid.UUID, i) for i in z.task_ids])
            for z in energy_left(ctx, snap.tasks, snap.energy(ctx.today))
        ]  # fmt: skip
    critical_today = sum(
        1 for t in snap.tasks
        if t.date == ctx.today and t.importance == Importance.CRITICAL and not t.done
    )  # fmt: skip
    return TasksView(
        view=view, counts=await task_counts(session, user_id, ctx.today), items=items,
        loads=loads, critical_today=critical_today,
    )  # fmt: skip
