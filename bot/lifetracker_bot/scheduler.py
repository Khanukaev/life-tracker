"""Reminder worker: every tick asks the database who is due and sends, once, politely.

- Due users come from one SQL query (see ``lifetracker.services.reminders``), so there is
  no per-user timer to keep in memory and nothing is lost on restart.
- Each message is claimed in ``deliveries`` before sending: several bot replicas or an
  overlapping tick can never send the same reminder twice.
- Sends are spaced below Telegram's ~30 msg/s limit; on 429 we wait ``retry_after``.
- A user who blocked the bot is marked ``bot_blocked`` and never selected again.
"""

import asyncio
import time
from collections.abc import Callable
from datetime import datetime

import structlog
from aiogram import Bot
from aiogram.exceptions import (
    TelegramBadRequest,
    TelegramForbiddenError,
    TelegramRetryAfter,
)
from aiogram.types import InlineKeyboardMarkup
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from lifetracker.core.config import Settings
from lifetracker.db.models import User
from lifetracker.domain.enums import DeliveryKind
from lifetracker.services import reminders
from lifetracker.services.reminders import Due
from lifetracker_bot import texts
from lifetracker_bot.handlers import utc_now

log = structlog.get_logger()

TICK_S = 30


class RateLimiter:
    """At most ``rate`` calls per second, evenly spaced (no bursts that trigger 429)."""

    def __init__(self, rate: float) -> None:
        self.interval = 1.0 / rate
        self._next = 0.0
        self._lock = asyncio.Lock()

    async def wait(self) -> None:
        async with self._lock:
            now = time.monotonic()
            delay = self._next - now
            self._next = max(now, self._next) + self.interval
        if delay > 0:
            await asyncio.sleep(delay)


class Reminders:
    def __init__(
        self,
        bot: Bot,
        sessions: async_sessionmaker[AsyncSession],
        settings: Settings,
        now: Callable[[], datetime] = utc_now,
    ) -> None:
        self.bot = bot
        self.sessions = sessions
        self.settings = settings
        self.now = now
        self.limiter = RateLimiter(settings.bot_send_rate)

    async def tick(self) -> int:
        """One pass over every reminder kind. Returns how many messages were sent."""
        sent = 0
        for kind in (DeliveryKind.EVENING, DeliveryKind.MORNING, DeliveryKind.WEEK_NOTE):
            async with self.sessions() as session:
                due = await reminders.due_reminders(session, kind, self.now())
            for d in due:
                sent += await self.deliver(d)
        async with self.sessions() as session:
            items = await reminders.due_items(session, self.now())
        for d in items:
            sent += await self.deliver(d)
        return sent

    async def _content(self, d: Due) -> tuple[str, InlineKeyboardMarkup]:
        url = self.settings.webapp_url
        async with self.sessions() as session:
            match d.kind:
                case DeliveryKind.EVENING:
                    e = await reminders.evening_content(session, d.user_id, d.day, self.now())
                    return texts.evening_text(e), texts.evening_kb(e, url)
                case DeliveryKind.MORNING:
                    m = await reminders.morning_content(session, d.user_id, d.day, self.now())
                    return texts.morning_text(m), texts.morning_kb(m, url)
                case DeliveryKind.WEEK_NOTE:
                    name = await session.scalar(select(User.first_name).where(User.id == d.user_id))
                    return texts.week_note_text(name or ""), texts.week_note_kb(url)
            item = await reminders.item_content(session, d)
            if isinstance(item, reminders.TaskReminder):
                return texts.task_text(item), texts.task_kb(item, url)
            return texts.habit_text(item), texts.habit_kb(item, d.day, url)

    async def deliver(self, d: Due) -> int:
        async with self.sessions() as session:
            if not await reminders.claim(session, d):
                return 0  # another worker (or an earlier tick) has it
        try:
            text, kb = await self._content(d)
            for attempt in range(3):
                await self.limiter.wait()
                try:
                    await self.bot.send_message(d.telegram_id, text, reply_markup=kb)
                    break
                except TelegramRetryAfter as e:  # 429: Telegram tells how long to wait
                    if attempt == 2:
                        raise
                    log.warning("telegram_flood_wait", retry_after=e.retry_after)
                    await asyncio.sleep(e.retry_after)
        except (TelegramForbiddenError, TelegramBadRequest) as e:
            # The claim stays in both cases: retrying would fail the same way.
            if isinstance(e, TelegramForbiddenError) or "chat not found" in e.message.lower():
                # Blocked the bot / deleted the account: stop sending for good.
                async with self.sessions() as session:
                    await reminders.set_bot_blocked(session, d.telegram_id, True)
                log.info("reminder_recipient_gone", telegram_id=d.telegram_id, error=e.message)
            else:
                log.error("reminder_rejected", user_id=str(d.user_id), error=e.message)
            return 0
        except Exception:
            # Network trouble, Telegram 5xx, a bug in the content: give the claim back so
            # the next tick retries (until the grace window ends).
            async with self.sessions() as session:
                await reminders.release(session, d)
            log.exception("reminder_failed", user_id=str(d.user_id), kind=d.kind.value)
            return 0
        async with self.sessions() as session:
            await reminders.mark_sent(session, d, self.now())
        log.info("reminder_sent", user_id=str(d.user_id), kind=d.kind.value, day=str(d.day))
        return 1

    async def run_forever(self) -> None:
        while True:
            started = time.monotonic()
            try:
                await self.tick()
            except Exception:  # the worker must survive a DB hiccup
                log.exception("reminder_tick_failed")
            await asyncio.sleep(max(1.0, TICK_S - (time.monotonic() - started)))
