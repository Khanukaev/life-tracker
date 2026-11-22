"""Enumerations shared by the domain logic, the database and the API."""

from enum import StrEnum


class HabitType(StrEnum):
    CHECK = "check"  # plain checkbox
    BEDTIME = "bedtime"  # derived from the next night's sleep, never logged directly
    WATER = "water"  # glasses of water against a daily volume
    MINUTES = "minutes"  # minutes counter against a daily target (reading, practice…)
    DUAL = "dual"  # two flags that must both be set (e.g. "calories + protein")


class ScheduleKind(StrEnum):
    DAILY = "daily"
    EVERY = "every"  # once every N days, counted from the last time it was done
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


class GoalKind(StrEnum):
    SUBTASKS = "subtasks"
    STREAK = "streak"
    COUNT = "count"
    MANUAL = "manual"


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
