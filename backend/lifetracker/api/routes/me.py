from fastapi import APIRouter

from lifetracker.api.deps import SessionDep, UserId
from lifetracker.db.models import User, UserSettings
from lifetracker.schemas.users import MeOut, MeUpdate, SettingsOut, SettingsUpdate
from lifetracker.services import users

router = APIRouter(tags=["profile"])


@router.get("/me", response_model=MeOut)
async def get_me(session: SessionDep, user_id: UserId) -> User:
    return await users.get_me(session, user_id)


@router.patch("/me", response_model=MeOut)
async def update_me(body: MeUpdate, session: SessionDep, user_id: UserId) -> User:
    return await users.update_me(session, user_id, body)


@router.get("/settings", response_model=SettingsOut)
async def get_settings(session: SessionDep, user_id: UserId) -> UserSettings:
    return await users.get_settings(session, user_id)


@router.patch("/settings", response_model=SettingsOut)
async def update_settings(
    body: SettingsUpdate, session: SessionDep, user_id: UserId
) -> UserSettings:
    return await users.update_settings(session, user_id, body)


@router.post("/settings/model/reset", response_model=SettingsOut)
async def reset_model(session: SessionDep, user_id: UserId) -> UserSettings:
    """Forget the personal correction learned from "How do you feel?" answers."""
    return await users.reset_energy_model(session, user_id)
