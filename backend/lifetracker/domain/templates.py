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
        "type": "water",
        "config": {"target_l": 2, "glass_l": 0.25},
        "hint": "2 л, стаканами по 0,25",
    },
    {
        "key": "reading",
        "name": "Чтение",
        "type": "minutes",
        "config": {"target_min": 20, "step_min": 10},
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
        "type": "minutes",
        "config": {"target_min": 10, "step_min": 5},
        "hint": "10 минут",
    },
    {
        "key": "language",
        "name": "Иностранный язык",
        "type": "minutes",
        "config": {"target_min": 15, "step_min": 5},
        "schedule": {"kind": "every", "n": 2},
        "hint": "через день по 15 минут",
    },
    {
        "key": "nutrition",
        "name": "Питание",
        "type": "dual",
        "config": {"labels": ["Калории", "Белок"]},
        "hint": "две отметки за день",
    },
    {
        "key": "no_sugar",
        "name": "Без сладкого",
        "type": "check",
        "hint": "каждый день",
    },
]
