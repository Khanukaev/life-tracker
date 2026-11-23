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
