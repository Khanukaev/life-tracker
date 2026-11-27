"""MCP tools: the user's Claude reads and changes *their own* tracker.

Every tool runs the same `lifetracker.services` as the HTTP API, so the business rules
(logical day 05:00–05:00, score, streaks, energy model) are identical everywhere. The
user comes only from the authenticated token (`current_user`), never from arguments:
an id that belongs to someone else is reported as "not found".

Outputs are compact JSON projections of the app's screens: what Claude needs to reason
about a day, without chart geometry. Times are "HH:MM" in the user's time zone,
dates are ISO "YYYY-MM-DD".
"""

import uuid
from collections.abc import Callable
from contextvars import ContextVar
from datetime import UTC, date, datetime
from typing import Annotated, Any, Literal, cast

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations
from pydantic import Field, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

import lifetracker.services.days as days
import lifetracker.services.habits as habits
import lifetracker.services.journal as journal
import lifetracker.services.notes as notes
import lifetracker.services.reviews as reviews
import lifetracker.services.screens as screens
import lifetracker.services.tasks as tasks
import lifetracker.services.users as users
import lifetracker.services.views as screen_views
from lifetracker.core.errors import AppError
from lifetracker.db.session import get_sessionmaker
from lifetracker.domain.dates import fmt_date_short
from lifetracker.domain.enums import (
    Actor,
    HabitType,
    NoteKind,
    ReviewKind,
    SleepQuality,
)
from lifetracker.schemas.claude import REVIEW_MAX, PlanItem
from lifetracker.schemas.days import SleepIn
from lifetracker.schemas.habits import HabitCreate, HabitOut, HabitUpdate
from lifetracker.schemas.tasks import TaskCreate, TaskOut, TaskUpdate, TaskView
from lifetracker.services.clock import user_now
from lifetracker.services.reminders import mark_value

current_user: ContextVar[uuid.UUID | None] = ContextVar("current_user", default=None)


def utc_now() -> datetime:
    return datetime.now(UTC)


clock: Callable[[], datetime] = utc_now  # tests freeze it

INSTRUCTIONS = """\
Life Tracker: the user's personal tracker of habits, sleep, energy and tasks.
All data belongs to the user who connected this server; you only ever see their data.

Model:
- A *logical day* runs 05:00–05:00 in the user's time zone: 01:30 belongs to the previous date.
- Habits have a type: check (done / not done), count (a daily norm such as 8 glasses of
  water or 20 minutes of reading; each tap in the app adds `step`), bedtime (derived from
  sleep: met when they went to bed by the target time; never logged directly).
  Schedules: daily, weekdays (Mon–Fri), or a cycle like "1101100" (1 = do, 0 = rest).
  Every habit weighs the same in the day score; tasks weigh more (important ones most).
- Sleep of a date = the night that ended on that date's morning (bed, wake, quality).
- Energy is predicted from sleep with a circadian model and split into zones:
  focus (best for hard thinking), steady (routine work), recharge (rest, admin).
- Tasks have a date (or none = inbox), optional start time and duration, `important`
  (top of the list, ×3 in the score) and `fresh` (needs a fresh head: best in a focus zone).
- Day score ("рейтинг", 0–100 %) = weighted share of what was done: sleep, habits, tasks.

Etiquette: answer in the user's language (usually Russian). Prefer reading before
writing. When you change something, say what you changed: every change is also listed
in the app under your next review. Save written analyses with save_review and day
plans with save_plan so the user sees them in the app.
"""

server: MCPServer[Any] = MCPServer(
    name="life-tracker",
    title="Трекер жизни",
    instructions=INSTRUCTIONS,
    version="0.1.0",
)

READ = ToolAnnotations(read_only_hint=True, open_world_hint=False)
WRITE = ToolAnnotations(read_only_hint=False, destructive_hint=False, open_world_hint=False)
UPDATE = ToolAnnotations(
    read_only_hint=False, destructive_hint=False, idempotent_hint=True, open_world_hint=False
)

# ---- plumbing ----


def _uid() -> uuid.UUID:
    uid = current_user.get()
    if uid is None:  # the HTTP layer rejects such requests; this guards direct calls
        raise ToolError("Not authenticated")
    return uid


