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
import lifetracker.services.goals as goals
import lifetracker.services.habits as habits
import lifetracker.services.reviews as reviews
import lifetracker.services.screens as screens
import lifetracker.services.spheres as spheres
import lifetracker.services.tasks as tasks
import lifetracker.services.users as users
import lifetracker.services.views as screen_views
from lifetracker.core.errors import AppError
from lifetracker.db.session import get_sessionmaker
from lifetracker.domain.enums import (
    Actor,
    EnergyZone,
    GoalKind,
    HabitType,
    Importance,
    ReviewKind,
    SleepQuality,
)
from lifetracker.schemas.claude import REVIEW_MAX
from lifetracker.schemas.days import SleepIn
from lifetracker.schemas.goals import GoalCreate, GoalUpdate, SubtaskIn, SubtaskUpdate
from lifetracker.schemas.habits import HabitCreate, HabitOut, HabitUpdate
from lifetracker.schemas.tasks import TaskCreate, TaskOut, TaskUpdate, TaskView
from lifetracker.services.clock import user_now
from lifetracker.services.reminders import mark_value

current_user: ContextVar[uuid.UUID | None] = ContextVar("current_user", default=None)


def utc_now() -> datetime:
    return datetime.now(UTC)


clock: Callable[[], datetime] = utc_now  # tests freeze it

