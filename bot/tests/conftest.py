"""Bot tests reuse the backend's database fixtures and talk to a fake Telegram API.

``FakeTelegram`` replaces aiogram's HTTP session: every Bot API call is recorded instead
of being sent, and a test can make the next call fail (blocked user, flood wait).
"""

import sys
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.client.session.base import BaseSession
from aiogram.enums import ParseMode
from aiogram.methods import AnswerCallbackQuery, EditMessageText, SendMessage
from aiogram.methods.base import TelegramMethod
from aiogram.types import Chat, Message
from tests.conftest import (  # noqa: F401  (fixtures are registered by import)
    BOT_TOKEN,
    Clock,
    alice,
    anon,
    clean_db,
    clock,
    login,
    migrated_db,
)

from lifetracker.core.config import get_settings
from lifetracker.db.session import get_sessionmaker
from lifetracker_bot.handlers import build_router


class FakeTelegram(BaseSession):
    def __init__(self) -> None:
        super().__init__()
        self.calls: list[TelegramMethod[Any]] = []
        self.fail_with: list[Callable[[TelegramMethod[Any]], Exception]] = []

    async def make_request(
        self,
        bot: Bot,
        method: TelegramMethod[Any],
        timeout: int | None = None,  # noqa: ASYNC109
    ) -> Any:
        self.calls.append(method)
        if self.fail_with:
            raise self.fail_with.pop(0)(method)
        if isinstance(method, SendMessage | EditMessageText):
            return Message(
                message_id=len(self.calls),
                date=datetime.now(UTC),
                chat=Chat(id=int(getattr(method, "chat_id", 0) or 0), type="private"),
                text=method.text,
            )
        if isinstance(method, AnswerCallbackQuery):
            return True
        return True

    async def close(self) -> None:
        pass

    async def stream_content(self, *args: Any, **kwargs: Any) -> Any:  # pragma: no cover
        raise NotImplementedError

    def sent(self, kind: type[TelegramMethod[Any]] = SendMessage) -> list[Any]:
        return [c for c in self.calls if isinstance(c, kind)]


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
