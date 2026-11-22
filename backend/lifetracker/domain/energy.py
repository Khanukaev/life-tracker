"""Alertness model for a day (port of `energyDay`).

Three-process model (Åkerstedt–Folkard, based on Borbély):
* S — sleep pressure: rises while awake, dissipates while asleep;
* C — circadian rhythm: 24 h cosine + 12 h harmonic, phase from the weighted
  mid-sleep of the last 7 nights (body clocks lag behind schedule changes);
* W — sleep inertia right after waking up;
minus penalties for sleep debt, late bedtime, irregular schedule, oversleeping and
poor quality, plus the personal correction learned from "How do you feel?" answers.

The output index 0–100 is split into Focus / Steady / Recharge zones relative to the
day itself (quantiles), merged into windows, and used for slot suggestions.

Operation order deliberately mirrors the JavaScript original so that results are
bit-for-bit identical (see the golden tests).
"""

import math
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from lifetracker.domain.dates import (
    DAY_START_MIN,
    STEP,
    add_days,
    fmt_dur,
    idx_of,
    js_round,
    task_min,
)
from lifetracker.domain.model import Ctx
from lifetracker.domain.sleep import Night, night_for, planned_night

La, Ha, D_RISE, D_REC, M_AMP, Wc, Wd, A0, Ar = 2.4, 14.3, 0.0353, 0.381, 2.5, -5.72, 1.51, 3, 11.5
UNIT2PTS = 100 / Ar
FEEL_T = {"low": 30, "ok": 58, "high": 82}
W7 = (0.3, 0.2, 0.15, 0.12, 0.1, 0.08, 0.05)
DAY_END_MIN = 29 * 60  # 05:00 of the next day


def to_idx(a: float) -> float:
    return (a - A0) / Ar * 100


def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def bucket_of(h_since_wake: float) -> int:
    """Personal correction buckets: 0–3 h / 3–7 / 7–11 / 11+ h after waking."""
    return 0 if h_since_wake < 3 else 1 if h_since_wake < 7 else 2 if h_since_wake < 11 else 3


def _sig(x: float) -> float:
    if x < -700:  # JS: 1 / (1 + Infinity) = 0; Python would overflow
        return 0.0
    return 1 / (1 + math.exp(-x))


def to_fixed1(x: float) -> str:
    """JavaScript `Number.prototype.toFixed(1)` (ties away from zero on the exact value)."""
    return str(Decimal(x).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))


@dataclass(slots=True)
class Point:
    m: int
    asleep: bool
    idx: int | None
    raw: float
    C: float
    S: float
    zone: str = "steady"
    mel: float = 0.0
    cort: float = 0.0
    mot: float = 0.0
    alert: float = 0.0


@dataclass(slots=True)
class Window:
    zone: str
    start: int
    end: int
    sum: int
    n: int
    avg: int = 0


@dataclass(slots=True)
class Train:
    start: float
    end: float
    score: float


@dataclass(slots=True)
class Factor:
    key: str
    label: str
    val: int
    note: str


@dataclass(slots=True)
class EnergyDay:
    day: date
    pts: list[Point]
    wake: float
    bed: float
    night: Night
    tonight: Night
    windows: list[Window]
    train: Train | None
    avg: int | None
    max: int
    max_at: int | None
    min: int
    min_at: int | None
    factors: list[Factor]
    acro: float
    # Extras for the UI (not in the original return value, same computation):
    q_hi: int = 50
    q_lo: int = 50
    dlmo: float = 0.0  # modelled melatonin onset, minutes of the day
    debt_h: float = 0.0
    late_min: float = 0.0
    irr_sd_h: float | None = None

    def at(self, m: float) -> Point | None:
        """Point at minute `m` (like `e.at`, out of range -> None)."""
        i = js_round((m - DAY_START_MIN) / STEP)
        return self.pts[i] if 0 <= i < len(self.pts) else None

    def idx_at(self, m: float) -> int | None:
        p = self.at(js_round(m / STEP) * STEP)
        return p.idx if p else None

    def zone_at(self, m: float) -> str | None:
        p = self.at(js_round(m / STEP) * STEP)
        return p.zone if p else None


