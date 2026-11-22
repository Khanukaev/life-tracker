"""Application settings loaded from environment variables (see .env.example)."""

from functools import lru_cache
from typing import Literal

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: Literal["dev", "test", "prod"] = "dev"
    log_level: str = "INFO"

    database_url: str = "postgresql+asyncpg://tracker:tracker@localhost:5432/tracker"
    db_pool_size: int = 10

    bot_token: SecretStr = SecretStr("")
    jwt_secret: SecretStr
    jwt_ttl_s: int = 3600
    initdata_max_age_s: int = 86400
    # Local browser development without Telegram: POST /auth/dev. Ignored unless APP_ENV=dev.
    dev_auth: bool = False

    @field_validator("jwt_secret")
    @classmethod
    def _secret_is_strong(cls, v: SecretStr) -> SecretStr:
        if len(v.get_secret_value()) < 32:
            raise ValueError("JWT_SECRET must be at least 32 characters")
        return v


@lru_cache
def get_settings() -> Settings:
    return Settings()  # values come from the environment
