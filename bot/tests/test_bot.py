"""The bot end to end: Telegram updates in, Bot API calls out (recorded by FakeTelegram)."""

import uuid
from datetime import UTC, date, datetime
from typing import Any

from aiogram import Bot, Dispatcher
from aiogram.exceptions import TelegramForbiddenError, TelegramRetryAfter
from aiogram.methods import AnswerCallbackQuery, EditMessageText, SendMessage
from aiogram.types import InlineKeyboardMarkup, Update
from fake_telegram import FakeTelegram
from httpx import AsyncClient
from sqlalchemy import select
from tests.conftest import Clock

from lifetracker.core.config import get_settings
from lifetracker.db.models import Delivery, HabitLog, McpToken, Task, User
from lifetracker.db.session import get_sessionmaker
from lifetracker.domain.enums import DeliveryKind
from lifetracker.services import mcp_tokens, reminders
from lifetracker.services.reminders import Evening, Morning, PendingHabit
from lifetracker_bot import texts
from lifetracker_bot.scheduler import RateLimiter, Reminders

TS = int(datetime(2026, 11, 22, tzinfo=UTC).timestamp())
_update_id = 0


def _update(**kw: Any) -> Update:
    global _update_id
    _update_id += 1
    return Update.model_validate({"update_id": _update_id, **kw})


def _user(tg_id: int) -> dict[str, Any]:
    return {"id": tg_id, "is_bot": False, "first_name": "Alice", "language_code": "ru"}


def message(tg_id: int, text: str) -> Update:
    return _update(
        message={
            "message_id": 1,
            "date": TS,
            "chat": {"id": tg_id, "type": "private"},
            "from": _user(tg_id),
            "text": text,
            "entities": [{"type": "bot_command", "offset": 0, "length": len(text.split()[0])}],
        }
    )


def press(tg_id: int, data: str) -> Update:
    return _update(
        callback_query={
            "id": "cb1",
            "from": _user(tg_id),
            "chat_instance": "x",
            "data": data,
            "message": {
                "message_id": 7,
                "date": TS,
                "chat": {"id": tg_id, "type": "private"},
                "text": "old",
            },
        }
    )


def _member(status: str, me: dict[str, Any]) -> dict[str, Any]:
    return {"status": status, "user": me, **({"until_date": 0} if status == "kicked" else {})}


def chat_member(tg_id: int, old: str, new: str) -> Update:
    me = {"id": 42, "is_bot": True, "first_name": "Bot"}
    return _update(
        my_chat_member={
            "chat": {"id": tg_id, "type": "private"},
            "from": _user(tg_id),
            "date": TS,
            "old_chat_member": _member(old, me),
            "new_chat_member": _member(new, me),
        }
    )


async def user_row(tg_id: int) -> User | None:
    async with get_sessionmaker()() as s:
        return await s.scalar(select(User).where(User.telegram_id == tg_id))


def buttons(markup: InlineKeyboardMarkup | None) -> list[str]:
    assert markup is not None
    return [b.text for row in markup.inline_keyboard for b in row]


# ---- commands ----


async def test_start_creates_account_and_offers_the_app(
    dp: Dispatcher, bot: Bot, tg: FakeTelegram
) -> None:
    await dp.feed_update(bot, message(5005, "/start"))
    user = await user_row(5005)
    assert user is not None
    assert user.onboarded is False
    [sent] = tg.sent()
    assert "Привет, Alice" in sent.text
    [button] = sent.reply_markup.inline_keyboard[0]
    assert button.web_app.url == get_settings().webapp_url


async def test_start_after_block_resumes_messages(dp: Dispatcher, bot: Bot) -> None:
    await dp.feed_update(bot, message(5005, "/start"))
    await dp.feed_update(bot, chat_member(5005, "member", "kicked"))
    assert (await user_row(5005)).bot_blocked is True  # type: ignore[union-attr]
    await dp.feed_update(bot, chat_member(5005, "kicked", "member"))
    assert (await user_row(5005)).bot_blocked is False  # type: ignore[union-attr]


