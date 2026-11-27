"""«План» and «Итоги»: what is ahead, and a week or a month in numbers."""

from datetime import UTC, datetime

from httpx import AsyncClient

from lifetracker.db.session import get_sessionmaker
from lifetracker.domain.enums import ReviewKind
from lifetracker.services import reviews
from tests.test_query_count import count_queries

TODAY = "2026-11-22"  # a Sunday; FROZEN_NOW is 12:00 UTC, user time zone UTC
NOW = datetime(2026, 11, 22, 12, tzinfo=UTC)


async def uid(c: AsyncClient):  # type: ignore[no-untyped-def]
    import uuid

    return uuid.UUID((await c.get("/me")).json()["id"])


async def test_plan_shows_only_what_is_ahead(alice: AsyncClient, bob: AsyncClient) -> None:
    await alice.post("/habits", json={"name": "Daily", "type": "check"})
    await alice.post(
        "/habits", json={"name": "Workdays", "type": "check", "schedule": {"kind": "weekdays"}}
    )
    await alice.post(
        "/habits",
        json={"name": "Cycle", "type": "check",
              "schedule": {"kind": "cycle", "pattern": "10", "anchor": TODAY}},
    )  # fmt: skip
    await alice.post("/tasks", json={"title": "Today", "date": TODAY})
    await alice.post("/tasks", json={"title": "Late", "date": "2026-11-20"})
    await alice.post("/tasks", json={"title": "Late done", "date": "2026-11-20"})
    done_id = (await alice.get("/tasks?view=overdue")).json()
    for t in done_id:
        if t["title"] == "Late done":
            await alice.patch(f"/tasks/{t['id']}", json={"done": True})
    await alice.post("/tasks", json={"title": "Tomorrow", "date": "2026-11-23", "important": True})
    await alice.post("/tasks", json={"title": "Far", "date": "2026-12-05"})
    await alice.post("/tasks", json={"title": "Someday"})

    r = await alice.get("/views/plan")
    assert r.status_code == 200, r.text
    v = r.json()
    assert [t["title"] for t in v["overdue"]] == ["Late"]
    assert [t["title"] for t in v["inbox"]] == ["Someday"]
    days = {d["date"]: d for d in v["days"]}
    assert TODAY not in days  # today lives on «Сегодня»
    assert len(v["days"]) == 30
    assert [t["title"] for t in days["2026-11-23"]["tasks"]] == ["Tomorrow"]
    assert [t["title"] for t in days["2026-12-05"]["tasks"]] == ["Far"]
    # Monday 23: daily + weekdays + cycle (day 2 of "10" = rest) → 2; Tuesday 24: 3.
    assert days["2026-11-23"]["habits"] == 2
    assert days["2026-11-24"]["habits"] == 3
    assert days["2026-11-28"]["habits"] == 2  # Saturday: daily + cycle
    assert days["2026-11-29"]["habits"] == 1  # Sunday: daily only (cycle rest)
    assert (await bob.get("/views/plan")).json()["inbox"] == []


async def test_results_week_and_month(alice: AsyncClient) -> None:
    empty = (await alice.get("/views/results")).json()
    assert empty["empty"] is True
    assert empty["review"] is None
    assert empty["claude_connected"] is False

    hid = (await alice.post("/habits", json={"name": "Read", "type": "check"})).json()["id"]
    for d in ("2026-11-16", "2026-11-17", "2026-11-18", "2026-11-20", "2026-11-21"):
        await alice.put(f"/days/{d}/habits/{hid}", json={"value": True})
        await alice.put(f"/days/{d}/sleep", json={"bed": "00:45", "wake": "08:00"})
    await alice.post("/tasks", json={"title": "Big", "date": "2026-11-18", "important": True})
    await alice.post("/tasks", json={"title": "Small", "date": "2026-11-19"})
    await alice.post("/tasks", json={"title": "Inbox"})
    await alice.put("/notes/week?anchor=2026-11-20", json={"text": "Тяжёлая среда"})
    async with get_sessionmaker()() as s:
        await reviews.save_review(
            s, await uid(alice), ReviewKind.WEEK, "Разбор недели", NOW, used_note=True
        )

    r = await alice.get("/views/results?period=week")
    assert r.status_code == 200, r.text
    w = r.json()
    assert (w["start"], w["end"], w["upto"]) == ("2026-11-16", "2026-11-22", TODAY)
    assert w["label"] == "Неделя, 16–22 ноября"
    assert w["empty"] is False
    assert len(w["trend"]) == 8
    assert w["trend"][-1] == w["avg"]
    assert w["review"]["text"] == "Разбор недели"
    assert w["review"]["used_note"] is True
    assert w["note"]["text"] == "Тяжёлая среда"
    h = w["habits"]
    assert len(h["days"]) == 7
    line = h["lines"][0]
    assert (line["done"], line["of"]) == (5, 7)  # Thursday missed, today pending
    assert h["pct"] == round(5 / 6 * 100)
    t = w["tasks"]
    assert (t["done"], t["total"], t["important"], t["normal"]) == (0, 2, [0, 1], [0, 1])
    assert [x["title"] for x in t["overdue"]] == ["Big", "Small"]
    assert [x["title"] for x in t["inbox"]] == ["Inbox"]
    sl = w["sleep"]
    assert sl["n"] == 5
    assert sl["late"] == 5  # the norm is earlier than 00:45
    assert sl["avg_bed"] == 45
    assert sl["avg_dur"] == 435
    assert len(sl["nights"]) == 7
    assert sl["nights"][3] is None

    m = (await alice.get("/views/results?period=month")).json()
    assert m["label"] == "Ноябрь, 1–22"
    assert m["prev_name"] == "октябрю"
    assert len(m["trend"]) == 5
    assert m["review"] is None  # the week review is not a month review


async def test_outlook_query_count_is_constant(alice: AsyncClient, bob: AsyncClient) -> None:
    from tests.test_query_count import add_data

    await add_data(alice, habits=1, days=1)
    await add_data(bob, habits=6, days=12)
    out = []
    for c in (alice, bob):
        counts = []
        for url in ("/views/plan", "/views/results?period=month"):
            with count_queries() as q:
                assert (await c.get(url)).status_code == 200
            counts.append(len([s for s in q if s == "SELECT"]))
        out.append(counts)
    assert out[0] == out[1], out
    assert out[0][0] <= 8
    assert out[0][1] <= 12
