"""Unit tests for initData verification and JWT handling (no database)."""

import uuid
from datetime import timedelta
from urllib.parse import parse_qsl, urlencode

import pytest

from lifetracker.core.errors import UnauthorizedError
from lifetracker.core.security import create_access_token, decode_access_token, verify_init_data
from tests.conftest import BOT_TOKEN, FROZEN_NOW, make_init_data

pytestmark = pytest.mark.nodb

SECRET = "x" * 40


def verify(init_data: str, **kw: object) -> object:
    params = {"bot_token": BOT_TOKEN, "max_age_s": 3600, "now": FROZEN_NOW, **kw}
    return verify_init_data(init_data, **params)  # type: ignore[arg-type]


def test_valid_init_data_returns_user() -> None:
    user = verify(make_init_data(42, first_name="Ann", username="ann"))
    assert user.id == 42  # type: ignore[attr-defined]
    assert user.first_name == "Ann"  # type: ignore[attr-defined]
    assert user.username == "ann"  # type: ignore[attr-defined]


def test_tampered_field_is_rejected() -> None:
    fields = dict(parse_qsl(make_init_data(42)))
    fields["user"] = fields["user"].replace("42", "43")  # pretend to be another user
    with pytest.raises(UnauthorizedError, match="signature"):
        verify(urlencode(fields))


def test_signature_from_another_bot_is_rejected() -> None:
    with pytest.raises(UnauthorizedError, match="signature"):
        verify(make_init_data(42, bot_token="999:other-bot"))


def test_missing_hash_is_rejected() -> None:
    fields = dict(parse_qsl(make_init_data(42)))
    del fields["hash"]
    with pytest.raises(UnauthorizedError):
        verify(urlencode(fields))


def test_expired_init_data_is_rejected() -> None:
    old = make_init_data(42, auth_date=FROZEN_NOW - timedelta(hours=2))
    with pytest.raises(UnauthorizedError, match="expired"):
        verify(old)


def test_init_data_from_the_future_is_rejected() -> None:
    with pytest.raises(UnauthorizedError, match="expired"):
        verify(make_init_data(42, auth_date=FROZEN_NOW + timedelta(minutes=10)))


def test_garbage_is_rejected() -> None:
    with pytest.raises(UnauthorizedError):
        verify("not a query string")


def test_unconfigured_bot_token_rejects_everything() -> None:
    with pytest.raises(UnauthorizedError):
        verify(make_init_data(42), bot_token="")


def test_jwt_roundtrip() -> None:
    uid = uuid.uuid4()
    token = create_access_token(uid, secret=SECRET, ttl_s=60, now=FROZEN_NOW)
    assert decode_access_token(token, secret=SECRET, now=FROZEN_NOW) == uid


def test_jwt_with_wrong_secret_is_rejected() -> None:
    token = create_access_token(uuid.uuid4(), secret=SECRET, ttl_s=60, now=FROZEN_NOW)
    with pytest.raises(UnauthorizedError):
        decode_access_token(token, secret="y" * 40, now=FROZEN_NOW)


def test_expired_jwt_is_rejected() -> None:
    token = create_access_token(uuid.uuid4(), secret=SECRET, ttl_s=60, now=FROZEN_NOW)
    with pytest.raises(UnauthorizedError):
        decode_access_token(token, secret=SECRET, now=FROZEN_NOW + timedelta(seconds=61))
