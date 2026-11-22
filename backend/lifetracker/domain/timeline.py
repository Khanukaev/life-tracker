"""Day timeline helpers (from the reference app's timeline rendering): free gaps
between timed tasks and the energy window the user is in right now."""

from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date

from lifetracker.domain.dates import DAY_START_MIN
from lifetracker.domain.energy import EnergyDay, Window
from lifetracker.domain.model import Task

MIN_GAP = 20


@dataclass(slots=True)
class Gap:
    start: float
    end: float
    zone: str | None  # dominant energy zone of the gap


def free_gaps(e: EnergyDay, tasks: Sequence[Task], k: date) -> list[Gap]:
    timed = sorted(
        ((t.start, t.start + (t.dur or 30)) for t in tasks if t.date == k and t.start is not None),
        key=lambda x: x[0],
    )
    g0: float = max(e.wake, DAY_START_MIN)
    raw: list[tuple[float, float]] = []
    for a, b in timed:
        if a > g0:
            raw.append((g0, min(a, e.bed)))
        g0 = max(g0, b)
    if g0 < e.bed:
        raw.append((g0, e.bed))
    gaps: list[Gap] = []
    for ga, gb in raw:
        if gb - ga < MIN_GAP:
            continue
        zones: Counter[str] = Counter()
        m = ga
        while m < gb:
            z = e.zone_at(m)
            if z and z != "sleep":
                zones[z] += 1
            m += 5
        gaps.append(Gap(ga, gb, zones.most_common(1)[0][0] if zones else None))
    return gaps


def window_at(e: EnergyDay, minute: float) -> Window | None:
    return next((w for w in e.windows if w.start <= minute < w.end), None)


def next_window(
    e: EnergyDay, minute: float, zone: str | None = None, min_len: int = 30
) -> Window | None:
    return next(
        (
            w
            for w in e.windows
            if w.start > minute and w.end - w.start >= min_len and (zone is None or w.zone == zone)
        ),
        None,
    )
