"""The Claude screen: reviews and plans, notes about a week or month, the MCP token."""

import uuid
from collections.abc import Sequence
from datetime import date

from fastapi import APIRouter, Response

from lifetracker.api.deps import Now, SessionDep, SettingsDep, UserId
from lifetracker.db.models import Review, Task
from lifetracker.domain.enums import NoteKind, ReviewKind
from lifetracker.schemas.claude import McpIssuedOut, McpStatusOut, NoteIn, NoteOut, ReviewOut
from lifetracker.schemas.tasks import TaskOut
from lifetracker.services import mcp_tokens, notes, reviews
from lifetracker.services.clock import user_now

router = APIRouter(tags=["claude"])


@router.get("/reviews", response_model=list[ReviewOut])
async def list_reviews(
    session: SessionDep, user_id: UserId, kind: ReviewKind | None = None
) -> Sequence[Review]:
    return await reviews.list_reviews(session, user_id, kind=kind)


@router.get("/reviews/{review_id}", response_model=ReviewOut)
async def get_review(review_id: uuid.UUID, session: SessionDep, user_id: UserId) -> Review:
    return await reviews.get_review(session, user_id, review_id)


@router.post("/reviews/{review_id}/apply", response_model=list[TaskOut], status_code=201)
async def apply_plan(
    review_id: uuid.UUID, session: SessionDep, user_id: UserId, now: Now
) -> list[Task]:
    """«Добавить в день»: a plan's items become tasks of its day (once)."""
    return await reviews.apply_plan(session, user_id, review_id, now)


@router.get("/notes/{kind}", response_model=NoteOut | None)
async def get_note(
    kind: NoteKind, session: SessionDep, user_id: UserId, now: Now, anchor: date | None = None
) -> object:
    """The note of the week or month containing `anchor` (default today); null if none."""
    day = anchor or (await user_now(session, user_id, now)).day
    return await notes.get_note(session, user_id, kind, day)


@router.put("/notes/{kind}", response_model=NoteOut | None)
async def put_note(
    kind: NoteKind,
    body: NoteIn,
    session: SessionDep,
    user_id: UserId,
    now: Now,
    anchor: date | None = None,
) -> object:
    day = anchor or (await user_now(session, user_id, now)).day
    return await notes.save_note(session, user_id, kind, day, body.text)


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
