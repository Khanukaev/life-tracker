"""Screen builders: Day, Now, Review. Each is one snapshot + pure domain functions."""

import calendar
import math
import uuid
from datetime import date, datetime, timedelta
from typing import cast

from sqlalchemy.ext.asyncio import AsyncSession

from lifetracker.domain.dates import MONTHS, add_days, fmt_date, fmt_date_short, js_round
from lifetracker.domain.energy import Window, bucket_of
from lifetracker.domain.enums import EnergyZone, Importance
from lifetracker.domain.habits import (
    active_habits,
    best_streak,
    habit_due,
    habit_rate_range,
    habit_status,
    streak_of,
    value_of,
)
from lifetracker.domain.insights import weak_spots
from lifetracker.domain.model import Task
from lifetracker.domain.phrases import phrase_pool
from lifetracker.domain.score import bed_gain, day_score, gains, week_scores
from lifetracker.domain.sleep import parse_night, planned_night
from lifetracker.domain.slots import Slot, is_overdue, suggest_with_fallback
from lifetracker.domain.timeline import free_gaps, next_window, window_at
from lifetracker.schemas.days import SleepOut
from lifetracker.schemas.habits import HabitOut
from lifetracker.schemas.tasks import TaskOut
from lifetracker.schemas.views import (
    AlertOut,
    DayTask,
    DayView,
    FactorOut,
    FeelOut,
    GainOut,
    GapOut,
    HabitRow,
    HormonesOut,
    NightDot,
    NowCard,
    NowView,
    ReviewHabit,
    ReviewView,
    ScoreItemOut,
    ScoreOut,
    SlotOut,
    SlotView,
    TimelineOut,
    WeekBar,
    ZoneSpan,
)
from lifetracker.services.snapshot import Snapshot, load_snapshot

CRITICAL_LIMIT = 3  # "Когда всё важно — ничего не важно"
RANK = {Importance.CRITICAL: 0, Importance.IMPORTANT: 1, Importance.NORMAL: 2}


def _hhmm(minutes: int) -> str:
    x = minutes % 1440
    return f"{x // 60:02d}:{x % 60:02d}"


def _day_tasks(snap: Snapshot, k: date) -> list[DayTask]:
    e = snap.energy(k)
    ts = sorted(
        (t for t in snap.tasks if t.date == k),
        key=lambda t: (t.done, RANK[t.importance], t.start if t.start is not None else 9999),
    )
    out = []
    for t in ts:
        zone = e.zone_at(t.start) if t.start is not None else None
        out.append(
            DayTask(
                **TaskOut.model_validate(snap.task_rows[cast(uuid.UUID, t.id)]).model_dump(),
                overdue=is_overdue(t, snap.ctx),
                low_energy=t.energy == EnergyZone.FOCUS and zone in ("recharge", "sleep"),
            )
        )
    return out


def _score(snap: Snapshot, k: date) -> ScoreOut | None:
    ctx = snap.ctx
    sc = day_score(k, ctx, snap.tasks)
    if sc is None:
        return None
    prev = day_score(add_days(k, -1), ctx, snap.tasks)
    week = week_scores(k, ctx, snap.tasks)
    known = [s.pct for _, s in week if s]
    gs = gains(sc) if k == ctx.today else []
    return ScoreOut(
        pct=sc.pct,
        delta=sc.pct - prev.pct if prev else None,
        avg7=js_round(sum(known) / len(known)) if len(known) > 1 else None,
        week=[WeekBar(date=d, pct=s.pct if s else None) for d, s in week],
        items=[
            ScoreItemOut(
                kind=x.kind,
                ref=x.ref,
                label=x.label,
                w=x.w,
                v=x.v,
                note=x.note,
                points=sc.points(x),
                max_points=sc.max_points(x),
            )
            for x in sc.items
        ],
        gains=[
            GainOut(kind=g.item.kind, ref=g.item.ref, label=g.item.label, points=g.points)
            for g in gs
        ],
        gains_total=sum(g.points for g in gs),
        bed_gain=bed_gain(sc),
    )


