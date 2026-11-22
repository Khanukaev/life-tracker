from typing import Any

from httpx import AsyncClient


async def _habit(c: AsyncClient, name: str) -> str:
    return str((await c.post("/habits", json={"name": name, "type": "check"})).json()["id"])


async def test_create_goal_with_steps(alice: AsyncClient) -> None:
    r = await alice.post(
        "/goals",
        json={
            "title": "Finish the course",
            "criterion": "All modules passed",
            "deadline": "2026-12-20",
            "subtasks": [{"title": "Module 1"}, {"title": "Module 2", "deadline": "2026-12-01"}],
        },
    )
    assert r.status_code == 201, r.text
    g = r.json()
    assert g["kind"] == "subtasks"
    assert g["stage"] == 1
    assert [s["title"] for s in g["subtasks"]] == ["Module 1", "Module 2"]
    assert [h["what"] for h in g["history"]] == ["Цель создана"]
    assert g["history"][0]["by"] == "me"


async def test_streak_and_count_goals_need_habits(alice: AsyncClient) -> None:
    r = await alice.post("/goals", json={"title": "Read daily", "kind": "streak"})
    assert r.status_code == 422
    hid = await _habit(alice, "Read")
    g = (
        await alice.post(
            "/goals", json={"title": "Read daily", "kind": "streak", "habit_ids": [hid]}
        )
    ).json()
    assert g["target"] == 10
    assert g["habit_ids"] == [hid]
    c = (
        await alice.post("/goals", json={"title": "Gym", "kind": "count", "habit_ids": [hid]})
    ).json()
    assert (c["window_days"], c["target"]) == (7, 7)


async def test_update_writes_readable_history(alice: AsyncClient) -> None:
    gid = (await alice.post("/goals", json={"title": "Save money"})).json()["id"]
    h1 = await _habit(alice, "No takeout")
    r = await alice.patch(
        f"/goals/{gid}",
        json={"title": "Save 100k", "deadline": "2027-03-01", "stage": 2, "habit_ids": [h1]},
    )
    g = r.json()
    assert g["stage"] == 2
    assert g["history"][0]["what"] == (
        "Изменено: название: Save money → Save 100k; дедлайн: — → 1 мар; этап: 1 → 2; привычки"
    )
    # Keeping one habit and adding another must not trip over the primary key.
    h2 = await _habit(alice, "Budget check")
    g = (await alice.patch(f"/goals/{gid}", json={"habit_ids": [h1, h2]})).json()
    assert sorted(g["habit_ids"]) == sorted([h1, h2])

    g = (await alice.patch(f"/goals/{gid}", json={"archived": True})).json()
    assert g["archived"] is True
    assert g["history"][0]["what"] == "Перенесена в архив"
    assert (await alice.get("/goals?archived=false")).json() == []


async def test_switching_to_streak_without_habits_fails(alice: AsyncClient) -> None:
    gid = (await alice.post("/goals", json={"title": "x"})).json()["id"]
    r = await alice.patch(f"/goals/{gid}", json={"kind": "streak"})
    assert r.status_code == 422


async def test_subtasks_lifecycle(alice: AsyncClient) -> None:
    gid = (await alice.post("/goals", json={"title": "Course"})).json()["id"]
    g = (await alice.post(f"/goals/{gid}/subtasks", json={"title": "Lab 1"})).json()
    sid = g["subtasks"][0]["id"]

    g = (await alice.patch(f"/goals/{gid}/subtasks/{sid}", json={"done": True})).json()
    assert g["subtasks"][0]["done"] is True
    assert g["subtasks"][0]["done_at"] is not None
    g = (await alice.patch(f"/goals/{gid}/subtasks/{sid}", json={"title": "Lab 1–3"})).json()
    g = (await alice.delete(f"/goals/{gid}/subtasks/{sid}")).json()
    assert g["subtasks"] == []
    assert [h["what"] for h in g["history"]] == [
        "Удалён шаг «Lab 1–3»",
        "Шаг «Lab 1» → «Lab 1–3»",
        "Выполнен шаг «Lab 1»",
        "Добавлен шаг «Lab 1»",
        "Цель создана",
    ]
    missing = await alice.patch(f"/goals/{gid}/subtasks/{gid}", json={"done": True})
    assert missing.status_code == 404


async def test_list_is_ordered_and_delete(alice: AsyncClient) -> None:
    ids: list[Any] = []
    for title in ("A", "B", "C"):
        ids.append((await alice.post("/goals", json={"title": title})).json()["id"])
    listed = (await alice.get("/goals")).json()
    assert [g["title"] for g in listed] == ["A", "B", "C"]
    assert (await alice.delete(f"/goals/{ids[0]}")).status_code == 204
    assert len((await alice.get("/goals")).json()) == 2
