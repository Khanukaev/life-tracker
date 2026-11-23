"""Import the old app's JSON export («Скопировать данные (JSON)») into a user's account.

Rules:
- **Merge, not replace.** Existing data stays. A habit that already exists with the same
  name and type (e.g. created during onboarding) is reused, not duplicated; there is only
  ever one bedtime habit.
- **Idempotent.** New ids are derived from the old ones: ``uuid5(user_id, "task:t17")``.
  Importing the same file twice changes nothing the second time; importing a newer
  export adds what is new and updates what changed.
- **All or nothing.** One transaction; a dry run does the same work and rolls back, so
  the preview shows exactly what a real import would do.
- The legacy → domain mapping (habit types, norms, values) is the same adapter the
  golden tests verify against the original JavaScript: ``domain/legacy.py``.
"""

import uuid
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime, time
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from lifetracker.core.errors import DomainValidationError
from lifetracker.db import models as m
from lifetracker.domain.enums import Actor, HabitType, SleepQuality
from lifetracker.domain.legacy import convert
from lifetracker.services.clock import user_now

MAX_DAYS = 3660
MAX_TASKS = 20_000
MAX_GOALS = 500


@dataclass
class ImportReport:
    dry_run: bool
    days: int = 0
    sleep_nights: int = 0
    habit_marks: int = 0
    habits_created: list[str] = field(default_factory=list)
    habits_reused: list[str] = field(default_factory=list)
    spheres_created: list[str] = field(default_factory=list)
    tasks_created: int = 0
    tasks_updated: int = 0
    goals_created: int = 0
    goals_updated: int = 0
    period: tuple[str, str] | None = None
    warnings: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def _hhmm(minutes: int | None) -> time | None:
    if minutes is None:
        return None
    mm = minutes % 1440
    return time(mm // 60, mm % 60)


def _ts(s: Any) -> datetime | None:
    if not isinstance(s, str) or not s:
        return None
    try:
        t = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=UTC)


def _check_shape(export: Any) -> dict[str, Any]:
    if not isinstance(export, dict) or not any(
        k in export for k in ("settings", "days", "tasks", "goals")
    ):
        raise DomainValidationError(
            "Это не экспорт трекера: ожидается JSON с полями settings, days, tasks, goals"
        )
    for key, kind in (("settings", dict), ("days", dict), ("tasks", dict), ("goals", dict)):
        if key in export and export[key] is not None and not isinstance(export[key], kind):
            raise DomainValidationError(f"Поле {key} должно быть объектом")
    if len(export.get("days") or {}) > MAX_DAYS:
        raise DomainValidationError(f"Слишком много дней (больше {MAX_DAYS})")
    if len(export.get("tasks") or {}) > MAX_TASKS:
        raise DomainValidationError(f"Слишком много задач (больше {MAX_TASKS})")
    if len(export.get("goals") or {}) > MAX_GOALS:
        raise DomainValidationError(f"Слишком много целей (больше {MAX_GOALS})")
    return export


