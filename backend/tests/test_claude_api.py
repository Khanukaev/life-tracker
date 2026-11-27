"""Reviews list, the MCP token screen API and rate limiting."""

from collections.abc import Iterator
from datetime import UTC, date, datetime

import pytest
from httpx import AsyncClient

from lifetracker.api.app import app
from lifetracker.core.ratelimit import SlidingWindowLimiter
from lifetracker.db.session import get_sessionmaker
from lifetracker.domain.enums import ReviewKind
from lifetracker.services import mcp_tokens, reviews

NOW = datetime(2026, 11, 22, 12, tzinfo=UTC)


async def uid(c: AsyncClient):  # type: ignore[no-untyped-def]
    import uuid

    return uuid.UUID((await c.get("/me")).json()["id"])


async def test_reviews_are_listed_newest_first_and_isolated(
    alice: AsyncClient, bob: AsyncClient
) -> None:
    a = await uid(alice)
    async with get_sessionmaker()() as s:
        await reviews.save_review(s, a, ReviewKind.DAY, "Хороший день", NOW)
        w = await reviews.save_review(
            s, a, ReviewKind.WEEK, "  Неделя  ", NOW, on=date(2026, 11, 16)
        )
    r = (await alice.get("/reviews")).json()
    assert [x["text"] for x in r] == ["Неделя", "Хороший день"]
    assert r[1]["date"] == "2026-11-22"
    assert r[1]["by"] == "claude"
    assert [x["kind"] for x in (await alice.get("/reviews?kind=week")).json()] == ["week"]
    assert (await alice.get(f"/reviews/{w.id}")).json()["text"] == "Неделя"

    assert (await bob.get("/reviews")).json() == []
    assert (await bob.get(f"/reviews/{w.id}")).status_code == 404


async def test_token_screen_flow(alice: AsyncClient) -> None:
    st = (await alice.get("/mcp/token")).json()
    assert st["active"] is False
    assert st["url"].endswith("/mcp")

    issued = (await alice.post("/mcp/token")).json()
    assert issued["token"].startswith("lt_")
    st = (await alice.get("/mcp/token")).json()
    assert st["active"] is True
    assert st["prefix"] == issued["prefix"]
    assert "token" not in st  # never shown again

    async with get_sessionmaker()() as s:
        assert await mcp_tokens.user_by_token(s, issued["token"], NOW) == await uid(alice)
    assert (await alice.delete("/mcp/token")).status_code == 204
    async with get_sessionmaker()() as s:
        assert await mcp_tokens.user_by_token(s, issued["token"], NOW) is None
    assert (await alice.get("/mcp/token")).json()["active"] is False


# ---- rate limiting ----


class FakeClock:
    def __init__(self) -> None:
        self.t = 960.0  # start of a 60 s window

    def __call__(self) -> float:
        return self.t


def test_sliding_window_limits_and_recovers() -> None:
    clock = FakeClock()
    lim = SlidingWindowLimiter(limit=5, period_s=60, clock=clock)
    assert all(lim.hit("a") is None for _ in range(5))
    retry = lim.hit("a")
    assert retry is not None
    assert retry >= 1
    assert lim.hit("b") is None  # other clients are not affected

    clock.t += 60  # next window: the previous one still counts fully at its start
    assert lim.hit("a") is not None
    clock.t += 50  # most of the previous window has slid away
    assert lim.hit("a") is None


@pytest.fixture
def strict_limits() -> Iterator[None]:
    saved = app.state.rate_limiter.limit, app.state.auth_limiter.limit
    app.state.rate_limiter.limit, app.state.auth_limiter.limit = 3, 2
    app.state.rate_limiter.enabled = app.state.auth_limiter.enabled = True
    yield
    app.state.rate_limiter.limit, app.state.auth_limiter.limit = saved
    app.state.rate_limiter._buckets.clear()
    app.state.auth_limiter._buckets.clear()


async def test_api_answers_429_with_retry_after(
    alice: AsyncClient, anon: AsyncClient, strict_limits: None
) -> None:
    codes = [(await alice.get("/me")).status_code for _ in range(4)]
    assert codes == [200, 200, 200, 429]
    r = await alice.get("/me")
    assert r.json()["error"]["code"] == "rate_limited"
    assert int(r.headers["retry-after"]) >= 1
    health = [(await anon.get("/health")).status_code for _ in range(5)]
    assert health == [200] * 5  # never limited


async def test_login_is_limited_by_ip(anon: AsyncClient, strict_limits: None) -> None:
    codes = [
        (await anon.post("/api/v1/auth/telegram", json={"init_data": "x"})).status_code
        for _ in range(3)
    ]
    assert codes == [401, 401, 429]


# ---- «Неделя словами»: notes about a week or a month ----


