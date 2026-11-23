"""Bot tests reuse the backend's database fixtures and talk to a fake Telegram API.

``FakeTelegram`` replaces aiogram's HTTP session: every Bot API call is recorded instead
of being sent, and a test can make the next call fail (blocked user, flood wait).
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from fake_telegram import FakeTelegram
from tests.conftest import (  # noqa: F401  (fixtures are registered by import)
    BOT_TOKEN,
    Clock,
    alice,
    anon,
    clean_db,
    clock,
    login,
    migrated_db,
    no_rate_limit,
)

from lifetracker.core.config import get_settings
from lifetracker.db.session import get_sessionmaker
from lifetracker_bot.handlers import build_router


@pytest.fixture
def tg() -> FakeTelegram:
    return FakeTelegram()


@pytest.fixture
def bot(tg: FakeTelegram) -> Bot:
    return Bot(BOT_TOKEN, session=tg, default=DefaultBotProperties(parse_mode=ParseMode.HTML))


@pytest.fixture
def dp(clock: Clock) -> Dispatcher:  # noqa: F811
    d = Dispatcher()
    d.include_router(build_router(get_sessionmaker(), get_settings(), now=clock))
    return d
