"""Logical day: a day runs from 05:00 to 05:00 in the user's time zone.

Ported from `logicalNow` in the reference app; the full date toolkit and its
golden tests arrive with the rest of the domain logic.
"""

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

DAY_START_MIN = 5 * 60


@dataclass(frozen=True, slots=True)
class LogicalNow:
    day: date
    minute: int  # minutes since 00:00 of `day`; 00:00–04:59 after midnight are 1440+


def logical_now(now: datetime, tz: str) -> LogicalNow:
    local = now.astimezone(ZoneInfo(tz))
    day = (local - timedelta(minutes=DAY_START_MIN)).date()
    minute = local.hour * 60 + local.minute
    if minute < DAY_START_MIN:
        minute += 1440
    return LogicalNow(day=day, minute=minute)
