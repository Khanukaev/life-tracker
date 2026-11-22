"""Users must never see or change each other's data.

Alice owns one object of every kind. Bob tries every endpoint against Alice's ids and
must get 404 (not 403: we don't even confirm the id exists), and Alice's data must
stay untouched. A final test bypasses the API to show that the database itself
rejects cross-user references.
"""

import uuid
from dataclasses import dataclass

import pytest
from httpx import AsyncClient
from sqlalchemy.exc import IntegrityError

from lifetracker.db.models import Task
from lifetracker.db.session import get_sessionmaker

TODAY = "2026-11-22"


@dataclass
class AliceData:
    sphere: str
    habit: str
    task: str
    goal: str
    subtask: str


@pytest.fixture
async def alice_data(alice: AsyncClient) -> AliceData:
    sphere = (await alice.post("/spheres", json={"name": "Private"})).json()["id"]
    habit = (await alice.post("/habits", json={"name": "Secret habit", "type": "check"})).json()[
        "id"
    ]
    task = (
        await alice.post(
            "/tasks", json={"title": "Secret task", "date": TODAY, "sphere_id": sphere}
        )
    ).json()["id"]
    goal = (
        await alice.post(
            "/goals",
            json={
                "title": "Secret goal",
                "kind": "streak",
                "habit_ids": [habit],
                "subtasks": [{"title": "Secret step"}],
            },
        )
    ).json()
    await alice.put(f"/days/{TODAY}/habits/{habit}", json={"value": True})
    await alice.put(f"/days/{TODAY}/sleep", json={"bed": "23:00", "wake": "07:00"})
    return AliceData(sphere, habit, task, goal["id"], goal["subtasks"][0]["id"])


def foreign_requests(a: AliceData) -> list[tuple[str, str, dict[str, object] | None]]:
    return [
        ("PATCH", f"/spheres/{a.sphere}", {"name": "pwned"}),
        ("DELETE", f"/spheres/{a.sphere}", None),
        ("GET", f"/habits/{a.habit}", None),
        ("PATCH", f"/habits/{a.habit}", {"name": "pwned"}),
        ("DELETE", f"/habits/{a.habit}", None),
        ("PUT", f"/days/{TODAY}/habits/{a.habit}", {"value": False}),
        ("DELETE", f"/days/{TODAY}/habits/{a.habit}", None),
        ("GET", f"/tasks/{a.task}", None),
        ("PATCH", f"/tasks/{a.task}", {"done": True}),
        ("DELETE", f"/tasks/{a.task}", None),
        ("GET", f"/goals/{a.goal}", None),
        ("PATCH", f"/goals/{a.goal}", {"title": "pwned"}),
        ("DELETE", f"/goals/{a.goal}", None),
        ("POST", f"/goals/{a.goal}/subtasks", {"title": "pwned"}),
        ("PATCH", f"/goals/{a.goal}/subtasks/{a.subtask}", {"done": True}),
        ("DELETE", f"/goals/{a.goal}/subtasks/{a.subtask}", None),
    ]


async def test_cannot_touch_foreign_objects(
    alice: AsyncClient, bob: AsyncClient, alice_data: AliceData
) -> None:
    for method, url, body in foreign_requests(alice_data):
        r = await bob.request(method, url, json=body)
        assert r.status_code == 404, f"{method} {url} -> {r.status_code}"

    # Alice's data is intact.
    assert (await alice.get(f"/tasks/{alice_data.task}")).json()["done"] is False
    goal = (await alice.get(f"/goals/{alice_data.goal}")).json()
    assert goal["title"] == "Secret goal"
    assert goal["subtasks"][0]["done"] is False
    assert (await alice.get(f"/habits/{alice_data.habit}")).json()["name"] == "Secret habit"
    assert (await alice.get(f"/days/{TODAY}")).json()["habits"] == {alice_data.habit: True}
    assert [s["name"] for s in (await alice.get("/spheres")).json()] == ["Private"]


async def test_lists_only_show_own_data(bob: AsyncClient, alice_data: AliceData) -> None:
    assert (await bob.get("/spheres")).json() == []
    assert (await bob.get("/habits")).json() == []
    assert (await bob.get("/goals")).json() == []
    for view in ("inbox", "today", "overdue", "upcoming", "done"):
        assert (await bob.get("/tasks", params={"view": view})).json() == []
    assert (await bob.get("/tasks", params={"date": TODAY})).json() == []
    day = (await bob.get(f"/days/{TODAY}")).json()
    assert day["habits"] == {}
    assert day["sleep"] is None
    assert (await bob.get("/days", params={"from": TODAY, "to": TODAY})).json() == []


async def test_cannot_reference_foreign_objects(bob: AsyncClient, alice_data: AliceData) -> None:
    a = alice_data
    attempts = [
        ("/habits", {"name": "x", "type": "check", "sphere_id": a.sphere}),
        ("/tasks", {"title": "x", "sphere_id": a.sphere}),
        ("/goals", {"title": "x", "sphere_id": a.sphere}),
        ("/goals", {"title": "x", "kind": "streak", "habit_ids": [a.habit]}),
    ]
    for url, body in attempts:
        r = await bob.post(url, json=body)
        assert r.status_code == 404, (url, body, r.text)

    own_task = (await bob.post("/tasks", json={"title": "mine"})).json()["id"]
    r = await bob.patch(f"/tasks/{own_task}", json={"sphere_id": a.sphere})
    assert r.status_code == 404
    own_goal = (await bob.post("/goals", json={"title": "mine"})).json()["id"]
    r = await bob.patch(f"/goals/{own_goal}", json={"habit_ids": [a.habit]})
    assert r.status_code == 404


async def test_reusing_foreign_client_id_is_conflict(
    alice: AsyncClient, bob: AsyncClient, alice_data: AliceData
) -> None:
    r = await bob.post("/tasks", json={"id": alice_data.task, "title": "steal"})
    assert r.status_code == 409
    assert "Secret" not in r.text  # nothing of Alice's object leaks
    assert (await alice.get(f"/tasks/{alice_data.task}")).json()["title"] == "Secret task"


async def test_database_rejects_cross_user_reference(
    bob: AsyncClient, alice_data: AliceData
) -> None:
    """Even if service code forgot a check, the composite FK would stop it."""
    bob_id = uuid.UUID((await bob.get("/me")).json()["id"])
    async with get_sessionmaker()() as session:
        session.add(Task(user_id=bob_id, title="sneaky", sphere_id=uuid.UUID(alice_data.sphere)))
        with pytest.raises(IntegrityError):
            await session.commit()
