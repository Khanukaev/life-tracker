"""Profile, Tasks and Goals screens, habit templates and the dev-only login."""

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
    sid = (await alice.post("/spheres", json={"name": "Health"})).json()["id"]
    await alice.post(
        "/habits",
        json={"name": "Water", "type": "water", "config": {"target_l": 2}, "sphere_id": sid},
    )
    off = (await alice.post("/habits", json={"name": "Old", "type": "check"})).json()["id"]
    await alice.patch(f"/habits/{off}", json={"active": False})
    await alice.post("/tasks", json={"title": "T", "date": TODAY, "sphere_id": sid})
    await alice.post(
        "/tasks", json={"title": "Old", "date": "2026-11-20", "importance": "critical"}
    )
    await alice.post("/tasks", json={"title": "Inbox"})
    for i in range(4):
        await alice.post("/goals", json={"title": f"G{i}"})

    v = (await alice.get("/views/profile")).json()
    assert len(v["goals"]) == 3
    assert v["goals_total"] == 4
    assert v["tasks"] == {
        "inbox": 1, "today": 1, "overdue": 1, "overdue_critical": 1, "upcoming": 0, "done": 0
    }  # fmt: skip
    assert [h["name"] for h in v["habits"]] == ["Water", "Old"]  # active first
    assert v["habits"][0]["sphere_name"] == "Health"
    assert v["spheres"] == [{"id": sid, "name": "Health", "count": 2}]


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


async def test_goals_view(alice: AsyncClient) -> None:
    hid = (await alice.post("/habits", json={"name": "Gym", "type": "check"})).json()["id"]
    await alice.post(
        "/goals",
        json={
            "title": "Course",
            "subtasks": [{"title": "A"}, {"title": "B", "deadline": "2026-11-20"}],
        },
    )
    await alice.post(
        "/goals", json={"title": "Gym 4/7", "kind": "count", "habit_ids": [hid], "target": 4}
    )
    nxt = (await alice.post("/goals", json={"title": "Later", "stage": 2})).json()["id"]
    arch = (await alice.post("/goals", json={"title": "Done", "stage": 1})).json()["id"]
    await alice.patch(f"/goals/{arch}", json={"archived": True})

    v = (await alice.get("/views/goals")).json()
    assert [g["title"] for g in v["base"]] == ["Course", "Gym 4/7"]
    assert [g["id"] for g in v["next"]] == [nxt]
    assert [g["title"] for g in v["archived"]] == ["Done"]
    course = v["base"][0]
    assert course["overdue_steps"] == 1
    assert course["progress"]["label"] == "0/2 шагов"
    assert len(v["base"][1]["cells"]) == 7
    assert v["history"][0]["what"] == "Перенесена в архив"
    assert v["base_holds"] is False


async def test_screens_are_isolated(alice: AsyncClient, bob: AsyncClient) -> None:
    await alice.post("/goals", json={"title": "Secret"})
    await alice.post("/tasks", json={"title": "Secret", "date": TODAY})
    assert (await bob.get("/views/goals")).json()["base"] == []
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
