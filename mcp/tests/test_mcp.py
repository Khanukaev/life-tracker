"""MCP server: token auth over HTTP, every tool, and isolation between users."""

import json
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from mcp.server.mcpserver.exceptions import ToolError
from sqlalchemy import select

from lifetracker.db.models import Task
from lifetracker.db.session import get_sessionmaker
from lifetracker.services import mcp_tokens
from lifetracker_mcp import tools

TODAY = "2026-11-22"  # FROZEN_NOW, user time zone UTC
HEADERS = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}


async def uid(c: AsyncClient) -> uuid.UUID:
    return uuid.UUID((await c.get("/me")).json()["id"])


async def token_for(c: AsyncClient) -> str:
    return str((await c.post("/mcp/token")).json()["token"])


Call = Callable[..., Awaitable[Any]]


@pytest.fixture
def as_user() -> Callable[[uuid.UUID], Call]:
    """Call tools in-process as a given user (what TokenAuth does for HTTP requests)."""

    def bind(user_id: uuid.UUID) -> Call:
        async def call(tool: str, /, **args: Any) -> Any:
            ctx = tools.current_user.set(user_id)
            try:  # a tool failure is raised as ToolError with the message the model sees
                result = await tools.server.call_tool(tool, args)
            finally:
                tools.current_user.reset(ctx)
            sc = result.structured_content  # type: ignore[union-attr]
            return sc["result"] if sc and set(sc) == {"result"} else sc

        return call

    return bind


# ---- HTTP transport and auth ----


async def rpc(c: AsyncClient, method: str, params: dict[str, Any], token: str | None) -> Any:
    h = dict(HEADERS)
    if token:
        h["Authorization"] = f"Bearer {token}"
    body = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    return await c.post("/mcp", headers=h, content=json.dumps(body))


async def test_http_requires_a_valid_token(mcp_app: Any, alice: AsyncClient) -> None:
    async with AsyncClient(transport=ASGITransport(app=mcp_app), base_url="http://t") as c:
        assert (await c.get("/health")).status_code == 200
        r = await rpc(c, "tools/list", {}, None)
        assert r.status_code == 401
        assert r.headers["www-authenticate"].startswith("Bearer")
        assert (await rpc(c, "tools/list", {}, "lt_forged")).status_code == 401

        token = await token_for(alice)
        init = await rpc(
            c,
            "initialize",
            {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "test", "version": "1"},
            },
            token,
        )
        assert init.status_code == 200, init.text
        assert init.json()["result"]["serverInfo"]["name"] == "keel"

        listed = await rpc(c, "tools/list", {}, token)
        names = {t["name"] for t in listed.json()["result"]["tools"]}
        assert {"get_today", "log_habit", "save_review", "create_task"} <= names
        assert not {n for n in names if "goal" in n}

        r = await rpc(c, "tools/call", {"name": "get_profile", "arguments": {}}, token)
        assert r.status_code == 200, r.text
        profile = r.json()["result"]["structuredContent"]
        assert profile["name"] == "Alice"
        assert profile["today"] == TODAY

        await alice.post("/mcp/token")  # reissued in the app → the old token is dead at once
        assert (await rpc(c, "tools/list", {}, token)).status_code == 401


async def test_http_requests_are_isolated(
    mcp_app: Any, alice: AsyncClient, bob: AsyncClient
) -> None:
    await alice.post("/tasks", json={"title": "Alice's secret", "date": TODAY})
    tb = await token_for(bob)
    async with AsyncClient(transport=ASGITransport(app=mcp_app), base_url="http://t") as c:
        r = await rpc(c, "tools/call", {"name": "list_tasks", "arguments": {}}, tb)
    assert r.json()["result"]["structuredContent"]["result"] == []


async def test_mcp_rate_limit(mcp_app: Any, alice: AsyncClient) -> None:
    token = await token_for(alice)
    mcp_app.limiter.limit = 2
    async with AsyncClient(transport=ASGITransport(app=mcp_app), base_url="http://t") as c:
        codes = [(await rpc(c, "tools/list", {}, token)).status_code for _ in range(3)]
    assert codes == [200, 200, 429]


# ---- read tools ----


async def setup(c: AsyncClient) -> dict[str, str]:
    vit = (await c.post("/habits", json={"name": "Vitamins", "type": "check"})).json()["id"]
    read = (
        await c.post(
            "/habits", json={"name": "Read", "type": "count", "config": {"norm": 20, "step": 10}}
        )
    ).json()["id"]
    await c.post("/habits", json={"name": "Bed", "type": "bedtime"})
    await c.put(f"/days/{TODAY}/sleep", json={"bed": "23:30", "wake": "07:30"})
    task = (
        await c.post("/tasks", json={"title": "Report", "date": TODAY, "important": True})
    ).json()["id"]
    return {"vit": vit, "read": read, "task": task}


async def test_read_tools(alice: AsyncClient, as_user: Callable[[uuid.UUID], Call]) -> None:
    ids = await setup(alice)
    call = as_user(await uid(alice))

    today = await call("get_today")
    assert today["date"] == TODAY
    assert today["score"]["pct"] >= 0
    assert {h["name"] for h in today["habits"]} == {"Vitamins", "Read", "Bed"}
    assert today["tasks"][0]["title"] == "Report"
    assert {z["zone"] for z in today["energy_zones"]} <= {"focus", "steady", "recharge"}

    assert (await call("get_day", date="2026-11-21"))["relation"] == "past"
    assert (await call("get_energy"))["zone_now"] in {"focus", "steady", "recharge", "sleep"}
    assert "hourly_index" in await call("get_energy", date="2026-11-23")
    assert (await call("get_progress", period="month"))["from"] == "2026-11-01"
    assert (await call("get_week_summary"))["from"] == "2026-11-16"
    assert {h["name"] for h in (await call("get_streaks"))["habits"]} >= {"Vitamins"}
    assert len(await call("list_habits")) == 3
    assert [t["id"] for t in await call("list_tasks", filter="today")] == [ids["task"]]
    assert await call("list_tasks", filter="inbox") == []
    with pytest.raises(ToolError, match="date is required"):
        await call("list_tasks", filter="date")


