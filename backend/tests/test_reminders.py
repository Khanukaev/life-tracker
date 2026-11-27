"""Reminder scheduling, exactly-once delivery, marking from buttons and MCP tokens."""

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, date, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from lifetracker.core.errors import NotFoundError
from lifetracker.db.models import McpToken
from lifetracker.db.session import get_sessionmaker
from lifetracker.domain.enums import DeliveryKind
from lifetracker.services import mcp_tokens, reminders

EVENING = DeliveryKind.EVENING
MORNING = DeliveryKind.MORNING


def at(h: int, m: int = 0, day: int = 22) -> datetime:
    return datetime(2026, 11, day, h, m, tzinfo=UTC)


@pytest.fixture
async def session() -> AsyncIterator[AsyncSession]:
    async with get_sessionmaker()() as s:
        yield s


async def uid(c: AsyncClient) -> uuid.UUID:
    return uuid.UUID((await c.get("/me")).json()["id"])


async def due_ids(session: AsyncSession, kind: DeliveryKind, now: datetime) -> set[uuid.UUID]:
    return {d.user_id for d in await reminders.due_reminders(session, kind, now)}


# ---- who is due ----


async def test_evening_due_in_users_own_time_zone(
    alice: AsyncClient, bob: AsyncClient, session: AsyncSession
) -> None:
    await alice.patch("/me", json={"timezone": "Europe/Moscow", "reminder_time": "21:00"})
    await bob.patch("/me", json={"timezone": "Asia/Tokyo", "reminder_time": "21:00"})
    a, b = await uid(alice), await uid(bob)

    assert await due_ids(session, EVENING, at(17, 59)) == set()  # 20:59 Moscow
    assert await due_ids(session, EVENING, at(18, 0)) == {a}  # 21:00 Moscow
    assert await due_ids(session, EVENING, at(12, 5)) == {b}  # 21:05 Tokyo
    assert await due_ids(session, EVENING, at(21, 0)) == set()  # Moscow: grace is over


async def test_logical_day_for_reminder_after_midnight(
    alice: AsyncClient, session: AsyncSession
) -> None:
    await alice.patch("/me", json={"reminder_time": "00:30"})  # UTC user
    due = await reminders.due_reminders(session, EVENING, at(0, 40, day=23))
    assert [d.day for d in due] == [date(2026, 11, 22)]  # still the evening of the 22nd


async def test_no_reminder_when_off_or_blocked(alice: AsyncClient, session: AsyncSession) -> None:
    assert await due_ids(session, EVENING, at(21)) == set()  # reminder_time is null
    await alice.patch("/me", json={"reminder_time": "21:00"})
    me = (await alice.get("/me")).json()
    await reminders.set_bot_blocked(session, 1001, True)
    assert await due_ids(session, EVENING, at(21)) == set()
    await reminders.set_bot_blocked(session, 1001, False)
    assert await due_ids(session, EVENING, at(21)) == {uuid.UUID(me["id"])}


async def test_morning_ping_after_usual_wake_unless_sleep_logged(
    alice: AsyncClient, session: AsyncSession
) -> None:
    a = await uid(alice)
    assert await due_ids(session, MORNING, at(8)) == set()  # opt-in
    await alice.patch("/me", json={"morning_ping": True})
    assert await due_ids(session, MORNING, at(7, 59)) == set()  # usual wake 07:30 + 30 min
    assert await due_ids(session, MORNING, at(8)) == {a}
    await alice.put("/days/2026-11-22/sleep", json={"bed": "23:30", "wake": "07:30"})
    assert await due_ids(session, MORNING, at(8)) == set()


# ---- exactly once ----


async def test_claim_is_exactly_once(alice: AsyncClient, session: AsyncSession) -> None:
    await alice.patch("/me", json={"reminder_time": "21:00"})
    [d] = await reminders.due_reminders(session, EVENING, at(21))
    assert await reminders.claim(session, d) is True
    assert await reminders.claim(session, d) is False  # a second worker gets nothing
    assert await due_ids(session, EVENING, at(21, 30)) == set()

    await reminders.release(session, d)  # transient failure → retried on the next tick
    assert await due_ids(session, EVENING, at(21, 30)) == {d.user_id}


