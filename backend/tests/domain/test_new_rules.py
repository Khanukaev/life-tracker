"""Rules that intentionally differ from the reference app (decisions of stage 0)."""

from datetime import date
from functools import cache

import pytest

from lifetracker.domain.dates import add_days
from lifetracker.domain.energy import EnergyDay, energy_day
from lifetracker.domain.enums import HabitType, ScheduleKind
from lifetracker.domain.habits import habit_status
from lifetracker.domain.model import Ctx, DayRec, Habit, Settings, SleepRec, Task
from lifetracker.domain.phrases import CRITICAL, pick_phrase
from lifetracker.domain.score import bed_gain, day_score, gains
from lifetracker.domain.slots import suggest_with_fallback

pytestmark = pytest.mark.nodb

TODAY = date(2026, 11, 22)


def make_ctx(
    habits: list[Habit], days: dict[date, DayRec] | None = None, now_min: int = 780
) -> Ctx:
    return Ctx(
        today=TODAY,
        start_date=date(2026, 11, 1),
        settings=Settings(bed_target=23 * 60 + 30),
        habits=habits,
        days=days or {},
        now_min=now_min,
    )


def test_each_task_is_its_own_item_and_important_weighs_three() -> None:
    ctx = make_ctx([Habit(id="vit", type=HabitType.CHECK)])
    tasks = [
        Task(id="a", title="Important", date=TODAY, important=True),
        Task(id="b", title="Normal", date=TODAY, done=True),
        Task(id="c", title="Other", date=TODAY),
    ]
    sc = day_score(TODAY, ctx, tasks)
    assert sc is not None
    assert [(x.kind, x.w) for x in sc.items] == [
        ("habit", 1),
        ("task", 3),
        ("task", 2),
        ("task", 2),
    ]
    assert sc.W == 8
    assert sc.pct == 25  # only the normal task (2 of 8) is done
    # The unfinished important task is the biggest gain.
    assert gains(sc)[0].item.ref == "a"
    assert gains(sc)[0].points == 38


def test_habits_weigh_the_same() -> None:
    ctx = make_ctx(
        [
            Habit(id="read", type=HabitType.CHECK),
            Habit(id="vit", type=HabitType.CHECK),
        ],
        {TODAY: DayRec(values={"read": True})},
    )
    sc = day_score(TODAY, ctx, [])
    assert sc is not None
    assert sc.pct == 50
    assert {x.w for x in sc.items} == {1}


def test_no_bedtime_habit_means_no_sleep_item() -> None:
    ctx = make_ctx(
        [Habit(id="vit", type=HabitType.CHECK)],
        {TODAY: DayRec(sleep=SleepRec(bed=60, wake=480))},
    )
    sc = day_score(TODAY, ctx, [])
    assert sc is not None
    assert [x.kind for x in sc.items] == ["habit"]
    assert bed_gain(sc) == 0


def test_bedtime_item_scales_with_lateness() -> None:
    bed = Habit(id="bed", type=HabitType.BEDTIME)
    on_time = make_ctx([bed], {TODAY: DayRec(sleep=SleepRec(bed=23 * 60, wake=7 * 60))})
    an_hour_late = make_ctx([bed], {TODAY: DayRec(sleep=SleepRec(bed=30, wake=8 * 60))})
    assert day_score(TODAY, on_time, []).pct == 100  # type: ignore[union-attr]
    assert day_score(TODAY, an_hour_late, []).pct == 50  # type: ignore[union-attr]


def test_partial_credit_for_counters() -> None:
    habits = [
        Habit(id="w", type=HabitType.COUNT, config={"norm": 8}),
        Habit(id="m", type=HabitType.COUNT, config={"norm": 40, "step": 10}),
        Habit(id="x", type=HabitType.COUNT, config={"norm": 2}),
    ]
    ctx = make_ctx(habits, {TODAY: DayRec(values={"w": 4, "m": 10, "x": 5})})
    sc = day_score(TODAY, ctx, [])
    assert sc is not None
    assert [x.v for x in sc.items] == [0.5, 0.25, 1]  # over the norm still counts as 1
    assert sc.items[0].note == "4/8"


def test_weekdays_rest_on_the_weekend() -> None:
    gym = Habit(id="g", type=HabitType.CHECK, sched=ScheduleKind.WEEKDAYS)
    ctx = make_ctx([gym])
    saturday = date(2026, 11, 21)
    assert habit_status(gym, saturday, ctx) == "rest"
    assert habit_status(gym, add_days(saturday, -1), ctx) == "missed"  # Friday


def test_slot_falls_back_to_next_day_when_today_fits_poorly() -> None:
    # Late evening: today's remaining time has no Focus zone left.
    ctx = make_ctx([], now_min=22 * 60)

    @cache
    def energy_of(k: date) -> EnergyDay:
        return energy_day(k, ctx)

    s = suggest_with_fallback(TODAY, 60, "focus", ctx, [], energy_of)
    assert s.best is None or s.best.fit < 0.6
    assert s.alternative is not None
    assert s.alternative.day == date(2026, 11, 23)
    assert s.alternative.fit >= 0.6


def test_phrase_mentions_important_tasks_when_they_are_open() -> None:
    ctx = make_ctx([Habit(id="vit", type=HabitType.CHECK)])
    tasks = [Task(id="a", title="x", date=TODAY, important=True)]
    sc = day_score(TODAY, ctx, tasks)
    assert sc is not None
    phrases = {pick_phrase(sc, None, ctx, tasks, bed_label="23:30", shift=i) for i in range(20)}
    assert set(CRITICAL) <= phrases
