"""Adapter: the original app's JSON export -> domain model.

Used by the golden tests (same fixtures as the JavaScript run) and later by the
import endpoint. Legacy special cases become universal habit types:

* ``type: "sleep"``             -> BEDTIME
* ``type: "water"``             -> COUNT of glasses, the norm from the global water target
* ``type: "protein"`` (kbju)    -> COUNT with norm 2 (``kbju`` + ``proteinOk``)
* ``key: "study"`` (+studyMin)  -> COUNT of minutes with norm ``studyNeed``
* ``sched: every N``            -> CYCLE ``1 0…0`` (approximate, see ``approx_schedule``)
* hard-coded weights ×3 for sleep/study/orders -> dropped: every habit weighs the same

It also reads this app's own export (``services/exporter.py``), which uses the same
layout with this app's types (``check``, ``count``, ``bedtime``; older exports also
``minutes`` and ``dual``), an explicit ``config``, and every value under the habit's own key.
"""

import math
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

from lifetracker.domain.dates import hm, js_round, logical_now, task_min
from lifetracker.domain.enums import EnergyZone, HabitType, ScheduleKind
from lifetracker.domain.model import (
    Ctx,
    DayRec,
    FeelRec,
    Habit,
    HabitId,
    Settings,
    SleepRec,
    Task,
)

LEGACY_DEFAULT_TARGETS: dict[str, Any] = {
    "bed": "01:00", "waterL": 2.5, "glassL": 0.25, "proteinG": 140, "sleepNeed": 8, "studyH": 2,
}  # fmt: skip
LEGACY_DEFAULT_USUAL = {"bed": "03:00", "wake": "12:30"}

# `DEFAULT_SETTINGS` of the old app: used only when an export has no habits.
DEFAULT_HABITS: list[dict[str, Any]] = [
    {"key": "bedtime", "name": "Отбой до {bed}", "type": "sleep"},
    {"key": "orders", "name": "Все заказы отправлены вовремя", "type": "check"},
    {
        "key": "study",
        "name": "Подготовка к сессии ≥ {studyH} ч",
        "type": "check",
    },
    {"key": "creatine", "name": "Креатин", "type": "check"},
    {"key": "water", "name": "Вода {waterL} л", "type": "water"},
    {"key": "kbju", "name": "КБЖУ + белок {proteinG} г", "type": "protein"},
    {
        "key": "training",
        "name": "Тренировка по плану",
        "type": "check",
        "sched": {"t": "cycle", "p": "11010", "a": None},
    },
    {"key": "skin", "name": "Уход за кожей", "type": "check"},
    {
        "key": "expander",
        "name": "Эспандер 5 мин",
        "type": "check",
        "sched": {"t": "every", "n": 2},
    },
    {
        "key": "english",
        "name": "Английский",
        "type": "check",
        "sched": {"t": "every", "n": 2},
    },
]


@dataclass(slots=True)
class LegacyData:
    ctx: Ctx
    tasks: list[Task]
    # Habits whose old "every N days" schedule became an approximate cycle.
    approx_schedule: set[str] = field(default_factory=set)


def _d(s: str | None) -> date | None:
    return date.fromisoformat(s) if s else None


def legacy_targets(raw: dict[str, Any]) -> dict[str, Any]:
    return {**LEGACY_DEFAULT_TARGETS, **(raw.get("targets") or {})}


def _js_num(x: Any) -> str:
    """JavaScript String(number): 2.0 -> "2", 2.5 -> "2.5"."""
    if isinstance(x, float) and x.is_integer():
        return str(int(x))
    return str(x)


def habit_name(name: str, targets: dict[str, Any]) -> str:
    """`habitName`: fill legacy placeholders with the norms (first occurrence, like JS)."""
    return (
        name.replace("{bed}", str(targets["bed"]), 1)
        .replace("{waterL}", _js_num(targets["waterL"]).replace(".", ","), 1)
        .replace("{proteinG}", _js_num(targets["proteinG"]), 1)
        .replace("{studyH}", _js_num(targets["studyH"]).replace(".", ","), 1)
    )


def study_need(targets: dict[str, Any]) -> int:
    return max(15, js_round((targets.get("studyH") or 2) * 60))


def glasses(target_l: Any, glass_l: Any) -> int:
    """Old water norm in litres -> glasses per day (the original's `glassesNeed`)."""
    return max(1, math.ceil(float(target_l) / float(glass_l or 0.25) - 1e-9))


def _count(norm: int, step: int = 1) -> dict[str, int]:
    return {"norm": max(1, int(norm)), "step": max(1, int(step))}


