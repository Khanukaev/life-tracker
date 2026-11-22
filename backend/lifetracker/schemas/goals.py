import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import Field, model_validator

from lifetracker.domain.enums import Actor, GoalKind
from lifetracker.schemas.common import ApiModel, InputModel


class SubtaskOut(ApiModel):
    id: uuid.UUID
    title: str
    deadline: date | None
    done: bool
    done_at: datetime | None
    position: int


class HistoryOut(ApiModel):
    at: datetime
    by: Actor
    what: str


class GoalOut(ApiModel):
    id: uuid.UUID
    title: str
    criterion: str
    deadline: date | None
    stage: int
    kind: GoalKind
    target: int | None
    window_days: int | None
    manual_pct: int | None
    sphere_id: uuid.UUID | None
    archived: bool
    position: int
    habit_ids: list[uuid.UUID]
    subtasks: list[SubtaskOut]
    created_at: datetime
    updated_at: datetime


class GoalDetailOut(GoalOut):
    history: list[HistoryOut]


class SubtaskIn(InputModel):
    id: uuid.UUID | None = None
    title: str = Field(min_length=1, max_length=200)
    deadline: date | None = None


class SubtaskUpdate(InputModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    deadline: date | None = None
    done: bool | None = None
    position: int | None = None


Stage = Literal[1, 2]


class GoalCreate(InputModel):
    id: uuid.UUID | None = None
    title: str = Field(min_length=1, max_length=200)
    criterion: str = Field(default="", max_length=2000)
    deadline: date | None = None
    stage: Stage = 1
    kind: GoalKind = GoalKind.SUBTASKS
    habit_ids: list[uuid.UUID] = Field(default_factory=list, max_length=20)
    target: int | None = Field(default=None, ge=1, le=3650)
    window_days: int | None = Field(default=None, ge=1, le=3650)
    manual_pct: int | None = Field(default=None, ge=0, le=100)
    sphere_id: uuid.UUID | None = None
    subtasks: list[SubtaskIn] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def _kind_fields(self) -> "GoalCreate":
        """Defaults follow the reference app: streak 10 days, count = target of last 7 days."""
        if self.kind in (GoalKind.STREAK, GoalKind.COUNT) and not self.habit_ids:
            raise ValueError("streak and count goals need at least one habit")
        if self.kind == GoalKind.STREAK:
            self.target = self.target or 10
        elif self.kind == GoalKind.COUNT:
            self.window_days = self.window_days or 7
            self.target = self.target or self.window_days
        elif self.kind == GoalKind.MANUAL:
            self.manual_pct = self.manual_pct or 0
        return self


class GoalUpdate(InputModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    criterion: str | None = Field(default=None, max_length=2000)
    deadline: date | None = None
    stage: Stage | None = None
    kind: GoalKind | None = None
    habit_ids: list[uuid.UUID] | None = Field(default=None, max_length=20)
    target: int | None = Field(default=None, ge=1, le=3650)
    window_days: int | None = Field(default=None, ge=1, le=3650)
    manual_pct: int | None = Field(default=None, ge=0, le=100)
    sphere_id: uuid.UUID | None = None
    archived: bool | None = None
    position: int | None = None
