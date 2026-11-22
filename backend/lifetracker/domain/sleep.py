"""Sleep nights. Night `k` is the sleep you woke up from on day `k`.

Times are minutes relative to 00:00 of day `k`; a bedtime after 12:00 belongs to
the previous evening and becomes negative (23:00 -> -60).
"""

from dataclasses import dataclass
from datetime import date

from lifetracker.domain.dates import add_days, js_round
from lifetracker.domain.model import Ctx, Settings, SleepRec


@dataclass(slots=True)
class Night:
    bed: float
    wake: float
    dur: float
    q: str = "ok"
    real: bool = False
    planned: bool = False


def parse_night(sl: SleepRec | None) -> Night | None:
    if sl is None:
        return None
    bed = sl.bed - 1440 if sl.bed >= 12 * 60 else sl.bed
    if sl.wake <= bed:
        return None
    return Night(bed=bed, wake=sl.wake, dur=sl.wake - bed, q=sl.q or "ok", real=True)


def planned_night(st: Settings) -> Night:
    bed = st.bed_target - 1440 if st.bed_target >= 12 * 60 else st.bed_target
    dur = js_round(st.sleep_need_h * 60)
    return Night(bed=bed, wake=bed + dur, dur=dur, planned=True)


def _sleep_of(ctx: Ctx, k: date) -> SleepRec | None:
    d = ctx.days.get(k)
    return d.sleep if d else None


def usual_night(k: date, ctx: Ctx) -> Night:
    """Average of the last 7 real nights, or the user's usual schedule when there are none."""
    xs = [n for i in range(1, 8) if (n := parse_night(_sleep_of(ctx, add_days(k, -i))))]
    if not xs:
        st = ctx.settings
        n = parse_night(SleepRec(bed=st.usual_bed, wake=st.usual_wake))
        if n is None:  # degenerate usual schedule: fall back to the planned night
            return planned_night(st)
        n.real = False
        return n
    bed = sum(n.bed for n in xs) / len(xs)
    wake = sum(n.wake for n in xs) / len(xs)
    return Night(bed=bed, wake=wake, dur=wake - bed)


def night_for(k: date, ctx: Ctx) -> Night:
    n = parse_night(_sleep_of(ctx, k))
    if n:
        return n
    if k > ctx.today:
        return planned_night(ctx.settings)
    return usual_night(k, ctx)
