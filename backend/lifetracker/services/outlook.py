"""«План» and «Итоги»: each is one snapshot plus a couple of small lookups — no N+1.

The app counts on its own (percentages, comparisons, what lags); short phrases here sum
that up in plain words when Claude has not written a review for the period.
"""

import calendar
import uuid
from datetime import date, datetime, time, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from lifetracker.db.models import Review
from lifetracker.domain.dates import MONTHS, add_days, fmt_hm, js_round
from lifetracker.domain.enums import NoteKind, ReviewAuthor, ReviewKind
from lifetracker.domain.habits import active_habits, best_streak, habit_due, habit_status, streak_of
from lifetracker.domain.insights import plural
from lifetracker.domain.model import Task
from lifetracker.domain.score import day_score
from lifetracker.domain.sleep import parse_night, planned_night
from lifetracker.schemas.claude import NoteOut, ReviewOut
from lifetracker.schemas.outlook import (
    DayDot,
    HabitLine,
    HabitsBlock,
    NightOut,
    PlanDay,
    PlanView,
    ResultsView,
    SleepBlock,
    TasksBlock,
)
from lifetracker.schemas.tasks import TaskOut
from lifetracker.services import mcp_tokens, notes
from lifetracker.services.clock import user_now
from lifetracker.services.snapshot import Snapshot, load_snapshot

PLAN_DAYS = 30
MONTH_NOM = (
    "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
    "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
)  # fmt: skip
MONTH_DAT = (
    "январю", "февралю", "марту", "апрелю", "маю", "июню",
    "июлю", "августу", "сентябрю", "октябрю", "ноябрю", "декабрю",
)  # fmt: skip
MONTH_GEN = (
    "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря",
)  # fmt: skip
WEEKDAY_ACC = ("понедельник", "вторник", "среду", "четверг", "пятницу", "субботу", "воскресенье")


def _task_out(snap: Snapshot, t: Task) -> TaskOut:
    return TaskOut.model_validate(snap.task_rows[t.id])  # type: ignore[index]


# ---------- «План» ----------


async def plan_view(session: AsyncSession, user_id: uuid.UUID, now: datetime) -> PlanView:
    """Only what is ahead: overdue, the next days with their habit counts, no date."""
    today = (await user_now(session, user_id, now)).day
    last = add_days(today, PLAN_DAYS)
    snap = await load_snapshot(session, user_id, now, until=last, inbox=True)
    ctx = snap.ctx
    habits = active_habits(ctx)
    by_day: dict[date, list[Task]] = {}
    overdue: list[Task] = []
    for t in snap.tasks:
        if t.date is None:
            continue
        if t.date < today and not t.done:
            overdue.append(t)
        elif today < t.date <= last:
            by_day.setdefault(t.date, []).append(t)

    def order(ts: list[Task]) -> list[Task]:
        return sorted(
            ts, key=lambda t: (t.done, not t.important, t.start if t.start is not None else 9999)
        )

    days = []
    for i in range(1, PLAN_DAYS + 1):
        k = add_days(today, i)
        days.append(
            PlanDay(
                date=k,
                tasks=[_task_out(snap, t) for t in order(by_day.get(k, []))],
                habits=sum(1 for h in habits if habit_due(h, k, ctx)),
            )
        )
    overdue.sort(key=lambda t: (t.date, not t.important))
    return PlanView(
        today=today,
        overdue=[_task_out(snap, t) for t in overdue],
        days=days,
        inbox=[TaskOut.model_validate(t) for t in snap.inbox_rows],
    )


# ---------- «Итоги» ----------


def _days_word(n: int) -> str:
    return f"{n} {plural(n, 'день', 'дня', 'дней')}"


def _hm(t: time | None) -> str | None:
    return t.strftime("%H:%M") if t else None


def bounds(period: str, anchor: date) -> tuple[date, date]:
    if period == "week":
        start = anchor - timedelta(days=anchor.weekday())
        return start, start + timedelta(days=6)
    start = anchor.replace(day=1)
    return start, anchor.replace(day=calendar.monthrange(anchor.year, anchor.month)[1])