async def test_notes_per_week_and_month(alice: AsyncClient, bob: AsyncClient) -> None:
    assert (await alice.get("/notes/week")).json() is None
    r = await alice.put("/notes/week", json={"text": "  Пятница самая тяжёлая: пары до вечера  "})
    assert r.status_code == 200, r.text
    note = r.json()
    assert note["start"] == "2026-11-16"  # the Monday of the week of 2026-11-22
    assert note["text"] == "Пятница самая тяжёлая: пары до вечера"

    # Any day of the week finds it; another week has its own.
    assert (await alice.get("/notes/week?anchor=2026-11-18")).json()["text"].startswith("Пятница")
    assert (await alice.get("/notes/week?anchor=2026-11-09")).json() is None
    await alice.put("/notes/month", json={"text": "Сессия"})
    assert (await alice.get("/notes/month?anchor=2026-11-03")).json()["start"] == "2026-11-01"

    await alice.put("/notes/week", json={"text": "Новый текст"})  # one note per week
    assert (await alice.get("/notes/week")).json()["text"] == "Новый текст"
    assert (await alice.put("/notes/week", json={"text": "   "})).json() is None  # cleared
    assert (await alice.get("/notes/week")).json() is None

    assert (await bob.get("/notes/month")).json() is None
    assert (await alice.put("/notes/year", json={"text": "x"})).status_code == 422


# ---- plans and «Что Claude изменил» ----


async def test_plan_is_added_to_the_day_once(alice: AsyncClient, bob: AsyncClient) -> None:
    a = await uid(alice)
    async with get_sessionmaker()() as s:
        plan = await reviews.save_plan(
            s, a,
            [{"title": "Лаба по физике", "start": "10:00", "dur": 180, "note": "твой пик"},
             {"title": "Вода", "start": None, "dur": 5, "note": ""}],
            NOW,
        )  # fmt: skip
    assert (await bob.post(f"/reviews/{plan.id}/apply")).status_code == 404

    r = await alice.post(f"/reviews/{plan.id}/apply")
    assert r.status_code == 201, r.text
    assert [(t["title"], t["start_time"], t["created_by"]) for t in r.json()] == [
        ("Лаба по физике", "10:00", "claude"),
        ("Вода", None, "claude"),
    ]
    assert (await alice.post(f"/reviews/{plan.id}/apply")).status_code == 409
    got = (await alice.get(f"/reviews/{plan.id}")).json()
    assert got["kind"] == "plan"
    assert got["applied_at"] is not None
    assert len((await alice.get("/tasks?view=today")).json()) == 2


async def test_day_view_shows_the_latest_plan_until_it_is_added(
    alice: AsyncClient, bob: AsyncClient
) -> None:
    a = await uid(alice)
    assert (await alice.get("/views/day")).json()["plan"] is None
    async with get_sessionmaker()() as s:
        await reviews.save_plan(s, a, [{"title": "Старый", "dur": 30}], NOW)
        plan = await reviews.save_plan(
            s, a, [{"title": "Лаба", "start": "10:00", "dur": 180, "note": "пик"}],
            NOW.replace(minute=5), text="Утро для лабы",
        )  # fmt: skip
    got = (await alice.get("/views/day")).json()["plan"]
    assert got["id"] == str(plan.id)
    assert got["kind"] == "plan"
    assert got["text"] == "Утро для лабы"
    assert got["items"][0]["title"] == "Лаба"
    assert (await bob.get("/views/day")).json()["plan"] is None
    assert (await alice.get("/views/day?date=2026-11-21")).json()["plan"] is None

    assert (await alice.post(f"/reviews/{plan.id}/apply")).status_code == 201
    assert (await alice.get("/views/day")).json()["plan"] is None


async def test_review_lists_what_claude_changed_since_the_last_one(alice: AsyncClient) -> None:
    from lifetracker.services import journal

    a = await uid(alice)
    async with get_sessionmaker()() as s:
        journal.record(s, a, "Добавил задачу «Отчёт» на 23 ноя", NOW)
        await s.commit()
        first = await reviews.save_review(s, a, ReviewKind.DAY, "День", NOW, used_note=True)
        later = datetime(2026, 11, 22, 18, tzinfo=UTC)
        journal.record(s, a, "Записал сон за 22 ноя: 23:30–07:30", later)
        await s.commit()
        second = await reviews.save_review(s, a, ReviewKind.WEEK, "Неделя", later)
    r1 = (await alice.get(f"/reviews/{first.id}")).json()
    assert r1["changes"] == ["Добавил задачу «Отчёт» на 23 ноя"]
    assert r1["used_note"] is True
    r2 = (await alice.get(f"/reviews/{second.id}")).json()
    assert r2["changes"] == ["Записал сон за 22 ноя: 23:30–07:30"]  # only the newer line
    assert r2["used_note"] is False
