"""Latency benchmark for the aggregated screens on a heavy user (a year of data).

    make db && uv run --env-file .env python backend/scripts/bench_views.py

Creates (or recreates) a benchmark user with 10 habits × 365 days of logs, sleep
every night, 300 tasks and 8 goals, then measures p50/p95 of each screen in-process
(ASGI, no network). Budget from the spec: p95 < 100 ms.
"""

import asyncio
import random
import statistics
import time
from datetime import UTC, date, datetime, timedelta
from datetime import time as dtime

from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, insert

from lifetracker.api.app import app
from lifetracker.core.config import get_settings
from lifetracker.core.security import TelegramUser, create_access_token
from lifetracker.db import models as m
from lifetracker.db.base import new_id
from lifetracker.db.session import get_sessionmaker
from lifetracker.services.users import login_telegram_user

TG_ID = 999_999_001
DAYS = 365
RUNS = 40


async def build_user() -> str:
    rng = random.Random(7)
    now = datetime.now(UTC)
    async with get_sessionmaker()() as s:
        await s.execute(delete(m.User).where(m.User.telegram_id == TG_ID))
        await s.commit()
        user = await login_telegram_user(
            s, TelegramUser(TG_ID, "Bench", None, "ru"), timezone="Europe/Moscow", now=now
        )
        uid = user.id
        today = now.date()
        user.start_date = today - timedelta(days=DAYS)
        types = [
            "bedtime",
            "check",
            "check",
            "check",
            "water",
            "minutes",
            "dual",
            "check",
            "check",
            "check",
        ]
        cfg = {
            "water": {"target_l": 2, "glass_l": 0.25},
            "minutes": {"target_min": 30, "step_min": 10},
            "dual": {"labels": ["a", "b"]},
        }
        habits = []
        for i, t in enumerate(types):
            hid = new_id()
            sched = {"sched_kind": "every", "sched_n": 2} if i == 8 else {"sched_kind": "daily"}
            habits.append((hid, t))
            await s.execute(
                insert(m.Habit).values(
                    id=hid,
                    user_id=uid,
                    name=f"Habit {i}",
                    type=t,
                    is_key=i < 2,
                    config=cfg.get(t, {}),
                    active=True,
                    position=i,
                    **sched,
                )
            )
        day_rows, log_rows = [], []
        for d in range(DAYS + 1):
            k = today - timedelta(days=d)
            bed = 23 * 60 + rng.randint(-40, 90)
            day_rows.append(
                {
                    "user_id": uid,
                    "date": k,
                    "sleep_bed": dtime((bed // 60) % 24, bed % 60),
                    "sleep_wake": dtime(7, rng.randint(0, 59)),
                    "sleep_quality": "ok",
                    "feel": [],
                    "backfill": False,
                }
            )
            for hid, t in habits:
                if t == "bedtime" or rng.random() < 0.25:
                    continue
                value = {
                    "water": rng.randint(0, 9),
                    "minutes": rng.choice([10, 20, 30, 45]),
                    "dual": {"a": True, "b": rng.random() < 0.6},
                }.get(t, True)
                log_rows.append({"habit_id": hid, "date": k, "user_id": uid, "value": value})
        await s.execute(insert(m.Day), day_rows)
        await s.execute(insert(m.HabitLog), log_rows)
        await s.execute(
            insert(m.Task),
            [
                {
                    "id": new_id(),
                    "user_id": uid,
                    "title": f"Task {i}",
                    "description": "",
                    "date": today + timedelta(days=rng.randint(-60, 14)) if i % 7 else None,
                    "start_time": dtime(rng.randint(9, 20), 0) if i % 3 == 0 and i % 7 else None,
                    "duration_min": rng.choice([30, 60, 90]),
                    "energy": rng.choice(["focus", "steady", "recharge"]),
                    "importance": rng.choice(["normal", "normal", "important", "critical"]),
                    "done": rng.random() < 0.6,
                    "created_by": "me",
                }
                for i in range(300)
            ],
        )
        for g in range(8):
            gid = new_id()
            kind = ["subtasks", "streak", "count", "manual"][g % 4]
            await s.execute(
                insert(m.Goal).values(
                    id=gid,
                    user_id=uid,
                    title=f"Goal {g}",
                    criterion="",
                    kind=kind,
                    stage=1,
                    archived=False,
                    position=g,
                    target=10 if kind != "subtasks" else None,
                    window_days=14 if kind == "count" else None,
                    manual_pct=30 if kind == "manual" else None,
                )
            )
            if kind in ("streak", "count"):
                await s.execute(
                    insert(m.GoalHabit).values(goal_id=gid, habit_id=habits[1][0], user_id=uid)
                )
            await s.execute(
                insert(m.GoalSubtask),
                [
                    {
                        "id": new_id(),
                        "goal_id": gid,
                        "title": f"Step {j}",
                        "done": j < 2,
                        "position": j,
                    }
                    for j in range(5)
                ],
            )
        await s.commit()
        print(f"user: {DAYS} days, {len(log_rows)} habit logs, 300 tasks, 8 goals")
        st = get_settings()
        return create_access_token(
            uid, secret=st.jwt_secret.get_secret_value(), ttl_s=3600, now=now
        )


async def main() -> None:
    token = await build_user()
    headers = {"Authorization": f"Bearer {token}"}
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://b/api/v1", headers=headers
    ) as c:
        for name, url in [
            ("Day", "/views/day"),
            ("Now", "/views/now"),
            ("Review (month)", "/views/review?period=month"),
            ("Review (week)", "/views/review?period=week"),
            ("Slot", f"/views/slot?date={date.today().isoformat()}&dur=60&energy=focus"),
            ("Tasks today", "/tasks?view=today"),
        ]:
            await c.get(url)  # warm-up
            ms = []
            for _ in range(RUNS):
                t0 = time.perf_counter()
                r = await c.get(url)
                ms.append((time.perf_counter() - t0) * 1000)
                assert r.status_code == 200, r.text
            ms.sort()
            p95 = ms[int(len(ms) * 0.95) - 1]
            print(f"{name:16} p50 {statistics.median(ms):6.1f} ms   p95 {p95:6.1f} ms")


if __name__ == "__main__":
    asyncio.run(main())
