""" "Где проседаешь" — weak spots over a period (port of `weakSpots`).

Each alert keeps the original weight and text (checked by the golden tests) and adds
a title/subtitle pair for the redesigned card. The original's goal alerts are gone with
goals.
"""

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import date

from lifetracker.domain.dates import add_days, fmt_date_short, fmt_dur, fmt_hm
from lifetracker.domain.energy import EnergyDay
from lifetracker.domain.habits import active_habits, habit_rate_range, habit_status, miss_run
from lifetracker.domain.model import Ctx, Task
from lifetracker.domain.sleep import parse_night, planned_night

MAX_ALERTS = 7
SEVERE_WEIGHT = 10


def plural(n: int, one: str, few: str, many: str) -> str:
    n10, n100 = n % 10, n % 100
    if n10 == 1 and n100 != 11:
        return one
    if 2 <= n10 <= 4 and not 12 <= n100 <= 14:
        return few
    return many


@dataclass(slots=True)
class Alert:
    kind: str
    w: int
    text: str  # original wording
    title: str
    subtitle: str = ""
    data: dict[str, object] = field(default_factory=dict)

    @property
    def severe(self) -> bool:
        return self.w >= SEVERE_WEIGHT


def _last_done(ctx: Ctx, h_index: int) -> date | None:
    h = active_habits(ctx)[h_index]
    k = ctx.today
    while k >= ctx.start_date:
        if habit_status(h, k, ctx) == "done":
            return k
        k = add_days(k, -1)
    return None


def weak_spots(
    ctx: Ctx,
    tasks: Sequence[Task],
    energy_today: EnergyDay,
    start: date,
    end: date,
    period_word: str,
) -> list[Alert]:
    """Alerts for [start, end]; `period_word` is "неделю" or "месяц" ("за неделю")."""
    out: list[Alert] = []
    habits = active_habits(ctx)

    for i, h in enumerate(habits):
        run = miss_run(h, ctx)
        if run >= 2:
            days_w = "дня" if run < 5 else "дней"
            last = _last_done(ctx, i)
            out.append(
                Alert(
                    "miss_run", 10 + run, f"{h.name}: {run} {days_w} подряд мимо.",
                    f"{h.name} — {run} {plural(run, 'день', 'дня', 'дней')} подряд мимо",
                    f"Последний раз — {fmt_date_short(last)}" if last else "Ещё ни разу",
                    {"habit": h.id, "days": run},
                )
            )  # fmt: skip
    for h in habits:
        r = habit_rate_range(h, ctx, start, end)
        if r.pct is not None and r.pct < 60 and miss_run(h, ctx) < 2 and r.done + r.miss >= 3:
            out.append(
                Alert(
                    "low_rate", 5, f"{h.name}: {r.pct}% за {period_word}.",
                    f"«{h.name}» — {r.pct}%", "Ниже 60% — привычка не держится",
                    {"habit": h.id, "pct": r.pct},
                )
            )  # fmt: skip

    overdue = [t for t in tasks if not t.done and t.date is not None and t.date < ctx.today]
    if overdue:
        oldest = min(t.date for t in overdue if t.date is not None)
        crit = sum(1 for t in overdue if t.importance == "critical")
        n = len(overdue)
        out.append(
            Alert(
                "overdue_tasks", 9 + n,
                f"Просрочено задач: {n}, самая старая с {fmt_date_short(oldest)}.",
                f"{n} {plural(n, 'просроченная', 'просроченные', 'просроченных')} "
                f"{plural(n, 'задача', 'задачи', 'задач')}",
                (f"Из них {crit} {plural(crit, 'критичная', 'критичные', 'критичных')}"
                 if crit else f"Самая старая — с {fmt_date_short(oldest)}"),
                {"count": n, "critical": crit, "oldest": oldest.isoformat()},
            )
        )  # fmt: skip

    nights = [
        nt
        for i in range(7)
        if (rec := ctx.days.get(add_days(ctx.today, -i))) and (nt := parse_night(rec.sleep))
    ]
    if len(nights) >= 2:
        avg_bed = sum(n.bed for n in nights) / len(nights)
        goal = planned_night(ctx.settings).bed
        if avg_bed - goal > 30:
            late = fmt_dur(avg_bed - goal)
            out.append(
                Alert(
                    "late_bed", 11, f"Отбой в среднем {fmt_hm(avg_bed)}, на {late} позже цели.",
                    f"Средний отбой {fmt_hm(avg_bed)}", f"Норма {fmt_hm(goal)} — позже на {late}",
                    {"avg_bed": avg_bed},
                )
            )  # fmt: skip

    debt = next((f for f in energy_today.factors if f.key == "debt"), None)
    if debt and debt.val <= -8:
        out.append(
            Alert(
                "sleep_debt", 9, f"Долг сна снижает энергию на {-debt.val} п. ({debt.note}).",
                f"Долг сна — минус {-debt.val} к энергии", f"За 7 ночей: {debt.note}",
                {"points": -debt.val},
            )
        )  # fmt: skip

    low = 0
    k = end
    while k >= start:
        rec = ctx.days.get(k)
        low += sum(1 for f in (rec.feel if rec else []) if f.v == "low")
        k = add_days(k, -1)
    if low >= 3:
        out.append(
            Alert(
                "low_feel", 6, f"«Низко» отмечено {low} раз за период.",
                f"«Низко» {low} {plural(low, 'раз', 'раза', 'раз')} за период",
                "Посмотри, что было со сном накануне", {"count": low},
            )
        )  # fmt: skip

    out.sort(key=lambda a: -a.w)  # stable, like Array.prototype.sort
    return out[:MAX_ALERTS]


def weak_spots_last(
    ctx: Ctx, tasks: Sequence[Task], energy_today: EnergyDay, n: int
) -> list[Alert]:
    """Original signature: the last `n` days (7 = week, 30 = month)."""
    return weak_spots(
        ctx, tasks, energy_today, add_days(ctx.today, -(n - 1)), ctx.today,
        "неделю" if n == 7 else "месяц",
    )  # fmt: skip
