"""Adapter: the original app's JSON export -> domain model.

Used by the golden tests (same fixtures as the JavaScript run) and later by the
import endpoint. Legacy special cases become universal habit types:

* ``type: "sleep"``             -> BEDTIME
* ``type: "water"``             -> WATER with the global water norm moved into the habit
* ``type: "protein"`` (kbju)    -> DUAL with flags ``kbju`` / ``proteinOk``
* ``key: "study"`` (+studyMin)  -> MINUTES with target ``studyNeed``
* hard-coded weights ×3 for sleep/study/orders -> ``is_key``
"""

from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

from lifetracker.domain.dates import hm, js_round, logical_now, task_min
from lifetracker.domain.enums import EnergyZone, GoalKind, HabitType, Importance, ScheduleKind
from lifetracker.domain.model import (
    Ctx,
    DayRec,
    FeelRec,
    Goal,
    Habit,
    HabitId,
    Settings,
    SleepRec,
    Subtask,
    Task,
)

LEGACY_DEFAULT_TARGETS: dict[str, Any] = {
    "bed": "01:00", "waterL": 2.5, "glassL": 0.25, "proteinG": 140, "sleepNeed": 8, "studyH": 2,
}  # fmt: skip
LEGACY_DEFAULT_USUAL = {"bed": "03:00", "wake": "12:30"}
LEGACY_KEY_HABITS = {"study", "orders"}  # SCORE_W keys besides sleep

# `DEFAULT_SETTINGS` of the old app: used only when an export has no habits/spheres.
DEFAULT_SPHERES = ["Сон", "Учёба", "Бизнес", "Спорт", "Здоровье", "Английский", "Личное"]
DEFAULT_HABITS: list[dict[str, Any]] = [
    {"key": "bedtime", "name": "Отбой до {bed}", "type": "sleep", "sphere": "Сон"},
    {"key": "orders", "name": "Все заказы отправлены вовремя", "type": "check", "sphere": "Бизнес"},
    {
        "key": "study",
        "name": "Подготовка к сессии ≥ {studyH} ч",
        "type": "check",
        "sphere": "Учёба",
    },
    {"key": "creatine", "name": "Креатин", "type": "check", "sphere": "Спорт"},
    {"key": "water", "name": "Вода {waterL} л", "type": "water", "sphere": "Здоровье"},
    {"key": "kbju", "name": "КБЖУ + белок {proteinG} г", "type": "protein", "sphere": "Спорт"},
    {
        "key": "training",
        "name": "Тренировка по плану",
        "type": "check",
        "sphere": "Спорт",
        "sched": {"t": "cycle", "p": "11010", "a": None},
    },
    {"key": "skin", "name": "Уход за кожей", "type": "check", "sphere": "Здоровье"},
    {
        "key": "expander",
        "name": "Эспандер 5 мин",
        "type": "check",
        "sphere": "Спорт",
        "sched": {"t": "every", "n": 2},
    },
    {
        "key": "english",
        "name": "Английский",
        "type": "check",
        "sphere": "Английский",
        "sched": {"t": "every", "n": 2},
    },
]


@dataclass(slots=True)
class LegacyData:
    ctx: Ctx
    tasks: list[Task]
    goals: list[Goal]
    spheres: list[str]


def _d(s: str | None) -> date | None:
    return date.fromisoformat(s) if s else None


def legacy_targets(raw: dict[str, Any]) -> dict[str, Any]:
    return {**LEGACY_DEFAULT_TARGETS, **(raw.get("targets") or {})}


def study_need(targets: dict[str, Any]) -> int:
    return max(15, js_round((targets.get("studyH") or 2) * 60))


def convert_habit(h: dict[str, Any], targets: dict[str, Any], start: date) -> Habit:
    sched = h.get("sched") or {"t": "daily"}
    kind = ScheduleKind(sched.get("t", "daily"))
    habit = Habit(
        id=h["key"],
        type=HabitType.CHECK,
        name=h.get("name", ""),
        sphere=h.get("sphere"),
        active=h.get("active") is not False,
        is_key=h["key"] in LEGACY_KEY_HABITS,
        sched=kind,
        sched_n=(sched.get("n") or 2) if kind == ScheduleKind.EVERY else None,
        sched_pattern=(sched.get("p") or "1") if kind == ScheduleKind.CYCLE else None,
        sched_anchor=(_d(sched.get("a")) or start) if kind == ScheduleKind.CYCLE else None,
    )
    match h.get("type"):
        case "sleep":
            habit.type, habit.is_key = HabitType.BEDTIME, True
        case "water":
            habit.type = HabitType.WATER
            habit.config = {"target_l": targets["waterL"], "glass_l": targets["glassL"]}
        case "protein":
            habit.type = HabitType.DUAL
            habit.config = {"labels": ["КБЖУ", "Белок"]}
        case _ if h["key"] == "study":
            habit.type = HabitType.MINUTES
            habit.config = {"target_min": study_need(targets), "step_min": 15}
    return habit


