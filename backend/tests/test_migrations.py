"""Data migrations, run against a database of their own.

The suite's main database is built by `alembic upgrade head` (see conftest), which proves
the schema migrations apply. This module checks what a migration does to existing rows:
it stops at the revision before, writes data in the old shape, upgrades, and reads back.
"""

import asyncio
import os
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import asyncpg
import pytest

from tests.conftest import TEST_DB_URL, _plain_dsn

pytestmark = pytest.mark.nodb

BACKEND_DIR = Path(__file__).resolve().parents[1]
DB_URL = TEST_DB_URL.rsplit("/", 1)[0] + "/tracker_migrations_test"
DSN = _plain_dsn(DB_URL)
BEFORE_HABIT_TYPES = "b41c9e2d7a10"


def alembic(*args: str) -> None:
    subprocess.run(  # noqa: S603
        ["uv", "run", "alembic", *args],  # noqa: S607
        cwd=BACKEND_DIR,
        env={**os.environ, "DATABASE_URL": DB_URL},
        check=True,
        capture_output=True,
    )


async def recreate_db() -> None:
    base, name = DSN.rsplit("/", 1)
    conn = await asyncpg.connect(f"{base}/postgres")
    try:
        await conn.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
        await conn.execute(f'CREATE DATABASE "{name}"')
    finally:
        await conn.close()


def run(coro: object) -> object:
    with ThreadPoolExecutor(1) as pool:
        return pool.submit(asyncio.run, coro).result()  # type: ignore[arg-type]


OLD_DATA = """
INSERT INTO users (id, telegram_id, first_name, language, timezone, morning_ping, haptics,
                   onboarded, bot_blocked, start_date)
VALUES ('00000000-0000-7000-8000-000000000001', 1, 'A', 'ru', 'UTC', false, true, true, false,
        '2026-11-01');
INSERT INTO habits (id, user_id, name, type, config, sched_kind, sched_n, active, position,
                    created_at)
VALUES
  ('00000000-0000-7000-8000-0000000000a1', '00000000-0000-7000-8000-000000000001', 'Water',
   'water', '{"target_l": 2.1, "glass_l": 0.25}', 'daily', NULL, true, 0, '2026-11-01'),
  ('00000000-0000-7000-8000-0000000000a2', '00000000-0000-7000-8000-000000000001', 'Read',
   'minutes', '{"target_min": 30, "step_min": 15}', 'daily', NULL, true, 1, '2026-11-01'),
  ('00000000-0000-7000-8000-0000000000a3', '00000000-0000-7000-8000-000000000001', 'Food',
   'dual', '{"labels": ["Kcal", "Protein"]}', 'daily', NULL, true, 2, '2026-11-01'),
  ('00000000-0000-7000-8000-0000000000a4', '00000000-0000-7000-8000-000000000001', 'Run',
   'check', '{}', 'every', 3, true, 3, '2026-11-01');
INSERT INTO habit_logs (habit_id, date, user_id, value) VALUES
  ('00000000-0000-7000-8000-0000000000a3', '2026-11-20', '00000000-0000-7000-8000-000000000001',
   '{"a": true, "b": false}'),
  ('00000000-0000-7000-8000-0000000000a3', '2026-11-21', '00000000-0000-7000-8000-000000000001',
   '{"a": true, "b": true}'),
  ('00000000-0000-7000-8000-0000000000a4', '2026-11-18', '00000000-0000-7000-8000-000000000001',
   'true'),
  ('00000000-0000-7000-8000-0000000000a4', '2026-11-19', '00000000-0000-7000-8000-000000000001',
   'false');
"""


async def write_old_and_read_new() -> dict[str, object]:
    conn = await asyncpg.connect(DSN)
    try:
        await conn.execute(OLD_DATA)
    finally:
        await conn.close()
    await asyncio.to_thread(alembic, "upgrade", "head")
    conn = await asyncpg.connect(DSN)
    try:
        habits = {
            r["name"]: dict(r)
            for r in await conn.fetch(
                "SELECT name, type, config::text AS config, sched_kind, sched_pattern,"
                " sched_anchor::text AS anchor FROM habits"
            )
        }
        food = [
            r["value"]
            for r in await conn.fetch(
                "SELECT value::text FROM habit_logs l JOIN habits h ON h.id = l.habit_id"
                " WHERE h.name = 'Food' ORDER BY l.date"
            )
        ]
    finally:
        await conn.close()
    return {"habits": habits, "food": food}


def test_old_habit_types_become_check_and_count() -> None:
    run(recreate_db())
    alembic("upgrade", BEFORE_HABIT_TYPES)
    got = run(write_old_and_read_new())
    assert isinstance(got, dict)
    h = got["habits"]

    assert h["Water"]["type"] == "count"
    assert h["Water"]["config"] == '{"norm": 9, "step": 1}'  # 2.1 l / 0.25 l, rounded up
    assert h["Read"]["config"] == '{"norm": 30, "step": 15}'
    assert h["Food"]["config"] == '{"norm": 2, "step": 1}'
    assert got["food"] == ["1", "2"]  # {"a", "b"} -> how many of the two were done

    # Every 3 days -> the cycle 100, anchored on the last day it was really done.
    assert (h["Run"]["sched_kind"], h["Run"]["sched_pattern"]) == ("cycle", "100")
    assert h["Run"]["anchor"] == "2026-11-18"

    alembic("downgrade", BEFORE_HABIT_TYPES)  # and the way back still applies
