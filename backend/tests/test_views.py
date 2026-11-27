"""Aggregated screens: Day, Now, Review, slot suggestion and "How do you feel?"."""

from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient

from tests.conftest import Clock

TODAY = "2026-11-22"  # FROZEN_NOW is 12:00 UTC, user time zone UTC


async def setup_user(c: AsyncClient) -> dict[str, str]:
    bed = (await c.post("/habits", json={"name": "Bed", "type": "bedtime"})).json()["id"]
    read = (
        await c.post(
            "/habits",
            json={"name": "Read", "type": "count", "config": {"norm": 30, "step": 10}},
        )
    ).json()["id"]
    vit = (await c.post("/habits", json={"name": "Vitamins", "type": "check"})).json()["id"]
    for i in range(1, 8):
        d = (datetime(2026, 11, 22) - timedelta(days=i)).date().isoformat()
        await c.put(f"/days/{d}/sleep", json={"bed": "23:15", "wake": "07:15"})
        await c.put(f"/days/{d}/habits/{vit}", json={"value": True})
    await c.put(f"/days/{TODAY}/sleep", json={"bed": "23:30", "wake": "07:30", "quality": "good"})
    await c.put(f"/days/{TODAY}/habits/{read}", json={"value": 10})
    await c.post(
        "/tasks",
        json={"title": "Report", "date": TODAY, "start_time": "15:00", "duration_min": 60,
              "importance": "critical", "energy": "focus"},
    )  # fmt: skip
    await c.post("/tasks", json={"title": "Groceries", "date": TODAY})
    return {"bed": bed, "read": read, "vit": vit}


async def test_day_view(alice: AsyncClient) -> None:
    ids = await setup_user(alice)
    r = await alice.get("/views/day")
    assert r.status_code == 200, r.text
    v = r.json()
    assert v["date"] == TODAY
    assert v["relation"] == "today"
    assert v["now_min"] == 720
    assert v["date_label"] == "Вс, 22 ноября"
    assert v["sleep"]["duration_min"] == 480

    score = v["score"]
    kinds = [i["kind"] for i in score["items"]]
    assert kinds == ["sleep", "habit", "habit", "task", "task"]
    assert score["gains"][0]["label"] == "Report"  # critical task: the biggest gain
    assert score["bed_gain"] > 0
    assert len(score["week"]) == 7

    habits = {h["id"]: h for h in v["habits"]}
    assert habits[ids["read"]]["status"] == "pending"
    assert habits[ids["read"]]["value"] == 10
    assert habits[ids["vit"]]["streak"] == 7  # today pending doesn't break the streak
    assert habits[ids["vit"]]["streak_base"] == 7

    assert [t["title"] for t in v["critical"]] == ["Report"]
    assert v["critical_overload"] is False
    assert [t["title"] for t in v["tasks"]] == ["Report", "Groceries"]  # critical first
    tl = v["timeline"]
    assert len(tl["curve"]) == 97
    assert tl["zones"]
    assert tl["free"]
    assert tl["now"]["zone"] in ("focus", "steady", "recharge")
    assert v["phrase"]


async def test_day_view_other_days(alice: AsyncClient) -> None:
    await setup_user(alice)
    past = (await alice.get("/views/day", params={"date": "2026-11-20"})).json()
    assert past["relation"] == "past"
    assert past["score"] is not None
    assert past["phrase"] is None
    future = (await alice.get("/views/day", params={"date": "2026-11-24"})).json()
    assert future["relation"] == "future"
    assert future["score"] is None
    assert future["habits"] == []
    assert future["sleep_planned"] == {"bed": "23:30", "need_h": 8.0}


async def test_critical_overload_warning(alice: AsyncClient) -> None:
    for i in range(4):
        await alice.post("/tasks", json={"title": f"C{i}", "date": TODAY, "importance": "critical"})
    v = (await alice.get("/views/day")).json()
    assert v["critical_overload"] is True


async def test_new_user_day_view_is_empty_but_valid(alice: AsyncClient) -> None:
    v = (await alice.get("/views/day")).json()
    assert v["habits"] == []
    assert v["tasks"] == []
    assert v["score"]["pct"] == 0
    assert v["sleep"] is None


