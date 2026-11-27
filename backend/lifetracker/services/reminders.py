"""Bot reminders: who is due right now, exactly-once delivery and the reminder content.

Scheduling is a plain query, not one timer per user: once a minute the bot asks the
database "whose local reminder time has come and has not been sent today?". Time zones
are resolved by PostgreSQL itself (``now AT TIME ZONE users.timezone``), so the query
stays one indexed scan no matter how many users and zones there are.

Exactly-once: before sending, the worker inserts ``(user, kind, logical date, item)`` into
``deliveries`` with ``ON CONFLICT DO NOTHING``. Only the worker whose insert succeeded
sends; a second worker, a restart or an overlapping tick gets nothing back and skips.
If the send fails for a transient reason the claim is released, so the next tick retries.
"""

import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import delete, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from lifetracker.core.errors import DomainValidationError
from lifetracker.db.models import Delivery, Habit, HabitLog, Task, User
from lifetracker.domain.enums import DeliveryKind, HabitType
from lifetracker.domain.habits import count_norm, habit_status
from lifetracker.services import days as days_service
from lifetracker.services import reviews
from lifetracker.services.common import get_owned
from lifetracker.services.snapshot import Snapshot, load_snapshot, to_domain_habit
from lifetracker.services.views import day_view

# How late a reminder may still go out (bot was down, deploy, Telegram outage).
GRACE = timedelta(hours=3)
# An item reminder is about "now": an hour late it is no longer useful.
ITEM_GRACE = timedelta(hours=1)
NIL = uuid.UUID(int=0)

# The local logical date (05:00–05:00) and the reminder moment inside it: a reminder
# at 00:30 belongs to the evening of the previous calendar date.
_LOCAL = """
    (:now AT TIME ZONE users.timezone) AS local_ts,
    ((:now AT TIME ZONE users.timezone) - interval '5 hours')::date AS ld
"""
_DUE_TS = """
    ld + at_time + CASE WHEN at_time < time '05:00' THEN interval '1 day'
                        ELSE interval '0' END
"""

# The f-strings below only splice the constant fragments above; values are bound.
_USER_DUE_SQL = text(
    f"""
    WITH u AS (
        SELECT users.id, users.telegram_id, {_LOCAL},
               CASE :kind WHEN 'evening' THEN users.reminder_time
                          WHEN 'morning' THEN users.morning_time
                          ELSE users.week_note_time END AS at_time
        FROM users
        WHERE NOT users.bot_blocked
    ), t AS (
        SELECT *, {_DUE_TS} AS due_ts FROM u WHERE at_time IS NOT NULL
    )
    SELECT t.id, t.telegram_id, t.ld
    FROM t
    WHERE t.local_ts >= t.due_ts AND t.local_ts < t.due_ts + :grace
      AND (:kind <> 'week_note' OR extract(isodow FROM t.ld) = 7)
      AND NOT EXISTS (SELECT 1 FROM deliveries d
                      WHERE d.user_id = t.id AND d.kind = :kind AND d.date = t.ld
                        AND d.ref = :nil)
    ORDER BY t.due_ts
    LIMIT :limit
    """  # noqa: S608
)

# Item reminders: open tasks of the local day, active habits (their schedule and whether
# they are already done are checked in Python, with the same domain rules as the app).
_ITEM_DUE_SQL = text(
    f"""
    WITH u AS (
        SELECT users.id, users.telegram_id, {_LOCAL}
        FROM users WHERE NOT users.bot_blocked
    ), items AS (
        SELECT 'task' AS kind, tasks.id AS ref, u.*, tasks.remind_at AS at_time
          FROM tasks JOIN u ON u.id = tasks.user_id
         WHERE tasks.remind_at IS NOT NULL AND NOT tasks.done AND tasks.date = u.ld
        UNION ALL
        SELECT 'habit', habits.id, u.*, habits.remind_at
          FROM habits JOIN u ON u.id = habits.user_id
         WHERE habits.remind_at IS NOT NULL AND habits.active AND habits.type <> 'bedtime'
    ), t AS (SELECT *, {_DUE_TS} AS due_ts FROM items)
    SELECT t.kind, t.ref, t.id, t.telegram_id, t.ld
    FROM t
    WHERE t.local_ts >= t.due_ts AND t.local_ts < t.due_ts + :grace
      AND NOT EXISTS (SELECT 1 FROM deliveries d
                      WHERE d.user_id = t.id AND d.kind = t.kind AND d.date = t.ld
                        AND d.ref = t.ref)
    ORDER BY t.due_ts
    LIMIT :limit
    """  # noqa: S608
)


