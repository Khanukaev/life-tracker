"""Run the bot: long polling for updates + the reminder worker in one process.

Long polling needs no public endpoint and survives restarts without losing updates
(Telegram keeps them for 24 h). Exactly one polling process may run per bot token; the
reminder worker is safe to run in any number of copies thanks to the deliveries ledger.
"""

import asyncio

import structlog
from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.types import BotCommand, MenuButtonWebApp, WebAppInfo

from lifetracker.core.config import get_settings
from lifetracker.core.logging import configure_logging
from lifetracker.db.session import get_sessionmaker
from lifetracker_bot.handlers import build_router
from lifetracker_bot.scheduler import Reminders

log = structlog.get_logger()


async def main() -> None:
    settings = get_settings()
    configure_logging(settings.log_level, json=settings.app_env == "prod")
    token = settings.bot_token.get_secret_value()
    if not token:
        raise SystemExit("BOT_TOKEN is not set")

    bot = Bot(token, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    sessions = get_sessionmaker()

    # The menu button next to the input field opens the Mini App from any chat state.
    await bot.set_chat_menu_button(
        menu_button=MenuButtonWebApp(text="Трекер", web_app=WebAppInfo(url=settings.webapp_url))
    )
    await bot.set_my_commands(
        [
            BotCommand(command="start", description="Открыть трекер"),
            BotCommand(command="connect", description="Токен для подключения Claude"),
        ]
    )

    dp = Dispatcher()
    dp.include_router(build_router(sessions, settings))
    worker = asyncio.create_task(Reminders(bot, sessions, settings).run_forever())
    log.info("bot_started", webapp=settings.webapp_url)
    try:
        await dp.start_polling(bot, allowed_updates=dp.resolve_used_update_types())
    finally:
        worker.cancel()
        await bot.session.close()


if __name__ == "__main__":
    asyncio.run(main())
