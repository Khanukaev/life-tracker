import datetime as dt
import uuid
from datetime import datetime
from enum import StrEnum

from pydantic import Field, model_validator

from lifetracker.domain.enums import Actor, EnergyZone, Importance
from lifetracker.schemas.common import HHMM, ApiModel, InputModel


class TaskView(StrEnum):
    INBOX = "inbox"  # no date
    TODAY = "today"
    OVERDUE = "overdue"
    UPCOMING = "upcoming"  # next 14 days
    DONE = "done"  # last 60 completed


class TaskOut(ApiModel):
    id: uuid.UUID
    title: str
    description: str
    date: dt.date | None
    start_time: HHMM | None
    duration_min: int
    energy: EnergyZone
    importance: Importance
    done: bool
    done_at: datetime | None
    created_by: Actor
    created_at: datetime
    updated_at: datetime


class TaskCreate(InputModel):
    id: uuid.UUID | None = None
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    date: dt.date | None = None
    start_time: HHMM | None = Field(
        default=None, description="00:00–04:59 belongs to the night after `date`"
    )
    duration_min: int = Field(default=30, ge=5, le=1440)
    energy: EnergyZone = EnergyZone.STEADY
    importance: Importance = Importance.NORMAL

    @model_validator(mode="after")
    def _time_needs_date(self) -> "TaskCreate":
        if self.start_time is not None and self.date is None:
            raise ValueError("start_time requires a date (inbox tasks have no time)")
        return self


class TaskUpdate(InputModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    date: dt.date | None = None
    start_time: HHMM | None = None
    duration_min: int | None = Field(default=None, ge=5, le=1440)
    energy: EnergyZone | None = None
    importance: Importance | None = None
    done: bool | None = None


class MovedOut(ApiModel):
    moved: int
