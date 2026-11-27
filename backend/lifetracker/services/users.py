"""Profile and settings."""

import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from lifetracker.core.errors import NotFoundError
from lifetracker.core.security import TelegramUser
from lifetracker.db.base import new_id
from lifetracker.db.models import User, UserSettings
from lifetracker.domain.dates import logical_now
from lifetracker.schemas.users import MeUpdate, SettingsUpdate
from lifetracker.services.common import apply_patch

DEFAULT_TZ = "UTC"


def _language(code: str | None) -> str:
    return "en" if code and not code.lower().startswith(("ru", "uk", "be", "kk")) else "ru"


async def login_telegram_user(
    session: AsyncSession, tg: TelegramUser, *, timezone: str | None, now: datetime
) -> User:
    """Find the account for a Telegram user or create it on first launch.

    INSERT … ON CONFLICT makes concurrent first launches (e.g. two tabs) safe.
    """
    existing = await session.scalar(select(User).where(User.telegram_id == tg.id))
    if existing is not None:
        if existing.username != tg.username:
            existing.username = tg.username
            await session.commit()
        return existing

    tz = timezone or DEFAULT_TZ
    user_id = new_id()
    inserted = await session.scalar(
        insert(User)
        .values(
            id=user_id,
            telegram_id=tg.id,
            first_name=tg.first_name or "Друг",
            username=tg.username,
            language=_language(tg.language_code),
            timezone=tz,
            haptics=True,
            onboarded=False,
            bot_blocked=False,
            start_date=logical_now(now, tz).day,
        )
        .on_conflict_do_nothing(index_elements=[User.telegram_id])
        .returning(User.id)
    )
    if inserted is not None:
        session.add(UserSettings(user_id=user_id))
    await session.commit()
    user = await session.scalar(select(User).where(User.telegram_id == tg.id))
    if user is None:  # pragma: no cover - only if the row vanished mid-request
        raise NotFoundError("User not found")
    return user


async def get_me(session: AsyncSession, user_id: uuid.UUID) -> User:
    user = await session.get(User, user_id)
    if user is None:
        raise NotFoundError("User not found")
    return user


async def update_me(session: AsyncSession, user_id: uuid.UUID, data: MeUpdate) -> User:
    user = await get_me(session, user_id)
    apply_patch(
        user,
        data.model_dump(exclude_unset=True),
        nullable={"reminder_time", "morning_time", "week_note_time", "theme", "motto"},
    )
    await session.commit()
    return user


async def get_settings(session: AsyncSession, user_id: uuid.UUID) -> UserSettings:
    st = await session.get(UserSettings, user_id)
    if st is None:
        raise NotFoundError("Settings not found")
    return st


async def update_settings(
    session: AsyncSession, user_id: uuid.UUID, data: SettingsUpdate
) -> UserSettings:
    st = await get_settings(session, user_id)
    apply_patch(st, data.model_dump(exclude_unset=True))
    await session.commit()
    return st


async def reset_energy_model(session: AsyncSession, user_id: uuid.UUID) -> UserSettings:
    st = await get_settings(session, user_id)
    st.model_bias = [0.0, 0.0, 0.0, 0.0]
    st.model_n = 0
    await session.commit()
    return st
