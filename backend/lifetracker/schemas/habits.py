"""Habits: universal types with their own norms and schedules."""

import uuid
from datetime import date
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from lifetracker.domain.enums import HabitType, ScheduleKind
from lifetracker.schemas.common import ApiModel, InputModel


class CountConfig(BaseModel):
    """A daily norm; each tap adds `step` (1 for glasses or pages, 5–15 for minutes)."""

    model_config = ConfigDict(extra="forbid")
    norm: int = Field(ge=1, le=1440)
    step: int = Field(default=1, ge=1, le=240)


class EmptyConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")


CONFIG_MODELS: dict[HabitType, type[BaseModel]] = {
    HabitType.CHECK: EmptyConfig,
    HabitType.BEDTIME: EmptyConfig,
    HabitType.COUNT: CountConfig,
}


def normalize_config(habit_type: HabitType, raw: dict[str, Any]) -> dict[str, Any]:
    """Validate a type-specific config and fill in defaults."""
    return CONFIG_MODELS[habit_type].model_validate(raw).model_dump(mode="json")


class DailySchedule(InputModel):
    kind: Literal[ScheduleKind.DAILY] = ScheduleKind.DAILY


class WeekdaysSchedule(InputModel):
    kind: Literal[ScheduleKind.WEEKDAYS]


class CycleSchedule(InputModel):
    kind: Literal[ScheduleKind.CYCLE]
    pattern: str = Field(
        pattern=r"^[01]*1[01]*$", min_length=2, max_length=31, description="1 = do, 0 = rest"
    )
    anchor: date | None = Field(default=None, description="Day 1 of the pattern; default today")


Schedule = Annotated[DailySchedule | WeekdaysSchedule | CycleSchedule, Field(discriminator="kind")]


class ScheduleOut(ApiModel):
    kind: ScheduleKind
    pattern: str | None = None
    anchor: date | None = None


class HabitOut(ApiModel):
    id: uuid.UUID
    name: str
    type: HabitType
    config: dict[str, Any]
    schedule: ScheduleOut
    active: bool
    position: int

    @model_validator(mode="before")
    @classmethod
    def _from_orm(cls, obj: Any) -> Any:
        if hasattr(obj, "sched_kind"):
            return {
                "id": obj.id,
                "name": obj.name,
                "type": obj.type,
                "config": obj.config,
                "schedule": ScheduleOut(
                    kind=obj.sched_kind,
                    pattern=obj.sched_pattern,
                    anchor=obj.sched_anchor,
                ),
                "active": obj.active,
                "position": obj.position,
            }
        return obj


class HabitCreate(InputModel):
    id: uuid.UUID | None = None
    name: str = Field(min_length=1, max_length=80)
    type: HabitType
    config: dict[str, Any] = Field(default_factory=dict)
    schedule: Schedule = Field(default_factory=DailySchedule)
    active: bool = True
    position: int | None = None

    @model_validator(mode="after")
    def _check_config(self) -> "HabitCreate":
        try:
            self.config = normalize_config(self.type, self.config)
        except ValidationError as e:
            raise ValueError(f"invalid config for {self.type} habit: {e.errors()[0]['msg']}") from e
        return self


class HabitUpdate(InputModel):
    """The type cannot change: existing logs would lose their meaning."""

    name: str | None = Field(default=None, min_length=1, max_length=80)
    config: dict[str, Any] | None = None
    schedule: Schedule | None = None
    active: bool | None = None
    position: int | None = None
