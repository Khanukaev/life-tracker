"""«План» (what is ahead) and «Итоги» (a week or a month in numbers)."""

import datetime as dt
import uuid

from pydantic import BaseModel

from lifetracker.schemas.claude import NoteOut, ReviewOut
from lifetracker.schemas.tasks import TaskOut


class PlanDay(BaseModel):
    date: dt.date
    tasks: list[TaskOut]
    habits: int  # habits scheduled that day (cycle rest days are not counted)


class PlanView(BaseModel):
    today: dt.date
    overdue: list[TaskOut]
    days: list[PlanDay]  # tomorrow … +30 days; the client shows a week and folds the rest
    inbox: list[TaskOut]


class DayDot(BaseModel):
    date: dt.date
    ok: bool | None  # more than half of the day's habits done; None = ahead or no habits


class HabitLine(BaseModel):
    id: uuid.UUID
    name: str
    type: str
    # Status per day of the period: done | missed | pending | rest | future | nodata.
    cells: list[str]
    done: int
    of: int  # days that counted (rest days and days ahead do not)
    streak: int
    best: int
    remind_at: str | None


class HabitsBlock(BaseModel):
    pct: int | None
    prev_pct: int | None
    days: list[DayDot]
    lines: list[HabitLine]
    marks_done: int
    marks_total: int
    record: int
    record_name: str | None
    weak_id: uuid.UUID | None
    lead: str
    motto: str
    weak_text: str


class TasksBlock(BaseModel):
    done: int
    total: int
    prev_done: int | None
    important: list[int]  # [done, planned]
    normal: list[int]
    overdue: list[TaskOut]
    inbox: list[TaskOut]
    lead: str
    motto: str


class NightOut(BaseModel):
    date: dt.date
    bed: int  # minutes from 00:00 of the wake-up day (23:30 = -30)
    wake: int
    dur: int


class SleepBlock(BaseModel):
    nights: list[NightOut | None]  # one per day of the period up to today
    n: int
    late: int
    avg_bed: int | None
    avg_wake: int | None
    avg_dur: int | None
    prev_avg_bed: int | None
    goal_bed: int
    lead: str
    motto: str


class ResultsView(BaseModel):
    period: str
    start: dt.date
    end: dt.date
    upto: dt.date
    today: dt.date
    label: str  # "Неделя, 23–29 ноября" · "Ноябрь, 1–25"
    prev_name: str  # "прошлой" · "октябрю" (for "+6 к …")
    empty: bool
    avg: int | None
    prev_avg: int | None
    trend: list[int | None]  # 8 weeks or 5 months, oldest first, the current one last
    review: ReviewOut | None
    claude_connected: bool
    lead: str
    motto: str
    note: NoteOut | None
    habits: HabitsBlock
    tasks: TasksBlock
    sleep: SleepBlock
