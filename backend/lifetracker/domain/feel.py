""" "How do you feel?" — compare the answer with the model and learn a personal correction."""

import math
from dataclasses import dataclass

from lifetracker.domain.dates import fmt_hm
from lifetracker.domain.energy import FEEL_T, bucket_of, clamp, energy_day
from lifetracker.domain.model import Ctx, FeelRec

MAX_FEELS_PER_DAY = 12
ASLEEP_MSG = "По модели сейчас время сна. Отметь, когда проснёшься."


@dataclass(slots=True)
class FeelResult:
    rec: FeelRec
    bucket: int
    bias: list[float]
    model_n: int
    message: str


def feel_update(v: str, ctx: Ctx) -> FeelResult | None:
    """Port of `feel`: None when the model says the user is asleep right now."""
    e0 = energy_day(ctx.today, ctx, no_feel=True)
    p = e0.at(math.floor(ctx.now_min / 5) * 5)
    if not p or p.idx is None:
        return None
    pred = p.idx
    err = FEEL_T[v] - pred
    b = bucket_of(max(0, (ctx.now_min - e0.wake) / 60))
    bias = list(ctx.settings.bias or [0.0, 0.0, 0.0, 0.0])
    bias[b] = clamp((bias[b] or 0) + 0.2 * (FEEL_T[v] - pred), -20, 20)
    if abs(err) < 8:
        msg = "Совпало с прогнозом"
    elif err > 0:
        msg = "Ты бодрее прогноза, модель подстроилась"
    else:
        msg = "Ты ниже прогноза, модель подстроилась"
    return FeelResult(
        rec=FeelRec(t=fmt_hm(ctx.now_min), v=v, pred=pred, err=err),
        bucket=b,
        bias=bias,
        model_n=ctx.settings.model_n + 1,
        message=msg,
    )
