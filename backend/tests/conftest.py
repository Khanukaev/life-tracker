"""Test setup: a real PostgreSQL database migrated with Alembic, a frozen clock and
helpers that sign Telegram initData exactly like Telegram does."""

import asyncio
import hashlib
import hmac
import json
import os
import subprocess
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlencode

import asyncpg
import pytest
from httpx import ASGITransport, AsyncClient

TEST_DB_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+asyncpg://tracker:tracker@localhost:5432/tracker_test"
)
BOT_TOKEN = "123456:TEST-bot-token"

os.environ.update(
    APP_ENV="test",
    DATABASE_URL=TEST_DB_URL,
    BOT_TOKEN=BOT_TOKEN,
    JWT_SECRET="test-secret-test-secret-test-secret-42",
    LOG_LEVEL="WARNING",
)

from lifetracker.api.app import app  # noqa: E402  (env must be set first)
from lifetracker.api.deps import get_now  # noqa: E402
from lifetracker.db.session import get_engine  # noqa: E402

BACKEND_DIR = Path(__file__).resolve().parents[1]
FROZEN_NOW = datetime(2026, 11, 22, 12, 0, tzinfo=UTC)  # logical day 2026-11-22 in UTC


def _plain_dsn(url: str) -> str:
    return url.replace("postgresql+asyncpg://", "postgresql://")


async def _ensure_database() -> None:
    dsn = _plain_dsn(TEST_DB_URL)
    base, name = dsn.rsplit("/", 1)
    conn = await asyncpg.connect(f"{base}/postgres")
    try:
        if not await conn.fetchval("SELECT 1 FROM pg_database WHERE datname = $1", name):
            await conn.execute(f'CREATE DATABASE "{name}"')
    finally:
        await conn.close()


@pytest.fixture(scope="session", autouse=True)
def migrated_db() -> None:
    """Create the test DB and build the schema through migrations (tests the migrations too)."""
    asyncio.run(_ensure_database())
    env = {**os.environ, "DATABASE_URL": TEST_DB_URL}
    for args in (["downgrade", "base"], ["upgrade", "head"]):
        subprocess.run(  # noqa: S603
            ["uv", "run", "alembic", *args],  # noqa: S607
            cwd=BACKEND_DIR,
            env=env,
            check=True,
            capture_output=True,
        )


@pytest.fixture(autouse=True)
async def clean_db() -> AsyncIterator[None]:
    yield
    async with get_engine().begin() as conn:
        # Every table hangs off users with ON DELETE CASCADE.
        await conn.exec_driver_sql("TRUNCATE users CASCADE")


class Clock:
    def __init__(self) -> None:
        self.now = FROZEN_NOW

    def __call__(self) -> datetime:
        return self.now


@pytest.fixture(autouse=True)
def clock() -> Iterator[Clock]:
    c = Clock()
    app.dependency_overrides[get_now] = c
    yield c
    app.dependency_overrides.pop(get_now, None)


def make_init_data(
    tg_id: int,
    *,
    first_name: str = "Test",
    username: str | None = None,
    language_code: str = "ru",
    auth_date: datetime = FROZEN_NOW,
    bot_token: str = BOT_TOKEN,
) -> str:
    user = {"id": tg_id, "first_name": first_name, "language_code": language_code}
    if username:
        user["username"] = username
    fields = {
        "auth_date": str(int(auth_date.timestamp())),
        "query_id": "AAHdF6IQAAAAAN0XohDhrOrc",
        "user": json.dumps(user, separators=(",", ":"), ensure_ascii=False),
    }
    data_check = "\n".join(f"{k}={v}" for k, v in sorted(fields.items()))
    secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    fields["hash"] = hmac.new(secret, data_check.encode(), hashlib.sha256).hexdigest()
    return urlencode(fields)


@pytest.fixture
async def anon() -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


Login = Callable[..., Awaitable[AsyncClient]]


@pytest.fixture
async def login() -> AsyncIterator[Login]:
    """Factory: an authenticated client for a Telegram user id."""
    clients: list[AsyncClient] = []

    async def _login(tg_id: int, **kw: object) -> AsyncClient:
        c = AsyncClient(transport=ASGITransport(app=app), base_url="http://test/api/v1")
        clients.append(c)
        timezone = kw.pop("timezone", None)
        r = await c.post(
            "/auth/telegram",
            json={"init_data": make_init_data(tg_id, **kw), "timezone": timezone},  # type: ignore[arg-type]
        )
        assert r.status_code == 200, r.text
        c.headers["Authorization"] = f"Bearer {r.json()['access_token']}"
        return c

    yield _login
    for c in clients:
        await c.aclose()


@pytest.fixture
async def alice(login: Login) -> AsyncClient:
    return await login(1001, first_name="Alice")


@pytest.fixture
async def bob(login: Login) -> AsyncClient:
    return await login(2002, first_name="Bob")