def _prev_start(period: str, start: date) -> date:
    return (
        start - timedelta(days=7)
        if period == "week"
        else (start - timedelta(days=1)).replace(day=1)
    )


def _days(a: date, b: date) -> list[date]:
    return [a + timedelta(days=i) for i in range((b - a).days + 1)] if b >= a else []


def _avg(xs: list[int]) -> int | None:
    return js_round(sum(xs) / len(xs)) if xs else None


def _label(period: str, start: date, end: date, upto: date) -> str:
    if period == "month":
        return f"{MONTH_NOM[start.month - 1]}, 1–{upto.day}"
    if start.month == end.month:
        return f"Неделя, {start.day}–{end.day} {MONTHS[end.month - 1]}"
    return f"Неделя, {start.day} {MONTHS[start.month - 1]} – {end.day} {MONTHS[end.month - 1]}"


def _score_avg(snap: Snapshot, days: list[date]) -> int | None:
    pcts = [s.pct for d in days if (s := day_score(d, snap.ctx, snap.tasks)) is not None]
    return _avg(pcts)


def _habits_block(
    snap: Snapshot, start: date, upto: date, prev: tuple[date, date], period: str
) -> HabitsBlock:
    ctx = snap.ctx
    days = _days(start, upto)
    rows = {h.id: h for h in snap.habit_rows}
    lines: list[HabitLine] = []
    for h in active_habits(ctx):
        cells = [habit_status(h, d, ctx) for d in days]
        done = cells.count("done")
        of = done + cells.count("missed") + cells.count("pending")
        row = rows.get(h.id)  # type: ignore[call-overload]
        lines.append(
            HabitLine(
                id=h.id, name=h.name, type=h.type, cells=cells, done=done, of=of,
                streak=streak_of([h.id], ctx), best=best_streak([h.id], ctx),
                remind_at=_hm(row.remind_at if row is not None else None),
            )
        )  # fmt: skip
    dots = []
    for i, d in enumerate(days):
        st = [ln.cells[i] for ln in lines]
        due = [s for s in st if s in ("done", "missed", "pending")]
        ok = (
            None
            if not due or (d == ctx.today and "done" not in st)
            else st.count("done") * 2 > len(due)
        )
        dots.append(DayDot(date=d, ok=ok))
    closed = [ln for ln in lines if ln.of]
    marks_done = sum(ln.done for ln in lines)
    marks_total = sum(ln.of for ln in lines)
    missed = sum(ln.cells.count("missed") for ln in lines)
    pct = js_round(marks_done / (marks_done + missed) * 100) if marks_done + missed else None

    p_done = p_miss = 0
    for h in active_habits(ctx):
        for d in _days(*prev):
            s = habit_status(h, d, ctx)
            p_done += s == "done"
            p_miss += s == "missed"
    prev_pct = js_round(p_done / (p_done + p_miss) * 100) if p_done + p_miss else None

    best = max(closed, key=lambda ln: (ln.done / ln.of, ln.done), default=None)
    weak = min(closed, key=lambda ln: (ln.done / ln.of, -ln.of), default=None)
    if weak is not None and (weak is best or weak.done * 2 >= weak.of or weak.of < 2):
        weak = None
    since = "с понедельника" if period == "week" else "за месяц"
    lead = motto = weak_text = ""
    if best is not None:
        lead = f"Ровнее всех **{best.name.lower()}**: {_days_word(best.done)} из {best.of}."
        motto = f"{best.name} ты уже держишь."
    if weak is not None:
        lead += f" Проседает **{weak.name.lower()}**: {weak.done} из {weak.of}."
        motto += f" Добавь к нему {weak.name.lower()}."
        weak_text = f"{since.capitalize()} {_days_word(weak.done)} из {weak.of}."
    elif best is not None:
        motto += " Так держать."
    record_line = max(lines, key=lambda ln: ln.best, default=None)
    return HabitsBlock(
        pct=pct, prev_pct=prev_pct, days=dots, lines=lines, marks_done=marks_done,
        marks_total=marks_total, record=record_line.best if record_line else 0,
        record_name=record_line.name if record_line and record_line.best else None,
        weak_id=weak.id if weak else None, lead=lead.strip(), motto=motto.strip(),
        weak_text=weak_text,
    )  # fmt: skip