class _Call:
    """`async with _Call() as (session, user_id, now)`: one DB session per tool call,
    domain errors turned into messages the model can read and act on."""

    async def __aenter__(self) -> tuple[AsyncSession, uuid.UUID, datetime]:
        self._uid = _uid()
        self._cm = get_sessionmaker()()
        self._session = await self._cm.__aenter__()
        return self._session, self._uid, clock()

    async def __aexit__(self, et: Any, exc: Any, tb: Any) -> None:
        await self._cm.__aexit__(et, exc, tb)
        if isinstance(exc, AppError):
            raise ToolError(exc.message) from exc
        if isinstance(exc, ValidationError):
            msgs = "; ".join(f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors())
            raise ToolError(f"Invalid input: {msgs}") from exc


async def _log(s: AsyncSession, uid: uuid.UUID, what: str, now: datetime) -> None:
    """One line in «Что Claude изменил» (shown with Claude's next review)."""
    journal.record(s, uid, what, now)
    await s.commit()


def _on(d: date | None) -> str:
    return f"на {fmt_date_short(d)}" if d else "во входящие"


def _hhmm(minutes: float | None) -> str | None:
    if minutes is None:
        return None
    m = round(minutes) % 1440
    return f"{m // 60:02d}:{m % 60:02d}"


def _task(t: Any) -> dict[str, Any]:
    d = TaskOut.model_validate(t).model_dump(mode="json")
    keep = (
        "id",
        "title",
        "description",
        "date",
        "start_time",
        "duration_min",
        "important",
        "fresh",
        "done",
        "created_by",
    )
    return {k: d[k] for k in keep if d.get(k) not in (None, "")} | {"done": d["done"]}


def _habit(h: Any) -> dict[str, Any]:
    d = HabitOut.model_validate(h).model_dump(mode="json")
    keep = ("id", "name", "type", "config", "schedule", "active")
    return {k: d[k] for k in keep}


# ---- read ----


@server.tool(annotations=READ)
async def get_profile() -> dict[str, Any]:
    """The user's profile: name, time zone, today's logical date, sleep norms
    (bedtime target, sleep need, usual bed/wake), reminder settings and task counters."""
    async with _Call() as (s, uid, now):
        me = await users.get_me(s, uid)
        st = await users.get_settings(s, uid)
        ln = await user_now(s, uid, now)
        counts = await screens.task_counts(s, uid, ln.day)
        return {
            "name": me.first_name,
            "motto": me.motto,
            "timezone": me.timezone,
            "today": ln.day.isoformat(),
            "now": _hhmm(ln.minute),
            "tracking_since": me.start_date.isoformat(),
            "bed_target": st.bed_target.strftime("%H:%M"),
            "sleep_need_h": st.sleep_need_h,
            "usual_bed": st.usual_bed.strftime("%H:%M"),
            "usual_wake": st.usual_wake.strftime("%H:%M"),
            "evening_reminder": me.reminder_time.strftime("%H:%M") if me.reminder_time else None,
            "morning_reminder": me.morning_time.strftime("%H:%M") if me.morning_time else None,
            "week_note_reminder": (
                me.week_note_time.strftime("%H:%M") if me.week_note_time else None
            ),
            "tasks": counts.model_dump(),
        }


async def _day(k: date | None) -> dict[str, Any]:
    async with _Call() as (s, uid, now):
        v = await screen_views.day_view(s, uid, now, k)
    score = None
    if v.score:
        score = {
            "pct": v.score.pct,
            "delta_vs_yesterday": v.score.delta,
            "avg_7d": v.score.avg7,
            "items": [
                {
                    "kind": i.kind,
                    "label": i.label,
                    "points": i.points,
                    "max": i.max_points,
                    **({"note": i.note} if i.note else {}),
                }
                for i in v.score.items
            ],
            "biggest_gains_left": [{"label": g.label, "points": g.points} for g in v.score.gains],
        }
    return {
        "date": v.date.isoformat(),
        "relation": v.relation,
        "now": _hhmm(v.now_min),
        "score": score,
        "hint": v.phrase,
        "sleep": v.sleep.model_dump(mode="json") if v.sleep else None,
        "habits": [
            {
                "id": str(h.id),
                "name": h.name,
                "type": h.type,
                "status": h.status,
                "value": h.value,
                "streak": h.streak,
            }
            for h in v.habits
        ],
        "tasks": [
            _task(t)
            | ({"overdue": True} if t.overdue else {})
            | ({"warning": "focus task in a low-energy time"} if t.low_energy else {})
            for t in v.tasks
        ],
        "energy_zones": [
            {"zone": z.zone, "from": _hhmm(z.start), "to": _hhmm(z.end)} for z in v.timeline.zones
        ],
        "energy_now": v.energy_now,
    }


