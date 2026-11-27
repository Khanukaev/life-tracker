"""Relational schema.

Isolation is enforced twice:
1. every query in the service layer filters by the authenticated ``user_id``;
2. composite foreign keys ``(child.ref_id, child.user_id) -> (parent.id, parent.user_id)``
   make it impossible at the database level to attach a row to another user's
   habit, even if application code had a bug.
"""

import datetime as dt
import uuid
from datetime import date, datetime, time
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Identity,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    Time,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from lifetracker.db.base import Base, created_at_col, str_enum, updated_at_col, uuid_pk
from lifetracker.domain.enums import (
    Actor,
    DeliveryKind,
    HabitType,
    NoteKind,
    ReviewAuthor,
    ReviewKind,
    ScheduleKind,
    SleepQuality,
    Theme,
)


def user_fk() -> ForeignKey:
    return ForeignKey("users.id", ondelete="CASCADE")


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = uuid_pk()
    telegram_id: Mapped[int] = mapped_column(BigInteger, unique=True)
    first_name: Mapped[str] = mapped_column(String(64))
    username: Mapped[str | None] = mapped_column(String(64))
    language: Mapped[str] = mapped_column(String(8), default="ru")
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")
    reminder_time: Mapped[time | None] = mapped_column(Time)  # evening; NULL = off
    morning_time: Mapped[time | None] = mapped_column(Time)  # NULL = off
    week_note_time: Mapped[time | None] = mapped_column(Time)  # on Sundays; NULL = off
    theme: Mapped[Theme | None] = mapped_column(str_enum(Theme, "theme"))  # NULL = auto
    haptics: Mapped[bool] = mapped_column(Boolean, default=True)
    onboarded: Mapped[bool] = mapped_column(Boolean, default=False)
    bot_blocked: Mapped[bool] = mapped_column(Boolean, default=False)
    motto: Mapped[str | None] = mapped_column(String(120))
    start_date: Mapped[date] = mapped_column(Date)
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    settings: Mapped["UserSettings"] = relationship(back_populates="user", lazy="raise")

    __table_args__ = (
        # Scheduler picks users whose evening reminder is due.
        Index(
            "ix_users_reminder_due",
            "reminder_time",
            postgresql_where=text("reminder_time IS NOT NULL AND NOT bot_blocked"),
        ),
    )


class UserSettings(Base):
    """Sleep norms and the personal correction of the energy model (1:1 with users)."""

    __tablename__ = "user_settings"

    user_id: Mapped[uuid.UUID] = mapped_column(user_fk(), primary_key=True)
    bed_target: Mapped[time] = mapped_column(Time, default=time(23, 30))
    sleep_need_h: Mapped[float] = mapped_column(Float, default=8.0)
    usual_bed: Mapped[time] = mapped_column(Time, default=time(23, 30))
    usual_wake: Mapped[time] = mapped_column(Time, default=time(7, 30))
    model_bias: Mapped[list[float]] = mapped_column(
        ARRAY(Float), default=lambda: [0.0, 0.0, 0.0, 0.0]
    )
    model_n: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = updated_at_col()

    user: Mapped[User] = relationship(back_populates="settings", lazy="raise")

    __table_args__ = (
        CheckConstraint("sleep_need_h BETWEEN 4 AND 12", name="sleep_need_range"),
        CheckConstraint("cardinality(model_bias) = 4", name="model_bias_len"),
    )


class Habit(Base):
    __tablename__ = "habits"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(user_fk())
    name: Mapped[str] = mapped_column(String(80))
    type: Mapped[HabitType] = mapped_column(str_enum(HabitType, "habit_type"))
    # count: {norm, step}; check and bedtime: {}
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    sched_kind: Mapped[ScheduleKind] = mapped_column(
        str_enum(ScheduleKind, "schedule_kind"), default=ScheduleKind.DAILY
    )
    sched_pattern: Mapped[str | None] = mapped_column(String(31))
    sched_anchor: Mapped[date | None] = mapped_column(Date)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    remind_at: Mapped[time | None] = mapped_column(Time)  # a bot message on its days
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    __table_args__ = (
        UniqueConstraint("id", "user_id", name="uq_habits_id_user"),
        CheckConstraint(
            "(sched_kind IN ('daily', 'weekdays') AND sched_pattern IS NULL)"
            " OR (sched_kind = 'cycle' AND sched_pattern ~ '^[01]*1[01]*$'"
            " AND sched_anchor IS NOT NULL)",
            name="schedule_valid",
        ),
        # Bedtime is derived from sleep, so one per user is enough.
        Index(
            "uq_habits_one_bedtime",
            "user_id",
            unique=True,
            postgresql_where=text("type = 'bedtime'"),
        ),
        Index("ix_habits_user_position", "user_id", "position"),
    )