def _schedule(sched: dict[str, Any], start: date) -> tuple[ScheduleKind, str | None, date | None]:
    """Legacy schedules -> daily | weekdays | cycle. "Every N days" (floating: N−1 rest days
    after each done day) has no exact equivalent; it becomes the cycle 1 0…0 from `start`."""
    match sched.get("t"):
        case "cycle":
            return ScheduleKind.CYCLE, sched.get("p") or "1", _d(sched.get("a")) or start
        case "every":
            n = max(2, min(31, int(sched.get("n") or 2)))
            return ScheduleKind.CYCLE, "1" + "0" * (n - 1), start
        case "weekdays":
            return ScheduleKind.WEEKDAYS, None, None
    return ScheduleKind.DAILY, None, None


def convert_habit(h: dict[str, Any], targets: dict[str, Any], start: date) -> Habit:
    kind, pattern, anchor = _schedule(h.get("sched") or {"t": "daily"}, start)
    habit = Habit(
        id=h["key"],
        type=HabitType.CHECK,
        name=habit_name(h.get("name", ""), targets),
        active=h.get("active") is not False,
        sched=kind,
        sched_pattern=pattern,
        sched_anchor=anchor,
    )
    cfg: dict[str, Any] = h["config"] if isinstance(h.get("config"), dict) else {}
    match h.get("type"):
        case "sleep" | "bedtime":
            habit.type = HabitType.BEDTIME
        case "count":  # this app's export
            habit.type, habit.config = (
                HabitType.COUNT,
                _count(cfg.get("norm") or 1, cfg.get("step") or 1),
            )
        case "water":
            target = cfg.get("target_l", targets["waterL"])
            habit.type = HabitType.COUNT
            habit.config = _count(glasses(target, cfg.get("glass_l", targets["glassL"])))
        case "minutes":  # an earlier export of this app
            habit.type = HabitType.COUNT
            habit.config = _count(cfg.get("target_min") or 20, cfg.get("step_min") or 10)
        case "protein" | "dual":
            habit.type, habit.config = HabitType.COUNT, _count(2)
        case _ if h["key"] == "study":
            habit.type, habit.config = HabitType.COUNT, _count(study_need(targets), 15)
    return habit


def _int(v: Any) -> int | None:
    return int(v) if isinstance(v, int | float) and not isinstance(v, bool) else None


def convert_values(
    h_raw: dict[str, Any], habits: list[Habit], raw_types: dict[str, str]
) -> dict[HabitId, Any]:
    """Day values -> check: True/False, count: int. `raw_types` are the export's own types
    (water, protein, minutes…), which decide how an old value becomes a count."""
    out: dict[HabitId, Any] = {}
    for h in habits:
        key = str(h.id)
        own = h_raw.get(key)
        if h.type == HabitType.BEDTIME:
            continue
        if h.type == HabitType.CHECK:
            if own:
                out[key] = True
            elif own is False:  # an explicit "not done" (bot ❌) survives export
                out[key] = False
            continue
        match raw_types.get(key):
            case "protein":
                if "kbju" in h_raw or "proteinOk" in h_raw:
                    out[key] = int(bool(h_raw.get("kbju"))) + int(bool(h_raw.get("proteinOk")))
            case "dual":  # an earlier export of this app: {"a": bool, "b": bool}
                if isinstance(own, dict):
                    out[key] = int(bool(own.get("a"))) + int(bool(own.get("b")))
            case _ if key == "study" and raw_types.get(key) not in ("count", "minutes"):
                if h_raw.get("studyMin") is not None:
                    out[key] = int(h_raw["studyMin"])
                elif h_raw.get("study"):
                    # Old check-only record without minutes: counts as the full norm.
                    out[key] = int(h.config["norm"])
            case _:
                if (n := _int(own)) is not None:
                    out[key] = n
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
    raw_types = {str(h["key"]): str(h.get("type") or "check") for h in raw_habits}
    approx = {str(h["key"]) for h in raw_habits if (h.get("sched") or {}).get("t") == "every"}
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
            values=convert_values(d.get("h") or {}, habits, raw_types),
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
            energy=EnergyZone.FOCUS if t.get("fresh") else EnergyZone(t.get("energy") or "steady"),
            important=t.get("importance") in ("important", "critical")
            or t.get("important") is True,
            done=bool(t.get("done")),
        )
        for tid, t in (export.get("tasks") or {}).items()
    ]
    return LegacyData(ctx=ctx, tasks=tasks, approx_schedule=approx)


def parse_now(now_iso: str) -> tuple[date, int]:
    """Fixture wall-clock time -> (logical day, logical minute), like `logicalNow`."""
    ln = logical_now(datetime.fromisoformat(now_iso + ":00+00:00"), "UTC")
    return ln.day, ln.minute
