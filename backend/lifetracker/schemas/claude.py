"""Claude integration: reviews and plans, notes and the personal MCP token."""

import datetime as dt
import uuid
from datetime import datetime
from typing import Any

from pydantic import Field

from lifetracker.domain.enums import NoteKind, ReviewAuthor, ReviewKind
from lifetracker.schemas.common import HHMM, ApiModel, InputModel

REVIEW_MAX = 20_000


class ReviewOut(ApiModel):
    id: uuid.UUID
    kind: ReviewKind
    date: dt.date
    text: str = Field(validation_alias="body")
    by: ReviewAuthor
    at: datetime
    used_note: bool
    changes: list[str]
    items: list[dict[str, Any]] | None = None  # plans only
    applied_at: datetime | None = None


class ReviewIn(InputModel):
    kind: ReviewKind = ReviewKind.DAY
    text: str = Field(min_length=1, max_length=REVIEW_MAX)
    date: dt.date | None = None  # default: the user's logical today


class McpStatusOut(ApiModel):
    url: str
    active: bool
    prefix: str | None = None  # first characters, to recognise the token
    created_at: datetime | None = None
    last_used_at: datetime | None = None


class McpIssuedOut(ApiModel):
    url: str
    token: str  # shown once; only its SHA-256 is stored
    prefix: str


class PlanItem(InputModel):
    title: str = Field(min_length=1, max_length=200)
    start: HHMM | None = None
    dur: int = Field(default=30, ge=5, le=1440)
    note: str = Field(default="", max_length=300, description="Why now: «это твой пик энергии»")


class NoteOut(ApiModel):
    kind: NoteKind
    start: dt.date
    text: str = Field(validation_alias="body")
    updated_at: datetime


class NoteIn(InputModel):
    text: str = Field(max_length=4000, description="Empty text deletes the note")
