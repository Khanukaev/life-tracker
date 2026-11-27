"""Aggregated screen payloads: one request per screen.

Times of day are integers: minutes since 00:00 of the logical day (05:00 = 300,
01:30 of the next night = 1530), exactly as the domain model uses them.
"""

import datetime as dt
import uuid
from typing import Any

from pydantic import BaseModel

from lifetracker.schemas.days import SleepOut
from lifetracker.schemas.habits import ScheduleOut
from lifetracker.schemas.tasks import TaskOut


class ScoreItemOut(BaseModel):
    kind: str  # sleep | habit | task
    ref: uuid.UUID
    label: str
    w: int
    v: float
    points: int
    max_points: int
    note: str


class GainOut(BaseModel):
    kind: str
    ref: uuid.UUID
    label: str
    points: int


class WeekBar(BaseModel):
    date: dt.date
    pct: int | None


class ScoreOut(BaseModel):
    pct: int
    delta: int | None
    avg7: int | None
    week: list[WeekBar]
    items: list[ScoreItemOut]
    gains: list[GainOut]
    gains_total: int
    bed_gain: int


class HabitRow(BaseModel):
    id: uuid.UUID
    name: str
    type: str
    config: dict[str, Any]
    schedule: ScheduleOut
    status: str  # done | missed | rest | pending | nodata | future
    due: bool
    value: Any
    streak: int
    # Streak up to yesterday: the client shows `streak_base + 1` right after a tap
    # (optimistic UI) without waiting for the server.
    streak_base: int


class DayTask(TaskOut):
    overdue: bool
    low_energy: bool  # Focus task placed in a Recharge/sleep zone


class ZoneSpan(BaseModel):
    zone: str
    start: int
    end: int
    avg: int


class GapOut(BaseModel):
    start: float
    end: float
    zone: str | None


class NowCard(BaseModel):
    zone: str
    until: int
    idx: int | None
    next_zone: str | None


class TimelineOut(BaseModel):
    wake: float
    bed: float
    zones: list[ZoneSpan]
    curve: list[int | None]  # energy index every 15 min from 05:00 to 05:00 (97 points)
    free: list[GapOut]
    now: NowCard | None


class DayView(BaseModel):
    date: dt.date
    today: dt.date
    relation: str  # today | past | future
    now_min: int | None
    date_label: str
    energy_now: int | None
    energy_zone: str | None
    score: ScoreOut | None
    phrase: str | None
    phrases: list[str]  # tap on the phrase shows the next one
    sleep: SleepOut | None
    sleep_planned: dict[str, Any] | None
    habits: list[HabitRow]
    tasks: list[DayTask]
    timeline: TimelineOut


class FactorOut(BaseModel):
    key: str
    label: str
    val: int
    note: str


class HormonesOut(BaseModel):
    step_min: int
    alertness: list[float]
    motivation: list[float]
    cortisol: list[float]
    melatonin: list[float]
    now: dict[str, float] | None
    melatonin_rise: int


class FeelOut(BaseModel):
    t: str
    v: str
    pred: float | None
    err: float | None


class NowView(BaseModel):
    today: dt.date
    now_min: int
    idx: int | None
    zone: str
    window: ZoneSpan | None
    next_focus: ZoneSpan | None
    sleep_logged: bool
    last_feel: FeelOut | None
    curve: list[int | None]  # every 5 min, 05:00 → 05:00 (289 points)
    q_hi: int
    q_lo: int
    avg: int | None
    max: int
    max_at: int | None
    min: int
    min_at: int | None
    windows: list[ZoneSpan]
    train: dict[str, float] | None
    factors: list[FactorOut]
    personal: int
    personal_n: int
    debt_h: float
    late_min: float
    irr_sd_h: float | None
    hormones: HormonesOut


class AlertOut(BaseModel):
    kind: str
    title: str
    subtitle: str
    severe: bool


class ReviewHabit(BaseModel):
    id: uuid.UUID
    name: str
    pct: int | None
    dots: list[str]  # status per day of the period
    streak: int
    best: int


class NightDot(BaseModel):
    date: dt.date
    bed: float | None  # minutes relative to 00:00 of the wake-up day (23:00 = -60)
    on_time: bool | None


class ReviewView(BaseModel):
    period: str
    start: dt.date
    end: dt.date
    label: str
    prev_anchor: dt.date
    next_anchor: dt.date | None
    scores: list[WeekBar]
    avg: int | None
    days_70: int
    best_run_70: int
    best_day: WeekBar | None
    alerts: list[AlertOut]
    habits_pct: int | None
    tasks_pct: int | None
    tasks_done: int
    tasks_total: int
    habits: list[ReviewHabit]
    bed_goal: float
    nights: list[NightDot]


class SlotOut(BaseModel):
    date: dt.date
    start: int
    end: int
    fit: float
    avg: int
    zone: str | None


class SlotView(BaseModel):
    best: SlotOut | None
    alternative: SlotOut | None


class FeelIn(BaseModel):
    v: str


class FeelResultOut(BaseModel):
    feel: FeelOut
    message: str
    bias: list[float]
    model_n: int


class TaskCounts(BaseModel):
    inbox: int
    today: int
    overdue: int
    overdue_important: int
    upcoming: int
    done: int


class ListTask(DayTask):
    slot: SlotOut | None  # suggested better slot for a Focus task in a low-energy time


class ZoneLoadOut(BaseModel):
    zone: str
    need_min: int
    free_min: int
    task_ids: list[uuid.UUID]


class TasksView(BaseModel):
    view: str
    counts: TaskCounts
    items: list[ListTask]
    loads: list[ZoneLoadOut]
    important_today: int


class ProfileHabit(BaseModel):
    id: uuid.UUID
    name: str
    type: str
    active: bool
    schedule_label: str
    streak: int


class ProfileView(BaseModel):
    tasks: TaskCounts
    habits: list[ProfileHabit]
