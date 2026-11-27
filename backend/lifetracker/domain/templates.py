"""Optional habit templates offered during onboarding. Neutral: no assumptions about the user."""

from typing import Any

HABIT_TEMPLATES: list[dict[str, Any]] = [
    {
        "key": "bedtime",
        "name": "Отбой вовремя",
        "type": "bedtime",
        "hint": "Отмечается сам по времени, когда лёг",
    },
    {
        "key": "water",
        "name": "Вода",
        "type": "count",
        "config": {"norm": 8, "step": 1},
        "hint": "8 стаканов в день",
    },
    {
        "key": "reading",
        "name": "Чтение",
        "type": "count",
        "config": {"norm": 20, "step": 10},
        "hint": "20 минут в день",
    },
    {
        "key": "workout",
        "name": "Тренировка",
        "type": "check",
        "schedule": {"kind": "cycle", "pattern": "1101100"},
        "hint": "по циклу: 4 дня из 7",
    },
    {
        "key": "morning",
        "name": "Зарядка",
        "type": "check",
        "hint": "каждый день",
    },
    {
        "key": "walk",
        "name": "Прогулка",
        "type": "check",
        "hint": "каждый день",
    },
    {
        "key": "meditation",
        "name": "Медитация",
        "type": "count",
        "config": {"norm": 10, "step": 5},
        "hint": "10 минут",
    },
    {
        "key": "language",
        "name": "Иностранный язык",
        "type": "count",
        "config": {"norm": 15, "step": 5},
        "schedule": {"kind": "weekdays"},
        "hint": "по будням, 15 минут",
    },
    {
        "key": "no_sugar",
        "name": "Без сладкого",
        "type": "check",
        "hint": "каждый день",
    },
]
