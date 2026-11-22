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
    is_key: bool
    sphere_id: uuid.UUID | None
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
    sleep: SleepOut | None
    sleep_planned: dict[str, Any] | None
    critical: list[DayTask]
    critical_overload: bool
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


class ReviewSphere(BaseModel):
    id: uuid.UUID
    name: str
    streak: int
    best: int
    pct: int | None


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
    spheres: list[ReviewSphere]
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


class GoalProgressOut(BaseModel):
    pct: int
    label: str
    cur: int | None = None
    t: int | None = None


class DayCell(BaseModel):
    date: dt.date
    ok: str  # ok | pending | missed | nodata


class GoalCard(BaseModel):
    id: uuid.UUID
    title: str
    criterion: str
    kind: str
    stage: int
    deadline: dt.date | None
    sphere_id: uuid.UUID | None
    sphere_name: str | None
    archived: bool
    progress: GoalProgressOut
    overdue: bool
    overdue_steps: int
    steps: list[dict[str, Any]]  # {id, title, done, deadline, overdue}
    cells: list[DayCell]  # count goals: the window; streak goals: last `target` days


class HistoryItem(BaseModel):
    goal_id: uuid.UUID
    goal_title: str
    by: str
    what: str
    at: str


class GoalsView(BaseModel):
    base: list[GoalCard]
    next: list[GoalCard]
    archived: list[GoalCard]
    history: list[HistoryItem]
    base_holds: bool  # base held > 70% for the last 14 days (hint to start the next stage)


class TaskCounts(BaseModel):
    inbox: int
    today: int
    overdue: int
    overdue_critical: int
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
    critical_today: int


class ProfileHabit(BaseModel):
    id: uuid.UUID
    name: str
    type: str
    active: bool
    sphere_name: str | None
    schedule_label: str
    streak: int


class ProfileSphere(BaseModel):
    id: uuid.UUID
    name: str
    count: int  # habits + open tasks in the sphere


class ProfileView(BaseModel):
    goals: list[GoalCard]
    goals_total: int
    tasks: TaskCounts
    habits: list[ProfileHabit]
    spheres: list[ProfileSphere]
