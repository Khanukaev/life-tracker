"""Task timing: overdue checks, busy intervals and energy-aware slot suggestions."""

import math
from collections.abc import Callable, Hashable, Sequence
from dataclasses import dataclass
from datetime import date

from lifetracker.domain.dates import add_days, js_round
from lifetracker.domain.energy import EnergyDay
from lifetracker.domain.enums import EnergyZone
from lifetracker.domain.model import Ctx, Task

GOOD_FIT = 0.6
EnergyFn = Callable[[date], EnergyDay]


def task_end(t: Task) -> int | None:
    return None if t.start is None else t.start + (t.dur or 30)


def is_overdue(t: Task, ctx: Ctx) -> bool:
    if t.done or t.date is None:
        return False
    if t.date < ctx.today:
        return True
    end = task_end(t)
    return t.date == ctx.today and end is not None and end < ctx.now_min


def busy_on(
    tasks: Sequence[Task], k: date, exclude: Hashable | None = None
) -> list[tuple[int, int]]:
    out = [
        (t.start, t.start + (t.dur or 30))
        for t in tasks
        if t.date == k and t.start is not None and t.id != exclude
    ]
    return sorted(out, key=lambda x: x[0])


@dataclass(slots=True)
class Slot:
    day: date
    start: int
    end: int
    fit: float  # share of the slot inside the requested energy zone
    avg: int
    score: float
    zone: str | None


def suggest_slot(
    k: date,
    dur: int,
    energy: EnergyZone | str,
    ctx: Ctx,
    tasks: Sequence[Task],
    energy_of: EnergyFn,
    exclude: Hashable | None = None,
) -> Slot | None:
    """Best free slot on day `k` (port of `suggestSlot`): fit to the zone first,
    then energy level, with a slight preference for earlier times."""
    e = energy_of(k)
    dur = dur or 30
    frm = math.ceil((e.wake + 15) / 15) * 15
    if k == ctx.today:
        frm = max(frm, math.ceil((ctx.now_min + 10) / 15) * 15)
    to = e.bed - 15
    busy = busy_on(tasks, k, exclude)
    best: Slot | None = None
    s = frm
    while s + dur <= to:
        if any(s < b and s + dur > a for a, b in busy):
            s += 15
            continue
        match = n = total = 0
        m = s
        while m < s + dur:
            p = e.at(m)
            if not p or p.zone == "sleep" or p.idx is None:
                n = -1
                break
            n += 1
            total += p.idx
            if p.zone == energy:
                match += 1
            m += 5
        if n > 0:
            fit, avg = match / n, total / n
            bonus = (
                avg / 100 if energy == "focus" else (100 - avg) / 200 if energy == "recharge" else 0
            )
            score = fit * 2 + bonus - (s - frm) / 1440 * 0.6
            if best is None or score > best.score:
                best = Slot(k, s, s + dur, fit, js_round(avg), score, e.zone_at(s))
        s += 15
    return best


@dataclass(slots=True)
class SlotSuggestion:
    best: Slot | None  # on the requested day
    alternative: Slot | None  # next day, offered when the requested day fits poorly


def suggest_with_fallback(
    k: date,
    dur: int,
    energy: EnergyZone | str,
    ctx: Ctx,
    tasks: Sequence[Task],
    energy_of: EnergyFn,
    exclude: Hashable | None = None,
) -> SlotSuggestion:
    """Decision #5: if the day's best slot fits the zone < 60%, also look at the next day."""
    best = suggest_slot(k, dur, energy, ctx, tasks, energy_of, exclude)
    alt = None
    if best is None or best.fit < GOOD_FIT:
        nxt = suggest_slot(add_days(k, 1), dur, energy, ctx, tasks, energy_of, exclude)
        if nxt and (best is None or nxt.fit > best.fit):
            alt = nxt
    return SlotSuggestion(best, alt)


@dataclass(slots=True)
class ZoneLoad:
    zone: str
    task_ids: list[Hashable]
    need_min: int  # minutes of unfinished tasks of this energy type
    free_min: int  # free minutes of this zone left today

    @property
    def over(self) -> bool:
        return self.need_min > self.free_min


def energy_left(ctx: Ctx, tasks: Sequence[Task], e: EnergyDay) -> list[ZoneLoad]:
    """Unfinished tasks (today and overdue) per energy type vs today's remaining windows."""
    left = [t for t in tasks if not t.done and t.date is not None and t.date <= ctx.today]
    busy = busy_on(tasks, ctx.today)
    out: list[ZoneLoad] = []
    for z in ("focus", "steady", "recharge"):
        ts = [t for t in left if (t.energy or "steady") == z]
        need = sum(t.dur or 30 for t in ts)
        free = 0
        m: float = max(ctx.now_min, e.wake)
        while m < e.bed:
            if e.zone_at(m) == z and not any(a <= m < b for a, b in busy):
                free += 5
            m += 5
        out.append(ZoneLoad(z, [t.id for t in ts], need, free))
    return out
