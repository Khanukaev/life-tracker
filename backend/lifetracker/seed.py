"""Demo data: two users with different habits and tasks (`make seed`).

Idempotent: users that already exist are skipped. Uses the same services as the API,
so seeded data passes exactly the same validation.
"""

import asyncio
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from lifetracker.core.security import TelegramUser
from lifetracker.db.models import User
from lifetracker.db.session import get_sessionmaker
from lifetracker.schemas.habits import HabitCreate
from lifetracker.schemas.tasks import TaskCreate
from lifetracker.schemas.users import MeUpdate, SettingsUpdate
from lifetracker.services import days, habits, tasks, users
from lifetracker.services.clock import user_now

DEMO_USERS: list[dict[str, Any]] = [
    {
        "tg": TelegramUser(id=900_001, first_name="Анна", username="demo_anna", language_code="ru"),
        "tz": "Europe/Moscow",
        "settings": {"bed_target": "23:30", "usual_bed": "23:45", "usual_wake": "07:30"},
        "habits": [
            {"name": "Отбой вовремя", "type": "bedtime"},
            {"name": "Вода", "type": "count", "config": {"norm": 8}},
            {
                "name": "Чтение",
                "type": "count",
                "config": {"norm": 30, "step": 10},
            },
            {
                "name": "Зарядка",
                "type": "check",
                "schedule": {"kind": "weekdays"},
            },
        ],
        "tasks": [
            {
                "title": "Подготовить отчёт",
                "offset": 0,
                "start_time": "11:00",
                "fresh": True,
                "duration_min": 90,
                "important": True,
            },
            {"title": "Купить продукты", "offset": 0},
            {"title": "Записаться к врачу", "offset": -2},
            {"title": "Спланировать отпуск", "offset": None, "important": True},
        ],
    },
    {
        "tg": TelegramUser(id=900_002, first_name="Илья", username="demo_ilya", language_code="ru"),
        "tz": "Asia/Yekaterinburg",
        "settings": {"bed_target": "00:30", "usual_bed": "01:00", "usual_wake": "08:30"},
        "habits": [
            {
                "name": "Тренировка",
                "type": "check",
                "schedule": {"kind": "cycle", "pattern": "11010"},
            },
            {"name": "Питание по плану", "type": "check"},
            {"name": "Медитация", "type": "count", "config": {"norm": 10, "step": 5}},
        ],
        "tasks": [
            {
                "title": "Контрольная по физике",
                "offset": 3,
                "fresh": True,
                "duration_min": 120,
                "important": True,
            },
            {"title": "Разобрать почту", "offset": 0, "start_time": "22:30", "fresh": True},
        ],
    },
]


async def seed_user(session: AsyncSession, spec: dict[str, Any], now: datetime) -> bool:
    if await session.scalar(select(User.id).where(User.telegram_id == spec["tg"].id)):
        return False
    user = await users.login_telegram_user(session, spec["tg"], timezone=spec["tz"], now=now)
    uid = user.id
    profile = MeUpdate.model_validate({"onboarded": True, "reminder_time": "21:00"})
    await users.update_me(session, uid, profile)
    await users.update_settings(session, uid, SettingsUpdate.model_validate(spec["settings"]))

    habit_ids = {}
    for h in spec["habits"]:
        habit = await habits.create_habit(session, uid, HabitCreate.model_validate(h), now)
        habit_ids[h["name"]] = habit

    today = (await user_now(session, uid, now)).day
    for t in spec["tasks"]:
        body = {k: v for k, v in t.items() if k != "offset"}
        body["date"] = None if t["offset"] is None else today + timedelta(days=t["offset"])
        await tasks.create_task(session, uid, TaskCreate.model_validate(body))

    # A few days of history so streaks and charts have something to show.
    for back in range(1, 6):
        d = today - timedelta(days=back)
        for habit in habit_ids.values():
            value = {
                "check": back % 2 == 1,
                "count": habit.config.get("norm", 1) * back // 4,
            }.get(habit.type)
            if value is not None:
                await days.set_habit_value(session, uid, d, habit.id, value, now)

    return True


async def main() -> None:
    now = datetime.now(UTC)
    async with get_sessionmaker()() as session:
        for spec in DEMO_USERS:
            created = await seed_user(session, spec, now)
            name = spec["tg"].first_name
            print(f"{'created' if created else 'exists '}: {name} (telegram_id={spec['tg'].id})")


if __name__ == "__main__":
    asyncio.run(main())
