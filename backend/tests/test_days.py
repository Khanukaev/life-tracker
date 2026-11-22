from datetime import UTC, datetime

from httpx import AsyncClient

from tests.conftest import Clock, Login


async def _habit(c: AsyncClient, **body: object) -> str:
    r = await c.post("/habits", json=body)
    assert r.status_code == 201, r.text
    return str(r.json()["id"])


async def test_empty_day(alice: AsyncClient) -> None:
    day = (await alice.get("/days/2026-11-22")).json()
    assert day == {
        "date": "2026-11-22",
        "sleep": None,
        "feel": [],
        "backfill": False,
        "habits": {},
    }


async def test_sleep_crosses_midnight(alice: AsyncClient) -> None:
    r = await alice.put("/days/2026-11-22/sleep", json={"bed": "23:40", "wake": "07:10"})
    assert r.status_code == 200, r.text
    sleep = r.json()["sleep"]
    assert sleep == {"bed": "23:40", "wake": "07:10", "quality": "ok", "duration_min": 450}

    r = await alice.put(
        "/days/2026-11-22/sleep", json={"bed": "02:10", "wake": "10:30", "quality": "good"}
    )
    assert r.json()["sleep"]["duration_min"] == 500

    r = await alice.delete("/days/2026-11-22/sleep")
    assert r.json()["sleep"] is None


async def test_impossible_sleep_is_rejected(alice: AsyncClient) -> None:
    # bed before noon and wake earlier than bed: the night has negative length
    r = await alice.put("/days/2026-11-22/sleep", json={"bed": "03:00", "wake": "02:00"})
    assert r.status_code == 422


async def test_future_day_cannot_be_logged(alice: AsyncClient) -> None:
    r = await alice.put("/days/2026-11-23/sleep", json={"bed": "23:00", "wake": "07:00"})
    assert r.status_code == 422


async def test_logical_day_starts_at_five(login: Login, clock: Clock) -> None:
    # 02:00 in Moscow on Nov 23 is still the logical Nov 22.
    clock.now = datetime(2026, 11, 22, 23, 0, tzinfo=UTC)
    c = await login(5, timezone="Europe/Moscow")
    hid = await _habit(c, name="Vitamins", type="check")
    assert (await c.put(f"/days/2026-11-23/habits/{hid}", json={"value": True})).status_code == 422
    r = await c.put(f"/days/2026-11-22/habits/{hid}", json={"value": True})
    assert r.status_code == 200
    assert r.json()["backfill"] is False


async def test_backfill_flag_and_start_date(alice: AsyncClient) -> None:
    hid = await _habit(alice, name="Vitamins", type="check")
    r = await alice.put(f"/days/2026-11-18/habits/{hid}", json={"value": True})
    assert r.json()["backfill"] is True
    # Logging before the account existed moves the start of history back.
    assert (await alice.get("/me")).json()["start_date"] == "2026-11-18"


async def test_habit_values_are_validated_by_type(alice: AsyncClient) -> None:
    check = await _habit(alice, name="Vitamins", type="check")
    water = await _habit(alice, name="Water", type="water", config={"target_l": 2})
    minutes = await _habit(alice, name="Read", type="minutes", config={"target_min": 30})
    dual = await _habit(alice, name="Food", type="dual", config={"labels": ["kcal", "protein"]})
    bedtime = await _habit(alice, name="Bed", type="bedtime")

    ok = {check: True, water: 5, minutes: 40, dual: {"a": True, "b": False}}
    for hid, value in ok.items():
        r = await alice.put(f"/days/2026-11-22/habits/{hid}", json={"value": value})
        assert r.status_code == 200, (hid, r.text)

    bad = [
        (check, 1),
        (water, True),  # bool is not a glass count
        (water, -1),
        (minutes, "30"),
        (minutes, 2000),
        (dual, {"a": True}),
        (dual, {"a": True, "b": 1}),
        (bedtime, True),  # derived from sleep
    ]
    for hid, value in bad:
        r = await alice.put(f"/days/2026-11-22/habits/{hid}", json={"value": value})
        assert r.status_code == 422, (hid, value)

    day = (await alice.get("/days/2026-11-22")).json()
    assert day["habits"] == ok
    r = await alice.delete(f"/days/2026-11-22/habits/{water}")
    assert water not in r.json()["habits"]


async def test_days_range(alice: AsyncClient) -> None:
    hid = await _habit(alice, name="Vitamins", type="check")
    await alice.put(f"/days/2026-11-20/habits/{hid}", json={"value": True})
    await alice.put("/days/2026-11-22/sleep", json={"bed": "23:00", "wake": "07:00"})
    days = (await alice.get("/days", params={"from": "2026-11-15", "to": "2026-11-22"})).json()
    assert [d["date"] for d in days] == ["2026-11-20", "2026-11-22"]
    r = await alice.get("/days", params={"from": "2026-01-01", "to": "2026-11-22"})
    assert r.status_code == 422  # range too large
