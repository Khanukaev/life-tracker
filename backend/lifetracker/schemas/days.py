import uuid
from datetime import date
from typing import Any

from pydantic import Field, model_validator

from lifetracker.domain.enums import SleepQuality
from lifetracker.schemas.common import HHMM, ApiModel, InputModel


def night_minutes(bed_min: int, wake_min: int) -> tuple[int, int] | None:
    """Port of `parseNight`: bed ≥ 12:00 means the previous evening.

    Returns (bed, wake) in minutes relative to 00:00 of the wake-up day,
    or None when the night is impossible (wake not after bed).
    """
    bed = bed_min - 1440 if bed_min >= 12 * 60 else bed_min
    if wake_min <= bed:
        return None
    return bed, wake_min


class SleepIn(InputModel):
    bed: HHMM
    wake: HHMM
    quality: SleepQuality = SleepQuality.OK

    @model_validator(mode="after")
    def _plausible(self) -> "SleepIn":
        bed = self.bed.hour * 60 + self.bed.minute
        wake = self.wake.hour * 60 + self.wake.minute
        if night_minutes(bed, wake) is None:
            raise ValueError(
                "wake must be after bed (bed after 12:00 counts as the evening before)"
            )
        return self


class SleepOut(ApiModel):
    bed: HHMM
    wake: HHMM
    quality: SleepQuality
    duration_min: int


class FeelOut(ApiModel):
    t: str
    v: str
    pred: int | None = None
    err: float | None = None


class DayOut(ApiModel):
    date: date
    sleep: SleepOut | None
    feel: list[FeelOut]
    backfill: bool
    habits: dict[uuid.UUID, Any] = Field(description="habit_id → logged value")


class HabitValueIn(InputModel):
    value: Any = Field(
        description="check: bool · water: glasses (int) · minutes: int · dual: {a: bool, b: bool}"
    )
