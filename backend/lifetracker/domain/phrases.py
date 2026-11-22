"""Motivational phrase under the day score.

Selection rules come from `pickPhrase` (pool by score, extra pools for a late night,
a lagging minute counter in the evening, growth vs yesterday); the texts are neutral
and work for anyone. The redesign adds a pool for unfinished critical tasks.
"""

from collections.abc import Sequence

from lifetracker.domain.dates import idx_of
from lifetracker.domain.enums import HabitType, Importance
from lifetracker.domain.model import Ctx, Task
from lifetracker.domain.score import DayScore
from lifetracker.domain.sleep import parse_night, planned_night

LOW = (
    "Пустой день не нейтральный. Возьми самый лёгкий пункт и сделай его сейчас.",
    "Один закрытый пункт лучше десяти запланированных.",
    "День ещё можно вытащить. Не обнуляй его.",
    "Начни с пяти минут — дальше пойдёт само.",
)
MID = (
    "Половина — это разгон, а не результат. Добей пару пунктов.",
    "Хороший день собирается из скучных пунктов. Ты уже в движении.",
    "Не тормози на полпути: самое сложное уже позади.",
    "Пара коротких пунктов — и рейтинг заметно вырастет.",
)
HIGH = (
    "Сильный день. Серия ломается тогда, когда расслабился, — держи.",
    "Сегодня ты сильнее вчерашнего себя. Повтори завтра.",
    "Привычки строятся не рывком, а такими днями.",
)
LATE = (
    "Завтрашний подъём решается сегодня: в кровать до {bed}.",
    "Лёг поздно — весь день платишь энергией. Сегодня отбой до {bed}.",
)
MINUTES = ("«{name}» ещё не добрано. 15 минут сейчас лучше, чем ноль.",)
CRITICAL = (
    "Главное ещё не закрыто. Начни с той задачи, что страшнее.",
    "Критичные задачи ждут. Всё остальное подождёт.",
)
GROWTH = "+{delta} к вчера. Так и выглядит прогресс: понемногу, но каждый день."


def phrase_pool(
    score: DayScore,
    delta: int | None,
    ctx: Ctx,
    tasks: Sequence[Task],
    *,
    bed_label: str,
) -> list[str]:
    """All phrases for the situation, rotated so that [0] is today's pick (tap = next one)."""
    pool: list[str] = list(LOW if score.pct < 40 else MID if score.pct < 70 else HIGH)
    rec = ctx.days.get(ctx.today)
    n = parse_night(rec.sleep if rec else None)
    if n and n.bed - planned_night(ctx.settings).bed >= 60:
        pool += [p.format(bed=bed_label) for p in LATE]
    if ctx.now_min >= 16 * 60:
        for item in score.items:
            h = ctx.habit(item.ref) if item.kind == "habit" else None
            if h and h.type == HabitType.MINUTES and item.v < 1:
                pool += [p.format(name=h.name) for p in MINUTES]
                break
    if any(
        t.date == ctx.today and t.importance == Importance.CRITICAL and not t.done for t in tasks
    ):
        pool += CRITICAL
    if delta is not None and delta > 0:
        pool.append(GROWTH.format(delta=delta))
    start = (idx_of(ctx.today) * 7) % len(pool)
    return pool[start:] + pool[:start]


def pick_phrase(
    score: DayScore,
    delta: int | None,
    ctx: Ctx,
    tasks: Sequence[Task],
    *,
    bed_label: str,
    shift: int = 0,
) -> str:
    pool = phrase_pool(score, delta, ctx, tasks, bed_label=bed_label)
    return pool[shift % len(pool)]
