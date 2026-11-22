"""Relational schema.

Isolation is enforced twice:
1. every query in the service layer filters by the authenticated ``user_id``;
2. composite foreign keys ``(child.ref_id, child.user_id) -> (parent.id, parent.user_id)``
   make it impossible at the database level to attach a row to another user's
   sphere, habit or goal, even if application code had a bug.
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
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from lifetracker.db.base import Base, created_at_col, str_enum, updated_at_col, uuid_pk
from lifetracker.domain.enums import (
    Actor,
    DeliveryKind,
    EnergyZone,
    GoalKind,
    HabitType,
    Importance,
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
    reminder_time: Mapped[time | None] = mapped_column(Time)
    morning_ping: Mapped[bool] = mapped_column(Boolean, default=False)
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


class Sphere(Base):
    __tablename__ = "spheres"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(user_fk())
    name: Mapped[str] = mapped_column(String(40))
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = created_at_col()

    __table_args__ = (
        UniqueConstraint("id", "user_id", name="uq_spheres_id_user"),
        Index("uq_spheres_user_name", "user_id", func.lower(name), unique=True),
    )


class Habit(Base):
    __tablename__ = "habits"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(user_fk())
    sphere_id: Mapped[uuid.UUID | None] = mapped_column()
    name: Mapped[str] = mapped_column(String(80))
    type: Mapped[HabitType] = mapped_column(str_enum(HabitType, "habit_type"))
    is_key: Mapped[bool] = mapped_column(Boolean, default=False)
    # water: {target_l, glass_l}; minutes: {target_min, step_min}; dual: {labels: [a, b]}
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    sched_kind: Mapped[ScheduleKind] = mapped_column(
        str_enum(ScheduleKind, "schedule_kind"), default=ScheduleKind.DAILY
    )
    sched_n: Mapped[int | None] = mapped_column(SmallInteger)
    sched_pattern: Mapped[str | None] = mapped_column(String(31))
    sched_anchor: Mapped[date | None] = mapped_column(Date)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    __table_args__ = (
        UniqueConstraint("id", "user_id", name="uq_habits_id_user"),
        ForeignKeyConstraint(
            ["sphere_id", "user_id"],
            ["spheres.id", "spheres.user_id"],
            ondelete="SET NULL (sphere_id)",
            name="fk_habits_sphere_owner",
        ),
        CheckConstraint(
            "(sched_kind = 'daily')"
            " OR (sched_kind = 'every' AND sched_n BETWEEN 2 AND 365)"
            " OR (sched_kind = 'cycle' AND sched_pattern ~ '^[01]+$' AND sched_anchor IS NOT NULL)",
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
    """Value of a habit on a logical day: true | number | {"a": bool, "b": bool}."""

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
    energy: Mapped[EnergyZone] = mapped_column(
        str_enum(EnergyZone, "energy_zone"), default=EnergyZone.STEADY
    )
    sphere_id: Mapped[uuid.UUID | None] = mapped_column()
    importance: Mapped[Importance] = mapped_column(
        str_enum(Importance, "importance"), default=Importance.NORMAL
    )
    done: Mapped[bool] = mapped_column(Boolean, default=False)
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[Actor] = mapped_column(str_enum(Actor, "actor"), default=Actor.ME)
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    __table_args__ = (
        ForeignKeyConstraint(
            ["sphere_id", "user_id"],
            ["spheres.id", "spheres.user_id"],
            ondelete="SET NULL (sphere_id)",
            name="fk_tasks_sphere_owner",
        ),
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


class Goal(Base):
    __tablename__ = "goals"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(user_fk())
    title: Mapped[str] = mapped_column(String(200))
    criterion: Mapped[str] = mapped_column(Text, default="")
    deadline: Mapped[date | None] = mapped_column(Date)
    stage: Mapped[int] = mapped_column(SmallInteger, default=1)
    kind: Mapped[GoalKind] = mapped_column(str_enum(GoalKind, "goal_kind"))
    target: Mapped[int | None] = mapped_column(Integer)
    window_days: Mapped[int | None] = mapped_column(Integer)
    manual_pct: Mapped[int | None] = mapped_column(SmallInteger)
    sphere_id: Mapped[uuid.UUID | None] = mapped_column()
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    subtasks: Mapped[list["GoalSubtask"]] = relationship(
        order_by="GoalSubtask.position", cascade="all, delete-orphan", lazy="raise"
    )
    habit_links: Mapped[list["GoalHabit"]] = relationship(
        cascade="all, delete-orphan", lazy="raise"
    )

    __table_args__ = (
        UniqueConstraint("id", "user_id", name="uq_goals_id_user"),
        ForeignKeyConstraint(
            ["sphere_id", "user_id"],
            ["spheres.id", "spheres.user_id"],
            ondelete="SET NULL (sphere_id)",
            name="fk_goals_sphere_owner",
        ),
        CheckConstraint("stage IN (1, 2)", name="stage_valid"),
        CheckConstraint("manual_pct IS NULL OR manual_pct BETWEEN 0 AND 100", name="pct_range"),
        Index("ix_goals_user_list", "user_id", "archived", "position"),
    )


class GoalHabit(Base):
    __tablename__ = "goal_habits"

    goal_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    habit_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(user_fk())

    __table_args__ = (
        ForeignKeyConstraint(
            ["goal_id", "user_id"],
            ["goals.id", "goals.user_id"],
            ondelete="CASCADE",
            name="fk_goal_habits_goal_owner",
        ),
        ForeignKeyConstraint(
            ["habit_id", "user_id"],
            ["habits.id", "habits.user_id"],
            ondelete="CASCADE",
            name="fk_goal_habits_habit_owner",
        ),
    )


class GoalSubtask(Base):
    __tablename__ = "goal_subtasks"

    id: Mapped[uuid.UUID] = uuid_pk()
    goal_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("goals.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(200))
    deadline: Mapped[date | None] = mapped_column(Date)
    done: Mapped[bool] = mapped_column(Boolean, default=False)
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    position: Mapped[int] = mapped_column(Integer, default=0)

    __table_args__ = (Index("ix_goal_subtasks_goal_position", "goal_id", "position"),)


class GoalHistory(Base):
    __tablename__ = "goal_history"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    goal_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("goals.id", ondelete="CASCADE"))
    at: Mapped[datetime] = created_at_col()
    by: Mapped[Actor] = mapped_column(str_enum(Actor, "actor"))
    what: Mapped[str] = mapped_column(Text)

    __table_args__ = (Index("ix_goal_history_goal_at", "goal_id", text("at DESC")),)


class Review(Base):
    __tablename__ = "reviews"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(user_fk())
    kind: Mapped[ReviewKind] = mapped_column(str_enum(ReviewKind, "review_kind"))
    date: Mapped[date] = mapped_column(Date)
    body: Mapped[str] = mapped_column(Text)
    by: Mapped[ReviewAuthor] = mapped_column(str_enum(ReviewAuthor, "review_author"))
    at: Mapped[datetime] = created_at_col()

    __table_args__ = (Index("ix_reviews_user_at", "user_id", text("at DESC")),)


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
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