@dataclass(frozen=True, slots=True)
class Due:
    user_id: uuid.UUID
    telegram_id: int
    kind: DeliveryKind
    day: date
    ref: uuid.UUID = NIL  # the task or habit of an item reminder


async def due_reminders(
    session: AsyncSession, kind: DeliveryKind, now: datetime, *, limit: int = 1000
) -> list[Due]:
    """Evening, morning or the Sunday note: users whose time has come today."""
    rows = await session.execute(
        _USER_DUE_SQL,
        {"now": now, "kind": kind.value, "grace": GRACE, "nil": NIL, "limit": limit},
    )
    return [Due(r.id, r.telegram_id, kind, r.ld) for r in rows]


async def due_items(session: AsyncSession, now: datetime, *, limit: int = 1000) -> list[Due]:
    """Task and habit reminders whose time has come; habits only on their working days
    and only while not done."""
    rows = list(
        await session.execute(_ITEM_DUE_SQL, {"now": now, "grace": ITEM_GRACE, "limit": limit})
    )
    out: list[Due] = []
    snaps: dict[uuid.UUID, Snapshot] = {}
    for r in rows:
        if r.kind == "habit":
            if r.id not in snaps:
                snaps[r.id] = await load_snapshot(session, r.id, now)
            ctx = snaps[r.id].ctx
            h = ctx.habit(r.ref)
            if h is None or habit_status(h, r.ld, ctx) != "pending":
                continue  # a rest day of its schedule, or already done
        out.append(Due(r.id, r.telegram_id, DeliveryKind(r.kind), r.ld, r.ref))
    return out


def _key(due: Due) -> Any:
    return (
        (Delivery.user_id == due.user_id)
        & (Delivery.kind == due.kind)
        & (Delivery.date == due.day)
        & (Delivery.ref == due.ref)
    )


async def claim(session: AsyncSession, due: Due) -> bool:
    """Reserve the right to send. False means someone already sent (or is sending) it."""
    got = await session.scalar(
        insert(Delivery)
        .values(user_id=due.user_id, kind=due.kind, date=due.day, ref=due.ref)
        .on_conflict_do_nothing()
        .returning(Delivery.user_id)
    )
    await session.commit()
    return got is not None


async def mark_sent(session: AsyncSession, due: Due, now: datetime) -> None:
    await session.execute(update(Delivery).where(_key(due)).values(sent_at=now))
    await session.commit()


async def release(session: AsyncSession, due: Due) -> None:
    """Give the claim back after a transient failure so the next tick retries."""
    await session.execute(delete(Delivery).where(_key(due)))
    await session.commit()


# ---- users seen through Telegram ----


async def user_id_by_telegram(session: AsyncSession, telegram_id: int) -> uuid.UUID | None:
    return await session.scalar(select(User.id).where(User.telegram_id == telegram_id))


async def set_bot_blocked(session: AsyncSession, telegram_id: int, blocked: bool) -> None:
    """The user blocked (or unblocked) the bot: stop (or resume) sending anything."""
    await session.execute(
        update(User).where(User.telegram_id == telegram_id).values(bot_blocked=blocked)
    )
    await session.commit()


# ---- content ----


@dataclass(frozen=True, slots=True)
class PendingHabit:
    id: uuid.UUID
    name: str


@dataclass(frozen=True, slots=True)
class Evening:
    day: date
    score: int | None
    delta: int | None
    habits: list[PendingHabit]  # due today and not marked either way yet
    important: list[str]  # titles of unfinished important tasks
    done_habits: int
    total_habits: int


