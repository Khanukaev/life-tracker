"""Shared API types."""

import re
from datetime import time
from typing import Annotated, Any

from pydantic import BaseModel, BeforeValidator, ConfigDict, PlainSerializer, WithJsonSchema

_HHMM = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)$")


def _parse_hhmm(v: Any) -> Any:
    if isinstance(v, str):
        m = _HHMM.match(v)
        if not m:
            raise ValueError("time must be HH:MM")
        return time(int(m[1]), int(m[2]))
    return v


# Times travel as "HH:MM" strings, exactly like in the reference app.
HHMM = Annotated[
    time,
    BeforeValidator(_parse_hhmm),
    PlainSerializer(lambda t: t.strftime("%H:%M"), return_type=str, when_used="json"),
    WithJsonSchema({"type": "string", "pattern": r"^\d{2}:\d{2}$", "example": "23:30"}),
]


class ApiModel(BaseModel):
    """Response models are built straight from ORM objects."""

    model_config = ConfigDict(from_attributes=True)


class InputModel(BaseModel):
    """Request bodies: unknown fields are rejected instead of being silently ignored."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