async def import_export(
    session: AsyncSession,
    user_id: uuid.UUID,
    export: Any,
    now: datetime,
    *,
    dry_run: bool = False,
) -> ImportReport:
    export = _check_shape(export)
    ln = await user_now(session, user_id, now)
    try:
        data = convert(export, today=ln.day, now_min=ln.minute)
    except (KeyError, TypeError, ValueError) as e:
        raise DomainValidationError(f"Не получилось прочитать экспорт: {e}") from e

    report = ImportReport(dry_run=dry_run)
    ns = user_id  # namespace for deterministic ids: same file → same rows

    def nid(kind: str, legacy_id: str) -> uuid.UUID:
        return uuid.uuid5(ns, f"{kind}:{legacy_id}")

    try:
        user = await session.get(m.User, user_id)
        settings = await session.get(m.UserSettings, user_id)
        if user is None or settings is None:
            raise DomainValidationError("User not found")

        # ---- settings and start date ----
        s = data.ctx.settings
        settings.bed_target = _hhmm(s.bed_target) or settings.bed_target
        settings.sleep_need_h = min(12.0, max(4.0, s.sleep_need_h))
        settings.usual_bed = _hhmm(s.usual_bed) or settings.usual_bed
        settings.usual_wake = _hhmm(s.usual_wake) or settings.usual_wake
        if s.model_n > settings.model_n:  # keep whichever correction learned from more answers
            settings.model_bias, settings.model_n = list(s.bias), s.model_n
        if data.ctx.start_date < user.start_date:
            user.start_date = data.ctx.start_date

        # ---- spheres by name ----
        existing_sph = {
            x.name.lower(): x
            for x in await session.scalars(select(m.Sphere).where(m.Sphere.user_id == user_id))
        }
        pos = len(existing_sph)
        names = list(data.spheres) + [str(h.sphere) for h in data.ctx.habits if h.sphere]
        names += [str(t.sphere) for t in data.tasks if t.sphere]
        sphere_id: dict[str, uuid.UUID] = {}
        for name in names:
            clean = name.strip()[:40]
            if not clean or clean.lower() in sphere_id:
                continue
            sph = existing_sph.get(clean.lower())
            if sph is None:
                sph = m.Sphere(
                    id=nid("sphere", clean.lower()), user_id=user_id, name=clean, position=pos
                )
                pos += 1
                session.add(sph)
                existing_sph[clean.lower()] = sph
                report.spheres_created.append(clean)
            sphere_id[clean.lower()] = sph.id

        def sphere_of(name: Any) -> uuid.UUID | None:
            return sphere_id.get(str(name).strip().lower()) if name else None

        # ---- habits: reuse by id, then by (name, type); one bedtime at most ----
        existing_h = list(await session.scalars(select(m.Habit).where(m.Habit.user_id == user_id)))
        by_id = {h.id: h for h in existing_h}
        by_name = {(h.name.lower(), h.type): h for h in existing_h}
        bedtime = next((h for h in existing_h if h.type == HabitType.BEDTIME), None)
        habit_id: dict[str, uuid.UUID] = {}
        hpos = len(existing_h)
        for h in data.ctx.habits:
            key = str(h.id)
            new_id = nid("habit", key)
            found = by_id.get(new_id) or by_name.get((h.name.lower(), h.type))
            if found is None and h.type == HabitType.BEDTIME:
                found = bedtime
            if found is not None:
                habit_id[key] = found.id
                report.habits_reused.append(h.name)
                continue
            hrow = m.Habit(
                id=new_id,
                user_id=user_id,
                name=h.name[:80],
                type=h.type,
                is_key=h.is_key,
                config=dict(h.config or {}),
                sched_kind=h.sched,
                sched_n=h.sched_n,
                sched_pattern=h.sched_pattern,
                sched_anchor=h.sched_anchor,
                active=h.active,
                position=hpos,
                sphere_id=sphere_of(h.sphere),
            )
            hpos += 1
            session.add(hrow)
            if h.type == HabitType.BEDTIME:
                bedtime = hrow
            habit_id[key] = new_id
            report.habits_created.append(h.name)
        await session.flush()

        # ---- days: sleep, feel, habit marks (upserts) ----
        raw_days = export.get("days") or {}
        day_rows, log_rows = [], []
        for k, rec in data.ctx.days.items():
            raw = raw_days.get(k.isoformat()) or {}
            # Every row needs the same keys for a multi-row INSERT.
            row: dict[str, Any] = {
                "user_id": user_id,
                "date": k,
                "backfill": rec.backfill,
                "sleep_bed": None,
                "sleep_wake": None,
                "sleep_quality": None,
                "feel": [],
            }
            if rec.sleep:
                row |= {
                    "sleep_bed": _hhmm(rec.sleep.bed),
                    "sleep_wake": _hhmm(rec.sleep.wake),
                    "sleep_quality": SleepQuality(rec.sleep.q)
                    if rec.sleep.q in SleepQuality._value2member_map_
                    else SleepQuality.OK,
                }
                report.sleep_nights += 1
            row["feel"] = [f for f in raw.get("feel") or [] if isinstance(f, dict)][:12]
            day_rows.append(row)
            for hkey, value in rec.values.items():
                if str(hkey) in habit_id:
                    log_rows.append(
                        {
                            "habit_id": habit_id[str(hkey)],
                            "date": k,
                            "user_id": user_id,
                            "value": value,
                        }
                    )
        if day_rows:
            stmt = insert(m.Day).values(day_rows)
            # Never wipe what the user already logged here: imported values fill gaps.
            await session.execute(
                stmt.on_conflict_do_update(
                    index_elements=[m.Day.user_id, m.Day.date],
                    set_={
                        "sleep_bed": func.coalesce(m.Day.sleep_bed, stmt.excluded.sleep_bed),
                        "sleep_wake": func.coalesce(m.Day.sleep_wake, stmt.excluded.sleep_wake),
                        "sleep_quality": func.coalesce(
                            m.Day.sleep_quality, stmt.excluded.sleep_quality
                        ),
                        "feel": func.coalesce(
                            func.nullif(m.Day.feel, text_empty()), stmt.excluded.feel
                        ),
                    },
                )
            )
        for i in range(0, len(log_rows), 2000):  # stay far below the bind-parameter limit
            chunk = log_rows[i : i + 2000]
            stmt = insert(m.HabitLog).values(chunk)
            await session.execute(
                stmt.on_conflict_do_nothing(index_elements=[m.HabitLog.habit_id, m.HabitLog.date])
            )
        report.days = len(day_rows)
        report.habit_marks = len(log_rows)
        if data.ctx.days:
            ks = sorted(data.ctx.days)
            report.period = (ks[0].isoformat(), ks[-1].isoformat())

        # ---- tasks ----
        raw_tasks: dict[str, Any] = export.get("tasks") or {}
        known_tasks = set(await session.scalars(select(m.Task.id).where(m.Task.user_id == user_id)))
        for t in data.tasks:
            raw_t: dict[str, Any] = raw_tasks.get(str(t.id)) or next(
                (x for x in raw_tasks.values() if x.get("id") == t.id), {}
            )
            tid = nid("task", str(t.id))
            fields: dict[str, Any] = {
                "title": (t.title or "Без названия")[:200],
                "description": str(raw_t.get("desc") or raw_t.get("description") or "")[:2000],
                "date": t.date,
                "start_time": _hhmm(t.start) if t.date else None,
                "duration_min": max(5, min(1440, int(t.dur or 30))),
                "energy": t.energy,
                "importance": t.importance,
                "done": t.done,
                "done_at": _ts(raw_t.get("doneAt")) if t.done else None,
                "sphere_id": sphere_of(t.sphere),
                "created_by": Actor.CLAUDE if raw_t.get("by") == "claude" else Actor.ME,
            }
            task_row = await session.get(m.Task, tid) if tid in known_tasks else None
            if task_row is not None:
                for k2, v2 in fields.items():
                    setattr(task_row, k2, v2)
                report.tasks_updated += 1
            else:
                session.add(m.Task(id=tid, user_id=user_id, **fields))
                report.tasks_created += 1

        # ---- goals with steps, linked habits and history ----
        raw_goals = export.get("goals") or {}
        gpos = await session.scalar(
            select(func.coalesce(func.max(m.Goal.position), -1)).where(m.Goal.user_id == user_id)
        )
        gpos = int(gpos or -1) + 1
        for g in data.goals:
            raw_g: dict[str, Any] = raw_goals.get(str(g.id)) or {}
            gid = nid("goal", str(g.id))
            existing_goal = await session.get(m.Goal, gid)
            stage = raw_g.get("stage") if raw_g.get("stage") in (1, 2) else 1
            goal_fields: dict[str, Any] = {
                "title": (g.title or "Цель")[:200],
                "criterion": str(raw_g.get("criterion") or "")[:2000],
                "deadline": g.deadline,
                "stage": stage,
                "kind": g.kind,
                "target": g.target,
                "window_days": g.window,
                "manual_pct": max(0, min(100, int(g.manual_pct)))
                if g.manual_pct is not None
                else None,
                "sphere_id": sphere_of(raw_g.get("sphere")),
                "archived": g.archived,
            }
            if existing_goal is not None:
                for k2, v2 in goal_fields.items():
                    setattr(existing_goal, k2, v2)
                report.goals_updated += 1
                continue
            session.add(m.Goal(id=gid, user_id=user_id, position=gpos, **goal_fields))
            gpos += 1
            await session.flush()
            for i, st in enumerate(g.subtasks):
                session.add(
                    m.GoalSubtask(
                        id=nid("step", f"{g.id}:{i}"),
                        goal_id=gid,
                        title=(st.title or "Шаг")[:200],
                        deadline=st.deadline,
                        done=st.done,
                        position=i,
                        done_at=now if st.done else None,
                    )
                )
            linked = {habit_id[str(h)] for h in g.habits if str(h) in habit_id}
            for hid in linked:
                session.add(m.GoalHabit(goal_id=gid, habit_id=hid, user_id=user_id))
            missing = [str(h) for h in g.habits if str(h) not in habit_id]
            if missing:
                report.warnings.append(
                    f"Цель «{g.title}»: не нашлись привычки {', '.join(missing)}"
                )
            history = [x for x in raw_g.get("history") or [] if isinstance(x, dict)][:60]
            for item in reversed(history):
                session.add(
                    m.GoalHistory(
                        goal_id=gid,
                        at=_ts(item.get("at")) or now,
                        by=Actor.CLAUDE if item.get("by") == "claude" else Actor.ME,
                        what=str(item.get("what") or "")[:500],
                    )
                )
            session.add(
                m.GoalHistory(
                    goal_id=gid, at=now, by=Actor.ME, what="Перенесена из старого трекера"
                )
            )
            report.goals_created += 1

        await session.flush()
    except Exception:
        await session.rollback()
        raise
    if dry_run:
        await session.rollback()
    else:
        await session.commit()
    return report


def text_empty() -> Any:
    """'[]'::jsonb — an empty feel list counts as "nothing logged"."""
    from sqlalchemy import literal
    from sqlalchemy.dialects.postgresql import JSONB

    return literal([], JSONB)
