"""Message texts and keyboards. Pure functions: easy to test without Telegram."""

from datetime import date
from html import escape

from aiogram.filters.callback_data import CallbackData
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo

from lifetracker.domain.dates import fmt_date
from lifetracker.services.reminders import Evening

MAX_HABIT_BUTTONS = 12  # a longer list is better marked in the app itself


class Mark(CallbackData, prefix="m"):
    """✅/❌ under a habit. Fits Telegram's 64-byte limit: m:<32 hex>:<yyyymmdd>:<0|1>."""

    habit: str  # UUID hex
    day: str  # yyyymmdd — the logical day of the reminder, not the day of the tap
    done: int


def day_key(d: date) -> str:
    return d.strftime("%Y%m%d")


def parse_day(s: str) -> date:
    return date(int(s[:4]), int(s[4:6]), int(s[6:]))


def open_app_kb(url: str, label: str = "Открыть трекер") -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text=label, web_app=WebAppInfo(url=url))]]
    )


def start_text(first_name: str) -> str:
    return (
        f"Привет, {escape(first_name)}! 👋\n\n"
        "Это твой личный трекер: привычки, сон, энергия, задачи и цели. "
        "Данные видишь только ты.\n\n"
        "Открой приложение кнопкой ниже — настройка займёт минуту. "
        "Вечером пришлю итог дня, а отмечать привычки можно прямо здесь.\n\n"
        "/connect — подключить своего Claude к трекеру"
    )


def _score_line(e: Evening) -> str:
    if e.score is None:
        return "Рейтинг дня пока не посчитать — добавь привычки или задачи."
    line = f"Рейтинг дня: <b>{e.score}%</b>"
    if e.delta:
        line += f" ({'+' if e.delta > 0 else '−'}{abs(e.delta)} ко вчера)"
    return line


def evening_text(e: Evening) -> str:
    parts = [f"🌙 <b>Итог дня</b> · {fmt_date(e.day)}", _score_line(e)]
    if e.total_habits:
        parts.append(f"Привычки: {e.done_habits} из {e.total_habits}")
    if e.habits:
        parts.append("\nНе отмечено — отметь кнопками:")
    elif e.total_habits:
        parts.append("\nВсе привычки отмечены 👌")
    if e.critical:
        tasks = "\n".join(f"• {escape(t)}" for t in e.critical)
        parts.append(f"\n🔴 Критичные задачи не закрыты:\n{tasks}")
    return "\n".join(parts)


def evening_kb(e: Evening, app_url: str) -> InlineKeyboardMarkup:
    rows: list[list[InlineKeyboardButton]] = []
    key = day_key(e.day)
    for h in e.habits[:MAX_HABIT_BUTTONS]:
        hid = h.id.hex
        name = h.name if len(h.name) <= 24 else h.name[:23] + "…"
        rows.append(
            [
                InlineKeyboardButton(
                    text=name, callback_data=Mark(habit=hid, day=key, done=1).pack()
                ),
                InlineKeyboardButton(
                    text="✅", callback_data=Mark(habit=hid, day=key, done=1).pack()
                ),
                InlineKeyboardButton(
                    text="❌", callback_data=Mark(habit=hid, day=key, done=0).pack()
                ),
            ]
        )
    rows.append([InlineKeyboardButton(text="Открыть день", web_app=WebAppInfo(url=app_url))])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def morning_text(first_name: str) -> str:
    return (
        f"☀️ Доброе утро, {escape(first_name)}! Как спал?\n"
        "Запиши сон — от него считается энергия на день."
    )


def morning_kb(app_url: str) -> InlineKeyboardMarkup:
    return open_app_kb(app_url + "?open=sleep", "Записать сон")


def connect_text(token: str, mcp_url: str, replaced: bool) -> str:
    old = "Старый токен больше не работает.\n\n" if replaced else ""
    return (
        "🔑 <b>Твой токен для Claude</b>\n\n"
        f"<code>{escape(token)}</code>\n\n"
        "Сохрани его: я показываю токен один раз, в базе хранится только хеш. "
        f"{old}"
        f"Адрес MCP-сервера: <code>{escape(mcp_url)}</code>\n\n"
        "Как подключить:\n"
        "1. Claude → Settings → Connectors → Add custom connector.\n"
        "2. Вставь адрес сервера и токен.\n"
        "3. Попроси: «посмотри мой трекер и разбери день».\n\n"
        "Подробная инструкция — в приложении: Профиль → Подключить Claude. "
        "Потерял токен или отдал кому-то — просто снова вызови /connect."
    )