def _tasks_block(
    snap: Snapshot, start: date, upto: date, prev: tuple[date, date], prev_name: str
) -> TasksBlock:
    ctx = snap.ctx
    ts = [t for t in snap.tasks if t.date and start <= t.date <= upto]
    done = sum(t.done for t in ts)
    imp = [t for t in ts if t.important]
    nor = [t for t in ts if not t.important]
    prev_ts = [t for t in snap.tasks if t.date and prev[0] <= t.date <= prev[1]]
    prev_done = sum(t.done for t in prev_ts) if prev_ts else None
    overdue = sorted(
        (t for t in ts if not t.done and t.date and t.date < ctx.today),
        key=lambda t: t.date or start,
    )
    imp_done = sum(t.done for t in imp)
    lead_parts = []
    if imp:
        lead_parts.append(
            "Все **важные** закрыл." if imp_done == len(imp)
            else f"Из важных не закрыто **{len(imp) - imp_done}**."
        )  # fmt: skip
    if overdue:
        n = len(overdue)
        lead_parts.append(f"Просрочено **{n} {plural(n, 'задача', 'задачи', 'задач')}**.")
    elif ts:
        lead_parts.append("Просроченных нет.")
    motto = (
        f"Закрой {plural(len(overdue), 'этот хвост', 'эти хвосты', 'эти хвосты')} — "
        "и период будет чистым."
        if overdue else ("Важное не упускаешь." if imp and imp_done == len(imp) else "")
    )  # fmt: skip
    return TasksBlock(
        done=done, total=len(ts), prev_done=prev_done,
        important=[imp_done, len(imp)], normal=[sum(t.done for t in nor), len(nor)],
        overdue=[_task_out(snap, t) for t in overdue],
        inbox=[TaskOut.model_validate(t) for t in snap.inbox_rows],
        lead=" ".join(lead_parts), motto=motto,
    )  # fmt: skip


def _sleep_block(
    snap: Snapshot, start: date, upto: date, prev: tuple[date, date], period: str
) -> SleepBlock:
    ctx = snap.ctx
    goal = js_round(planned_night(ctx.settings).bed)
    nights: list[NightOut | None] = []
    for d in _days(start, upto):
        rec = ctx.days.get(d)
        n = parse_night(rec.sleep if rec else None)
        nights.append(
            NightOut(date=d, bed=js_round(n.bed), wake=js_round(n.wake), dur=js_round(n.dur))
            if n
            else None
        )
    real = [n for n in nights if n]
    prev_beds = []
    for d in _days(*prev):
        rec = ctx.days.get(d)
        if (n := parse_night(rec.sleep if rec else None)) is not None:
            prev_beds.append(js_round(n.bed))
    late = sum(1 for n in real if n.bed > goal)
    lead = motto = ""
    if real:
        best = min(real, key=lambda n: n.bed)
        if late == len(real):
            lead = f"Все **{len(real)} {plural(len(real), 'ночь', 'ночи', 'ночей')}** позже нормы."
        elif late:
            lead = f"Позже нормы **{late} {plural(late, 'ночь', 'ночи', 'ночей')} из {len(real)}**."
        else:
            lead = "Все ночи **в норме**."
        lead += f" Раньше всего — в {WEEKDAY_ACC[best.date.weekday()]}: **{fmt_hm(best.bed)}**."
        motto = (
            f"Ляг сегодня до {fmt_hm(goal)} — завтра будет проще." if late * 2 >= len(real)
            else "Отбой держишь — энергия днём будет выше."
        )  # fmt: skip
    return SleepBlock(
        nights=nights, n=len(real), late=late,
        avg_bed=_avg([n.bed for n in real]), avg_wake=_avg([n.wake for n in real]),
        avg_dur=_avg([n.dur for n in real]), prev_avg_bed=_avg(prev_beds), goal_bed=goal,
        lead=lead, motto=motto,
    )  # fmt: skip


