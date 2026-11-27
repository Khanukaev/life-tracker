from httpx import AsyncClient

TODAY = "2026-11-22"


async def _task(c: AsyncClient, title: str, **body: object) -> dict[str, object]:
    r = await c.post("/tasks", json={"title": title, **body})
    assert r.status_code == 201, r.text
    return dict(r.json())


async def test_create_defaults(alice: AsyncClient) -> None:
    t = await _task(alice, "Write report", date=TODAY)
    assert t["duration_min"] == 30
    assert t["important"] is False
    assert t["fresh"] is False
    assert t["created_by"] == "me"
    assert t["done"] is False


async def test_time_requires_date(alice: AsyncClient) -> None:
    r = await alice.post("/tasks", json={"title": "x", "start_time": "10:00"})
    assert r.status_code == 422
    t = await _task(alice, "x", date=TODAY, start_time="10:00")
    # Moving a timed task to the inbox drops its time.
    r = await alice.patch(f"/tasks/{t['id']}", json={"date": None})
    assert r.json()["start_time"] is None


async def test_views_and_important_first(alice: AsyncClient) -> None:
    await _task(alice, "inbox normal")
    await _task(alice, "inbox important", important=True)
    await _task(alice, "today late", date=TODAY, start_time="18:00")
    await _task(alice, "today early", date=TODAY, start_time="09:00")
    await _task(alice, "today untimed important", date=TODAY, important=True)
    await _task(alice, "old", date="2026-11-20")
    await _task(alice, "old important", date="2026-11-21", important=True)
    await _task(alice, "soon", date="2026-11-25")
    await _task(alice, "too far", date="2026-12-31")

    async def titles(view: str) -> list[str]:
        return [t["title"] for t in (await alice.get("/tasks", params={"view": view})).json()]

    assert await titles("inbox") == ["inbox important", "inbox normal"]
    assert await titles("today") == ["today untimed important", "today early", "today late"]
    assert await titles("overdue") == ["old important", "old"]
    assert await titles("upcoming") == ["soon"]

    by_date = (await alice.get("/tasks", params={"date": "2026-12-31"})).json()
    assert [t["title"] for t in by_date] == ["too far"]


async def test_done_toggle_sets_done_at(alice: AsyncClient) -> None:
    t = await _task(alice, "Call", date=TODAY)
    r = await alice.patch(f"/tasks/{t['id']}", json={"done": True})
    assert r.json()["done_at"] is not None
    done = (await alice.get("/tasks", params={"view": "done"})).json()
    assert [x["title"] for x in done] == ["Call"]
    r = await alice.patch(f"/tasks/{t['id']}", json={"done": False})
    assert r.json()["done_at"] is None


async def test_done_tasks_sink_to_bottom_today(alice: AsyncClient) -> None:
    a = await _task(alice, "A", date=TODAY, important=True)
    await _task(alice, "B", date=TODAY)
    await alice.patch(f"/tasks/{a['id']}", json={"done": True})
    titles = [t["title"] for t in (await alice.get("/tasks", params={"view": "today"})).json()]
    assert titles == ["B", "A"]


async def test_move_overdue_to_today(alice: AsyncClient) -> None:
    await _task(alice, "old", date="2026-11-19", start_time="10:00")
    done = await _task(alice, "old done", date="2026-11-19")
    await alice.patch(f"/tasks/{done['id']}", json={"done": True})
    r = await alice.post("/tasks/move-overdue")
    assert r.json() == {"moved": 1}
    today = (await alice.get("/tasks", params={"view": "today"})).json()
    assert [(t["title"], t["start_time"]) for t in today] == [("old", None)]


async def test_update_validation_and_delete(alice: AsyncClient) -> None:
    t = await _task(alice, "x", date=TODAY)
    assert (await alice.patch(f"/tasks/{t['id']}", json={"title": None})).status_code == 422
    assert (await alice.patch(f"/tasks/{t['id']}", json={"duration_min": 2})).status_code == 422
    assert (
        await alice.patch(f"/tasks/{t['id']}", json={"importance": "critical"})
    ).status_code == 422
    assert (await alice.delete(f"/tasks/{t['id']}")).status_code == 204
    assert (await alice.get(f"/tasks/{t['id']}")).status_code == 404
