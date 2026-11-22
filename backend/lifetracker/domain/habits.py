"""Habit rules: schedules, statuses, streaks and completion rates (ported 1:1).

Statuses of a habit on a day:
    done | missed | rest (not scheduled) | pending (today, or bedtime awaiting the
    next morning's sleep entry) | nodata (before the start of history) | future
"""

import math
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date
from typing import Any

from lifetracker.domain.dates import add_days, idx_of, js_round
from lifetracker.domain.enums import HabitType, ScheduleKind
from lifetracker.domain.model import Ctx, Habit, HabitId
from lifetracker.domain.sleep import parse_night, planned_night

STREAK_LOOKBACK = 400
MISS_LOOKBACK = 60


def glasses_need(h: Habit) -> int:
    return max(1, math.ceil(float(h.config["target_l"]) / float(h.config["glass_l"]) - 1e-9))


def minutes_need(h: Habit) -> int:
    return int(h.config["target_min"])


def value_of(h: Habit, k: date, ctx: Ctx) -> Any:
    d = ctx.days.get(k)
    return d.values.get(h.id) if d else None


def habit_done_raw(h: Habit, k: date, ctx: Ctx) -> bool | None:
    """Whether the habit is fulfilled on day `k`; None = can't know yet (bedtime)."""
    v = value_of(h, k, ctx)
    match h.type:
        case HabitType.BEDTIME:
            nxt = ctx.days.get(add_days(k, 1))
            n = parse_night(nxt.sleep if nxt else None)
            if n is None:
                return None
            return n.bed <= planned_night(ctx.settings).bed
        case HabitType.WATER:
            return (v or 0) >= glasses_need(h)
        case HabitType.MINUTES:
            return v is not None and v >= minutes_need(h)
        case HabitType.DUAL:
            return bool(v and v.get("a") and v.get("b"))
        case _:
            return bool(v)


def habit_due(h: Habit, k: date, ctx: Ctx) -> bool:
    if h.sched == ScheduleKind.EVERY:
        n = h.sched_n or 2
        for i in range(1, n):
            pk = add_days(k, -i)
            if pk < ctx.start_date:
                break
            if habit_done_raw(h, pk, ctx):
                return False
        return True
    if h.sched == ScheduleKind.CYCLE:
        p = h.sched_pattern or "1"
        anchor = h.sched_anchor or ctx.start_date
        return p[(idx_of(k) - idx_of(anchor)) % len(p)] == "1"
    return True


def habit_status(h: Habit, k: date, ctx: Ctx) -> str:
    if k < ctx.start_date:
        return "nodata"
    if k > ctx.today:
        return "future"
    due = habit_due(h, k, ctx)
    done = habit_done_raw(h, k, ctx)
    if done:
        return "done"
    if not due:
        return "rest"
    if h.type == HabitType.BEDTIME and done is None and add_days(k, 1) >= ctx.today:
        return "pending"
    if k == ctx.today:
        return "pending"
    return "missed"


def active_habits(ctx: Ctx) -> list[Habit]:
    return [h for h in ctx.habits if h.active]


def day_ok(ids: Iterable[HabitId], k: date, ctx: Ctx) -> str:
    """A day counts for a set of habits when none is missed: ok, pending, missed, nodata."""
    pending = False
    for hid in ids:
        h = ctx.habit(hid)
        if h is None:
            continue
        s = habit_status(h, k, ctx)
        if s in ("missed", "nodata"):
            return s
        if s == "pending":
            pending = True
    return "pending" if pending else "ok"


def streak_of(ids: Iterable[HabitId], ctx: Ctx, upto: date | None = None) -> int:
    """Consecutive ok days back from `upto` (default today). Pending days are skipped:
    today is not closed yet, and yesterday's bedtime waits for this morning's sleep."""
    keys = list(ids)
    k, n = upto or ctx.today, 0
    for _ in range(STREAK_LOOKBACK):
        s = day_ok(keys, k, ctx)
        if s == "ok":
            n += 1
        elif s != "pending":
            break
        k = add_days(k, -1)
        if k < ctx.start_date:
            break
    return n


def best_streak(ids: Iterable[HabitId], ctx: Ctx) -> int:
    keys = list(ids)
    best = cur = 0
    k = ctx.start_date
    while k <= ctx.today:
        s = day_ok(keys, k, ctx)
        if s == "ok":
            cur += 1
            best = max(best, cur)
        elif s != "pending":
            cur = 0
        k = add_days(k, 1)
    return best


@dataclass(slots=True)
class Rate:
    done: int
    miss: int
    pct: int | None


def habit_rate_range(h: Habit, ctx: Ctx, start: date, end: date) -> Rate:
    """Done vs missed over [start, end]; rest days are not counted."""
    done = miss = 0
    k = end
    while k >= start:
        s = habit_status(h, k, ctx)
        if s == "done":
            done += 1
        elif s == "missed":
            miss += 1
        k = add_days(k, -1)
    pct = js_round(done / (done + miss) * 100) if done + miss else None
    return Rate(done=done, miss=miss, pct=pct)


def habit_rate(h: Habit, ctx: Ctx, n: int) -> Rate:
    """`habitRate`: the last `n` days including today."""
    return habit_rate_range(h, ctx, add_days(ctx.today, -(n - 1)), ctx.today)


def miss_run(h: Habit, ctx: Ctx) -> int:
    """Missed days in a row (rest and pending days don't break the run)."""
    n, k = 0, ctx.today
    for _ in range(MISS_LOOKBACK):
        s = habit_status(h, k, ctx)
        if s == "missed":
            n += 1
        elif s not in ("rest", "pending"):
            break
        k = add_days(k, -1)
    return n
