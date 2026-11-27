"""Profile and Tasks screens, habit templates and the dev-only login."""

import pytest
from httpx import AsyncClient

from lifetracker.core.config import get_settings

TODAY = "2026-11-22"


async def test_every_template_is_a_valid_habit(alice: AsyncClient) -> None:
    templates = (await alice.get("/habit-templates")).json()
    assert len(templates) >= 8
    for t in templates:
        body = {k: v for k, v in t.items() if k in ("name", "type", "config", "schedule")}
        r = await alice.post("/habits", json=body)
        assert r.status_code == 201, (t["key"], r.text)


async def test_profile_view(alice: AsyncClient) -> None:
    await alice.post("/habits", json={"name": "Water", "type": "count", "config": {"norm": 8}})
    off = (await alice.post("/habits", json={"name": "Old", "type": "check"})).json()["id"]
    await alice.patch(f"/habits/{off}", json={"active": False})
    await alice.post("/tasks", json={"title": "T", "date": TODAY})
    await alice.post(
        "/tasks", json={"title": "Old", "date": "2026-11-20", "importance": "critical"}
    )
    await alice.post("/tasks", json={"title": "Inbox"})

    v = (await alice.get("/views/profile")).json()
    assert v["tasks"] == {
        "inbox": 1, "today": 1, "overdue": 1, "overdue_critical": 1, "upcoming": 0, "done": 0
    }  # fmt: skip
    assert [h["name"] for h in v["habits"]] == ["Water", "Old"]  # active first


async def test_tasks_view_with_energy_tab(alice: AsyncClient) -> None:
    await alice.post(
        "/tasks",
        json={"title": "Deep work late", "date": TODAY, "start_time": "23:30", "energy": "focus",
              "duration_min": 60},
    )  # fmt: skip
    await alice.post("/tasks", json={"title": "Routine", "date": TODAY, "energy": "steady"})
    await alice.post(
        "/tasks", json={"title": "Old", "date": "2026-11-19", "importance": "critical"}
    )

    today = (await alice.get("/views/tasks", params={"view": "today"})).json()
    assert today["counts"]["today"] == 2
    late = next(t for t in today["items"] if t["title"] == "Deep work late")
    assert late["low_energy"] is True
    assert late["slot"] is not None  # a better Focus slot is suggested

    energy = (await alice.get("/views/tasks", params={"view": "energy"})).json()
    assert energy["items"][0]["title"] == "Old"  # critical first
    assert {z["zone"] for z in energy["loads"]} == {"focus", "steady", "recharge"}
    assert (await alice.get("/views/tasks", params={"view": "bogus"})).status_code == 422


async def test_screens_are_isolated(alice: AsyncClient, bob: AsyncClient) -> None:
    await alice.post("/tasks", json={"title": "Secret", "date": TODAY})
    assert (await bob.get("/views/tasks")).json()["items"] == []
    assert (await bob.get("/views/profile")).json()["tasks"]["today"] == 0


async def test_dev_login_is_disabled_outside_dev(anon: AsyncClient) -> None:
    r = await anon.post("/api/v1/auth/dev", json={"telegram_id": 1})
    assert r.status_code == 404


async def test_dev_login_works_only_with_both_flags(
    anon: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "app_env", "dev")
    assert (await anon.post("/api/v1/auth/dev", json={"telegram_id": 1})).status_code == 404
    monkeypatch.setattr(settings, "dev_auth", True)
    r = await anon.post("/api/v1/auth/dev", json={"telegram_id": 1, "first_name": "Dev"})
    assert r.status_code == 200
    assert r.json()["user"]["first_name"] == "Dev"
