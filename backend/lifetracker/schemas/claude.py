"""Claude integration: saved reviews and the personal MCP token."""

import datetime as dt
import uuid
from datetime import datetime

from pydantic import Field

from lifetracker.domain.enums import ReviewAuthor, ReviewKind
from lifetracker.schemas.common import ApiModel, InputModel

REVIEW_MAX = 20_000


class ReviewOut(ApiModel):
    id: uuid.UUID
    kind: ReviewKind
    date: dt.date
    text: str = Field(validation_alias="body")
    by: ReviewAuthor
    at: datetime


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
