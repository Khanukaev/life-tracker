import uuid
from datetime import date
from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import AfterValidator, Field

from lifetracker.domain.enums import Theme
from lifetracker.schemas.common import HHMM, ApiModel, InputModel


def _valid_tz(v: str) -> str:
    try:
        ZoneInfo(v)
    except (ZoneInfoNotFoundError, ValueError) as e:
        raise ValueError("unknown time zone") from e
    return v


TimeZone = Annotated[str, Field(max_length=64), AfterValidator(_valid_tz)]
Language = Annotated[str, Field(pattern=r"^(ru|en)$")]


class TelegramAuthIn(InputModel):
    init_data: str = Field(min_length=1, max_length=4096)
    # Browser time zone; used only when the account is created (onboarding can change it).
    timezone: TimeZone | None = None


class MeOut(ApiModel):
    id: uuid.UUID
    telegram_id: int
    first_name: str
    username: str | None
    language: str
    timezone: str
    reminder_time: HHMM | None
    morning_ping: bool
    theme: Theme | None
    haptics: bool
    onboarded: bool
    motto: str | None
    start_date: date


class MeUpdate(InputModel):
    first_name: str | None = Field(default=None, min_length=1, max_length=64)
    language: Language | None = None
    timezone: TimeZone | None = None
    reminder_time: HHMM | None = None
    morning_ping: bool | None = None
    theme: Theme | None = None
    haptics: bool | None = None
    onboarded: bool | None = None
    motto: str | None = Field(default=None, max_length=120)


class AuthOut(ApiModel):
    access_token: str
    token_type: str = "bearer"  # noqa: S105  (OAuth token type, not a secret)
    expires_in: int
    user: MeOut


class SettingsOut(ApiModel):
    bed_target: HHMM
    sleep_need_h: float
    usual_bed: HHMM
    usual_wake: HHMM
    model_bias: list[float]
    model_n: int


class SettingsUpdate(InputModel):
    bed_target: HHMM | None = None
    sleep_need_h: float | None = Field(default=None, ge=4, le=12, multiple_of=0.5)
    usual_bed: HHMM | None = None
    usual_wake: HHMM | None = None
