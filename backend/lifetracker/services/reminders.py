"""Bot reminders: who is due right now, exactly-once delivery and the reminder content.

Scheduling is a plain query, not one timer per user: once a minute the bot asks the
database "whose local reminder time has come and has not been sent today?". Time zones
are resolved by PostgreSQL itself (``now AT TIME ZONE users.timezone``), so the query
stays one indexed scan no matter how many users and zones there are.

Exactly-once: before sending, the worker inserts ``(user, kind, logical date)`` into
``deliveries`` with ``ON CONFLICT DO NOTHING``. Only the worker whose insert succeeded
sends; a second worker, a restart or an overlapping tick gets nothing back and skips.
If the send fails for a transient reason the claim is released, so the next tick retries.
"""

import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy import delete, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from lifetracker.core.errors import DomainValidationError
from lifetracker.db.models import Delivery, Habit, User
from lifetracker.domain.enums import DeliveryKind, HabitType, Importance
from lifetracker.domain.habits import glasses_need, minutes_need
from lifetracker.services import days as days_service
from lifetracker.services.common import get_owned
from lifetracker.services.snapshot import to_domain_habit
from lifetracker.services.views import day_view

# How late a reminder may still go out (bot was down, deploy, Telegram outage).
GRACE = timedelta(hours=3)
# The morning "How did you sleep?" comes a bit after the usual wake-up time.
MORNING_DELAY = timedelta(minutes=30)

_DUE_SQL = text(
    """
    WITH u AS (
        SELECT users.id, users.telegram_id,
               (:now AT TIME ZONE users.timezone) AS local_ts,
               ((:now AT TIME ZONE users.timezone) - interval '5 hours')::date AS ld,
               CASE WHEN :kind = 'evening' THEN users.reminder_time
                    ELSE (s.usual_wake + :morning_delay)::time END AS at_time
        FROM users JOIN user_settings s ON s.user_id = users.id
        WHERE NOT users.bot_blocked
          AND CASE WHEN :kind = 'evening' THEN users.reminder_time IS NOT NULL
                   ELSE users.morning_ping END
    ), t AS (
        -- The moment of the reminder inside the user's logical day (05:00–05:00):
        -- a reminder at 00:30 belongs to the evening of the previous calendar date.
        SELECT *, ld + at_time
                  + CASE WHEN at_time < time '05:00' THEN interval '1 day'
                         ELSE interval '0' END AS due_ts
        FROM u
    )
    SELECT t.id, t.telegram_id, t.ld
    FROM t
    WHERE t.local_ts >= t.due_ts AND t.local_ts < t.due_ts + :grace
      AND NOT EXISTS (SELECT 1 FROM deliveries d
                      WHERE d.user_id = t.id AND d.kind = :kind
                        AND d.date = t.ld)
      AND (:kind = 'evening' OR NOT EXISTS (
            SELECT 1 FROM days WHERE days.user_id = t.id AND days.date = t.ld
                                 AND days.sleep_bed IS NOT NULL))
    ORDER BY t.due_ts
    LIMIT :limit
    """
)


@dataclass(frozen=True, slots=True)
class Due:
    user_id: uuid.UUID
    telegram_id: int
    kind: DeliveryKind
    day: date


async def due_reminders(
    session: AsyncSession, kind: DeliveryKind, now: datetime, *, limit: int = 1000
) -> list[Due]:
    rows = await session.execute(
        _DUE_SQL,
        {
            "now": now,
            "kind": kind.value,
            "grace": GRACE,
            "morning_delay": MORNING_DELAY,
            "limit": limit,
        },
    )
    return [Due(r.id, r.telegram_id, kind, r.ld) for r in rows]


async def claim(session: AsyncSession, due: Due) -> bool:
    """Reserve the right to send. False means someone already sent (or is sending) it."""
    got = await session.scalar(
        insert(Delivery)
        .values(user_id=due.user_id, kind=due.kind, date=due.day)
        .on_conflict_do_nothing()
        .returning(Delivery.user_id)
    )
    await session.commit()
    return got is not None


async def mark_sent(session: AsyncSession, due: Due, now: datetime) -> None:
    await session.execute(
        update(Delivery)
        .where(Delivery.user_id == due.user_id, Delivery.kind == due.kind, Delivery.date == due.day)
        .values(sent_at=now)
    )
    await session.commit()


async def release(session: AsyncSession, due: Due) -> None:
    """Give the claim back after a transient failure so the next tick retries."""
    await session.execute(
        delete(Delivery).where(
            Delivery.user_id == due.user_id, Delivery.kind == due.kind, Delivery.date == due.day
        )
    )
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
    critical: list[str]  # titles of unfinished critical tasks
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
        critical=[
            t.title for t in view.tasks if t.importance == Importance.CRITICAL and not t.done
        ],
        done_habits=sum(1 for h in rows if h.status == "done"),
        total_habits=len(rows),
    )


def mark_value(habit: Habit, done: bool) -> object:
    """What ✅ / ❌ in the bot means for each habit type."""
    match habit.type:
        case HabitType.CHECK:
            return done
        case HabitType.DUAL:
            return {"a": done, "b": done}
        case HabitType.WATER:
            return glasses_need(to_domain_habit(habit)) if done else 0
        case HabitType.MINUTES:
            return minutes_need(to_domain_habit(habit)) if done else 0
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
