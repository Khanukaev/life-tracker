"""Generate golden-test fixtures in the original app's export format.

Each fixture is what "Скопировать данные (JSON)" produced (settings, days, tasks, goals)
plus the frozen wall-clock time `now`. Output is deterministic (seeded RNG).

    python3 golden/make_fixtures.py
"""

import json
import random
from datetime import date, timedelta
from pathlib import Path

OUT = Path(__file__).parent / "fixtures"

BASE_HABITS = [
    {
        "key": "bedtime",
        "name": "Отбой до {bed}",
        "type": "sleep",
        "sphere": "Сон",
        "sched": {"t": "daily"},
    },
    {
        "key": "orders",
        "name": "Дело дня",
        "type": "check",
        "sphere": "Работа",
        "sched": {"t": "daily"},
    },
    {
        "key": "study",
        "name": "Практика ≥ {studyH} ч",
        "type": "check",
        "sphere": "Учёба",
        "sched": {"t": "daily"},
    },
    {
        "key": "vitamins",
        "name": "Витамины",
        "type": "check",
        "sphere": "Здоровье",
        "sched": {"t": "daily"},
    },
    {
        "key": "water",
        "name": "Вода {waterL} л",
        "type": "water",
        "sphere": "Здоровье",
        "sched": {"t": "daily"},
    },
    {
        "key": "kbju",
        "name": "КБЖУ + белок {proteinG} г",
        "type": "protein",
        "sphere": "Здоровье",
        "sched": {"t": "daily"},
    },
    {
        "key": "training",
        "name": "Тренировка",
        "type": "check",
        "sphere": "Спорт",
        "sched": {"t": "cycle", "p": "11010", "a": None},
    },
    {
        "key": "stretch",
        "name": "Растяжка",
        "type": "check",
        "sphere": "Спорт",
        "sched": {"t": "every", "n": 2},
    },
    {
        "key": "lang",
        "name": "Язык",
        "type": "check",
        "sphere": "Учёба",
        "sched": {"t": "every", "n": 3},
    },
]
SPHERES = ["Сон", "Работа", "Учёба", "Здоровье", "Спорт"]


def hm(m: int) -> str:
    m %= 1440
    return f"{m // 60:02d}:{m % 60:02d}"


def settings(**over: object) -> dict[str, object]:
    st: dict[str, object] = {
        "startDate": None,
        "targets": {
            "bed": "23:30",
            "waterL": 2.0,
            "glassL": 0.25,
            "proteinG": 120,
            "sleepNeed": 8,
            "studyH": 1,
        },
        "usual": {"bed": "23:30", "wake": "07:30"},
        "spheres": SPHERES,
        "habits": [dict(h) for h in BASE_HABITS],
        "model": {"bias": [0, 0, 0, 0], "n": 0},
    }
    st.update(over)
    return st


def gen_days(
    rng: random.Random,
    today: date,
    n: int,
    *,
    bed: int,
    bed_sd: int,
    dur: int,
    dur_sd: int,
    p_done: float,
    p_sleep: float,
    habits: list[dict[str, object]],
) -> dict[str, object]:
    days: dict[str, object] = {}
    for i in range(n, -1, -1):
        k = today - timedelta(days=i)
        d: dict[str, object] = {"h": {}}
        if rng.random() < p_sleep:
            b = bed + int(rng.gauss(0, bed_sd))
            w = b + dur + int(rng.gauss(0, dur_sd))
            q = rng.choice(["bad", "ok", "ok", "good"])
            d["sleep"] = {"bed": hm(b), "wake": hm(w), "q": q}
        h: dict[str, object] = {}
        for hab in habits:
            key, typ = hab["key"], hab["type"]
            if typ == "sleep":
                continue
            if typ == "water":
                h[key] = rng.randint(0, 10)
            elif typ == "protein":
                h["kbju"] = rng.random() < p_done
                h["proteinOk"] = rng.random() < p_done
            elif key == "study":
                if rng.random() < 0.8:
                    h["studyMin"] = rng.choice([0, 15, 30, 45, 60, 75, 90])
                    h["study"] = h["studyMin"] >= 60
                else:
                    h["study"] = rng.random() < p_done
            elif rng.random() < p_done:
                h[key] = True
        d["h"] = h
        if i < 3 and rng.random() < 0.7:
            fm = rng.choice([600, 780, 900, 1080, 1260])
            v = rng.choice(["low", "ok", "high"])
            d["feel"] = [{"t": hm(fm), "v": v, "pred": 60, "err": rng.choice([-20, -8, 4, 15])}]
        if i > 0 and rng.random() < 0.15:
            d["backfill"] = True
        days[k.isoformat()] = d
    return days


def gen_tasks(rng: random.Random, today: date, n: int) -> dict[str, object]:
    tasks: dict[str, object] = {}
    titles = ["Отчёт", "Звонок", "Почта", "Покупки", "Код-ревью", "Статья", "Уборка", "Встреча"]
    for i in range(n):
        off = rng.choice([None, -5, -2, -1, 0, 0, 0, 0, 1, 1, 3, 10, 20])
        tid = f"t{i:02d}"
        t: dict[str, object] = {
            "id": tid,
            "title": rng.choice(titles) + f" {i}",
            "date": None if off is None else (today + timedelta(days=off)).isoformat(),
            "start": None,
            "dur": rng.choice([15, 30, 45, 60, 90, 120]),
            "energy": rng.choice(["focus", "steady", "recharge"]),
            "sphere": rng.choice([None, *SPHERES]),
            "done": rng.random() < 0.35,
            "by": rng.choice(["me", "me", "claude"]),
        }
        if off is not None and rng.random() < 0.6:
            t["start"] = hm(rng.choice([540, 600, 660, 780, 900, 1020, 1200, 1350, 1470]))
        if t["done"]:
            t["doneAt"] = f"{today.isoformat()}T1{i % 10}:00:00.000Z"
        tasks[tid] = t
    return tasks