# ---- content and marking ----


async def setup_habits(c: AsyncClient) -> dict[str, str]:
    ids = {}
    for name, body in {
        "vit": {"name": "Vitamins", "type": "check"},
        "read": {"name": "Read", "type": "count", "config": {"norm": 30, "step": 10}},
        "water": {"name": "Water", "type": "count", "config": {"norm": 8}},
        "food": {"name": "Food", "type": "check"},
        "bed": {"name": "Bed", "type": "bedtime"},
    }.items():
        r = await c.post("/habits", json=body)
        assert r.status_code in (200, 201), r.text
        ids[name] = r.json()["id"]
    await c.post("/tasks", json={"title": "Report", "date": "2026-11-22", "importance": "critical"})
    await c.post("/tasks", json={"title": "Chill", "date": "2026-11-22"})
    return ids


async def test_evening_content(alice: AsyncClient, session: AsyncSession) -> None:
    ids = await setup_habits(alice)
    await alice.put(f"/days/2026-11-22/habits/{ids['vit']}", json={"value": True})
    e = await reminders.evening_content(session, await uid(alice), date(2026, 11, 22), at(21))
    assert e.score is not None
    assert {h.name for h in e.habits} == {"Read", "Water", "Food"}  # bedtime is never here
    assert (e.done_habits, e.total_habits) == (1, 4)
    assert e.critical == ["Report"]


async def test_mark_buttons_per_habit_type(alice: AsyncClient, session: AsyncSession) -> None:
    ids = await setup_habits(alice)
    a, day = await uid(alice), date(2026, 11, 22)
    for key in ("vit", "read", "water", "food"):
        await reminders.mark_habit(session, a, uuid.UUID(ids[key]), day, True, at(21))
    habits = {h["id"]: h for h in (await alice.get("/views/day")).json()["habits"]}
    assert all(habits[ids[k]]["status"] == "done" for k in ("vit", "read", "water", "food"))
    assert habits[ids["water"]]["value"] == 8  # ✅ fills the norm

    await reminders.mark_habit(session, a, uuid.UUID(ids["vit"]), day, False, at(21))
    e = await reminders.evening_content(session, a, day, at(21))
    assert e.habits == []  # ❌ is an answer too: the habit leaves the list

    with pytest.raises(Exception, match="sleep"):
        await reminders.mark_habit(session, a, uuid.UUID(ids["bed"]), day, True, at(21))


async def test_cannot_mark_someone_elses_habit(
    alice: AsyncClient, bob: AsyncClient, session: AsyncSession
) -> None:
    ids = await setup_habits(alice)
    with pytest.raises(NotFoundError):
        await reminders.mark_habit(
            session, await uid(bob), uuid.UUID(ids["vit"]), date(2026, 11, 22), True, at(21)
        )
    habits = {h["id"]: h for h in (await alice.get("/views/day")).json()["habits"]}
    assert habits[ids["vit"]]["value"] is None


# ---- MCP tokens ----


async def test_token_issue_rotate_and_hash_only(alice: AsyncClient, session: AsyncSession) -> None:
    a = await uid(alice)
    t1 = await mcp_tokens.issue_token(session, a, at(10))
    assert t1.startswith("lt_")
    assert len(t1) > 40
    assert await mcp_tokens.user_by_token(session, t1, at(11)) == a

    t2 = await mcp_tokens.issue_token(session, a, at(12))
    assert await mcp_tokens.user_by_token(session, t1, at(13)) is None  # old one revoked
    assert await mcp_tokens.user_by_token(session, t2, at(13)) == a
    assert await mcp_tokens.user_by_token(session, "lt_forged", at(13)) is None

    rows = (await session.scalars(select(McpToken).where(McpToken.user_id == a))).all()
    assert len(rows) == 2
    assert all(t1 not in r.token_hash and t2 not in r.token_hash for r in rows)
    assert (await mcp_tokens.active_token(session, a)) is not None