@server.tool(annotations=READ)
async def get_today() -> dict[str, Any]:
    """Today at a glance: day score with what earned points and what would add the most,
    sleep, each habit's status (done / pending / missed / rest) with value and streak,
    tasks, and the predicted energy zones of the day."""
    return await _day(None)


@server.tool(annotations=READ)
async def get_day(
    date: Annotated[date, Field(description="Logical date, YYYY-MM-DD")],
) -> dict[str, Any]:
    """Any past, present or future day in the same shape as get_today. Future days have
    no score or habit statuses yet, only planned tasks and the energy forecast."""
    return await _day(date)


@server.tool(annotations=READ)
async def get_progress(
    period: Annotated[Literal["week", "month"], Field(description="Calendar week or month")],
    anchor: Annotated[
        date | None, Field(description="Any date inside the period; default today")
    ] = None,
) -> dict[str, Any]:
    """Results of a calendar week or month: daily scores, average, days ≥ 70 %, best run,
    habit completion per habit, task completion, bedtime regularity and
    alerts (weak spots worth attention), and the user's own note about the period
    («Неделя словами»): take it into account and say so with save_review(used_note=true)."""
    async with _Call() as (s, uid, now):
        v = await screen_views.review_view(s, uid, now, period, anchor)
        note = await notes.get_note(s, uid, NoteKind(period), v.start)
    return {
        "period": v.label,
        "user_note": note.body if note else None,
        "from": v.start.isoformat(),
        "to": v.end.isoformat(),
        "scores": {b.date.isoformat(): b.pct for b in v.scores},
        "avg": v.avg,
        "days_at_least_70": v.days_70,
        "best_run_70": v.best_run_70,
        "habits_pct": v.habits_pct,
        "tasks": {"pct": v.tasks_pct, "done": v.tasks_done, "total": v.tasks_total},
        "habits": [
            {"name": h.name, "pct": h.pct, "streak": h.streak, "best": h.best} for h in v.habits
        ],
        "bedtime_target": _hhmm(v.bed_goal),
        "nights_on_time": sum(1 for n in v.nights if n.on_time),
        "nights_logged": sum(1 for n in v.nights if n.on_time is not None),
        "alerts": [a.model_dump(mode="json") for a in v.alerts],
    }


@server.tool(annotations=READ)
async def get_week_summary() -> dict[str, Any]:
    """This calendar week so far (same shape as get_progress for period=week). A good
    starting point for an evening or weekly review."""
    return await get_progress("week")


@server.tool(annotations=READ)
async def get_streaks() -> dict[str, Any]:
    """Current and best streaks per habit. A streak counts consecutive days
    on which a habit was done when due (rest days of a schedule don't break it)."""
    async with _Call() as (s, uid, now):
        v = await screen_views.review_view(s, uid, now, "month", None)
    return {
        "habits": [
            {"id": str(h.id), "name": h.name, "current": h.streak, "best": h.best} for h in v.habits
        ],
    }


@server.tool(annotations=READ)
async def get_energy(
    date: Annotated[date | None, Field(description="YYYY-MM-DD; default today")] = None,
) -> dict[str, Any]:
    """Predicted energy for a day (0–100 index, hourly) and its zones. For today also the
    current zone and the next focus window. The forecast is driven by recent sleep and a
    personal correction learned from the user's "how do you feel" answers."""
    async with _Call() as (s, uid, now):
        today = (await user_now(s, uid, now)).day
        if date is None or date == today:
            n = await screen_views.now_view(s, uid, now)
            hourly = {_hhmm(300 + i * 5): x for i, x in enumerate(n.curve) if i % 12 == 0}
            return {
                "date": n.today.isoformat(),
                "now": _hhmm(n.now_min),
                "index_now": n.idx,
                "zone_now": n.zone,
                "next_focus": {"from": _hhmm(n.next_focus.start), "to": _hhmm(n.next_focus.end)}
                if n.next_focus
                else None,
                "zones": [
                    {"zone": w.zone, "from": _hhmm(w.start), "to": _hhmm(w.end)} for w in n.windows
                ],
                "hourly_index": hourly,
                "sleep_debt_h": n.debt_h,
                "sleep_logged_today": n.sleep_logged,
            }
        v = await screen_views.day_view(s, uid, now, date)
    tl = v.timeline
    return {
        "date": v.date.isoformat(),
        "zones": [{"zone": z.zone, "from": _hhmm(z.start), "to": _hhmm(z.end)} for z in tl.zones],
        "hourly_index": {_hhmm(300 + i * 15): x for i, x in enumerate(tl.curve) if i % 4 == 0},
        "wake": _hhmm(tl.wake),
        "bed": _hhmm(tl.bed),
    }