class Day(Base):
    """Per-day record: sleep of the night that ended this morning and energy self-reports."""

    __tablename__ = "days"

    user_id: Mapped[uuid.UUID] = mapped_column(user_fk(), primary_key=True)
    date: Mapped[date] = mapped_column(Date, primary_key=True)
    sleep_bed: Mapped[time | None] = mapped_column(Time)
    sleep_wake: Mapped[time | None] = mapped_column(Time)
    sleep_quality: Mapped[SleepQuality | None] = mapped_column(
        str_enum(SleepQuality, "sleep_quality")
    )
    # [{t: "HH:MM", v: low|ok|high, pred: int, err: float}], at most 12 per day
    feel: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    backfill: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = updated_at_col()

    __table_args__ = (
        CheckConstraint(
            "(sleep_bed IS NULL) = (sleep_wake IS NULL)"
            " AND (sleep_bed IS NULL) = (sleep_quality IS NULL)",
            name="sleep_complete",
        ),
    )


class HabitLog(Base):
    """Value of a habit on a logical day: true/false (check) or a count."""

    __tablename__ = "habit_logs"

    habit_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    date: Mapped[date] = mapped_column(Date, primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(user_fk())
    value: Mapped[Any] = mapped_column(JSONB)
    updated_at: Mapped[datetime] = updated_at_col()

    __table_args__ = (
        ForeignKeyConstraint(
            ["habit_id", "user_id"],
            ["habits.id", "habits.user_id"],
            ondelete="CASCADE",
            name="fk_habit_logs_habit_owner",
        ),
        Index("ix_habit_logs_user_date", "user_id", "date"),
    )


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(user_fk())
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    date: Mapped[dt.date | None] = mapped_column(Date, nullable=True)  # NULL = inbox
    start_time: Mapped[time | None] = mapped_column(Time)
    duration_min: Mapped[int] = mapped_column(SmallInteger, default=30)
    important: Mapped[bool] = mapped_column(Boolean, default=False)  # top of lists, ×3
    fresh: Mapped[bool] = mapped_column(Boolean, default=False)  # needs a fresh head: peak
    remind_at: Mapped[time | None] = mapped_column(Time)  # a bot message on its date
    done: Mapped[bool] = mapped_column(Boolean, default=False)
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[Actor] = mapped_column(str_enum(Actor, "actor"), default=Actor.ME)
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    __table_args__ = (
        CheckConstraint("duration_min BETWEEN 5 AND 1440", name="duration_range"),
        CheckConstraint("start_time IS NULL OR date IS NOT NULL", name="time_needs_date"),
        Index("ix_tasks_user_date", "user_id", "date", postgresql_where=text("date IS NOT NULL")),
        Index(
            "ix_tasks_user_inbox",
            "user_id",
            "created_at",
            postgresql_where=text("date IS NULL AND NOT done"),
        ),
        Index(
            "ix_tasks_user_done_at",
            "user_id",
            text("done_at DESC"),
            postgresql_where=text("done"),
        ),
    )


class Review(Base):
    __tablename__ = "reviews"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(user_fk())
    kind: Mapped[ReviewKind] = mapped_column(str_enum(ReviewKind, "review_kind"))
    date: Mapped[date] = mapped_column(Date)
    body: Mapped[str] = mapped_column(Text)
    by: Mapped[ReviewAuthor] = mapped_column(str_enum(ReviewAuthor, "review_author"))
    at: Mapped[datetime] = created_at_col()
    used_note: Mapped[bool] = mapped_column(Boolean, default=False)  # «Учёл твою заметку»
    # What Claude changed since its previous review: ["Поставил напоминание о воде на 15:00"]
    changes: Mapped[list[str]] = mapped_column(JSONB, default=list)
    # Plans only: [{"title", "start": "HH:MM" | null, "dur": int, "note": str}]
    items: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB)
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (Index("ix_reviews_user_at", "user_id", text("at DESC")),)


class Note(Base):
    """One text per week or month (keyed by the period's first day)."""

    __tablename__ = "notes"

    user_id: Mapped[uuid.UUID] = mapped_column(user_fk(), primary_key=True)
    kind: Mapped[NoteKind] = mapped_column(str_enum(NoteKind, "note_kind"), primary_key=True)
    start: Mapped[date] = mapped_column(Date, primary_key=True)
    body: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[datetime] = updated_at_col()


class ClaudeAction(Base):
    """Journal of what Claude changed through MCP, shown with its next review."""

    __tablename__ = "claude_actions"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(user_fk())
    at: Mapped[datetime] = created_at_col()
    what: Mapped[str] = mapped_column(Text)

    __table_args__ = (Index("ix_claude_actions_user_at", "user_id", text("at DESC")),)


class McpToken(Base):
    """Personal MCP token. Only a SHA-256 hash is stored; the token is shown once."""

    __tablename__ = "mcp_tokens"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(user_fk())
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    prefix: Mapped[str] = mapped_column(String(12))
    created_at: Mapped[datetime] = created_at_col()
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        Index(
            "uq_mcp_tokens_one_active",
            "user_id",
            unique=True,
            postgresql_where=text("revoked_at IS NULL"),
        ),
    )


class Delivery(Base):
    """Bot message ledger: inserting a row first guarantees a reminder is sent once."""

    __tablename__ = "deliveries"

    user_id: Mapped[uuid.UUID] = mapped_column(user_fk(), primary_key=True)
    kind: Mapped[DeliveryKind] = mapped_column(
        str_enum(DeliveryKind, "delivery_kind"), primary_key=True
    )
    date: Mapped[date] = mapped_column(Date, primary_key=True)
    # The task or habit of an item reminder; the nil UUID for evening, morning, week note.
    ref: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.UUID(int=0))
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