def _habit_rows(snap: Snapshot, k: date) -> list[HabitRow]:
    ctx = snap.ctx
    by_id = {h.id: h for h in snap.habit_rows}
    rows = []
    for h in active_habits(ctx):
        hid = h.id
        rows.append(
            HabitRow(
                id=hid,
                name=h.name,
                type=h.type,
                config=h.config,
                schedule=HabitOut.model_validate(by_id[cast(uuid.UUID, hid)]).schedule,
                status=habit_status(h, k, ctx),
                due=habit_due(h, k, ctx),
                value=value_of(h, k, ctx),
                streak=streak_of([hid], ctx, k),
                streak_base=streak_of([hid], ctx, add_days(k, -1)),
            )
        )
    return rows


def _timeline(snap: Snapshot, k: date) -> TimelineOut:
    e = snap.energy(k)
    now = None
    if k == snap.ctx.today:
        w = window_at(e, snap.ctx.now_min)
        if w is not None:
            nxt = next((x for x in e.windows if x.start >= w.end), None)
            now = NowCard(
                zone=w.zone,
                until=w.end,
                idx=e.idx_at(snap.ctx.now_min),
                next_zone=nxt.zone if nxt else None,
            )
    curve = []
    for i in range(0, len(e.pts), 3):
        curve.append(e.pts[i].idx)
    return TimelineOut(
        wake=e.wake,
        bed=e.bed,
        zones=[ZoneSpan(zone=w.zone, start=w.start, end=w.end, avg=w.avg) for w in e.windows],
        curve=curve,
        free=[GapOut(start=g.start, end=g.end, zone=g.zone) for g in free_gaps(e, snap.tasks, k)],
        now=now,
    )


async def day_view(
    session: AsyncSession, user_id: uuid.UUID, now: datetime, k: date | None
) -> DayView:
    snap = await load_snapshot(session, user_id, now, until=k, tasks_from=k)
    ctx = snap.ctx
    k = k or ctx.today
    relation = "today" if k == ctx.today else "past" if k < ctx.today else "future"
    e = snap.energy(k)

    energy_now = zone_now = None
    if relation == "today":
        p = e.at(math.floor(ctx.now_min / 5) * 5)
        if p:
            energy_now, zone_now = p.idx, p.zone
    elif relation == "past":
        energy_now, zone_now = e.avg, None

    score = _score(snap, k) if relation != "future" else None
    phrases: list[str] = []
    if score is not None and relation == "today":
        sc = day_score(k, ctx, snap.tasks)
        if sc is not None:
            bed_label = _hhmm(ctx.settings.bed_target)
            phrases = phrase_pool(sc, score.delta, ctx, snap.tasks, bed_label=bed_label)

    rec = ctx.days.get(k)
    sleep = None
    if rec and rec.sleep and (n := parse_night(rec.sleep)):
        row_sleep = rec.sleep
        sleep = SleepOut.model_validate(
            {
                "bed": _hhmm(row_sleep.bed),
                "wake": _hhmm(row_sleep.wake),
                "quality": row_sleep.q,
                "duration_min": int(n.dur),
            }
        )
    planned = None
    if sleep is None and relation == "future":
        planned = {"bed": _hhmm(ctx.settings.bed_target), "need_h": ctx.settings.sleep_need_h}

    tasks = _day_tasks(snap, k)
    critical = [t for t in tasks if t.importance == Importance.CRITICAL]
    return DayView(
        date=k,
        today=ctx.today,
        relation=relation,
        now_min=ctx.now_min if relation == "today" else None,
        date_label=fmt_date(k),
        energy_now=energy_now,
        energy_zone=zone_now,
        score=score,
        phrase=phrases[0] if phrases else None,
        phrases=phrases,
        sleep=sleep,
        sleep_planned=planned,
        critical=critical,
        critical_overload=len(critical) > CRITICAL_LIMIT,
        habits=_habit_rows(snap, k) if relation != "future" else [],
        tasks=tasks,
        timeline=_timeline(snap, k),
    )


def _round_list(xs: list[float]) -> list[float]:
    return [round(x, 3) for x in xs]


