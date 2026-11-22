"""Goal progress (ported 1:1 from `goalProgress` / `goalOverdue`)."""

from dataclasses import dataclass

from lifetracker.domain.dates import add_days, js_round
from lifetracker.domain.enums import GoalKind
from lifetracker.domain.habits import day_ok, streak_of
from lifetracker.domain.model import Ctx, Goal


@dataclass(slots=True)
class Progress:
    pct: int
    label: str
    cur: int | None = None
    t: int | None = None


def goal_progress(g: Goal, ctx: Ctx) -> Progress:
    if g.kind == GoalKind.STREAK:
        cur = streak_of(g.habits, ctx)
        t = g.target or 1
        return Progress(min(100, js_round(cur / t * 100)), f"{cur}/{t} дн. подряд", cur, t)
    if g.kind == GoalKind.COUNT:
        w = g.window or 7
        t = g.target or w
        c = sum(1 for i in range(w) if day_ok(g.habits, add_days(ctx.today, -i), ctx) == "ok")
        return Progress(min(100, js_round(c / t * 100)), f"{c} из {t} за {w} дн.", c, t)
    if g.kind == GoalKind.MANUAL:
        v = g.manual_pct or 0
        return Progress(v, f"{v}%")
    done = sum(1 for s in g.subtasks if s.done)
    total = len(g.subtasks)
    return Progress(
        js_round(done / total * 100) if total else 0, f"{done}/{total} шагов", done, total
    )


def goal_overdue(g: Goal, ctx: Ctx) -> bool:
    return bool(g.deadline and g.deadline < ctx.today and goal_progress(g, ctx).pct < 100)