@server.tool(annotations=READ)
async def list_habits(
    include_inactive: Annotated[bool, Field(description="Also paused habits")] = False,
) -> list[dict[str, Any]]:
    """All habits with type, norm (config) and schedule. Use the ids with
    log_habit and update_habit."""
    async with _Call() as (s, uid, _):
        rows = await habits.list_habits(s, uid, active=None if include_inactive else True)
        return [_habit(h) for h in rows]


@server.tool(annotations=READ)
async def list_tasks(
    filter: Annotated[
        Literal["today", "inbox", "overdue", "upcoming", "done", "date"],
        Field(description="inbox = no date; upcoming = next 14 days; done = last 60 completed"),
    ] = "today",
    date: Annotated[date | None, Field(description="Required when filter=date")] = None,
) -> list[dict[str, Any]]:
    """Tasks by view. Each task: id, title, date, start_time, duration_min, important,
    fresh, done, created_by (me or claude)."""
    async with _Call() as (s, uid, now):
        if filter == "date":
            if date is None:
                raise ToolError("date is required when filter=date")
            rows = await tasks.list_tasks(s, uid, now, on=date)
        else:
            rows = await tasks.list_tasks(s, uid, now, view=TaskView(filter))
        return [_task(t) for t in rows]


@server.tool(annotations=UPDATE)
async def log_habit(
    habit_id: Annotated[uuid.UUID, Field(description="From list_habits or get_today")],
    value: Annotated[
        bool | int | None,
        Field(
            description=(
                "check: true/false; count: the amount done today (glasses, minutes…); "
                "null = clear the mark. Omit together with done=true to mark it fully done."
            )
        ),
    ] = None,
    done: Annotated[
        bool | None, Field(description="Shortcut: true = fully done, false = not done")
    ] = None,
    date: Annotated[date | None, Field(description="Logical date; default today")] = None,
) -> dict[str, Any]:
    """Mark a habit for a day. Bedtime habits cannot be logged: they follow from log_sleep."""
    async with _Call() as (s, uid, now):
        day = date or (await user_now(s, uid, now)).day
        habit = await habits.get_habit(s, uid, habit_id)
        if habit.type == HabitType.BEDTIME:
            raise ToolError("Bedtime is derived from sleep: use log_sleep instead")
        if done is not None:
            value = cast("bool | int", mark_value(habit, done))
        if value is None:
            await days.clear_habit_value(s, uid, day, habit_id, now)
            what = f"Снял отметку «{habit.name}» за {fmt_date_short(day)}"
        else:
            await days.set_habit_value(s, uid, day, habit_id, value, now)
            amount = "" if isinstance(value, bool) else f": {value}"
            mark = "не сделано" if value is False or value == 0 else "отметил"
            what = f"«{habit.name}» за {fmt_date_short(day)} — {mark}{amount}"
        await _log(s, uid, what, now)
    return {"ok": True, "habit": habit.name, "date": day.isoformat(), "value": value}


@server.tool(annotations=UPDATE)
async def log_sleep(
    bed: Annotated[str, Field(description="Bedtime HH:MM (evening times mean the night before)")],
    wake: Annotated[str, Field(description="Wake-up time HH:MM")],
    quality: Annotated[SleepQuality, Field(description="bad | ok | good")] = SleepQuality.OK,
    date: Annotated[
        date | None, Field(description="The date of the morning they woke up; default today")
    ] = None,
) -> dict[str, Any]:
    """Record a night's sleep. It drives the energy forecast and the bedtime habit."""
    async with _Call() as (s, uid, now):
        day = date or (await user_now(s, uid, now)).day
        out = await days.set_sleep(
            s, uid, day, SleepIn.model_validate({"bed": bed, "wake": wake, "quality": quality}), now
        )
        await _log(s, uid, f"Записал сон за {fmt_date_short(day)}: {bed}–{wake}", now)
    return {"ok": True, "date": day.isoformat(), "sleep": out.model_dump(mode="json")["sleep"]}