async def now_view(session: AsyncSession, user_id: uuid.UUID, now: datetime) -> NowView:
    snap = await load_snapshot(session, user_id, now)
    ctx = snap.ctx
    e = snap.energy(ctx.today)
    p = e.at(math.floor(ctx.now_min / 5) * 5)
    w = window_at(e, ctx.now_min)
    nf = next_window(e, ctx.now_min, "focus")
    rec = ctx.days.get(ctx.today)
    last = rec.feel[-1] if rec and rec.feel else None
    since = (ctx.now_min - e.wake) / 60
    bucket = bucket_of(max(0.0, since))
    step = 3  # 15 minutes
    sample = e.pts[::step]
    now_h = (
        {
            "alertness": round(p.alert, 3),
            "motivation": round(p.mot, 3),
            "cortisol": round(p.cort, 3),
            "melatonin": round(p.mel, 3),
        }
        if p
        else None
    )

    def span(x: Window | None) -> ZoneSpan | None:
        return ZoneSpan(zone=x.zone, start=x.start, end=x.end, avg=x.avg) if x else None

    return NowView(
        today=ctx.today,
        now_min=ctx.now_min,
        idx=p.idx if p else None,
        zone=p.zone if p else "sleep",
        window=span(w),
        next_focus=span(nf),
        sleep_logged=bool(rec and rec.sleep),
        last_feel=FeelOut(t=last.t, v=last.v, pred=last.pred, err=last.err) if last else None,
        curve=[x.idx for x in e.pts],
        q_hi=e.q_hi,
        q_lo=e.q_lo,
        avg=e.avg,
        max=e.max,
        max_at=e.max_at,
        min=e.min,
        min_at=e.min_at,
        windows=[
            ZoneSpan(zone=x.zone, start=x.start, end=x.end, avg=x.avg)
            for x in e.windows
            if x.end - x.start >= 30
        ],
        train={"start": e.train.start, "end": e.train.end} if e.train else None,
        factors=[
            FactorOut(key=f.key, label=f.label, val=f.val, note=f.note) for f in e.factors if f.val
        ],
        personal=js_round(ctx.settings.bias[bucket]) if since >= 0 else 0,
        personal_n=ctx.settings.model_n,
        debt_h=round(e.debt_h, 2),
        late_min=round(e.late_min),
        irr_sd_h=round(e.irr_sd_h, 2) if e.irr_sd_h is not None else None,
        hormones=HormonesOut(
            step_min=15,
            alertness=_round_list([x.alert for x in sample]),
            motivation=_round_list([x.mot for x in sample]),
            cortisol=_round_list([x.cort for x in sample]),
            melatonin=_round_list([x.mel for x in sample]),
            now=now_h,
            melatonin_rise=js_round(e.dlmo + 1440) if e.dlmo < 0 else js_round(e.dlmo),
        ),
    )


def period_bounds(period: str, anchor: date) -> tuple[date, date, date, date]:
    """(start, end, prev_anchor, next_anchor) of the calendar week (Mon–Sun) or month."""
    if period == "week":
        start = anchor - timedelta(days=anchor.weekday())
        return (
            start,
            start + timedelta(days=6),
            start - timedelta(days=7),
            start + timedelta(days=7),
        )
    start = anchor.replace(day=1)
    last = calendar.monthrange(anchor.year, anchor.month)[1]
    end = anchor.replace(day=last)
    prev = (start - timedelta(days=1)).replace(day=1)
    return start, end, prev, end + timedelta(days=1)


def period_label(period: str, start: date, end: date) -> str:
    if period == "month":
        return _month_name(start)
    if start.month == end.month:
        return f"{start.day} — {end.day} {MONTHS[end.month - 1]}"
    return f"{fmt_date_short(start)} — {fmt_date_short(end)}"


MONTH_NOMINATIVE = (
    "Январь",
    "Февраль",
    "Март",
    "Апрель",
    "Май",
    "Июнь",
    "Июль",
    "Август",
    "Сентябрь",
    "Октябрь",
    "Ноябрь",
    "Декабрь",
)


def _month_name(d: date) -> str:
    return f"{MONTH_NOMINATIVE[d.month - 1]} {d.year}"


