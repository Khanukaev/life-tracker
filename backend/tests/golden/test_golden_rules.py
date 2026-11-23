"""Habits, goals, score, tasks, slots, weak spots and feel vs the JavaScript original."""

from dataclasses import asdict
from datetime import date
from functools import cache

import pytest

from lifetracker.domain.dates import add_days, fmt_dur
from lifetracker.domain.energy import EnergyDay, energy_day
from lifetracker.domain.feel import ASLEEP_MSG, feel_update
from lifetracker.domain.goals import goal_overdue, goal_progress
from lifetracker.domain.habits import (
    active_habits,
    best_streak,
    habit_due,
    habit_rate,
    habit_status,
    miss_run,
    streak_of,
)
from lifetracker.domain.insights import weak_spots_last
from lifetracker.domain.score import day_score, tasks_on
from lifetracker.domain.slots import energy_left, is_overdue, suggest_slot
from tests.golden.conftest import Case, equal_weights, r6

pytestmark = pytest.mark.nodb


def test_habit_statuses_streaks_rates(case: Case) -> None:
    ctx = case.data.ctx
    for h in ctx.habits:
        exp = case.expected["habits"][h.id]
        for k, s in exp["status"].items():
            assert habit_status(h, date.fromisoformat(k), ctx) == s, (h.id, k)
        for k, due in exp["due"].items():
            assert habit_due(h, date.fromisoformat(k), ctx) == due, (h.id, k)
        assert streak_of([h.id], ctx) == exp["streak"], h.id
        assert streak_of([h.id], ctx, add_days(ctx.today, -1)) == exp["streakYesterday"], h.id
        assert best_streak([h.id], ctx) == exp["best"], h.id
        assert asdict(habit_rate(h, ctx, 7)) == exp["rate7"], h.id
        assert asdict(habit_rate(h, ctx, 30)) == exp["rate30"], h.id
        assert miss_run(h, ctx) == exp["missRun"], h.id


def test_sphere_streaks(case: Case) -> None:
    ctx = case.data.ctx
    for sphere, exp in case.expected["spheres"].items():
        keys = [h.id for h in active_habits(ctx) if h.sphere == sphere]
        assert keys == exp["keys"]
        assert streak_of(keys, ctx) == exp["streak"], sphere
        assert best_streak(keys, ctx) == exp["best"], sphere


def test_goals(case: Case) -> None:
    for g in case.data.goals:
        exp = case.expected["goals"][g.id]
        p = {k: v for k, v in asdict(goal_progress(g, case.data.ctx)).items() if v is not None}
        assert p == exp["progress"], g.id
        assert goal_overdue(g, case.data.ctx) == exp["overdue"], g.id


def test_day_score_matches_where_rules_coincide(case: Case) -> None:
    """New rules: one item per task (critical ×3) and every habit ×1.

    With ≤1 task a day the items and their values equal the original's; the percentage
    is the original's items re-weighted (see ``equal_weights``)."""
    ctx, tasks = case.data.ctx, case.data.tasks
    compared = 0
    for k, exp in case.expected["dayScore"].items():
        day = date.fromisoformat(k)
        sc = day_score(day, ctx, tasks)
        if exp is None:
            assert sc is None, k
            continue
        assert sc is not None
        if len(tasks_on(tasks, day)) > 1:
            continue
        legacy_key = {"sleep": "sleep", "task": "tasks"}
        got = [[legacy_key.get(x.kind, x.ref), x.w, r6(x.v)] for x in sc.items]
        items, pct, total = equal_weights(exp["items"])
        assert got == items, k
        assert (sc.pct, sc.W) == (pct, total), k
        compared += 1
    if case.expected["dayScore"] and any(v for v in case.expected["dayScore"].values()):
        assert compared > 0, "no comparable days in fixture"


def test_task_overdue(case: Case) -> None:
    ctx = case.data.ctx
    for t in case.data.tasks:
        assert is_overdue(t, ctx) == case.expected["tasks"]["overdue"][t.id], t.id


def _energy_cache(case: Case) -> "dict[date, EnergyDay]":
    return {}


def test_slots(case: Case) -> None:
    ctx, tasks = case.data.ctx, case.data.tasks

    @cache
    def energy_of(k: date) -> EnergyDay:
        return energy_day(k, ctx)

    for k, dur, en, exp in case.expected["slots"]:
        s = suggest_slot(date.fromisoformat(k), dur, en, ctx, tasks, energy_of)
        got = s and {"start": s.start, "end": s.end, "fit": r6(s.fit), "avg": s.avg, "zone": s.zone}
        assert got == exp, (k, dur, en)


def test_weak_spots(case: Case) -> None:
    ctx = case.data.ctx
    e = energy_day(ctx.today, ctx)
    for n in (7, 30):
        got = [a.text for a in weak_spots_last(ctx, case.data.tasks, case.data.goals, e, n)]
        assert got == case.expected["weakSpots"][str(n)], n


def test_energy_left(case: Case) -> None:
    ctx = case.data.ctx
    loads = energy_left(ctx, case.data.tasks, energy_day(ctx.today, ctx))
    got = [[z.zone.capitalize(), fmt_dur(z.need_min), fmt_dur(z.free_min)] for z in loads]
    assert got == case.expected["energyLeft"]


def test_feel(case: Case) -> None:
    for v, exp in case.expected["feel"].items():
        res = feel_update(v, case.data.ctx)
        if exp["feel"] is None:
            assert res is None
            assert exp["msg"] == ASLEEP_MSG
            continue
        assert res is not None
        assert asdict(res.rec) == exp["feel"], v
        assert {"bias": [r6(b) for b in res.bias], "n": res.model_n} == exp["model"], v
        assert res.message == exp["msg"], v
