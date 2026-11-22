"""Dates, sleep nights and the energy model must match the JavaScript original exactly."""

from dataclasses import asdict
from datetime import date

import pytest

from lifetracker.domain.dates import fmt_date, fmt_date_short, fmt_dur, fmt_hm, task_min
from lifetracker.domain.energy import energy_day
from lifetracker.domain.sleep import night_for
from tests.golden.conftest import Case, r6

pytestmark = pytest.mark.nodb


def test_meta(case: Case) -> None:
    meta = case.expected["meta"]
    assert case.today.isoformat() == meta["today"]
    assert case.data.ctx.now_min == meta["nowMin"]
    assert case.data.ctx.start_date.isoformat() == meta["startDate"]


def test_formatting(case: Case) -> None:
    exp = case.expected["format"]
    assert [fmt_hm(m) for m in [-30, 0, 59, 61, 1439, 1440, 1501, 1745.6]] == exp["fmtHM"]
    assert [fmt_dur(m) for m in [0, 5, 60, 61, 125.4, 600]] == exp["fmtDur"]
    assert [task_min(s) for s in ["00:00", "04:59", "05:00", "23:30", "", None]] == exp["taskMin"]
    days = [case.today, date(2026, 1, 1)]
    assert [[fmt_date(d), fmt_date_short(d)] for d in days] == exp["fmtDate"]


def test_nights(case: Case) -> None:
    for k, exp in case.expected["nights"].items():
        n = night_for(date.fromisoformat(k), case.data.ctx)
        got = {key: v for key, v in asdict(n).items() if key != "planned" or n.planned}
        exp = {key: v for key, v in exp.items()}
        assert got == pytest.approx(exp), k


def test_energy_day(case: Case) -> None:
    for k, exp in case.expected["energy"].items():
        e = energy_day(date.fromisoformat(k), case.data.ctx)
        assert e.wake == exp["wake"], k
        assert e.bed == exp["bed"], k
        assert (e.avg, e.max, e.max_at, e.min, e.min_at) == (
            exp["avg"], exp["max"], exp["maxAt"], exp["min"], exp["minAt"],
        ), k  # fmt: skip
        assert r6(e.acro) == exp["acro"], k
        train = e.train and {"start": e.train.start, "end": e.train.end, "score": r6(e.train.score)}
        assert train == exp["train"], k
        assert [[w.zone, w.start, w.end, w.avg] for w in e.windows] == exp["windows"], k
        assert [[f.key, f.val, f.note] for f in e.factors] == exp["factors"], k
        got = [
            [p.m, p.idx, p.zone, r6(p.raw), r6(p.mel), r6(p.cort), r6(p.mot), r6(p.alert)]
            for p in e.pts
        ]
        assert got == exp["pts"], k


def test_energy_without_feel(case: Case) -> None:
    e = energy_day(case.today, case.data.ctx, no_feel=True)
    assert [p.idx for p in e.pts] == case.expected["energyNoFeel"]