async def test_connect_issues_and_rotates_token(
    dp: Dispatcher, bot: Bot, tg: FakeTelegram, clock: Clock
) -> None:
    await dp.feed_update(bot, message(5005, "/connect"))
    await dp.feed_update(bot, message(5005, "/connect"))
    first, second = tg.sent()
    token1 = first.text.split("<code>")[1].split("</code>")[0]
    token2 = second.text.split("<code>")[1].split("</code>")[0]
    assert token1 != token2
    assert first.protect_content is True
    assert "Старый токен больше не работает" in second.text
    assert get_settings().mcp_url in second.text

    user = await user_row(5005)
    async with get_sessionmaker()() as s:
        assert await mcp_tokens.user_by_token(s, token1, clock.now) is None
        assert await mcp_tokens.user_by_token(s, token2, clock.now) == user.id  # type: ignore[union-attr]
        rows = (await s.scalars(select(McpToken))).all()
        assert all(token2 not in r.token_hash for r in rows)


# ---- marking from the evening message ----


async def test_mark_button_logs_habit_and_redraws(
    dp: Dispatcher, bot: Bot, tg: FakeTelegram, alice: AsyncClient
) -> None:
    hid = (await alice.post("/habits", json={"name": "Vitamins", "type": "check"})).json()["id"]
    data = texts.Mark(habit=uuid.UUID(hid).hex, day="20261122", done=1).pack()
    await dp.feed_update(bot, press(1001, data))

    habit = next(h for h in (await alice.get("/views/day")).json()["habits"] if h["id"] == hid)
    assert habit["value"] is True
    [answer] = tg.sent(AnswerCallbackQuery)
    assert answer.text == "✅ Vitamins"
    [edit] = tg.sent(EditMessageText)
    assert "Все привычки отмечены" in edit.text
    assert "Vitamins" not in buttons(edit.reply_markup)


async def test_forged_button_cannot_touch_someone_elses_habit(
    dp: Dispatcher, bot: Bot, tg: FakeTelegram, alice: AsyncClient
) -> None:
    hid = (await alice.post("/habits", json={"name": "Vitamins", "type": "check"})).json()["id"]
    await dp.feed_update(bot, message(6006, "/start"))  # Mallory has an account
    data = texts.Mark(habit=uuid.UUID(hid).hex, day="20261122", done=0).pack()
    await dp.feed_update(bot, press(6006, data))

    habit = next(h for h in (await alice.get("/views/day")).json()["habits"] if h["id"] == hid)
    assert habit["value"] is None
    [answer] = tg.sent(AnswerCallbackQuery)
    assert "больше не отмечается" in answer.text
    assert tg.sent(EditMessageText) == []


# ---- texts ----


def test_evening_text_and_keyboard() -> None:
    hid = uuid.uuid4()
    e = Evening(
        day=date(2026, 11, 22),
        score=72,
        delta=-5,
        habits=[PendingHabit(hid, "Очень длинное название привычки")],
        important=["Отчёт <срочно>"],
        done_habits=2,
        total_habits=3,
    )
    text = texts.evening_text(e)
    assert "Рейтинг дня: <b>72%</b> (−5 ко вчера)" in text
    assert "Привычки: 2 из 3" in text
    assert "Отчёт &lt;срочно&gt;" in text  # user text is HTML-escaped
    kb = texts.evening_kb(e, "https://t.example/")
    first = kb.inline_keyboard[0]
    assert first[0].text.endswith("…")
    assert len(first[0].text) == 24
    assert [b.text for b in first[1:]] == ["✅", "❌"]
    assert all(len(b.callback_data or "") <= 64 for b in first)
    assert texts.Mark.unpack(first[2].callback_data or "").done == 0
    assert kb.inline_keyboard[-1][0].web_app is not None


