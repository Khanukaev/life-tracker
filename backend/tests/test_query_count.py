"""No N+1: the number of SQL queries per screen must not grow with the amount of data."""

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from httpx import AsyncClient
from sqlalchemy import event

from lifetracker.db.session import get_engine


@contextmanager
def count_queries() -> Iterator[list[str]]:
    statements: list[str] = []

    def on_execute(*args: Any) -> None:
        statements.append(str(args[2]).split()[0])

    engine = get_engine().sync_engine
    event.listen(engine, "before_cursor_execute", on_execute)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", on_execute)


async def add_data(c: AsyncClient, habits: int, days: int) -> None:
    ids = []
    for i in range(habits):
        r = await c.post("/habits", json={"name": f"H{i}", "type": "check"})
        ids.append(r.json()["id"])
    for d in range(1, days + 1):
        day = f"2026-11-{22 - d:02d}"
        for hid in ids:
            await c.put(f"/days/{day}/habits/{hid}", json={"value": True})
    for t in range(5):
        await c.post("/tasks", json={"title": f"T{t}", "date": "2026-11-22"})


async def measure(c: AsyncClient) -> dict[str, int]:
    out = {}
    for name, url in [
        ("day", "/views/day"),
        ("now", "/views/now"),
        ("review", "/views/review?period=month"),
        ("tasks", "/views/tasks"),
    ]:
        with count_queries() as q:
            assert (await c.get(url)).status_code == 200
        out[name] = len([s for s in q if s == "SELECT"])
    return out


async def test_query_count_is_constant(alice: AsyncClient, bob: AsyncClient) -> None:
    await add_data(alice, habits=1, days=1)
    await add_data(bob, habits=6, days=12)
    small, big = await measure(alice), await measure(bob)
    assert small == big, (small, big)
    assert small["day"] <= 8
    assert small["tasks"] <= 8