def convert_values(h_raw: dict[str, Any], habits: list[Habit]) -> dict[HabitId, Any]:
    out: dict[HabitId, Any] = {}
    for h in habits:
        key = str(h.id)
        match h.type:
            case HabitType.BEDTIME:
                continue
            case HabitType.WATER:
                if h_raw.get(key) is not None:
                    out[key] = int(h_raw[key])
            case HabitType.DUAL:
                if "kbju" in h_raw or "proteinOk" in h_raw:
                    out[key] = {"a": bool(h_raw.get("kbju")), "b": bool(h_raw.get("proteinOk"))}
            case HabitType.MINUTES:
                if h_raw.get("studyMin") is not None:
                    out[key] = int(h_raw["studyMin"])
                elif h_raw.get("study"):
                    # Old check-only record without minutes: counts as the full norm.
                    out[key] = int(h.config["target_min"])
            case _:
                if h_raw.get(key):
                    out[key] = True
    return out


def start_date_of(raw_settings: dict[str, Any], days: dict[str, Any], today: date) -> date:
    """`ctx()`: the earlier of settings.startDate and the first day with data (or today)."""
    keys = sorted(days)
    first = date.fromisoformat(keys[0]) if keys and keys[0] < today.isoformat() else today
    sd = _d(raw_settings.get("startDate"))
    return sd if sd and sd < first else first


def convert(export: dict[str, Any], *, today: date, now_min: int) -> LegacyData:
    raw = export.get("settings") or {}
    targets = legacy_targets(raw)
    usual = {**LEGACY_DEFAULT_USUAL, **(raw.get("usual") or {})}
    model = raw.get("model") or {}
    raw_days: dict[str, Any] = export.get("days") or {}
    start = start_date_of(raw, raw_days, today)

    raw_habits = raw.get("habits") or DEFAULT_HABITS
    habits = [convert_habit(h, targets, start) for h in raw_habits]
    settings = Settings(
        bed_target=hm(targets.get("bed") or "01:00") or 0,
        sleep_need_h=float(targets.get("sleepNeed") or 8),
        usual_bed=hm(usual["bed"]) or 0,
        usual_wake=hm(usual["wake"]) or 0,
        bias=[float(b or 0) for b in (model.get("bias") or [0, 0, 0, 0])],
        model_n=int(model.get("n") or 0),
    )
    days: dict[date, DayRec] = {}
    for k, d in raw_days.items():
        sl = d.get("sleep")
        sleep = None
        if sl and sl.get("bed") and sl.get("wake"):
            sleep = SleepRec(
                bed=hm(sl["bed"]) or 0, wake=hm(sl["wake"]) or 0, q=sl.get("q") or "ok"
            )
        days[date.fromisoformat(k)] = DayRec(
            sleep=sleep,
            feel=[
                FeelRec(t=f["t"], v=f["v"], pred=f.get("pred"), err=f.get("err"))
                for f in d.get("feel") or []
            ],
            values=convert_values(d.get("h") or {}, habits),
            backfill=bool(d.get("backfill")),
        )
    ctx = Ctx(today=today, start_date=start, settings=settings, habits=habits, days=days,
              now_min=now_min)  # fmt: skip

    tasks = [
        Task(
            id=t.get("id") or tid,
            title=t.get("title", ""),
            date=_d(t.get("date")),
            start=task_min(t.get("start")),
            dur=t.get("dur") or 30,
            energy=EnergyZone(t.get("energy") or "steady"),
            importance=Importance(t.get("importance") or "normal"),
            done=bool(t.get("done")),
            sphere=t.get("sphere"),
        )
        for tid, t in (export.get("tasks") or {}).items()
    ]
    goals = [
        Goal(
            id=g.get("id") or gid,
            title=g.get("title", ""),
            kind=GoalKind(g.get("kind") or "subtasks"),
            habits=list(g.get("habits") or []),
            target=g.get("target"),
            window=g.get("window"),
            manual_pct=g.get("value"),
            subtasks=[
                Subtask(
                    title=s.get("title", ""),
                    done=bool(s.get("done")),
                    deadline=_d(s.get("deadline")),
                )
                for s in g.get("subtasks") or []
            ],
            deadline=_d(g.get("deadline")),
            archived=bool(g.get("archived")),
        )
        for gid, g in (export.get("goals") or {}).items()
    ]
    return LegacyData(
        ctx=ctx, tasks=tasks, goals=goals, spheres=list(raw.get("spheres") or DEFAULT_SPHERES)
    )


def parse_now(now_iso: str) -> tuple[date, int]:
    """Fixture wall-clock time -> (logical day, logical minute), like `logicalNow`."""
    ln = logical_now(datetime.fromisoformat(now_iso + ":00+00:00"), "UTC")
    return ln.day, ln.minute
