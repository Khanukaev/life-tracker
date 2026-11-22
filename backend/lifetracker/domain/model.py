"""Plain data the domain functions work on.

Everything here is a frozen-ish snapshot built by the service layer from the
database (or by the legacy adapter from an old JSON export). Domain functions
never touch I/O, clocks or the ORM — this is what makes them golden-testable.
"""

from collections.abc import Hashable
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from lifetracker.domain.enums import EnergyZone, GoalKind, HabitType, Importance, ScheduleKind

HabitId = Hashable


@dataclass(slots=True)
class SleepRec:
    bed: int  # minutes since 00:00 (wall clock), e.g. 23:40 -> 1420
    wake: int
    q: str = "ok"  # bad | ok | good


@dataclass(slots=True)
class FeelRec:
    t: str  # "HH:MM"
    v: str  # low | ok | high
    pred: float | None = None
    err: float | None = None


@dataclass(slots=True)
class DayRec:
    sleep: SleepRec | None = None
    feel: list[FeelRec] = field(default_factory=list)
    values: dict[HabitId, Any] = field(default_factory=dict)
    backfill: bool = False


@dataclass(slots=True)
class Settings:
    bed_target: int = 23 * 60 + 30  # minutes since 00:00
    sleep_need_h: float = 8.0
    usual_bed: int = 23 * 60 + 30
    usual_wake: int = 7 * 60 + 30
    bias: list[float] = field(default_factory=lambda: [0.0, 0.0, 0.0, 0.0])
    model_n: int = 0


@dataclass(slots=True)
class Habit:
    id: HabitId
    type: HabitType
    name: str = ""
    sphere: Hashable | None = None
    is_key: bool = False
    active: bool = True
    config: dict[str, Any] = field(default_factory=dict)
    sched: ScheduleKind = ScheduleKind.DAILY
    sched_n: int | None = None
    sched_pattern: str | None = None
    sched_anchor: date | None = None


@dataclass(slots=True)
class Task:
    id: Hashable
    title: str
    date: date | None
    start: int | None = None  # task minute of the logical day (00:00–04:59 -> 1440+)
    dur: int = 30
    energy: EnergyZone = EnergyZone.STEADY
    importance: Importance = Importance.NORMAL
    done: bool = False
    sphere: Hashable | None = None


@dataclass(slots=True)
class Subtask:
    title: str
    done: bool = False
    deadline: date | None = None


@dataclass(slots=True)
class Goal:
    id: Hashable
    title: str
    kind: GoalKind = GoalKind.SUBTASKS
    habits: list[HabitId] = field(default_factory=list)
    target: int | None = None
    window: int | None = None
    manual_pct: int | None = None
    subtasks: list[Subtask] = field(default_factory=list)
    deadline: date | None = None
    archived: bool = False


@dataclass(slots=True)
class Ctx:
    """Everything about one user that the formulas need, as of `today`."""

    today: date
    start_date: date
    settings: Settings
    habits: list[Habit]
    days: dict[date, DayRec]
    now_min: int = 12 * 60  # logical minute of "now" (00:00–04:59 -> 1440+)

    def day(self, d: date) -> DayRec | None:
        return self.days.get(d)

    def habit(self, hid: HabitId) -> Habit | None:
        for h in self.habits:
            if h.id == hid:
                return h
        return None
