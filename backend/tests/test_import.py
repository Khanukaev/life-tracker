"""Import of the old app's JSON export.

The fixtures are the same exports the golden tests feed to the original JavaScript, so
the strongest check is available: after importing, every past day's score in our app
equals what the old app computed for the same data.
"""

import json
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from httpx import AsyncClient

from lifetracker.db.session import get_sessionmaker
from lifetracker.domain.enums import ReviewKind
from lifetracker.services import reviews
from tests.golden.conftest import equal_weights

GOLDEN = Path(__file__).resolve().parents[2] / "golden"


def fixture(name: str) -> dict[str, Any]:
    data = json.loads((GOLDEN / "fixtures" / f"{name}.json").read_text())
    data.pop("now", None)  # not part of a real export; the test clock is FROZEN_NOW
    return data


def expected(name: str) -> dict[str, Any]:
    return json.loads((GOLDEN / "expected" / f"{name}.json").read_text())  # type: ignore[no-any-return]


async def test_dry_run_reports_and_changes_nothing(alice: AsyncClient) -> None:
    r = await alice.post("/import?dry_run=true", json=fixture("regular"))
    assert r.status_code == 200, r.text
    rep = r.json()
    assert rep["dry_run"] is True
    assert rep["days"] == 46
    assert rep["sleep_nights"] > 30
    assert len(rep["habits_created"]) == 9
    assert rep["tasks_created"] == 24
    assert rep["goals_skipped"] == 7  # this app has no goals
    assert rep["period"][1] == "2026-11-22"
    assert (await alice.get("/habits")).json() == []
    assert (await alice.get("/tasks?view=inbox")).json() == []


async def test_import_reproduces_the_old_apps_scores(alice: AsyncClient) -> None:
    r = await alice.post("/import", json=fixture("regular"))
    assert r.status_code == 200, r.text
    exp = expected("regular")

    me = (await alice.get("/me")).json()
    assert me["start_date"] == exp["meta"]["startDate"]  # history starts where it did

    habits = {h["name"]: h for h in (await alice.get("/habits")).json()}
    types = {h["type"] for h in habits.values()}
    assert {"bedtime", "water", "dual", "minutes", "check"} <= types

    # Same comparison rule as the golden tests: our score has one item per task (critical
    # ×3), the old app had one "tasks" item, so the two coincide on days with ≤ 1 task;
    # habits all weigh ×1 here, so the original's items are re-weighted.
    tasks_per_day: dict[str, int] = {}
    for t in fixture("regular")["tasks"].values():
        if t.get("date"):
            tasks_per_day[t["date"]] = tasks_per_day.get(t["date"], 0) + 1
    checked = 0
    for day, want in exp["dayScore"].items():
        if day == exp["meta"]["today"] or want is None or tasks_per_day.get(day, 0) > 1:
            continue  # today depends on the minute of the day
        got = (await alice.get(f"/views/day?date={day}")).json()["score"]
        assert got is not None, day
        assert got["pct"] == equal_weights(want["items"])[1], day
        checked += 1
    assert checked >= 5


async def test_reimport_is_idempotent(alice: AsyncClient) -> None:
    first = (await alice.post("/import", json=fixture("regular"))).json()
    second = (await alice.post("/import", json=fixture("regular"))).json()
    assert second["habits_created"] == []
    assert len(second["habits_reused"]) == len(first["habits_created"])
    assert second["tasks_created"] == 0
    assert second["tasks_updated"] == first["tasks_created"]
    assert len((await alice.get("/habits")).json()) == len(first["habits_created"])


async def test_merge_keeps_what_the_user_already_has(alice: AsyncClient) -> None:
    # Onboarding created a bedtime habit and a "Креатин" check; the user logged today's sleep.
    bed = (await alice.post("/habits", json={"name": "Отбой", "type": "bedtime"})).json()["id"]
    await alice.post("/habits", json={"name": "Креатин", "type": "check"})
    await alice.put("/days/2026-11-22/sleep", json={"bed": "22:00", "wake": "06:00"})

    data = fixture("regular")
    data["settings"]["habits"].append({"key": "creatine", "name": "Креатин", "type": "check"})
    rep = (await alice.post("/import", json=data)).json()

    habits = (await alice.get("/habits")).json()
    assert [h["id"] for h in habits if h["type"] == "bedtime"] == [bed]  # still one bedtime
    assert sum(h["name"] == "Креатин" for h in habits) == 1
    assert "Креатин" in rep["habits_reused"]
    day = (await alice.get("/days/2026-11-22")).json()
    assert day["sleep"]["bed"] == "22:00"  # the user's own log wins over the file