INSTRUCTIONS = """\
Life Tracker: the user's personal tracker of habits, sleep, energy, tasks and goals.
All data belongs to the user who connected this server; you only ever see their data.

Model:
- A *logical day* runs 05:00–05:00 in the user's time zone: 01:30 belongs to the previous date.
- Habits have a type: check (done/not), water (glasses toward a daily volume), minutes
  (minutes toward a target), dual (two flags that must both be set), bedtime (derived
  from sleep: met when they went to bed by the target time; never logged directly).
  Schedules: daily, every N days, or a cycle pattern like "1101100" (1 = do, 0 = rest).
  Key habits weigh more in the day score.
- Sleep of a date = the night that ended on that date's morning (bed, wake, quality).
- Energy is predicted from sleep with a circadian model and split into zones:
  focus (best for hard thinking), steady (routine work), recharge (rest, admin).
- Tasks have a date (or none = inbox), optional start time and duration, energy zone,
  importance (normal, important, critical). Critical tasks weigh most in the score.
- Day score ("рейтинг", 0–100 %) = weighted share of what was done: sleep, habits, tasks.
- Goals: stage 1 = base, stage 2 = next stage; kinds: subtasks (steps), streak (N days
  in a row of linked habits), count (N times within a window), manual (percent).

Etiquette: answer in the user's language (usually Russian). Prefer reading before
writing. When you change something, say what you changed. Save written analyses with
save_review so the user sees them in the app.
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
        "energy",
        "importance",
        "done",
        "sphere_id",
        "created_by",
    )
    return {k: d[k] for k in keep if d.get(k) not in (None, "")} | {"done": d["done"]}


def _habit(h: Any) -> dict[str, Any]:
    d = HabitOut.model_validate(h).model_dump(mode="json")
    keep = ("id", "name", "type", "is_key", "config", "schedule", "active", "sphere_id")
    return {k: d[k] for k in keep}


# ---- read ----


@server.tool(annotations=READ)
async def get_profile() -> dict[str, Any]:
    """The user's profile: name, time zone, today's logical date, sleep norms
    (bedtime target, sleep need, usual bed/wake), reminder settings, spheres
    (life areas used to group habits, tasks and goals) and task counters."""
    async with _Call() as (s, uid, now):
        me = await users.get_me(s, uid)
        st = await users.get_settings(s, uid)
        ln = await user_now(s, uid, now)
        counts = await screens.task_counts(s, uid, ln.day)
        sph = await spheres.list_spheres(s, uid)
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
            "morning_ping": me.morning_ping,
            "spheres": [{"id": str(x.id), "name": x.name} for x in sph],
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
                "is_key": h.is_key,
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
    habit completion per habit and per sphere, task completion, bedtime regularity and
    alerts (weak spots worth attention)."""
    async with _Call() as (s, uid, now):
        v = await screen_views.review_view(s, uid, now, period, anchor)
    return {
        "period": v.label,
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
        "spheres": [{"name": x.name, "pct": x.pct} for x in v.spheres],
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
    """Current and best streaks: per habit and per sphere. A streak counts consecutive days
    on which a habit was done when due (rest days of a schedule don't break it)."""
    async with _Call() as (s, uid, now):
        v = await screen_views.review_view(s, uid, now, "month", None)
    return {
        "habits": [
            {"id": str(h.id), "name": h.name, "current": h.streak, "best": h.best} for h in v.habits
        ],
        "spheres": [{"name": x.name, "current": x.streak, "best": x.best} for x in v.spheres],
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
    """All habits with type, norm (config), schedule and sphere. Use the ids with
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
    """Tasks by view. Each task: id, title, date, start_time, duration_min, energy zone,
    importance, done, created_by (me or claude)."""
    async with _Call() as (s, uid, now):
        if filter == "date":
            if date is None:
                raise ToolError("date is required when filter=date")
            rows = await tasks.list_tasks(s, uid, now, on=date)
        else:
            rows = await tasks.list_tasks(s, uid, now, view=TaskView(filter))
        return [_task(t) for t in rows]


@server.tool(annotations=READ)
async def list_goals(
    include_archived: Annotated[bool, Field(description="Also archived goals")] = False,
) -> dict[str, Any]:
    """Goals grouped by stage (base / next) with progress, deadline, steps and linked
    habits' progress, plus recent goal history (who changed what: me or claude)."""
    async with _Call() as (s, uid, now):
        v = await screens.goals_view(s, uid, now)

    def card(g: Any) -> dict[str, Any]:
        d: dict[str, Any] = g.model_dump(mode="json", exclude={"cells", "sphere_id"})
        d["steps"] = [
            {k: st[k] for k in ("id", "title", "done", "deadline") if k in st} for st in d["steps"]
        ]
        return d

    out = {
        "base": [card(g) for g in v.base],
        "next": [card(g) for g in v.next],
        "base_holds_70_for_14_days": v.base_holds,
        "history": [h.model_dump(mode="json") for h in v.history[:20]],
    }
    if include_archived:
        out["archived"] = [card(g) for g in v.archived]
    return out


# ---- write ----


@server.tool(annotations=UPDATE)
async def log_habit(
    habit_id: Annotated[uuid.UUID, Field(description="From list_habits or get_today")],
    value: Annotated[
        bool | int | dict[str, bool] | None,
        Field(
            description=(
                "check: true/false; water: number of glasses; minutes: minutes done; "
                'dual: {"a": bool, "b": bool}; null = clear the mark. '
                "Omit together with done=true to simply mark it fully done."
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
            value = cast("bool | int | dict[str, bool]", mark_value(habit, done))
        if value is None:
            await days.clear_habit_value(s, uid, day, habit_id, now)
        else:
            await days.set_habit_value(s, uid, day, habit_id, value, now)
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
    return {"ok": True, "date": day.isoformat(), "sleep": out.model_dump(mode="json")["sleep"]}


@server.tool(annotations=WRITE)
async def create_task(
    title: Annotated[str, Field(min_length=1, max_length=200)],
    date: Annotated[date | None, Field(description="YYYY-MM-DD; omit for the inbox")] = None,
    start_time: Annotated[
        str | None, Field(description="HH:MM; needs a date. 00:00–04:59 = the night after date")
    ] = None,
    duration_min: Annotated[int, Field(ge=5, le=1440)] = 30,
    energy: Annotated[
        EnergyZone, Field(description="focus = hard thinking, steady = routine, recharge = light")
    ] = EnergyZone.STEADY,
    importance: Importance = Importance.NORMAL,
    description: Annotated[str, Field(max_length=2000)] = "",
    sphere_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    """Create a task. It is marked as created by Claude in the app. Keep critical tasks
    rare: more than 3 per day dilutes them. Place focus tasks into focus zones
    (see get_energy) when you pick a time."""
    async with _Call() as (s, uid, _):
        data = TaskCreate.model_validate(
            {
                "title": title,
                "date": date,
                "start_time": start_time,
                "duration_min": duration_min,
                "energy": energy,
                "importance": importance,
                "description": description,
                "sphere_id": sphere_id,
            }
        )
        return _task(await tasks.create_task(s, uid, data, by=Actor.CLAUDE))


@server.tool(annotations=UPDATE)
async def update_task(
    task_id: uuid.UUID,
    title: Annotated[str | None, Field(min_length=1, max_length=200)] = None,
    date: Annotated[date | None, Field(description="New date")] = None,
    move_to_inbox: Annotated[bool, Field(description="Remove the date (and time)")] = False,
    start_time: Annotated[str | None, Field(description="HH:MM")] = None,
    clear_time: Annotated[bool, Field(description="Keep the date, remove the time")] = False,
    duration_min: Annotated[int | None, Field(ge=5, le=1440)] = None,
    energy: EnergyZone | None = None,
    importance: Importance | None = None,
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
            "energy": energy,
            "importance": importance,
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
        return _task(
            await tasks.update_task(s, uid, task_id, TaskUpdate.model_validate(patch), now)
        )


@server.tool(annotations=UPDATE)
async def complete_task(
    task_id: uuid.UUID,
    done: Annotated[bool, Field(description="false re-opens the task")] = True,
) -> dict[str, Any]:
    """Mark a task done (or not done)."""
    async with _Call() as (s, uid, now):
        return _task(await tasks.update_task(s, uid, task_id, TaskUpdate(done=done), now))


@server.tool(annotations=WRITE)
async def create_habit(
    name: Annotated[str, Field(min_length=1, max_length=80)],
    type: Annotated[
        Literal["check", "water", "minutes", "dual", "bedtime"],
        Field(description="See the server instructions for what each type means"),
    ],
    config: Annotated[
        dict[str, Any] | None,
        Field(
            description=(
                'water: {"target_l": 2, "glass_l": 0.25}; minutes: {"target_min": 20, '
                '"step_min": 10}; dual: {"labels": ["Калории", "Белок"]}; check/bedtime: {}'
            )
        ),
    ] = None,
    schedule: Annotated[
        dict[str, Any] | None,
        Field(
            description=(
                '{"kind": "daily"} (default); {"kind": "every", "n": 2} = every other day; '
                '{"kind": "cycle", "pattern": "1101100"} = do on 1, rest on 0'
            )
        ),
    ] = None,
    is_key: Annotated[bool | None, Field(description="Key habits weigh ×3 in the score")] = None,
    sphere_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    """Create a habit. Suggest only a few at a time: new habits stick better one by one."""
    body: dict[str, Any] = {
        "name": name,
        "type": type,
        "config": config or {},
        "is_key": is_key,
        "sphere_id": sphere_id,
    }
    if schedule:
        body["schedule"] = schedule
    async with _Call() as (s, uid, now):
        return _habit(await habits.create_habit(s, uid, HabitCreate.model_validate(body), now))


@server.tool(annotations=UPDATE)
async def update_habit(
    habit_id: uuid.UUID,
    name: Annotated[str | None, Field(min_length=1, max_length=80)] = None,
    config: Annotated[
        dict[str, Any] | None, Field(description="Same shape as create_habit")
    ] = None,
    schedule: Annotated[dict[str, Any] | None, Field(description="Same as create_habit")] = None,
    is_key: bool | None = None,
    active: Annotated[bool | None, Field(description="false pauses the habit")] = None,
    sphere_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    """Change a habit's name, norm, schedule, weight or pause it. The type can't change."""
    patch = {
        k: v
        for k, v in {
            "name": name,
            "config": config,
            "schedule": schedule,
            "is_key": is_key,
            "active": active,
            "sphere_id": sphere_id,
        }.items()
        if v is not None
    }
    async with _Call() as (s, uid, now):
        h = await habits.update_habit(s, uid, habit_id, HabitUpdate.model_validate(patch), now)
        return _habit(h)


@server.tool(annotations=WRITE)
async def create_goal(
    title: Annotated[str, Field(min_length=1, max_length=200)],
    kind: Annotated[
        GoalKind,
        Field(
            description="subtasks = steps; streak = N days in a row of linked habits; "
            "count = N times within window_days; manual = percent set by hand"
        ),
    ] = GoalKind.SUBTASKS,
    criterion: Annotated[str, Field(description="How we know it's achieved")] = "",
    deadline: date | None = None,
    stage: Annotated[Literal[1, 2], Field(description="1 = base, 2 = next stage")] = 1,
    habit_ids: Annotated[
        list[uuid.UUID] | None, Field(description="Linked habits (streak / count goals)")
    ] = None,
    target: Annotated[int | None, Field(description="Days in a row or number of times")] = None,
    window_days: Annotated[int | None, Field(description="count goals: the window")] = None,
    steps: Annotated[list[str] | None, Field(description="subtasks goals: step titles")] = None,
    sphere_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    """Create a goal; its history records that Claude created it. Keep the base stage to
    about 3 goals: focus beats breadth."""
    body = {
        "title": title,
        "kind": kind,
        "criterion": criterion,
        "deadline": deadline,
        "stage": stage,
        "habit_ids": habit_ids or [],
        "target": target,
        "window_days": window_days,
        "sphere_id": sphere_id,
        "subtasks": [SubtaskIn(title=t) for t in steps or []],
    }
    async with _Call() as (s, uid, _):
        g = await goals.create_goal(s, uid, GoalCreate.model_validate(body), by=Actor.CLAUDE)
        return g.model_dump(mode="json")


@server.tool(annotations=UPDATE)
async def update_goal(
    goal_id: uuid.UUID,
    title: Annotated[str | None, Field(min_length=1, max_length=200)] = None,
    criterion: str | None = None,
    deadline: date | None = None,
    stage: Literal[1, 2] | None = None,
    habit_ids: list[uuid.UUID] | None = None,
    target: int | None = None,
    window_days: int | None = None,
    manual_pct: Annotated[int | None, Field(ge=0, le=100, description="manual goals")] = None,
    archived: Annotated[bool | None, Field(description="true = achieved / dropped")] = None,
    add_steps: Annotated[list[str] | None, Field(description="New step titles")] = None,
    complete_step_ids: Annotated[list[uuid.UUID] | None, Field(description="Steps done")] = None,
) -> dict[str, Any]:
    """Change a goal, add or complete steps. Every change is written to the goal's
    history as made by Claude, so the user can see it."""
    patch = {
        k: v
        for k, v in {
            "title": title,
            "criterion": criterion,
            "deadline": deadline,
            "stage": stage,
            "habit_ids": habit_ids,
            "target": target,
            "window_days": window_days,
            "manual_pct": manual_pct,
            "archived": archived,
        }.items()
        if v is not None
    }
    async with _Call() as (s, uid, now):
        if patch:
            await goals.update_goal(
                s, uid, goal_id, GoalUpdate.model_validate(patch), by=Actor.CLAUDE
            )
        for t in add_steps or []:
            await goals.add_subtask(s, uid, goal_id, SubtaskIn(title=t), by=Actor.CLAUDE)
        for sid in complete_step_ids or []:
            await goals.update_subtask(
                s, uid, goal_id, sid, SubtaskUpdate(done=True), now, by=Actor.CLAUDE
            )
        g = await goals.get_goal(s, uid, goal_id)
        return g.model_dump(mode="json")


@server.tool(annotations=WRITE)
async def save_review(
    kind: Annotated[ReviewKind, Field(description="day | week")],
    text: Annotated[
        str,
        Field(
            min_length=1,
            max_length=REVIEW_MAX,
            description="The review itself, in the user's language. Plain text or Markdown.",
        ),
    ],
    date: Annotated[
        date | None, Field(description="Day reviewed (or any day of the week); default today")
    ] = None,
) -> dict[str, Any]:
    """Save a review so the user can read it in the app (Day screen → «Разбор от Claude»).
    Write it as a short, kind and concrete note: what went well, what slipped and why
    (sleep, energy, overload), and one or two specific suggestions for tomorrow."""
    async with _Call() as (s, uid, now):
        r = await reviews.save_review(s, uid, kind, text, now, on=date)
    return {"ok": True, "id": str(r.id), "date": r.date.isoformat(), "kind": r.kind.value}
