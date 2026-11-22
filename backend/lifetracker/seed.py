"""Demo data: two users with different habits, tasks and goals (`make seed`).

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
from lifetracker.schemas.goals import GoalCreate
from lifetracker.schemas.habits import HabitCreate
from lifetracker.schemas.spheres import SphereCreate
from lifetracker.schemas.tasks import TaskCreate
from lifetracker.schemas.users import MeUpdate, SettingsUpdate
from lifetracker.services import days, goals, habits, spheres, tasks, users
from lifetracker.services.clock import user_now

DEMO_USERS: list[dict[str, Any]] = [
    {
        "tg": TelegramUser(id=900_001, first_name="Анна", username="demo_anna", language_code="ru"),
        "tz": "Europe/Moscow",
        "settings": {"bed_target": "23:30", "usual_bed": "23:45", "usual_wake": "07:30"},
        "spheres": ["Здоровье", "Развитие", "Работа"],
        "habits": [
            {"name": "Отбой вовремя", "type": "bedtime", "sphere": "Здоровье"},
            {"name": "Вода", "type": "water", "config": {"target_l": 2}, "sphere": "Здоровье"},
            {
                "name": "Чтение",
                "type": "minutes",
                "config": {"target_min": 30},
                "is_key": True,
                "sphere": "Развитие",
            },
            {
                "name": "Зарядка",
                "type": "check",
                "schedule": {"kind": "every", "n": 2},
                "sphere": "Здоровье",
            },
        ],
        "tasks": [
            {
                "title": "Подготовить отчёт",
                "offset": 0,
                "start_time": "11:00",
                "energy": "focus",
                "duration_min": 90,
                "importance": "critical",
                "sphere": "Работа",
            },
            {"title": "Купить продукты", "offset": 0, "energy": "recharge"},
            {"title": "Записаться к врачу", "offset": -2, "sphere": "Здоровье"},
            {"title": "Спланировать отпуск", "offset": None, "importance": "important"},
        ],
        "goal": {
            "title": "Читать каждый день",
            "kind": "streak",
            "target": 21,
            "habits": ["Чтение"],
            "sphere": "Развитие",
        },
    },
    {
        "tg": TelegramUser(id=900_002, first_name="Илья", username="demo_ilya", language_code="ru"),
        "tz": "Asia/Yekaterinburg",
        "settings": {"bed_target": "00:30", "usual_bed": "01:00", "usual_wake": "08:30"},
        "spheres": ["Спорт", "Учёба"],
        "habits": [
            {
                "name": "Тренировка",
                "type": "check",
                "schedule": {"kind": "cycle", "pattern": "11010"},
                "is_key": True,
                "sphere": "Спорт",
            },
            {
                "name": "Питание",
                "type": "dual",
                "config": {"labels": ["Калории", "Белок"]},
                "sphere": "Спорт",
            },
            {"name": "Медитация", "type": "minutes", "config": {"target_min": 10, "step_min": 5}},
        ],
        "tasks": [
            {
                "title": "Контрольная по физике",
                "offset": 3,
                "energy": "focus",
                "duration_min": 120,
                "importance": "critical",
                "sphere": "Учёба",
            },
            {"title": "Разобрать почту", "offset": 0, "start_time": "22:30", "energy": "focus"},
        ],
        "goal": {
            "title": "Сдать сессию без долгов",
            "kind": "subtasks",
            "steps": ["Лабораторные 1–3", "Курсовой проект", "Контрольная по физике"],
            "sphere": "Учёба",
        },
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

    sphere_ids = {
        name: (await spheres.create_sphere(session, uid, SphereCreate(name=name))).id
        for name in spec["spheres"]
    }
    habit_ids = {}
    for h in spec["habits"]:
        body = {k: v for k, v in h.items() if k != "sphere"}
        body["sphere_id"] = sphere_ids.get(h.get("sphere", ""))
        habit = await habits.create_habit(session, uid, HabitCreate.model_validate(body), now)
        habit_ids[h["name"]] = habit

    today = (await user_now(session, uid, now)).day
    for t in spec["tasks"]:
        body = {k: v for k, v in t.items() if k not in ("offset", "sphere")}
        body["date"] = None if t["offset"] is None else today + timedelta(days=t["offset"])
        body["sphere_id"] = sphere_ids.get(t.get("sphere", ""))
        await tasks.create_task(session, uid, TaskCreate.model_validate(body))

    # A few days of history so streaks and charts have something to show.
    for back in range(1, 6):
        d = today - timedelta(days=back)
        for habit in habit_ids.values():
            value = {
                "check": back % 2 == 1,
                "water": 6 + back % 3,
                "minutes": 10 * back,
                "dual": {"a": True, "b": back % 2 == 0},
            }.get(habit.type)
            if value is not None:
                await days.set_habit_value(session, uid, d, habit.id, value, now)

    g = spec["goal"]
    await goals.create_goal(
        session,
        uid,
        GoalCreate.model_validate(
            {
                "title": g["title"],
                "kind": g["kind"],
                "target": g.get("target"),
                "habit_ids": [habit_ids[n].id for n in g.get("habits", [])],
                "subtasks": [{"title": s} for s in g.get("steps", [])],
                "sphere_id": sphere_ids.get(g.get("sphere", "")),
            }
        ),
    )
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