def energy_day(day: date, ctx: Ctx, *, no_feel: bool = False) -> EnergyDay:
    st = ctx.settings
    base = idx_of(day) * 1440

    # nights D-4 … D+1
    nights: list[tuple[int, Night]] = []
    for i in range(-4, 2):
        k = add_days(day, i)
        nights.append((idx_of(k) * 1440, night_for(k, ctx)))
    n_d, n_next = nights[4][1], nights[5][1]
    wake_d, bed_next = n_d.wake, 1440 + n_next.bed

    # circadian phase: weighted mid-sleep of 7 nights
    ms = bed_h = wake_h = wsum = 0.0
    mids: list[float] = []
    for i in range(7):
        n = n_d if i < 1 else night_for(add_days(day, -i), ctx)
        ms += W7[i] * (n.bed + n.wake) / 2
        bed_h += W7[i] * n.bed
        wake_h += W7[i] * n.wake
        wsum += W7[i]
        if n.real:
            mids.append((n.bed + n.wake) / 2)
    ms /= wsum
    bed_h /= wsum
    wake_h /= wsum
    acro = ms + 13.8 * 60

    def circ(m: float) -> float:
        return M_AMP * math.cos(2 * math.pi * (m - acro) / 1440) + 1.0 * math.cos(
            4 * math.pi * (m - (acro - 510)) / 1440
        )

    # process S
    sleep_abs = [(off + n.bed, off + n.wake) for off, n in nights]

    def asleep_at(t: float) -> bool:
        return any(a <= t < b for a, b in sleep_abs)

    t = base - 4 * 1440 + 12 * 60
    s_val = 10.0
    end = base + DAY_END_MIN
    s_map: dict[int, float] = {}
    dt = STEP / 60
    while t <= end:
        if asleep_at(t):
            s_val = Ha - (Ha - s_val) * math.exp(-D_REC * dt)
        else:
            s_val = La + (s_val - La) * math.exp(-D_RISE * dt)
        t += STEP
        if t >= base + DAY_START_MIN:
            s_map[t - base] = s_val

    # penalties
    need = (st.sleep_need_h or 8) * 60
    debt = 0.0
    for i in range(7):
        n = n_d if i < 1 else night_for(add_days(day, -i), ctx)
        debt += max(0, need - n.dur) / 60 * math.pow(0.85, i)
    p_debt = min(3, 0.3 * debt)
    dur_h = n_d.dur / 60
    p_over = min(1.5, 0.5 * (dur_h - 9.5)) if dur_h > 9.5 else 0
    p_irr = 0.0
    sd: float | None = None
    if len(mids) >= 3:
        mu = sum(mids) / len(mids)
        sd = math.sqrt(sum((b - mu) ** 2 for b in mids) / len(mids)) / 60
        p_irr = min(1.5, 0.5 * sd)
    goal_bed = planned_night(st).bed
    late = (n_d.bed - goal_bed) / 60
    p_late = min(1.5, 0.35 * late) if late > 0 else 0
    p_q = 1.0 if n_d.q == "bad" else -0.4 if n_d.q == "good" else 0
    pen = p_debt + p_over + p_irr + p_late + p_q
    bias = st.bias or [0.0, 0.0, 0.0, 0.0]

    rec = ctx.days.get(day)
    feels = (rec.feel if rec else [])[-1:]
    pts: list[Point] = []
    for m in range(DAY_START_MIN, DAY_END_MIN + 1, STEP):
        asleep = asleep_at(base + m)
        since = (m - wake_d) / 60 if m >= wake_d else None
        w = Wc * math.exp(-Wd * since) if since is not None and not asleep else 0
        sv = s_map.get(m, 8)
        cv = circ(m)
        raw = to_idx(sv + cv + w - pen)
        b = (bias[bucket_of(since)] or 0) if since is not None else 0
        idx = raw + b
        if not no_feel and feels:
            f = feels[0]
            fm = task_min(f.t)
            if fm is not None and m >= fm - 60:
                idx += (f.err or 0) * 0.7 * math.exp(-abs(m - fm) / 180)
        pts.append(
            Point(
                m=m,
                asleep=asleep,
                idx=None if asleep else int(clamp(js_round(idx), 3, 100)),
                raw=clamp(raw + b, 0, 100),
                C=cv,
                S=sv,
            )
        )

    # zones, relative to the day's own distribution
    awake = [p for p in pts if not p.asleep and p.m >= wake_d and p.m < bed_next]
    mx, mn, mx_at, mn_at, total = -1, 101, None, None, 0
    for p in awake:
        assert p.idx is not None  # noqa: S101  (awake points always have an index)
        total += p.idx
        if p.idx > mx:
            mx, mx_at = p.idx, p.m
        if p.idx < mn:
            mn, mn_at = p.idx, p.m
    avg = js_round(total / len(awake)) if awake else None
    ordered = sorted(p.idx for p in awake if p.idx is not None)

    def quant(fr: float) -> int:
        return ordered[min(len(ordered) - 1, math.floor(fr * len(ordered)))] if ordered else 50

    q_hi, q_lo = quant(0.64), quant(0.22)
    for p in pts:
        if p.asleep or p.idx is None:
            p.zone = "sleep"
        elif p.idx >= q_hi and p.idx >= 45:
            p.zone = "focus"
        elif (p.idx <= q_lo and p.idx <= mx - 8) or p.idx < 30:
            p.zone = "recharge"
        else:
            p.zone = "steady"

    windows: list[Window] = []
    for p in pts:
        if p.zone == "sleep" or p.idx is None:
            continue
        last = windows[-1] if windows else None
        if last and last.zone == p.zone and last.end == p.m:
            last.end = p.m + STEP
            last.sum += p.idx
            last.n += 1
        else:
            windows.append(Window(zone=p.zone, start=p.m, end=p.m + STEP, sum=p.idx, n=1))
    for win in windows:
        win.avg = js_round(win.sum / win.n)

    def at(m: float) -> Point | None:
        i = js_round((m - DAY_START_MIN) / STEP)
        return pts[i] if 0 <= i < len(pts) else None

    # training: body temperature peak ≈ circadian peak, at least 2.5 h before sleep
    train: Train | None = None
    s_start = math.ceil((wake_d + 120) / 15) * 15
    while s_start + 90 <= bed_next - 150:
        sc, cnt = 0.0, 0
        mm = s_start
        while mm < s_start + 90:
            pt = at(mm)
            if not pt or pt.asleep:
                sc = -1e9
                break
            sc += 0.6 * (pt.C + M_AMP) / (2 * M_AMP) + 0.4 * (pt.idx or 0) / 100
            cnt += 1
            mm += STEP
        if cnt and (not train or sc / cnt > train.score):
            train = Train(start=s_start, end=s_start + 90, score=sc / cnt)
        s_start += 15

    # modelled hormones (estimates, not measurements)
    dlmo, off_m = bed_h - 120, wake_h - 30
    for p in pts:
        mel = 0.0
        for kk in (0, 1):
            mel = max(
                mel, _sig((p.m - (dlmo + 1440 * kk)) / 40) * _sig((off_m + 1440 * kk - p.m) / 50)
            )
        car = 0.45 * math.exp(-(((p.m - (wake_d + 40)) / 50) ** 2))
        cb = 0.15 + 0.4 * (1 + math.cos(2 * math.pi * (p.m - (wake_h + 60)) / 1440)) / 2
        p.cort = clamp(cb + (car if p.m >= wake_d - 30 else 0), 0, 1)
        p.mel = clamp(mel, 0, 1)
        p.mot = 0.05 if p.asleep else clamp(0.45 * p.cort / 0.95 + 0.55 * (p.idx or 0) / 100, 0, 1)
        p.alert = 0.02 if p.asleep else (p.idx or 0) / 100

    quality = {"bad": "плохо", "good": "хорошо"}.get(n_d.q, "нормально")
    factors = [
        Factor(
            "debt",
            "Долг сна за 7 дней",
            -js_round(p_debt * UNIT2PTS),
            to_fixed1(debt) + " ч (взвеш.)",
        ),
        Factor(
            "late",
            "Поздний отбой",
            -js_round(p_late * UNIT2PTS),
            "на " + fmt_dur(late * 60) + " позже цели" if late > 0 else "в норме",
        ),
        Factor(
            "irr",
            "Сбитый режим",
            -js_round(p_irr * UNIT2PTS),
            "разброс середины сна" if len(mids) >= 3 else "мало данных",
        ),
        Factor(
            "over",
            "Пересып",
            -js_round(p_over * UNIT2PTS),
            fmt_dur(n_d.dur) if dur_h > 9.5 else "нет",
        ),
        Factor("q", "Качество сна", -js_round(p_q * UNIT2PTS), quality),
    ]
    return EnergyDay(
        day=day, pts=pts, wake=wake_d, bed=bed_next, night=n_d, tonight=n_next,
        windows=windows, train=train, avg=avg, max=mx, max_at=mx_at, min=mn, min_at=mn_at,
        factors=factors, acro=acro, q_hi=q_hi, q_lo=q_lo, dlmo=dlmo, debt_h=debt,
        late_min=late * 60, irr_sd_h=sd,
    )  # fmt: skip
