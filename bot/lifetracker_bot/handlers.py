"""Telegram update handlers.

Isolation: the user is always resolved from the Telegram update itself (``from_user.id``,
signed by Telegram's servers), never from data inside a button. A button carries only a
habit id, and the habit is looked up together with the owner, so pressing a forged button
with someone else's habit id just answers "not found".
"""

import uuid
from collections.abc import Callable
from contextlib import suppress
from datetime import UTC, datetime

import structlog
from aiogram import F, Router
from aiogram.exceptions import TelegramBadRequest
from aiogram.filters import Command, CommandStart
from aiogram.filters.chat_member_updated import KICKED, MEMBER, ChatMemberUpdatedFilter
from aiogram.types import CallbackQuery, ChatMemberUpdated, InaccessibleMessage, Message
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from lifetracker.core.config import Settings
from lifetracker.core.errors import DomainValidationError, NotFoundError
from lifetracker.core.security import TelegramUser
from lifetracker.services import mcp_tokens, reminders, users
from lifetracker_bot import texts

log = structlog.get_logger()


def utc_now() -> datetime:
    return datetime.now(UTC)


def build_router(
    sessions: async_sessionmaker[AsyncSession],
    settings: Settings,
    now: Callable[[], datetime] = utc_now,
) -> Router:
    router = Router(name="tracker")

    async def ensure_user(session: AsyncSession, msg: Message) -> uuid.UUID:
        tg = msg.from_user
        if tg is None:  # pragma: no cover - private chats always have a sender
            raise RuntimeError("message without a sender")
        user = await users.login_telegram_user(
            session,
            TelegramUser(tg.id, tg.first_name, tg.username, tg.language_code),
            timezone=None,
            now=now(),
        )
        if user.bot_blocked:  # wrote to the bot again → they want messages again
            await reminders.set_bot_blocked(session, tg.id, False)
        return user.id

    @router.message(CommandStart(), F.chat.type == "private")
    async def start(msg: Message) -> None:
        async with sessions() as session:
            await ensure_user(session, msg)
        await msg.answer(
            texts.start_text(msg.from_user.first_name if msg.from_user else ""),
            reply_markup=texts.open_app_kb(settings.webapp_url),
        )

    @router.message(Command("connect"), F.chat.type == "private")
    async def connect(msg: Message) -> None:
        async with sessions() as session:
            user_id = await ensure_user(session, msg)
            had_token = await mcp_tokens.active_token(session, user_id) is not None
            token = await mcp_tokens.issue_token(session, user_id, now())
        log.info("mcp_token_issued", user_id=str(user_id), replaced=had_token)
        # protect_content: the message with the secret cannot be forwarded or saved.
        await msg.answer(
            texts.connect_text(token, settings.mcp_url, had_token), protect_content=True
        )

    @router.callback_query(texts.Mark.filter())
    async def mark(cb: CallbackQuery, callback_data: texts.Mark) -> None:
        try:
            habit_id = uuid.UUID(hex=callback_data.habit)
            day = texts.parse_day(callback_data.day)
        except ValueError:
            await cb.answer("Кнопка устарела")
            return
        async with sessions() as session:
            user_id = await reminders.user_id_by_telegram(session, cb.from_user.id)
            if user_id is None:
                await cb.answer("Сначала открой трекер: /start")
                return
            try:
                name = await reminders.mark_habit(
                    session, user_id, habit_id, day, bool(callback_data.done), now()
                )
            except (NotFoundError, DomainValidationError):
                await cb.answer("Эта привычка больше не отмечается здесь")
                return
            content = await reminders.evening_content(session, user_id, day, now())
        await cb.answer(f"{'✅' if callback_data.done else '❌'} {name}")
        # Redraw the same message: the marked habit disappears, the score updates.
        if cb.message is not None and not isinstance(cb.message, InaccessibleMessage):
            # "message is not modified" after a double tap is fine.
            with suppress(TelegramBadRequest):
                await cb.message.edit_text(
                    texts.evening_text(content),
                    reply_markup=texts.evening_kb(content, settings.webapp_url),
                )

    @router.my_chat_member(ChatMemberUpdatedFilter(member_status_changed=KICKED))
    async def blocked(event: ChatMemberUpdated) -> None:
        async with sessions() as session:
            await reminders.set_bot_blocked(session, event.from_user.id, True)
        log.info("bot_blocked", telegram_id=event.from_user.id)

    @router.my_chat_member(ChatMemberUpdatedFilter(member_status_changed=MEMBER))
    async def unblocked(event: ChatMemberUpdated) -> None:
        async with sessions() as session:
            await reminders.set_bot_blocked(session, event.from_user.id, False)

    return router
