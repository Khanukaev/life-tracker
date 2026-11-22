from httpx import AsyncClient

from lifetracker.db.session import get_sessionmaker
from lifetracker.seed import DEMO_USERS, seed_user
from tests.conftest import FROZEN_NOW, Login


async def test_seed_is_idempotent_and_users_differ(login: Login) -> None:
    async with get_sessionmaker()() as session:
        assert [await seed_user(session, s, FROZEN_NOW) for s in DEMO_USERS] == [True, True]
        assert [await seed_user(session, s, FROZEN_NOW) for s in DEMO_USERS] == [False, False]

    anna: AsyncClient = await login(DEMO_USERS[0]["tg"].id)
    ilya: AsyncClient = await login(DEMO_USERS[1]["tg"].id)
    anna_habits = {h["type"] for h in (await anna.get("/habits")).json()}
    ilya_habits = {h["type"] for h in (await ilya.get("/habits")).json()}
    assert anna_habits == {"bedtime", "water", "minutes", "check"}
    assert ilya_habits == {"check", "dual", "minutes"}
    assert len((await anna.get("/goals")).json()) == 1
