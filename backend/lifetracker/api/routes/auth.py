from fastapi import APIRouter

from lifetracker.api.deps import Now, SessionDep, SettingsDep
from lifetracker.core.security import create_access_token, verify_init_data
from lifetracker.schemas.users import AuthOut, MeOut, TelegramAuthIn
from lifetracker.services import users

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/telegram", response_model=AuthOut)
async def telegram_login(
    body: TelegramAuthIn, session: SessionDep, settings: SettingsDep, now: Now
) -> AuthOut:
    """Exchange signed Mini App ``initData`` for a short-lived access token."""
    tg = verify_init_data(
        body.init_data,
        bot_token=settings.bot_token.get_secret_value(),
        max_age_s=settings.initdata_max_age_s,
        now=now,
    )
    user = await users.login_telegram_user(session, tg, timezone=body.timezone, now=now)
    token = create_access_token(
        user.id, secret=settings.jwt_secret.get_secret_value(), ttl_s=settings.jwt_ttl_s, now=now
    )
    return AuthOut(
        access_token=token, expires_in=settings.jwt_ttl_s, user=MeOut.model_validate(user)
    )