# ---- write tools ----


async def test_write_tools(alice: AsyncClient, as_user: Callable[[uuid.UUID], Call]) -> None:
    ids = await setup(alice)
    a = await uid(alice)
    call = as_user(a)

    assert (await call("log_habit", habit_id=ids["vit"], done=True))["value"] is True
    assert (await call("log_habit", habit_id=ids["read"], value=25))["value"] == 25
    habits = {h["id"]: h for h in (await alice.get("/views/day")).json()["habits"]}
    assert habits[ids["vit"]]["status"] == "done"
    assert habits[ids["read"]]["status"] == "done"
    bed = next(h for h in await call("list_habits") if h["type"] == "bedtime")
    with pytest.raises(ToolError, match="log_sleep"):
        await call("log_habit", habit_id=bed["id"], done=True)

    s = await call("log_sleep", bed="00:15", wake="08:00", quality="good", date="2026-11-21")
    assert s["sleep"]["duration_min"] == 465
    with pytest.raises(ToolError, match="Invalid input"):
        await call("log_sleep", bed="07:00", wake="07:00")

    t = await call(
        "create_task",
        title="Plan week",
        date="2026-11-23",
        start_time="10:00",
        fresh=True,
        duration_min=60,
    )
    assert t["created_by"] == "claude"
    t = await call("update_task", task_id=t["id"], move_to_inbox=True)
    assert "date" not in t
    assert "start_time" not in t
    assert (await call("complete_task", task_id=ids["task"]))["done"] is True

    h = await call(
        "create_habit",
        name="Walk",
        type="count",
        config={"norm": 30, "step": 10},
        schedule={"kind": "weekdays"},
    )
    assert h["schedule"]["kind"] == "weekdays"
    assert (await call("update_habit", habit_id=h["id"], active=False))["active"] is False
    with pytest.raises(ToolError, match="Invalid input"):
        await call("create_habit", name="Bad", type="count", config={})

    await alice.put("/notes/week", json={"text": "Пятница самая тяжёлая"})
    assert (await call("get_week_summary"))["user_note"] == "Пятница самая тяжёлая"
    r = await call("save_review", kind="week", text="Хорошая неделя.", used_note=True)
    assert r["date"] == TODAY
    review = (await alice.get("/reviews")).json()[0]
    assert (review["text"], review["by"], review["used_note"]) == (
        "Хорошая неделя.",
        "claude",
        True,
    )
    # Every change made above is listed under the review, in plain words.
    assert "Добавил задачу «Plan week» на 23 ноя в 10:00" in review["changes"]
    assert "Записал сон за 21 ноя: 00:15–08:00" in review["changes"]
    assert "Поставил на паузу привычку «Walk»" in review["changes"]

    plan = await call(
        "save_plan", items=[{"title": "Отчёт", "start": "10:00", "dur": 90, "note": "пик"}]
    )
    assert plan["items"] == 1
    added = await alice.post(f"/reviews/{plan['id']}/apply")
    assert [t["title"] for t in added.json()] == ["Отчёт"]

    async with get_sessionmaker()() as session:
        mine = (await session.scalars(select(Task).where(Task.user_id == a))).all()
        assert {t.title for t in mine} == {"Report", "Plan week", "Отчёт"}
        assert {t.created_by.value for t in mine if t.title == "Plan week"} == {"claude"}


# ---- isolation ----


async def test_cannot_touch_another_users_data(
    alice: AsyncClient, bob: AsyncClient, as_user: Callable[[uuid.UUID], Call]
) -> None:
    ids = await setup(alice)
    mallory = as_user(await uid(bob))
    attempts: list[tuple[str, dict[str, Any]]] = [
        ("log_habit", {"habit_id": ids["vit"], "done": True}),
        ("update_habit", {"habit_id": ids["vit"], "name": "pwned"}),
        ("update_task", {"task_id": ids["task"], "title": "pwned"}),
        ("complete_task", {"task_id": ids["task"]}),
    ]
    for name, args in attempts:
        with pytest.raises(ToolError, match="not found"):
            await mallory(name, **args)

    alice_today = await as_user(await uid(alice))("get_today")
    assert all(h["value"] is None for h in alice_today["habits"])
    assert alice_today["tasks"][0]["title"] == "Report"
    assert not alice_today["tasks"][0]["done"]
    assert await mallory("list_habits") == []


async def test_tools_refuse_without_a_user() -> None:
    with pytest.raises(ToolError, match="Not authenticated"):
        await tools.server.call_tool("get_today", {})


async def test_token_last_used_is_throttled(alice: AsyncClient, clock: Any) -> None:
    token = await token_for(alice)
    async with get_sessionmaker()() as s:
        await mcp_tokens.user_by_token(s, token, clock.now)
        first = (await mcp_tokens.active_token(s, await uid(alice))).last_used_at  # type: ignore[union-attr]
        await mcp_tokens.user_by_token(s, token, clock.now.replace(minute=2))
        same = (await mcp_tokens.active_token(s, await uid(alice))).last_used_at  # type: ignore[union-attr]
    assert first == same == clock.now