async def test_isolated_per_user(alice: AsyncClient, bob: AsyncClient) -> None:
    await alice.post("/import", json=fixture("regular"))
    assert (await bob.get("/habits")).json() == []
    # The same file imported by Bob gets its own rows (ids are derived per user).
    rep = (await bob.post("/import", json=fixture("regular"))).json()
    assert len(rep["habits_created"]) == 9


@pytest.mark.parametrize("name", ["early_bird", "night_owl", "sparse_oversleep", "new_user"])
async def test_other_exports_import_cleanly(alice: AsyncClient, name: str) -> None:
    r = await alice.post("/import", json=fixture(name))
    assert r.status_code == 200, r.text


@pytest.mark.parametrize(
    "body",
    [
        {"hello": "world"},
        {"days": []},
        {"settings": {"habits": [{"name": "no key"}]}},
        {"days": {"not-a-date": {}}},
    ],
)
async def test_garbage_is_rejected_with_a_clear_message(alice: AsyncClient, body: Any) -> None:
    r = await alice.post("/import", json=body)
    assert r.status_code == 422, r.text
    assert (await alice.get("/habits")).json() == []  # nothing half-imported


# ---- export: the same layout, so backup and move are a round trip ----


async def _rich_account(c: AsyncClient) -> None:
    """Every habit type, a schedule, sleep, an explicit ❌, a task and a review."""
    await c.post("/import", json=fixture("regular"))
    read = (
        await c.post(
            "/habits", json={"name": "Чтение", "type": "minutes", "config": {"target_min": 25}}
        )
    ).json()["id"]
    vit = (
        await c.post(
            "/habits",
            json={"name": "Витамины", "type": "check", "schedule": {"kind": "every", "n": 3}},
        )
    ).json()["id"]
    await c.put(f"/days/2026-11-21/habits/{read}", json={"value": 40})
    await c.put(f"/days/2026-11-21/habits/{vit}", json={"value": False})

    uid = uuid.UUID((await c.get("/me")).json()["id"])
    async with get_sessionmaker()() as s:
        await reviews.save_review(
            s, uid, ReviewKind.DAY, "Разбор", datetime(2026, 11, 22, 12, tzinfo=UTC)
        )


async def test_export_has_everything(alice: AsyncClient) -> None:
    await _rich_account(alice)
    r = await alice.get("/export")
    assert r.status_code == 200
    ex = r.json()
    assert ex["format"] == "life-tracker/1"
    types = {h["type"] for h in ex["settings"]["habits"]}
    assert {"bedtime", "water", "dual", "minutes", "check"} <= types
    assert ex["days"]["2026-11-21"]["sleep"]["bed"]
    assert len(ex["tasks"]) == 24
    assert "goals" not in ex
    assert ex["reviews"][0]["text"] == "Разбор"


async def test_reimporting_own_export_changes_nothing(alice: AsyncClient) -> None:
    await _rich_account(alice)
    before = (await alice.get("/export")).json()
    rep = (await alice.post("/import", json=before)).json()
    assert rep["habits_created"] == []
    assert rep["tasks_created"] == 0
    assert rep["reviews"] == 0
    after = (await alice.get("/export")).json()
    for key in ("days", "tasks"):
        assert after[key] == before[key], key
    assert [h["key"] for h in after["settings"]["habits"]] == [
        h["key"] for h in before["settings"]["habits"]
    ]


async def test_export_moves_to_another_account(alice: AsyncClient, bob: AsyncClient) -> None:
    await _rich_account(alice)
    ex = (await alice.get("/export")).json()
    rep = (await bob.post("/import", json=ex)).json()
    assert len(rep["habits_created"]) == len(ex["settings"]["habits"])
    assert rep["reviews"] == 1

    for day in ("2026-11-19", "2026-11-20", "2026-11-21"):
        a = (await alice.get(f"/views/day?date={day}")).json()
        b = (await bob.get(f"/views/day?date={day}")).json()
        assert a["score"]["pct"] == b["score"]["pct"], day
        assert sorted((h["name"], h["status"], h["value"]) for h in a["habits"]) == sorted(
            (h["name"], h["status"], h["value"]) for h in b["habits"]
        ), day
    # Bob's rows are his own: Alice's ids were not reused for him.
    a_ids = {h["id"] for h in (await alice.get("/habits")).json()}
    assert not a_ids & {h["id"] for h in (await bob.get("/habits")).json()}