async def review_view(
    session: AsyncSession, user_id: uuid.UUID, now: datetime, period: str, anchor: date | None
) -> ReviewView:
    snap = await load_snapshot(session, user_id, now)
    ctx = snap.ctx
    anchor = anchor or ctx.today
    start, end, prev_a, next_a = period_bounds(period, anchor)
    if start > ctx.today:
        start, end, prev_a, next_a = period_bounds(period, ctx.today)
    if start < ctx.today - timedelta(days=31):  # older periods need older tasks
        snap = await load_snapshot(session, user_id, now, tasks_from=start)
        ctx = snap.ctx
    upto = min(end, ctx.today)
    days = [start + timedelta(days=i) for i in range((end - start).days + 1)]

    scores = [
        WeekBar(date=d, pct=(s.pct if (s := day_score(d, ctx, snap.tasks)) else None)) for d in days
    ]
    known = [b for b in scores if b.pct is not None]
    run = best_run = 0
    for b in scores:
        if b.pct is not None and b.pct >= 70:
            run += 1
            best_run = max(best_run, run)
        elif b.pct is not None:
            run = 0
    best_day = max(known, key=lambda b: b.pct or 0) if known else None

    alerts = weak_spots(
        ctx,
        snap.tasks,
        snap.energy(ctx.today),
        start,
        upto,
        "неделю" if period == "week" else "месяц",
    )
    habits = active_habits(ctx)
    done = miss = 0
    hab_rows = []
    for h in habits:
        r = habit_rate_range(h, ctx, start, upto)
        done, miss = done + r.done, miss + r.miss
        hab_rows.append(
            ReviewHabit(
                id=h.id,
                name=h.name,
                pct=r.pct,
                dots=[habit_status(h, d, ctx) for d in days],
                streak=streak_of([h.id], ctx),
                best=best_streak([h.id], ctx),
            )
        )
    period_tasks: list[Task] = [t for t in snap.tasks if t.date and start <= t.date <= upto]
    t_done = sum(1 for t in period_tasks if t.done)

    goal = planned_night(ctx.settings).bed
    nights = []
    for i in range(13, -1, -1):
        d = add_days(upto, -i)
        rec = ctx.days.get(d)
        n = parse_night(rec.sleep if rec else None)
        nights.append(
            NightDot(date=d, bed=n.bed if n else None, on_time=(n.bed <= goal) if n else None)
        )

    return ReviewView(
        period=period,
        start=start,
        end=end,
        label=period_label(period, start, end),
        prev_anchor=prev_a,
        next_anchor=next_a if next_a <= ctx.today else None,
        scores=scores,
        avg=js_round(sum(b.pct or 0 for b in known) / len(known)) if known else None,
        days_70=sum(1 for b in known if (b.pct or 0) >= 70),
        best_run_70=best_run,
        best_day=best_day,
        alerts=[
            AlertOut(kind=a.kind, title=a.title, subtitle=a.subtitle, severe=a.severe)
            for a in alerts
        ],
        habits_pct=js_round(done / (done + miss) * 100) if done + miss else None,
        tasks_pct=js_round(t_done / len(period_tasks) * 100) if period_tasks else None,
        tasks_done=t_done,
        tasks_total=len(period_tasks),
        habits=hab_rows,
        bed_goal=goal,
        nights=nights,
    )


def _slot(s: Slot | None) -> SlotOut | None:
    if s is None:
        return None
    return SlotOut(
        date=s.day, start=s.start, end=s.end, fit=round(s.fit, 3), avg=s.avg, zone=s.zone
    )


async def slot_view(
    session: AsyncSession,
    user_id: uuid.UUID,
    now: datetime,
    k: date,
    dur: int,
    energy: EnergyZone,
    exclude: uuid.UUID | None,
) -> SlotView:
    snap = await load_snapshot(session, user_id, now, until=k + timedelta(days=1), tasks_from=k)
    s = suggest_with_fallback(k, dur, energy, snap.ctx, snap.tasks, snap.energy, exclude)
    return SlotView(best=_slot(s.best), alternative=_slot(s.alternative))
