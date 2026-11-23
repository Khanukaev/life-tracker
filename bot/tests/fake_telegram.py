"""A fake Telegram Bot API: records every call instead of sending it.

Replaces aiogram's HTTP session; a test can make the next call fail (blocked user,
flood wait, network error).
"""

from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from aiogram import Bot
from aiogram.client.session.base import BaseSession
from aiogram.methods import AnswerCallbackQuery, EditMessageText, SendMessage
from aiogram.methods.base import TelegramMethod
from aiogram.types import Chat, Message


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