def test_morning_text_has_the_plan_and_asks_for_sleep() -> None:
    m = Morning(
        day=date(2026, 11, 22), first_name="Лёша", sleep_logged=False, tasks=3,
        important=["Лаба"], plan=["10:00 Лаба по физике", "Вода"],
    )  # fmt: skip
    text = texts.morning_text(m)
    assert "План на сегодня" in text
    assert "• 10:00 Лаба по физике" in text
    assert "На сегодня 3 дела." in text
    assert "Как спал?" in text
    kb = texts.morning_kb(m, "https://t.example/")
    assert kb.inline_keyboard[0][0].web_app.url == "https://t.example/?open=sleep"  # type: ignore[union-attr]
    slept = texts.morning_kb(Morning(m.day, "Лёша", True, 0, [], []), "https://t.example/")
    assert slept.inline_keyboard[0][0].web_app.url == "https://t.example/"  # type: ignore[union-attr]


# ---- scheduler ----


async def test_scheduler_sends_once_and_marks_delivery(
    bot: Bot, tg: FakeTelegram, alice: AsyncClient, clock: Clock
) -> None:
    await alice.patch("/me", json={"reminder_time": "21:00", "morning_time": "08:00"})
    await alice.post("/habits", json={"name": "Vitamins", "type": "check"})
    worker = Reminders(bot, get_sessionmaker(), get_settings(), now=clock)

    clock.now = datetime(2026, 11, 22, 8, 0, tzinfo=UTC)
    assert await worker.tick() == 1
    assert "Как спал" in tg.sent()[-1].text

    clock.now = datetime(2026, 11, 22, 21, 1, tzinfo=UTC)
    assert await worker.tick() == 1
    assert await worker.tick() == 0  # same evening: never twice
    evening = tg.sent()[-1]
    assert isinstance(evening, SendMessage)
    assert evening.chat_id == 1001
    assert "Итог дня" in evening.text
    assert "Vitamins" in buttons(evening.reply_markup)

    async with get_sessionmaker()() as s:
        rows = (await s.scalars(select(Delivery))).all()
        assert len(rows) == 2
        assert all(r.sent_at is not None for r in rows)


async def test_item_reminders_and_their_done_buttons(
    dp: Dispatcher, bot: Bot, tg: FakeTelegram, alice: AsyncClient, clock: Clock
) -> None:
    task = (
        await alice.post(
            "/tasks",
            json={"title": "Дз по матану", "date": "2026-11-22", "start_time": "18:00",
                  "remind_at": "17:30"},
        )
    ).json()  # fmt: skip
    water = (
        await alice.post(
            "/habits",
            json={"name": "Вода", "type": "count", "config": {"norm": 8}, "remind_at": "15:00"},
        )
    ).json()
    rest = (
        await alice.post(
            "/habits",
            json={"name": "Зал", "type": "check", "remind_at": "15:00",
                  "schedule": {"kind": "weekdays"}},
        )
    ).json()  # fmt: skip
    await alice.put(f"/days/2026-11-22/habits/{water['id']}", json={"value": 3})
    await alice.post("/tasks", json={"title": "Поздно", "date": "2026-11-22", "remind_at": "17:45"})
    worker = Reminders(bot, get_sessionmaker(), get_settings(), now=clock)

    clock.now = datetime(2026, 11, 22, 15, 5, tzinfo=UTC)  # a Sunday: «Зал» rests
    assert await worker.tick() == 1
    msg = tg.sent()[-1]
    assert isinstance(msg, SendMessage)
    assert "Вода</b> — 3 из 8" in msg.text
    assert rest["name"] not in msg.text
    assert await worker.tick() == 0  # once a day

    await dp.feed_update(bot, press(1001, msg.reply_markup.inline_keyboard[0][0].callback_data))  # type: ignore[union-attr,arg-type]
    # The clock moved past the app session's lifetime: check in the database.
    async with get_sessionmaker()() as s:
        log = await s.get(HabitLog, (uuid.UUID(water["id"]), date(2026, 11, 22)))
        assert log is not None
        assert log.value == 8  # «Сделано» fills the norm

    clock.now = datetime(2026, 11, 22, 17, 31, tzinfo=UTC)
    assert await worker.tick() == 1
    msg = tg.sent()[-1]
    assert "Дз по матану</b> · 18:00" in msg.text  # type: ignore[union-attr]
    await dp.feed_update(bot, press(1001, msg.reply_markup.inline_keyboard[0][0].callback_data))  # type: ignore[union-attr,arg-type]
    async with get_sessionmaker()() as s:
        row = await s.get(Task, uuid.UUID(task["id"]))
        assert row is not None
        assert row.done is True
    assert any(isinstance(c, EditMessageText) and "✅ Дз по матану" in c.text for c in tg.calls)

    clock.now = datetime(2026, 11, 22, 18, 46, tzinfo=UTC)  # over an hour late: dropped
    assert await worker.tick() == 0


