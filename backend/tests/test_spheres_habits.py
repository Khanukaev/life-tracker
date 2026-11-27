import uuid

from httpx import AsyncClient


async def test_sphere_crud(alice: AsyncClient) -> None:
    r = await alice.post("/spheres", json={"name": "Health"})
    assert r.status_code == 201
    sid = r.json()["id"]
    await alice.post("/spheres", json={"name": "Work"})
    names = [s["name"] for s in (await alice.get("/spheres")).json()]
    assert names == ["Health", "Work"]  # appended in order

    r = await alice.patch(f"/spheres/{sid}", json={"name": "Body"})
    assert r.json()["name"] == "Body"
    assert (await alice.delete(f"/spheres/{sid}")).status_code == 204
    assert len((await alice.get("/spheres")).json()) == 1


async def test_sphere_names_are_unique_case_insensitive(alice: AsyncClient) -> None:
    await alice.post("/spheres", json={"name": "Health"})
    r = await alice.post("/spheres", json={"name": "health"})
    assert r.status_code == 409


async def test_create_with_client_id_is_idempotent(alice: AsyncClient) -> None:
    cid = str(uuid.uuid4())
    a = await alice.post("/spheres", json={"id": cid, "name": "Health"})
    b = await alice.post("/spheres", json={"id": cid, "name": "Health"})  # network retry
    assert a.json()["id"] == b.json()["id"] == cid
    assert len((await alice.get("/spheres")).json()) == 1


async def test_deleting_sphere_keeps_habits(alice: AsyncClient) -> None:
    sid = (await alice.post("/spheres", json={"name": "Health"})).json()["id"]
    hid = (
        await alice.post("/habits", json={"name": "Stretch", "type": "check", "sphere_id": sid})
    ).json()["id"]
    await alice.delete(f"/spheres/{sid}")
    habit = (await alice.get(f"/habits/{hid}")).json()
    assert habit["sphere_id"] is None


async def test_habit_types_and_configs(alice: AsyncClient) -> None:
    water = await alice.post(
        "/habits", json={"name": "Water", "type": "water", "config": {"target_l": 2}}
    )
    assert water.status_code == 201, water.text
    assert water.json()["config"] == {"target_l": 2.0, "glass_l": 0.25}  # default glass

    minutes = await alice.post(
        "/habits", json={"name": "Reading", "type": "minutes", "config": {"target_min": 30}}
    )
    assert minutes.json()["config"] == {"target_min": 30, "step_min": 10}

    dual = await alice.post(
        "/habits",
        json={"name": "Nutrition", "type": "dual", "config": {"labels": ["Calories", "Protein"]}},
    )
    assert dual.json()["config"]["labels"] == ["Calories", "Protein"]

    bedtime = await alice.post("/habits", json={"name": "In bed on time", "type": "bedtime"})
    assert "is_key" not in bedtime.json()  # importance is for tasks only


async def test_habit_config_validation(alice: AsyncClient) -> None:
    bad = [
        {"name": "W", "type": "water", "config": {}},  # target is required
        {"name": "M", "type": "minutes", "config": {"target_min": 0}},
        {"name": "D", "type": "dual", "config": {"labels": ["only one"]}},
        {"name": "C", "type": "check", "config": {"unexpected": 1}},
        {"name": "X", "type": "unknown"},
        {"name": "", "type": "check"},
    ]
    for body in bad:
        r = await alice.post("/habits", json=body)
        assert r.status_code == 422, body


async def test_only_one_bedtime_habit(alice: AsyncClient) -> None:
    await alice.post("/habits", json={"name": "Bed", "type": "bedtime"})
    r = await alice.post("/habits", json={"name": "Bed again", "type": "bedtime"})
    assert r.status_code == 409


async def test_schedules(alice: AsyncClient) -> None:
    every = await alice.post(
        "/habits", json={"name": "Run", "type": "check", "schedule": {"kind": "every", "n": 2}}
    )
    assert every.json()["schedule"] == {"kind": "every", "n": 2, "pattern": None, "anchor": None}

    cycle = await alice.post(
        "/habits",
        json={"name": "Gym", "type": "check", "schedule": {"kind": "cycle", "pattern": "11010"}},
    )
    sched = cycle.json()["schedule"]
    assert sched["pattern"] == "11010"
    assert sched["anchor"] == "2026-11-22"  # defaults to the user's logical today

    bad = await alice.post(
        "/habits",
        json={"name": "Gym", "type": "check", "schedule": {"kind": "cycle", "pattern": "12"}},
    )
    assert bad.status_code == 422

    hid = cycle.json()["id"]
    r = await alice.patch(f"/habits/{hid}", json={"schedule": {"kind": "daily"}})
    assert r.json()["schedule"]["pattern"] is None


async def test_habit_update_and_delete(alice: AsyncClient) -> None:
    hid = (
        await alice.post(
            "/habits", json={"name": "Read", "type": "minutes", "config": {"target_min": 20}}
        )
    ).json()["id"]
    r = await alice.patch(
        f"/habits/{hid}", json={"config": {"target_min": 45, "step_min": 15}, "active": False}
    )
    assert r.json()["config"] == {"target_min": 45, "step_min": 15}
    assert r.json()["active"] is False
    assert (await alice.patch(f"/habits/{hid}", json={"config": {"x": 1}})).status_code == 422
    # The type is immutable: unknown field is rejected.
    assert (await alice.patch(f"/habits/{hid}", json={"type": "check"})).status_code == 422

    assert [h["id"] for h in (await alice.get("/habits?active=false")).json()] == [hid]
    assert (await alice.get("/habits?active=true")).json() == []
    assert (await alice.delete(f"/habits/{hid}")).status_code == 204
    assert (await alice.get(f"/habits/{hid}")).status_code == 404