@server.tool(annotations=WRITE)
async def create_task(
    title: Annotated[str, Field(min_length=1, max_length=200)],
    date: Annotated[date | None, Field(description="YYYY-MM-DD; omit for the inbox")] = None,
    start_time: Annotated[
        str | None, Field(description="HH:MM; needs a date. 00:00–04:59 = the night after date")
    ] = None,
    duration_min: Annotated[int, Field(ge=5, le=1440)] = 30,
    important: Annotated[
        bool, Field(description="Top of the list, weighs ×3 in the score; keep it rare")
    ] = False,
    fresh: Annotated[
        bool, Field(description="Needs a fresh head: the app suggests the energy peak")
    ] = False,
    description: Annotated[str, Field(max_length=2000)] = "",
) -> dict[str, Any]:
    """Create a task. It is marked as created by Claude in the app. Keep important tasks
    rare: when everything is important, nothing is. Place fresh-head tasks into focus
    zones (see get_energy) when you pick a time."""
    async with _Call() as (s, uid, now):
        data = TaskCreate.model_validate(
            {
                "title": title,
                "date": date,
                "start_time": start_time,
                "duration_min": duration_min,
                "important": important,
                "fresh": fresh,
                "description": description,
            }
        )
        t = await tasks.create_task(s, uid, data, by=Actor.CLAUDE)
        at = f" в {start_time}" if start_time else ""
        await _log(s, uid, f"Добавил задачу «{t.title}» {_on(t.date)}{at}", now)
        return _task(t)


@server.tool(annotations=UPDATE)
async def update_task(
    task_id: uuid.UUID,
    title: Annotated[str | None, Field(min_length=1, max_length=200)] = None,
    date: Annotated[date | None, Field(description="New date")] = None,
    move_to_inbox: Annotated[bool, Field(description="Remove the date (and time)")] = False,
    start_time: Annotated[str | None, Field(description="HH:MM")] = None,
    clear_time: Annotated[bool, Field(description="Keep the date, remove the time")] = False,
    duration_min: Annotated[int | None, Field(ge=5, le=1440)] = None,
    important: bool | None = None,
    fresh: bool | None = None,
    description: Annotated[str | None, Field(max_length=2000)] = None,
    done: bool | None = None,
) -> dict[str, Any]:
    """Change any fields of a task; omitted fields stay as they are."""
    patch: dict[str, Any] = {
        k: v
        for k, v in {
            "title": title,
            "date": date,
            "start_time": start_time,
            "duration_min": duration_min,
            "important": important,
            "fresh": fresh,
            "description": description,
            "done": done,
        }.items()
        if v is not None
    }
    if move_to_inbox:
        patch["date"] = None
    if clear_time:
        patch["start_time"] = None
    async with _Call() as (s, uid, now):
        t = await tasks.update_task(s, uid, task_id, TaskUpdate.model_validate(patch), now)
        if "date" in patch:
            what = f"Перенёс «{t.title}» {_on(t.date)}"
        elif patch.get("done") is not None:
            what = f"Отметил «{t.title}» {'сделанной' if t.done else 'несделанной'}"
        else:
            what = f"Изменил задачу «{t.title}»"
        await _log(s, uid, what, now)
        return _task(t)


@server.tool(annotations=UPDATE)
async def complete_task(
    task_id: uuid.UUID,
    done: Annotated[bool, Field(description="false re-opens the task")] = True,
) -> dict[str, Any]:
    """Mark a task done (or not done)."""
    async with _Call() as (s, uid, now):
        t = await tasks.update_task(s, uid, task_id, TaskUpdate(done=done), now)
        await _log(s, uid, f"Отметил «{t.title}» {'сделанной' if done else 'несделанной'}", now)
        return _task(t)


