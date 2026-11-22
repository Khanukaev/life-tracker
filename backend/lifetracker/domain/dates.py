"""Dates, logical day and formatting. Ported 1:1 from the reference app.

A logical day runs from 05:00 to 05:00 in the user's time zone. Minutes of a day
are counted from 00:00 of that day, so 00:00–04:59 of the next night are 1440+.
"""

import math
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

DAY_START_MIN = 5 * 60
STEP = 5  # minutes, resolution of the energy model
_EPOCH = date(1970, 1, 1).toordinal()


def js_round(x: float) -> int:
    """JavaScript `Math.round`: halves go up (2.5 -> 3, -2.5 -> -2).

    Python's built-in round() is banker's rounding (2.5 -> 2), which would break parity.
    """
    return math.floor(x + 0.5)


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


def idx_of(d: date) -> int:
    """Days since 1970-01-01 (`idxOf`)."""
    return d.toordinal() - _EPOCH


def add_days(d: date, n: int) -> date:
    return d + timedelta(days=n)


def hm(s: str | None) -> int | None:
    """ "HH:MM" -> minutes since 00:00 (`hm`)."""
    if s is None or s == "":
        return None
    h, _, m = str(s).partition(":")
    return int(h) * 60 + (int(m) if m else 0)


def task_min(s: str | None) -> int | None:
    """Task time -> minute of the logical day: 00:00–04:59 belong to the night after (`taskMin`)."""
    m = hm(s)
    if m is None:
        return None
    return m + 1440 if m < DAY_START_MIN else m


def time_to_task_min(minutes: int | None) -> int | None:
    if minutes is None:
        return None
    return minutes + 1440 if minutes < DAY_START_MIN else minutes


def fmt_hm(minutes: float) -> str:
    x = js_round(minutes) % 1440
    return f"{x // 60:02d}:{x % 60:02d}"


def fmt_dur(minutes: float) -> str:
    total = max(0, js_round(minutes))
    h, m = divmod(total, 60)
    if not h:
        return f"{m} мин"
    if not m:
        return f"{h} ч"
    return f"{h} ч {m} мин"


WEEKDAYS = ("пн", "вт", "ср", "чт", "пт", "сб", "вс")  # Monday first (date.weekday())
MONTHS = (
    "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря",
)  # fmt: skip
MONTHS_SHORT = ("янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек")


def fmt_date(d: date) -> str:
    """ "Вс, 22 ноября" (`fmtDate`)."""
    wd = WEEKDAYS[d.weekday()]
    return f"{wd[0].upper()}{wd[1:]}, {d.day} {MONTHS[d.month - 1]}"


def fmt_date_short(d: date) -> str:
    """ "22 ноя" (`fmtDate(k, "short")`)."""
    return f"{d.day} {MONTHS_SHORT[d.month - 1]}"