async def test_now_view(alice: AsyncClient) -> None:
    await setup_user(alice)
    v = (await alice.get("/views/now")).json()
    assert v["now_min"] == 720
    assert 3 <= v["idx"] <= 100
    assert len(v["curve"]) == 289
    assert v["sleep_logged"] is True
    assert all(f["val"] != 0 for f in v["factors"])
    h = v["hormones"]
    assert len(h["melatonin"]) == len(h["cortisol"]) == 97
    assert set(h["now"]) == {"alertness", "motivation", "cortisol", "melatonin"}
    assert v["q_hi"] >= v["q_lo"]


async def test_feel_updates_model(alice: AsyncClient) -> None:
    await setup_user(alice)
    r = await alice.post("/feel", json={"v": "low"})
    assert r.status_code == 200, r.text
    res = r.json()
    assert res["feel"]["t"] == "12:00"
    assert res["feel"]["err"] < 0
    assert res["model_n"] == 1
    assert res["message"] == "Ты ниже прогноза, модель подстроилась"
    st = (await alice.get("/settings")).json()
    assert st["model_n"] == 1
    assert any(b < 0 for b in st["model_bias"])
    day = (await alice.get(f"/days/{TODAY}")).json()
    assert [f["v"] for f in day["feel"]] == ["low"]
    now = (await alice.get("/views/now")).json()
    assert now["last_feel"]["v"] == "low"
    assert (await alice.post("/feel", json={"v": "meh"})).status_code == 422


async def test_feel_while_asleep_is_rejected(alice: AsyncClient, clock: Clock) -> None:
    await setup_user(alice)
    clock.now = datetime(2026, 11, 22, 3, 0, tzinfo=UTC)  # 03:00 at night, modelled asleep
    r = await alice.post("/feel", json={"v": "ok"})
    assert r.status_code == 422
    assert "время сна" in r.json()["error"]["message"]


async def test_slot_suggestion(alice: AsyncClient) -> None:
    await setup_user(alice)
    r = await alice.get("/views/slot", params={"date": TODAY, "dur": 60, "energy": "focus"})
    s = r.json()
    best = s["best"] or s["alternative"]
    assert best is not None
    # Never overlaps the timed task 15:00–16:00 on the same day.
    if best["date"] == TODAY:
        assert best["end"] <= 900 or best["start"] >= 960


@pytest.mark.parametrize("period", ["week", "month"])
async def test_review_view(alice: AsyncClient, period: str) -> None:
    ids = await setup_user(alice)
    v = (await alice.get("/views/review", params={"period": period})).json()
    if period == "week":
        assert (v["start"], v["end"], v["label"]) == ("2026-11-16", "2026-11-22", "16 — 22 ноября")
        assert len(v["scores"]) == 7
    else:
        assert (v["start"], v["end"], v["label"]) == ("2026-11-01", "2026-11-30", "Ноябрь 2026")
        assert v["scores"][-1]["pct"] is None  # future days have no score
    assert v["next_anchor"] is None  # can't go into the future
    habits = {h["id"]: h for h in v["habits"]}
    assert len(habits[ids["vit"]]["dots"]) == len(v["scores"])
    assert habits[ids["vit"]]["streak"] == 7
    assert v["tasks_total"] == 2
    assert len(v["nights"]) == 14
    assert v["nights"][-1]["on_time"] is True


async def test_review_navigates_to_previous_period(alice: AsyncClient) -> None:
    v = (await alice.get("/views/review", params={"period": "week", "anchor": "2026-11-10"})).json()
    assert (v["start"], v["end"]) == ("2026-11-09", "2026-11-15")
    assert v["next_anchor"] == "2026-11-16"
    assert v["prev_anchor"] == "2026-11-02"


async def test_views_are_isolated(alice: AsyncClient, bob: AsyncClient) -> None:
    await setup_user(alice)
    v = (await bob.get("/views/day")).json()
    assert v["habits"] == []
    assert v["tasks"] == []
    assert v["sleep"] is None
    review = (await bob.get("/views/review", params={"period": "week"})).json()
    assert review["habits"] == []
    assert review["tasks_total"] == 0
