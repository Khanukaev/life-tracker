import datetime as dt
import uuid
from datetime import datetime
from enum import StrEnum

from pydantic import Field, model_validator

from lifetracker.domain.enums import Actor
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
    important: bool
    fresh: bool
    remind_at: HHMM | None
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
    important: bool = Field(default=False, description="Top of the list, weighs ×3")
    fresh: bool = Field(default=False, description="Needs a fresh head: goes to the energy peak")
    remind_at: HHMM | None = Field(default=None, description="Bot message at this time")

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
    important: bool | None = None
    fresh: bool | None = None
    remind_at: HHMM | None = None
    done: bool | None = None


class MovedOut(ApiModel):
    moved: int
