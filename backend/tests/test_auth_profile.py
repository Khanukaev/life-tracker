from httpx import AsyncClient

from tests.conftest import Login, make_init_data


async def test_first_login_creates_account_with_defaults(anon: AsyncClient) -> None:
    r = await anon.post(
        "/api/v1/auth/telegram",
        json={"init_data": make_init_data(7, first_name="Ann"), "timezone": "Europe/Moscow"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["token_type"] == "bearer"
    me = body["user"]
    assert me["first_name"] == "Ann"
    assert me["timezone"] == "Europe/Moscow"
    assert me["language"] == "ru"
    assert me["onboarded"] is False
    assert "theme" not in me  # one dark theme: nothing to choose
    assert me["start_date"] == "2026-11-22"


async def test_second_login_returns_same_account(login: Login) -> None:
    a = await login(7, username="old")
    b = await login(7, username="new", timezone="Asia/Tokyo")
    me_a = (await a.get("/me")).json()
    me_b = (await b.get("/me")).json()
    assert me_a["id"] == me_b["id"]
    assert me_b["username"] == "new"  # refreshed from Telegram
    assert me_b["timezone"] == "UTC"  # time zone is only taken on creation


async def test_english_speakers_get_english(login: Login) -> None:
    c = await login(8, language_code="en")
    assert (await c.get("/me")).json()["language"] == "en"


async def test_invalid_init_data_is_401(anon: AsyncClient) -> None:
    r = await anon.post("/api/v1/auth/telegram", json={"init_data": "user=1&hash=abc"})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthorized"


async def test_endpoints_require_token(anon: AsyncClient) -> None:
    assert (await anon.get("/api/v1/me")).status_code == 401
    r = await anon.get("/api/v1/me", headers={"Authorization": "Bearer nope"})
    assert r.status_code == 401


async def test_update_profile(alice: AsyncClient) -> None:
    r = await alice.patch(
        "/me",
        json={
            "timezone": "Asia/Yekaterinburg",
            "reminder_time": "21:30",
            "morning_time": "08:30",
            "week_note_time": "20:00",
            "haptics": False,
            "onboarded": True,
            "motto": "Steady wins",
        },
    )
    assert r.status_code == 200, r.text
    me = r.json()
    assert (me["reminder_time"], me["morning_time"], me["week_note_time"]) == (
        "21:30",
        "08:30",
        "20:00",
    )
    # explicit null turns a reminder off
    me = (await alice.patch("/me", json={"morning_time": None, "reminder_time": None})).json()
    assert me["reminder_time"] is None
    assert me["morning_time"] is None
    assert me["week_note_time"] == "20:00"
    assert me["motto"] == "Steady wins"


async def test_profile_validation(alice: AsyncClient) -> None:
    assert (await alice.patch("/me", json={"timezone": "Mars/Base"})).status_code == 422
    assert (await alice.patch("/me", json={"first_name": None})).status_code == 422
    assert (await alice.patch("/me", json={"theme": "base"})).status_code == 422  # gone
    assert (await alice.patch("/me", json={"reminder_time": "25:00"})).status_code == 422
    assert (await alice.patch("/me", json={"telegram_id": 1})).status_code == 422  # not editable


async def test_settings_update_and_model_reset(alice: AsyncClient) -> None:
    st = (await alice.get("/settings")).json()
    assert st["sleep_need_h"] == 8.0
    assert st["model_bias"] == [0, 0, 0, 0]
    r = await alice.patch("/settings", json={"bed_target": "00:30", "sleep_need_h": 7.5})
    assert r.json()["bed_target"] == "00:30"
    assert (await alice.patch("/settings", json={"sleep_need_h": 15})).status_code == 422
    r = await alice.post("/settings/model/reset")
    assert r.json()["model_n"] == 0


async def test_health(anon: AsyncClient) -> None:
    assert (await anon.get("/health")).json() == {"status": "ok"}
    assert (await anon.get("/health/ready")).json() == {"status": "ok"}
