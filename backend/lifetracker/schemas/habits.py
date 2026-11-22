"""Habits: universal types with their own norms and schedules."""

import uuid
from datetime import date
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from lifetracker.domain.enums import HabitType, ScheduleKind
from lifetracker.schemas.common import ApiModel, InputModel


class WaterConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    target_l: float = Field(ge=0.1, le=10)
    glass_l: float = Field(default=0.25, ge=0.05, le=2)


class MinutesConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    target_min: int = Field(ge=1, le=1440)
    step_min: int = Field(default=10, ge=1, le=240)


class DualConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    labels: tuple[
        Annotated[str, Field(min_length=1, max_length=24)],
        Annotated[str, Field(min_length=1, max_length=24)],
    ]


class EmptyConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")


CONFIG_MODELS: dict[HabitType, type[BaseModel]] = {
    HabitType.CHECK: EmptyConfig,
    HabitType.BEDTIME: EmptyConfig,
    HabitType.WATER: WaterConfig,
    HabitType.MINUTES: MinutesConfig,
    HabitType.DUAL: DualConfig,
}


def normalize_config(habit_type: HabitType, raw: dict[str, Any]) -> dict[str, Any]:
    """Validate a type-specific config and fill in defaults."""
    return CONFIG_MODELS[habit_type].model_validate(raw).model_dump(mode="json")


class DailySchedule(InputModel):
    kind: Literal[ScheduleKind.DAILY] = ScheduleKind.DAILY


class EverySchedule(InputModel):
    kind: Literal[ScheduleKind.EVERY]
    n: int = Field(ge=2, le=365, description="2 = every other day")


class CycleSchedule(InputModel):
    kind: Literal[ScheduleKind.CYCLE]
    pattern: str = Field(pattern=r"^[01]+$", max_length=31, description="1 = do, 0 = rest")
    anchor: date | None = Field(default=None, description="Day 1 of the pattern; default today")


Schedule = Annotated[DailySchedule | EverySchedule | CycleSchedule, Field(discriminator="kind")]


class ScheduleOut(ApiModel):
    kind: ScheduleKind
    n: int | None = None
    pattern: str | None = None
    anchor: date | None = None


class HabitOut(ApiModel):
    id: uuid.UUID
    name: str
    type: HabitType
    sphere_id: uuid.UUID | None
    is_key: bool
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
                "sphere_id": obj.sphere_id,
                "is_key": obj.is_key,
                "config": obj.config,
                "schedule": ScheduleOut(
                    kind=obj.sched_kind,
                    n=obj.sched_n,
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
    sphere_id: uuid.UUID | None = None
    is_key: bool | None = None  # default: true for bedtime, false otherwise
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
    sphere_id: uuid.UUID | None = None
    is_key: bool | None = None
    config: dict[str, Any] | None = None
    schedule: Schedule | None = None
    active: bool | None = None
    position: int | None = None
