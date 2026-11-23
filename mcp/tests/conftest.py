"""MCP tests reuse the backend's database fixtures (real PostgreSQL, frozen clock)."""

import asyncio
import sys
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from typing import Any

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from tests.conftest import (  # noqa: F401  (fixtures are registered by import)
    Clock,
    alice,
    anon,
    bob,
    clean_db,
    clock,
    login,
    migrated_db,
    no_rate_limit,
)

from lifetracker_mcp import tools


@pytest.fixture(autouse=True)
def frozen_mcp_clock(clock: Clock) -> Iterator[None]:  # noqa: F811
    tools.clock = clock
    yield
    tools.clock = tools.utc_now


class Lifespan:
    """Drive an ASGI app's lifespan (startup/shutdown) like uvicorn does."""

    def __init__(self, app: Any) -> None:
        self.app = app
        self.inbox: asyncio.Queue[dict[str, str]] = asyncio.Queue()
        self.outbox: asyncio.Queue[dict[str, str]] = asyncio.Queue()

    async def __aenter__(self) -> None:
        self.task = asyncio.create_task(
            self.app({"type": "lifespan"}, self.inbox.get, self.outbox.put)
        )
        await self.inbox.put({"type": "lifespan.startup"})
        msg = await self.outbox.get()
        assert msg["type"] == "lifespan.startup.complete", msg

    async def __aexit__(self, *exc: object) -> None:
        await self.inbox.put({"type": "lifespan.shutdown"})
        await self.outbox.get()
        await self.task


@pytest.fixture
async def mcp_app() -> AsyncIterator[Any]:
    from lifetracker_mcp.app import create_app

    app = create_app()
    async with Lifespan(app):
        yield app
