"""Everything the "Подключить Claude" screen and the reviews list need."""

import uuid
from collections.abc import Sequence

from fastapi import APIRouter, Response

from lifetracker.api.deps import Now, SessionDep, SettingsDep, UserId
from lifetracker.db.models import Review
from lifetracker.domain.enums import ReviewKind
from lifetracker.schemas.claude import McpIssuedOut, McpStatusOut, ReviewOut
from lifetracker.services import mcp_tokens, reviews

router = APIRouter(tags=["claude"])


@router.get("/reviews", response_model=list[ReviewOut])
async def list_reviews(
    session: SessionDep, user_id: UserId, kind: ReviewKind | None = None
) -> Sequence[Review]:
    return await reviews.list_reviews(session, user_id, kind=kind)


@router.get("/reviews/{review_id}", response_model=ReviewOut)
async def get_review(review_id: uuid.UUID, session: SessionDep, user_id: UserId) -> Review:
    return await reviews.get_review(session, user_id, review_id)


@router.get("/mcp/token", response_model=McpStatusOut)
async def token_status(session: SessionDep, user_id: UserId, settings: SettingsDep) -> McpStatusOut:
    """The token itself cannot be shown again: only its hash is stored."""
    t = await mcp_tokens.active_token(session, user_id)
    if t is None:
        return McpStatusOut(url=settings.mcp_url, active=False)
    return McpStatusOut(
        url=settings.mcp_url,
        active=True,
        prefix=t.prefix,
        created_at=t.created_at,
        last_used_at=t.last_used_at,
    )


@router.post("/mcp/token", response_model=McpIssuedOut)
async def issue_token(
    session: SessionDep, user_id: UserId, settings: SettingsDep, now: Now
) -> McpIssuedOut:
    """Create a token, revoking the previous one. The response is the only time it is shown."""
    token = await mcp_tokens.issue_token(session, user_id, now)
    return McpIssuedOut(url=settings.mcp_url, token=token, prefix=token[:10])


@router.delete("/mcp/token", status_code=204)
async def revoke_token(session: SessionDep, user_id: UserId, now: Now) -> Response:
    await mcp_tokens.revoke_token(session, user_id, now)
    return Response(status_code=204)
