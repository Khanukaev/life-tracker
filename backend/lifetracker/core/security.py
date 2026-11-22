"""Telegram Mini App initData verification and short-lived JWT access tokens.

initData check (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app):
    secret_key = HMAC_SHA256(key="WebAppData", msg=bot_token)
    hash       = hex(HMAC_SHA256(key=secret_key, msg=data_check_string))
where data_check_string is every received field except ``hash``, sorted by key and
formatted as ``key=value`` lines joined by ``\\n``.
"""

import hashlib
import hmac
import json
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qsl

import jwt

from lifetracker.core.errors import UnauthorizedError

JWT_ALGORITHM = "HS256"


@dataclass(frozen=True, slots=True)
class TelegramUser:
    id: int
    first_name: str
    username: str | None
    language_code: str | None


def verify_init_data(
    init_data: str, *, bot_token: str, max_age_s: int, now: datetime
) -> TelegramUser:
    if not bot_token:
        raise UnauthorizedError("Telegram auth is not configured")
    try:
        fields = dict(parse_qsl(init_data, keep_blank_values=True, strict_parsing=True))
    except ValueError as e:
        raise UnauthorizedError("Malformed initData") from e

    received_hash = fields.pop("hash", "")
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(fields.items()))
    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    expected = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    # Constant-time comparison: no timing side channel on the signature.
    if not hmac.compare_digest(expected, received_hash):
        raise UnauthorizedError("Invalid initData signature")

    try:
        auth_date = datetime.fromtimestamp(int(fields["auth_date"]), UTC)
        raw_user = json.loads(fields["user"])
        user = TelegramUser(
            id=int(raw_user["id"]),
            first_name=str(raw_user.get("first_name") or "")[:64],
            username=raw_user.get("username"),
            language_code=raw_user.get("language_code"),
        )
    except (KeyError, ValueError, TypeError) as e:
        raise UnauthorizedError("initData lacks user or auth_date") from e

    age = (now - auth_date).total_seconds()
    if age > max_age_s or age < -60:  # small allowance for clock skew
        raise UnauthorizedError("initData expired")
    return user


def create_access_token(user_id: uuid.UUID, *, secret: str, ttl_s: int, now: datetime) -> str:
    payload = {"sub": str(user_id), "iat": now, "exp": now + timedelta(seconds=ttl_s)}
    return jwt.encode(payload, secret, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str, *, secret: str, now: datetime) -> uuid.UUID:
    """Expiry is checked against the injected clock, so tests can freeze time."""
    try:
        payload = jwt.decode(
            token,
            secret,
            algorithms=[JWT_ALGORITHM],
            options={"require": ["sub", "exp"], "verify_exp": False, "verify_iat": False},
        )
        if now.timestamp() >= float(payload["exp"]):
            raise UnauthorizedError("Token expired")
        return uuid.UUID(payload["sub"])
    except (jwt.PyJWTError, ValueError, TypeError) as e:
        raise UnauthorizedError("Invalid or expired token") from e
