"""Personal MCP tokens.

The plain token is shown to the user exactly once (in the bot or the Mini App); the
database keeps only its SHA-256, like a password hash. A leaked database therefore does
not let anyone talk to the MCP server on a user's behalf. SHA-256 without salt is enough
here because the token itself is 256 random bits — there is nothing to brute-force.
"""

import hashlib
import secrets
import uuid
from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from lifetracker.db.models import McpToken

TOKEN_PREFIX = "lt_"  # noqa: S105  (a visible marker, not a secret)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def issue_token(session: AsyncSession, user_id: uuid.UUID, now: datetime) -> str:
    """Revoke the active token (if any) and create a new one. Returns the plain token."""
    token = TOKEN_PREFIX + secrets.token_urlsafe(32)
    await session.execute(
        update(McpToken)
        .where(McpToken.user_id == user_id, McpToken.revoked_at.is_(None))
        .values(revoked_at=now)
    )
    session.add(McpToken(user_id=user_id, token_hash=hash_token(token), prefix=token[:10]))
    await session.commit()
    return token


async def active_token(session: AsyncSession, user_id: uuid.UUID) -> McpToken | None:
    return await session.scalar(
        select(McpToken).where(McpToken.user_id == user_id, McpToken.revoked_at.is_(None))
    )


async def user_by_token(session: AsyncSession, token: str, now: datetime) -> uuid.UUID | None:
    """Authenticate an MCP request. Revoked and unknown tokens look the same."""
    row = await session.scalar(
        select(McpToken).where(
            McpToken.token_hash == hash_token(token), McpToken.revoked_at.is_(None)
        )
    )
    if row is None:
        return None
    row.last_used_at = now
    await session.commit()
    return row.user_id