@server.tool(annotations=WRITE)
async def create_habit(
    name: Annotated[str, Field(min_length=1, max_length=80)],
    type: Annotated[
        Literal["check", "count", "bedtime"],
        Field(description="See the server instructions for what each type means"),
    ],
    config: Annotated[
        dict[str, Any] | None,
        Field(
            description=(
                'count: {"norm": 8, "step": 1} (water: 8 glasses; reading: {"norm": 20, '
                '"step": 10} minutes); check/bedtime: {}'
            )
        ),
    ] = None,
    schedule: Annotated[
        dict[str, Any] | None,
        Field(
            description=(
                '{"kind": "daily"} (default); {"kind": "weekdays"} = Monday to Friday; '
                '{"kind": "cycle", "pattern": "1101100"} = do on 1, rest on 0'
            )
        ),
    ] = None,
) -> dict[str, Any]:
    """Create a habit. Suggest only a few at a time: new habits stick better one by one."""
    body: dict[str, Any] = {
        "name": name,
        "type": type,
        "config": config or {},
    }
    if schedule:
        body["schedule"] = schedule
    async with _Call() as (s, uid, now):
        h = await habits.create_habit(s, uid, HabitCreate.model_validate(body), now)
        await _log(s, uid, f"Добавил привычку «{h.name}»", now)
        return _habit(h)


@server.tool(annotations=UPDATE)
async def update_habit(
    habit_id: uuid.UUID,
    name: Annotated[str | None, Field(min_length=1, max_length=80)] = None,
    config: Annotated[
        dict[str, Any] | None, Field(description="Same shape as create_habit")
    ] = None,
    schedule: Annotated[dict[str, Any] | None, Field(description="Same as create_habit")] = None,
    active: Annotated[bool | None, Field(description="false pauses the habit")] = None,
) -> dict[str, Any]:
    """Change a habit's name, norm, schedule or pause it. The type can't change."""
    patch = {
        k: v
        for k, v in {
            "name": name,
            "config": config,
            "schedule": schedule,
            "active": active,
        }.items()
        if v is not None
    }
    async with _Call() as (s, uid, now):
        h = await habits.update_habit(s, uid, habit_id, HabitUpdate.model_validate(patch), now)
        paused = "Поставил на паузу" if active is False else "Изменил"
        await _log(s, uid, f"{paused} привычку «{h.name}»", now)
        return _habit(h)


@server.tool(annotations=WRITE)
async def save_review(
    kind: Annotated[Literal["day", "week", "month"], Field(description="day | week | month")],
    text: Annotated[
        str,
        Field(
            min_length=1,
            max_length=REVIEW_MAX,
            description="The review itself, in the user's language. Plain text or Markdown.",
        ),
    ],
    date: Annotated[
        date | None, Field(description="Day reviewed (or any day of the period); default today")
    ] = None,
    used_note: Annotated[
        bool,
        Field(description="true if you took the user's note for the period into account"),
    ] = False,
) -> dict[str, Any]:
    """Save a review so the user reads it in the app (Results → «Разбор недели»). Read the
    period first (get_progress, which includes the user's own note about it). Write it
    short, kind and concrete: what went well, what gets in the way and why (sleep, energy,
    overload), and one or two specific things to do. Everything you changed in the tracker
    since your previous review is listed under it automatically."""
    async with _Call() as (s, uid, now):
        r = await reviews.save_review(
            s, uid, ReviewKind(kind), text, now, on=date, used_note=used_note
        )
    return {
        "ok": True, "id": str(r.id), "date": r.date.isoformat(), "kind": r.kind.value,
        "changes_listed": len(r.changes),
    }  # fmt: skip


@server.tool(annotations=WRITE)
async def save_plan(
    items: Annotated[
        list[PlanItem],
        Field(
            min_length=1,
            max_length=8,
            description="2–4 items usually. title; start HH:MM (optional); dur minutes; "
            "note = why now, e.g. «это твой пик энергии»",
        ),
    ],
    date: Annotated[date | None, Field(description="The day planned; default today")] = None,
) -> dict[str, Any]:
    """Suggest a plan for a day. It appears on the Today screen as «План на сегодня» with
    «Добавить в день», which turns the items into tasks. Fit hard items into the focus
    zones (get_energy), don't duplicate tasks the day already has (get_day)."""
    async with _Call() as (s, uid, now):
        plan = await reviews.save_plan(
            s, uid, [i.model_dump(mode="json") for i in items], now, on=date
        )
    return {"ok": True, "id": str(plan.id), "date": plan.date.isoformat(), "items": len(items)}