async def results_view(
    session: AsyncSession, user_id: uuid.UUID, now: datetime, period: str, anchor: date | None
) -> ResultsView:
    today = (await user_now(session, user_id, now)).day
    anchor = min(anchor or today, today)
    start, end = bounds(period, anchor)
    upto = min(end, today)
    # Trend: 8 weeks or 5 months back; tasks of that whole range in the same snapshot.
    trend_starts = [start]
    for _ in range(7 if period == "week" else 4):
        trend_starts.insert(0, _prev_start(period, trend_starts[0]))
    snap = await load_snapshot(session, user_id, now, tasks_from=trend_starts[0], inbox=True)
    ctx = snap.ctx
    p_start = trend_starts[-2]
    p_end = bounds(period, p_start)[1]
    prev = (p_start, p_end)
    prev_name = "прошлой" if period == "week" else MONTH_DAT[p_start.month - 1]

    days = _days(start, upto)
    avg = _score_avg(snap, days)
    prev_avg = _score_avg(snap, _days(*prev))
    trend = [_score_avg(snap, _days(s, min(bounds(period, s)[1], today))) for s in trend_starts]

    has_marks = any(
        (rec := ctx.days.get(d)) is not None
        and (rec.sleep is not None or any(v for v in rec.values.values()))
        for d in days
    ) or any(t.done for t in snap.tasks if t.date and start <= t.date <= upto)

    habits = _habits_block(snap, start, upto, prev, period)
    tasks = _tasks_block(snap, start, upto, prev, prev_name)
    sleep = _sleep_block(snap, start, upto, prev, period)

    kind = ReviewKind.WEEK if period == "week" else ReviewKind.MONTH
    review = await session.scalar(
        select(Review)
        .where(Review.user_id == user_id, Review.kind == kind, Review.by == ReviewAuthor.CLAUDE,
               Review.date.between(start, end))
        .order_by(Review.at.desc(), Review.id.desc())
        .limit(1)
    )  # fmt: skip
    note = await notes.get_note(session, user_id, NoteKind(period), start)
    token = await mcp_tokens.active_token(session, user_id)

    word = "прошлой недели" if period == "week" else MONTH_GEN[p_start.month - 1]
    lead = ""
    if avg is not None and prev_avg is not None:
        if avg > prev_avg + 2:
            lead = f"Лучше {word}."
        elif avg < prev_avg - 2:
            lead = f"Ниже {word}."
        else:
            lead = f"Почти как {'на прошлой неделе' if period == 'week' else 'в прошлом месяце'}."
    drags = []
    if sleep.n and sleep.late * 2 >= sleep.n:
        drags.append("поздние отбои")
    weak = next((ln for ln in habits.lines if ln.id == habits.weak_id), None)
    if weak is not None:
        drags.append(weak.name.lower())
    if drags:
        lead += f" Вниз тянут {' и '.join(drags)}."
    if avg is None:
        motto = "Начни с одного дела сегодня."
    elif avg >= 80:
        motto = "Сильный темп — держи его."
    elif avg >= 60:
        motto = "Держи темп и подтяни то, что проседает."
    else:
        motto = "Ты можешь больше: пара отметок в день — и итог пойдёт вверх."

    return ResultsView(
        period=period, start=start, end=end, upto=upto, today=today,
        label=_label(period, start, end, upto), prev_name=prev_name, empty=not has_marks,
        avg=avg, prev_avg=prev_avg, trend=trend,
        review=ReviewOut.model_validate(review) if review else None,
        claude_connected=token is not None, lead=lead.strip(), motto=motto,
        note=NoteOut.model_validate(note) if note else None,
        habits=habits, tasks=tasks, sleep=sleep,
    )  # fmt: skip