def gen_goals(today: date) -> dict[str, object]:
    return {
        "g1": {
            "id": "g1",
            "title": "Шаги",
            "kind": "subtasks",
            "stage": 1,
            "order": 1,
            "deadline": (today + timedelta(days=20)).isoformat(),
            "subtasks": [
                {"id": "s1", "title": "Один", "done": True},
                {
                    "id": "s2",
                    "title": "Два",
                    "done": False,
                    "deadline": (today - timedelta(days=2)).isoformat(),
                },
                {"id": "s3", "title": "Три", "done": False},
            ],
        },
        "g2": {
            "id": "g2",
            "title": "Серия",
            "kind": "streak",
            "habits": ["vitamins"],
            "target": 21,
            "stage": 1,
            "order": 2,
        },
        "g3": {
            "id": "g3",
            "title": "Дни из N",
            "kind": "count",
            "habits": ["training", "stretch"],
            "target": 4,
            "window": 7,
            "stage": 1,
            "order": 3,
        },
        "g4": {
            "id": "g4",
            "title": "Просрочена",
            "kind": "subtasks",
            "stage": 2,
            "order": 4,
            "deadline": (today - timedelta(days=3)).isoformat(),
            "subtasks": [{"id": "s4", "title": "x", "done": False}],
        },
        "g5": {
            "id": "g5",
            "title": "Ручная",
            "kind": "manual",
            "value": 40,
            "stage": 2,
            "order": 5,
        },
        "g6": {
            "id": "g6",
            "title": "Серия база",
            "kind": "streak",
            "habits": ["bedtime", "orders"],
            "target": 7,
            "stage": 1,
            "order": 6,
        },
        "g7": {
            "id": "g7",
            "title": "Пустая",
            "kind": "subtasks",
            "stage": 1,
            "order": 7,
            "archived": True,
        },
    }


def main() -> None:
    OUT.mkdir(exist_ok=True)
    fixtures: dict[str, dict[str, object]] = {}

    fixtures["new_user"] = {
        "now": "2026-11-22T14:35",
        "settings": settings(),
        "days": {},
        "tasks": {},
        "goals": {},
    }

    rng = random.Random(1)
    today = date(2026, 11, 22)
    st = settings()
    fixtures["regular"] = {
        "now": "2026-11-22T13:35",
        "settings": st,
        "days": gen_days(
            rng,
            today,
            45,
            bed=23 * 60 + 30,
            bed_sd=25,
            dur=480,
            dur_sd=30,
            p_done=0.8,
            p_sleep=0.95,
            habits=st["habits"],
        ),  # type: ignore[arg-type]
        "tasks": gen_tasks(rng, today, 24),
        "goals": gen_goals(today),
    }

    rng = random.Random(2)
    st = settings(
        targets={
            "bed": "01:00",
            "waterL": 2.5,
            "glassL": 0.3,
            "proteinG": 140,
            "sleepNeed": 8.5,
            "studyH": 2,
        },
        usual={"bed": "03:00", "wake": "12:30"},
        model={"bias": [-4.2, 3.1, 0, -7.5], "n": 9},
    )
    st["habits"][2]["active"] = False  # type: ignore[index]
    fixtures["night_owl"] = {
        # 02:40 after midnight: still the logical previous day (Nov 21)
        "now": "2026-11-22T02:40",
        "settings": st,
        "days": gen_days(
            rng,
            date(2026, 11, 21),
            30,
            bed=26 * 60 + 30,
            bed_sd=80,
            dur=430,
            dur_sd=70,
            p_done=0.45,
            p_sleep=0.7,
            habits=st["habits"],
        ),  # type: ignore[arg-type]
        "tasks": gen_tasks(rng, date(2026, 11, 21), 18),
        "goals": gen_goals(date(2026, 11, 21)),
    }

    rng = random.Random(3)
    today = date(2026, 3, 29)
    st = settings(startDate="2026-03-10")
    st["habits"][6]["sched"] = {"t": "cycle", "p": "1101100", "a": "2026-03-12"}  # type: ignore[index]
    days = gen_days(
        rng,
        today,
        25,
        bed=23 * 60,
        bed_sd=40,
        dur=560,
        dur_sd=60,
        p_done=0.6,
        p_sleep=0.5,
        habits=st["habits"],
    )  # type: ignore[arg-type]
    fixtures["sparse_oversleep"] = {
        "now": "2026-03-29T09:10",
        "settings": st,
        "days": {k: v for i, (k, v) in enumerate(days.items()) if i % 3 != 1},
        "tasks": gen_tasks(rng, today, 10),
        "goals": gen_goals(today),
    }

    rng = random.Random(4)
    today = date(2026, 6, 14)
    st = settings(
        targets={
            "bed": "22:45",
            "waterL": 3,
            "glassL": 0.5,
            "proteinG": 100,
            "sleepNeed": 7,
            "studyH": 0.5,
        }
    )
    fixtures["early_bird"] = {
        "now": "2026-06-14T21:50",
        "settings": st,
        "days": gen_days(
            rng,
            today,
            60,
            bed=22 * 60 + 30,
            bed_sd=15,
            dur=420,
            dur_sd=20,
            p_done=0.92,
            p_sleep=1.0,
            habits=st["habits"],
        ),  # type: ignore[arg-type]
        "tasks": gen_tasks(rng, today, 30),
        "goals": gen_goals(today),
    }

    for name, fx in fixtures.items():
        (OUT / f"{name}.json").write_text(
            json.dumps(fx, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
        )
    print("wrote", ", ".join(fixtures))


if __name__ == "__main__":
    main()
