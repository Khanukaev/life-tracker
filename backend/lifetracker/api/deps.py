"""FastAPI dependencies: DB session, clock, authenticated user."""

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from lifetracker.core.config import Settings, get_settings
from lifetracker.core.errors import UnauthorizedError
from lifetracker.core.security import decode_access_token
from lifetracker.db.session import get_session

_bearer = HTTPBearer(auto_error=False)


def get_now() -> datetime:
    """Injectable clock: tests override it to freeze time."""
    return datetime.now(UTC)


def current_user_id(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    settings: Annotated[Settings, Depends(get_settings)],
    now: Annotated[datetime, Depends(get_now)],
) -> uuid.UUID:
    """The only source of ``user_id`` for every request — never taken from the body or URL."""
    if creds is None:
        raise UnauthorizedError("Missing bearer token")
    return decode_access_token(
        creds.credentials, secret=settings.jwt_secret.get_secret_value(), now=now
    )


SessionDep = Annotated[AsyncSession, Depends(get_session)]
UserId = Annotated[uuid.UUID, Depends(current_user_id)]
Now = Annotated[datetime, Depends(get_now)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
