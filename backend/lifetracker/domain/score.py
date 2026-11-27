"""Day score ("рейтинг выкладывания"): weighted share of what was done.

Rules (agreed in stage 0, generalising the reference app):
* every habit weighs ×1 (importance is a task notion); the bedtime item is the night
  that ended this morning: full points at the target, zero when 2 h late;
* every task of the day is its own item: important ×3, others ×2;
* count habits (water, minutes, pages…) count partially toward their norm;
* habits resting by schedule are not counted.

The original `dayScore` weighted sleep/study/orders ×3. The golden tests check that
every item and its value match the original, and recompute the percentage with ×1.
"""

from collections.abc import Hashable, Sequence
from dataclasses import dataclass
from datetime import date

from lifetracker.domain.dates import add_days, fmt_hm, js_round
from lifetracker.domain.energy import clamp
from lifetracker.domain.enums import HabitType
from lifetracker.domain.habits import (
    active_habits,
    count_norm,
    habit_status,
    value_of,
)
from lifetracker.domain.model import Ctx, Task
from lifetracker.domain.sleep import parse_night, planned_night

HABIT_WEIGHT = 1
IMPORTANT_TASK_WEIGHT, TASK_WEIGHT = 3, 2


@dataclass(slots=True)
class ScoreItem:
    kind: str  # sleep | habit | task
    ref: Hashable  # habit id or task id
    label: str
    w: int
    v: float  # 0..1
    note: str = ""


@dataclass(slots=True)
class DayScore:
    pct: int
    items: list[ScoreItem]
    W: int

    def points(self, item: ScoreItem) -> int:
        """Points the item brings now (0..max) on the 0–100 scale."""
        return js_round(item.w * item.v / self.W * 100) if self.W else 0

    def max_points(self, item: ScoreItem) -> int:
        return js_round(item.w / self.W * 100) if self.W else 0


def tasks_on(tasks: Sequence[Task], k: date) -> list[Task]:
    return [t for t in tasks if t.date == k]


def day_score(k: date, ctx: Ctx, tasks: Sequence[Task]) -> DayScore | None:
    if k > ctx.today or k < ctx.start_date:
        return None
    rec = ctx.days.get(k)
    items: list[ScoreItem] = []
    habits = active_habits(ctx)

    bedtime = next((h for h in habits if h.type == HabitType.BEDTIME), None)
    if bedtime is not None:
        n = parse_night(rec.sleep if rec else None)
        goal = planned_night(ctx.settings).bed
        v = clamp(1 - max(0, n.bed - goal) / 120, 0, 1) if n else 0
        items.append(
            ScoreItem(
                "sleep", bedtime.id, bedtime.name, HABIT_WEIGHT,
                v, f"лёг в {fmt_hm(n.bed)}" if n else "сон не отмечен",
            )
        )  # fmt: skip

    for h in habits:
        if h.type == HabitType.BEDTIME:
            continue
        s = habit_status(h, k, ctx)
        if s == "rest":
            continue
        val: float = 1 if s == "done" else 0
        note = ""
        raw = value_of(h, k, ctx)
        if h.type == HabitType.COUNT:
            need, got_n = count_norm(h), raw or 0
            val, note = min(1, got_n / need), f"{got_n}/{need}"
        items.append(ScoreItem("habit", h.id, h.name, HABIT_WEIGHT, val, note))

    for t in tasks_on(tasks, k):
        w = IMPORTANT_TASK_WEIGHT if t.important else TASK_WEIGHT
        items.append(ScoreItem("task", t.id, t.title, w, 1 if t.done else 0))

    total_w = sum(x.w for x in items)
    got = sum(x.w * x.v for x in items)
    return DayScore(pct=js_round(got / total_w * 100) if total_w else 0, items=items, W=total_w)


@dataclass(slots=True)
class Gain:
    item: ScoreItem
    points: int


def gains(score: DayScore, limit: int = 4) -> list[Gain]:
    """ "How to raise the score": unfinished items with the biggest possible gain."""
    out = [
        Gain(x, js_round(x.w * (1 - x.v) / score.W * 100))
        for x in score.items
        if x.kind != "sleep" and x.v < 1
    ]
    out = [g for g in out if g.points >= 1]
    out.sort(key=lambda g: -g.points)  # stable, like Array.prototype.sort
    return out[:limit]


def bed_gain(score: DayScore) -> int:
    """Points that going to bed on time tonight brings to tomorrow's score."""
    sleep = next((x for x in score.items if x.kind == "sleep"), None)
    return js_round(sleep.w / score.W * 100) if sleep and score.W else 0


def week_scores(k: date, ctx: Ctx, tasks: Sequence[Task]) -> list[tuple[date, DayScore | None]]:
    return [(add_days(k, -i), day_score(add_days(k, -i), ctx, tasks)) for i in range(6, -1, -1)]
