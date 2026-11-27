"""Export the whole account as JSON — in the same layout the importer reads.

So one file works as a backup, as a move to another account, and as a round trip:
importing your own export into the same account changes nothing (ids are reused).
The layout follows the old app's «Скопировать данные (JSON)» (settings / days / tasks),
extended with this app's habit types, explicit norms and reviews.
"""

import uuid
from datetime import datetime, time
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

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
        case ScheduleKind.WEEKDAYS:
            return {"t": "weekdays"}
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
    reviews = await session.scalars(
        select(m.Review).where(m.Review.user_id == user_id).order_by(m.Review.at)
    )
    notes = await session.scalars(
        select(m.Note).where(m.Note.user_id == user_id).order_by(m.Note.start)
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
            "habits": [
                {
                    "key": str(h.id),
                    "name": h.name,
                    "type": h.type.value,
                    "config": h.config,
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
                "important": t.important,
                "fresh": t.fresh,
                "done": t.done,
                "doneAt": _iso(t.done_at),
                "by": t.created_by.value,
            }
            for t in tasks
        },
        "reviews": [
            {
                "id": str(r.id),
                "kind": r.kind.value,
                "date": r.date.isoformat(),
                "text": r.body,
                "by": r.by.value,
                "at": _iso(r.at),
                "used_note": r.used_note,
                "changes": r.changes,
                "items": r.items,
            }
            for r in reviews
        ],
        "notes": [
            {"kind": n.kind.value, "start": n.start.isoformat(), "text": n.body} for n in notes
        ],
    }
