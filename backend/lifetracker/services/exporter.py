"""Export the whole account as JSON — in the same layout the importer reads.

So one file works as a backup, as a move to another account, and as a round trip:
importing your own export into the same account changes nothing (ids are reused).
The layout follows the old app's «Скопировать данные (JSON)» (settings / days / tasks /
goals), extended with this app's habit types, explicit norms and reviews.
"""

import uuid
from datetime import datetime, time
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from lifetracker.core.errors import NotFoundError
from lifetracker.db import models as m
from lifetracker.domain.enums import ScheduleKind

FORMAT = "life-tracker/1"


def _hm(t: time | None) -> str | None:
    return t.strftime("%H:%M") if t else None


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def _sched(h: m.Habit) -> dict[str, Any]:
    match h.sched_kind:
        case ScheduleKind.EVERY:
            return {"t": "every", "n": h.sched_n}
        case ScheduleKind.CYCLE:
            anchor = h.sched_anchor.isoformat() if h.sched_anchor else None
            return {"t": "cycle", "p": h.sched_pattern, "a": anchor}
    return {"t": "daily"}


async def export_account(
    session: AsyncSession, user_id: uuid.UUID, now: datetime
) -> dict[str, Any]:
    user = await session.get(m.User, user_id)
    st = await session.get(m.UserSettings, user_id)
    if user is None or st is None:
        raise NotFoundError("User not found")

    spheres = list(
        await session.scalars(
            select(m.Sphere).where(m.Sphere.user_id == user_id).order_by(m.Sphere.position)
        )
    )
    sphere_name = {s.id: s.name for s in spheres}
    habits = list(
        await session.scalars(
            select(m.Habit).where(m.Habit.user_id == user_id).order_by(m.Habit.position)
        )
    )
    days = await session.scalars(select(m.Day).where(m.Day.user_id == user_id).order_by(m.Day.date))
    logs = await session.scalars(select(m.HabitLog).where(m.HabitLog.user_id == user_id))
    tasks = await session.scalars(
        select(m.Task).where(m.Task.user_id == user_id).order_by(m.Task.created_at)
    )
    goals = await session.scalars(
        select(m.Goal)
        .where(m.Goal.user_id == user_id)
        .options(selectinload(m.Goal.subtasks), selectinload(m.Goal.habit_links))
        .order_by(m.Goal.position)
    )
    goal_list = list(goals)
    history: dict[uuid.UUID, list[dict[str, Any]]] = {g.id: [] for g in goal_list}
    if goal_list:
        rows = await session.scalars(
            select(m.GoalHistory)
            .where(m.GoalHistory.goal_id.in_(history))
            .order_by(m.GoalHistory.at.desc(), m.GoalHistory.id.desc())
        )
        for r in rows:
            history[r.goal_id].append({"at": _iso(r.at), "by": r.by.value, "what": r.what})
    reviews = await session.scalars(
        select(m.Review).where(m.Review.user_id == user_id).order_by(m.Review.at)
    )

    day_map: dict[str, dict[str, Any]] = {}
    for d in days:
        rec: dict[str, Any] = {"h": {}}
        if d.sleep_bed and d.sleep_wake:
            q = d.sleep_quality.value if d.sleep_quality else "ok"
            rec["sleep"] = {"bed": _hm(d.sleep_bed), "wake": _hm(d.sleep_wake), "q": q}
        if d.feel:
            rec["feel"] = d.feel
        if d.backfill:
            rec["backfill"] = True
        day_map[d.date.isoformat()] = rec
    for log in logs:
        day_map.setdefault(log.date.isoformat(), {"h": {}})["h"][str(log.habit_id)] = log.value

    return {
        "format": FORMAT,
        "exported_at": now.isoformat(),
        "settings": {
            "name": user.first_name,
            "timezone": user.timezone,
            "startDate": user.start_date.isoformat(),
            "targets": {"bed": _hm(st.bed_target), "sleepNeed": st.sleep_need_h},
            "usual": {"bed": _hm(st.usual_bed), "wake": _hm(st.usual_wake)},
            "model": {"bias": list(st.model_bias), "n": st.model_n},
            "spheres": [s.name for s in spheres],
            "habits": [
                {
                    "key": str(h.id),
                    "name": h.name,
                    "type": h.type.value,
                    "config": h.config,
                    "sphere": sphere_name.get(h.sphere_id) if h.sphere_id else None,
                    "sched": _sched(h),
                    "active": h.active,
                }
                for h in habits
            ],
        },
        "days": day_map,
        "tasks": {
            str(t.id): {
                "id": str(t.id),
                "title": t.title,
                "desc": t.description,
                "date": t.date.isoformat() if t.date else None,
                "start": _hm(t.start_time),
                "dur": t.duration_min,
                "energy": t.energy.value,
                "importance": t.importance.value,
                "sphere": sphere_name.get(t.sphere_id) if t.sphere_id else None,
                "done": t.done,
                "doneAt": _iso(t.done_at),
                "by": t.created_by.value,
            }
            for t in tasks
        },
        "goals": {
            str(g.id): {
                "id": str(g.id),
                "title": g.title,
                "criterion": g.criterion,
                "kind": g.kind.value,
                "stage": g.stage,
                "deadline": g.deadline.isoformat() if g.deadline else None,
                "habits": [str(link.habit_id) for link in g.habit_links],
                "target": g.target,
                "window": g.window_days,
                "value": g.manual_pct,
                "sphere": sphere_name.get(g.sphere_id) if g.sphere_id else None,
                "archived": g.archived,
                "subtasks": [
                    {
                        "id": str(s.id),
                        "title": s.title,
                        "done": s.done,
                        "deadline": s.deadline.isoformat() if s.deadline else None,
                    }
                    for s in sorted(g.subtasks, key=lambda s: s.position)
                ],
                "history": history[g.id],
            }
            for g in goal_list
        },
        "reviews": [
            {
                "id": str(r.id),
                "kind": r.kind.value,
                "date": r.date.isoformat(),
                "text": r.body,
                "by": r.by.value,
                "at": _iso(r.at),
            }
            for r in reviews
        ],
    }