async def test_week_note_nudge_only_on_sunday(
    bot: Bot, tg: FakeTelegram, alice: AsyncClient, clock: Clock
) -> None:
    await alice.patch("/me", json={"week_note_time": "20:00"})
    worker = Reminders(bot, get_sessionmaker(), get_settings(), now=clock)
    clock.now = datetime(2026, 11, 21, 20, 1, tzinfo=UTC)  # Saturday
    assert await worker.tick() == 0
    clock.now = datetime(2026, 11, 22, 20, 1, tzinfo=UTC)  # Sunday
    assert await worker.tick() == 1
    msg = tg.sent()[-1]
    assert "Claude учтёт" in msg.text  # type: ignore[union-attr]
    assert msg.reply_markup.inline_keyboard[0][0].web_app.url.endswith("?open=note")  # type: ignore[union-attr]


async def test_blocked_user_is_marked_and_skipped(
    bot: Bot, tg: FakeTelegram, alice: AsyncClient, clock: Clock
) -> None:
    await alice.patch("/me", json={"reminder_time": "21:00"})
    clock.now = datetime(2026, 11, 22, 21, 0, tzinfo=UTC)
    tg.fail_with.append(
        lambda m: TelegramForbiddenError(m, "Forbidden: bot was blocked by the user")
    )
    worker = Reminders(bot, get_sessionmaker(), get_settings(), now=clock)
    assert await worker.tick() == 0
    assert (await user_row(1001)).bot_blocked is True  # type: ignore[union-attr]
    clock.now = datetime(2026, 11, 23, 21, 0, tzinfo=UTC)  # next evening: not even tried
    calls = len(tg.calls)
    assert await worker.tick() == 0
    assert len(tg.calls) == calls


async def test_flood_wait_is_respected_then_retried(
    bot: Bot, tg: FakeTelegram, alice: AsyncClient, clock: Clock
) -> None:
    await alice.patch("/me", json={"reminder_time": "21:00"})
    clock.now = datetime(2026, 11, 22, 21, 0, tzinfo=UTC)
    tg.fail_with.append(lambda m: TelegramRetryAfter(m, "Too Many Requests", retry_after=0))
    worker = Reminders(bot, get_sessionmaker(), get_settings(), now=clock)
    assert await worker.tick() == 1
    assert len(tg.sent()) == 2  # the failed attempt and the retry


async def test_transient_error_releases_claim_for_next_tick(
    bot: Bot, tg: FakeTelegram, alice: AsyncClient, clock: Clock
) -> None:
    await alice.patch("/me", json={"reminder_time": "21:00"})
    clock.now = datetime(2026, 11, 22, 21, 0, tzinfo=UTC)
    tg.fail_with.append(lambda m: ConnectionError("network down"))
    worker = Reminders(bot, get_sessionmaker(), get_settings(), now=clock)
    assert await worker.tick() == 0
    async with get_sessionmaker()() as s:
        assert (await s.scalars(select(Delivery))).all() == []
        assert len(await reminders.due_reminders(s, DeliveryKind.EVENING, clock.now)) == 1
    assert await worker.tick() == 1


async def test_rate_limiter_spaces_calls() -> None:
    import time

    limiter = RateLimiter(rate=50)
    started = time.monotonic()
    for _ in range(6):
        await limiter.wait()
    assert time.monotonic() - started >= 0.09  # 5 gaps × 20 ms