async def evening_content(
    session: AsyncSession, user_id: uuid.UUID, day: date, now: datetime
) -> Evening:
    """Everything the evening message shows, built from the same Day screen as the app."""
    view = await day_view(session, user_id, now, day)
    rows = [h for h in view.habits if h.type != HabitType.BEDTIME and h.due]
    pending = [
        PendingHabit(h.id, h.name)
        for h in rows
        if h.value is None and h.status in ("pending", "missed")
    ]
    return Evening(
        day=day,
        score=view.score.pct if view.score else None,
        delta=view.score.delta if view.score else None,
        habits=pending,
        important=[t.title for t in view.tasks if t.important and not t.done],
        done_habits=sum(1 for h in rows if h.status == "done"),
        total_habits=len(rows),
    )


def mark_value(habit: Habit, done: bool) -> object:
    """What ✅ / ❌ in the bot means for each habit type."""
    match habit.type:
        case HabitType.CHECK:
            return done
        case HabitType.COUNT:
            return count_norm(to_domain_habit(habit)) if done else 0
    raise DomainValidationError("This habit is marked from the sleep log")


async def mark_habit(
    session: AsyncSession,
    user_id: uuid.UUID,
    habit_id: uuid.UUID,
    day: date,
    done: bool,
    now: datetime,
) -> str:
    """Mark a habit from a reminder button. Someone else's habit is simply 'not found'."""
    habit = await get_owned(session, Habit, habit_id, user_id, what="Habit")
    await days_service.set_habit_value(
        session, user_id, day, habit_id, mark_value(habit, done), now
    )
    return habit.name


@dataclass(frozen=True, slots=True)
class Morning:
    day: date
    first_name: str
    sleep_logged: bool
    tasks: int  # open tasks of the day
    important: list[str]
    plan: list[str]  # Claude's plan for the day, one line per item: "10:00 Лаба"


async def morning_content(
    session: AsyncSession, user_id: uuid.UUID, day: date, now: datetime
) -> Morning:
    view = await day_view(session, user_id, now, day)
    name = await session.scalar(select(User.first_name).where(User.id == user_id))
    plan = await reviews.latest_plan(session, user_id, day)
    lines = [
        f"{it['start']} {it['title']}" if it.get("start") else str(it["title"])
        for it in (plan.items or [] if plan and plan.applied_at is None else [])
    ]
    return Morning(
        day=day,
        first_name=name or "",
        sleep_logged=view.sleep is not None,
        tasks=sum(1 for t in view.tasks if not t.done),
        important=[t.title for t in view.tasks if t.important and not t.done],
        plan=lines,
    )


@dataclass(frozen=True, slots=True)
class TaskReminder:
    id: uuid.UUID
    title: str
    start: str | None  # "HH:MM"


@dataclass(frozen=True, slots=True)
class HabitReminder:
    id: uuid.UUID
    name: str
    value: int | None  # count habits: done so far today
    norm: int | None


async def item_content(session: AsyncSession, due: Due) -> TaskReminder | HabitReminder:
    if due.kind == DeliveryKind.TASK:
        t = await get_owned(session, Task, due.ref, due.user_id, what="Task")
        return TaskReminder(t.id, t.title, t.start_time.strftime("%H:%M") if t.start_time else None)
    h = await get_owned(session, Habit, due.ref, due.user_id, what="Habit")
    if h.type != HabitType.COUNT:
        return HabitReminder(h.id, h.name, None, None)
    log = await session.get(HabitLog, (h.id, due.day))
    value = log.value if log is not None and isinstance(log.value, int) else 0
    return HabitReminder(h.id, h.name, value, count_norm(to_domain_habit(h)))


async def complete_task(
    session: AsyncSession, user_id: uuid.UUID, task_id: uuid.UUID, now: datetime
) -> str:
    """«Сделано» under a task reminder. Someone else's task is simply 'not found'."""
    task = await get_owned(session, Task, task_id, user_id, what="Task")
    if not task.done:
        task.done, task.done_at = True, now
        await session.commit()
    return task.title
