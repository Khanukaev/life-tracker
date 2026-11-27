"""Enumerations shared by the domain logic, the database and the API."""

from enum import StrEnum


class HabitType(StrEnum):
    CHECK = "check"  # one tap: done / not done
    COUNT = "count"  # a daily norm, each tap adds `step` (water glasses, minutes, pages…)
    BEDTIME = "bedtime"  # derived from the next night's sleep, never logged directly


class ScheduleKind(StrEnum):
    DAILY = "daily"
    WEEKDAYS = "weekdays"  # Monday to Friday
    CYCLE = "cycle"  # repeating pattern such as "11010" starting from an anchor date


class SleepQuality(StrEnum):
    BAD = "bad"
    OK = "ok"
    GOOD = "good"


class EnergyZone(StrEnum):
    FOCUS = "focus"
    STEADY = "steady"
    RECHARGE = "recharge"


class Importance(StrEnum):
    NORMAL = "normal"
    IMPORTANT = "important"
    CRITICAL = "critical"


class Actor(StrEnum):
    """Who made a change: the user in the app or their Claude via MCP."""

    ME = "me"
    CLAUDE = "claude"


class ReviewKind(StrEnum):
    DAY = "day"
    WEEK = "week"


class ReviewAuthor(StrEnum):
    SCHEDULE = "schedule"
    CLAUDE = "claude"
    ME = "me"


class Theme(StrEnum):
    BASE = "base"
    GLASS = "glass"


class DeliveryKind(StrEnum):
    EVENING = "evening"
    MORNING = "morning"
