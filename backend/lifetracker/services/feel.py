"""Record a "How do you feel?" answer and update the personal energy correction."""

import uuid
from dataclasses import asdict
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from lifetracker.core.errors import DomainValidationError
from lifetracker.db.models import Day, UserSettings
from lifetracker.domain.feel import ASLEEP_MSG, MAX_FEELS_PER_DAY, FeelResult, feel_update
from lifetracker.services.days import touch_day
from lifetracker.services.snapshot import load_snapshot

FEEL_VALUES = ("low", "ok", "high")


async def record_feel(
    session: AsyncSession, user_id: uuid.UUID, v: str, now: datetime
) -> FeelResult:
    if v not in FEEL_VALUES:
        raise DomainValidationError("v must be low, ok or high")
    snap = await load_snapshot(session, user_id, now)
    res = feel_update(v, snap.ctx)
    if res is None:
        raise DomainValidationError(ASLEEP_MSG)
    today = snap.ctx.today

    # Row locks: two quick taps must not lose an update of the model.
    st = await session.scalar(
        select(UserSettings).where(UserSettings.user_id == user_id).with_for_update()
    )
    if st is not None:
        st.model_bias = res.bias
        st.model_n = st.model_n + 1
        res.model_n = st.model_n
    await touch_day(session, user_id, today, now)
    day = await session.scalar(
        select(Day).where(Day.user_id == user_id, Day.date == today).with_for_update()
    )
    if day is not None:
        day.feel = [*day.feel, asdict(res.rec)][-MAX_FEELS_PER_DAY:]
    await session.commit()
    return res
