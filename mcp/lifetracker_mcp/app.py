"""HTTP app of the MCP server: Streamable HTTP at /mcp behind token auth and rate limiting.

Auth is a personal bearer token (`Authorization: Bearer lt_…`), which Claude's custom
connectors send as a request header. The token is checked against its SHA-256 in the
database; the resolved user id is put into a context variable that every tool reads.

Stateless mode: each HTTP request is self-contained (no server-side MCP session), so
the server can restart or scale without breaking clients, and the user id never leaks
between requests.
"""

import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import structlog
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from lifetracker.core.config import get_settings
from lifetracker.core.logging import configure_logging
from lifetracker.core.ratelimit import (
    ASGIApp,
    RateLimitMiddleware,
    Receive,
    Scope,
    Send,
    SlidingWindowLimiter,
)
from lifetracker.db.session import get_sessionmaker
from lifetracker.services.mcp_tokens import user_by_token
from lifetracker_mcp import tools

log = structlog.get_logger("mcp")


class TokenAuth:
    """Resolve `Authorization: Bearer <token>` to a user, or answer 401."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        token = None
        for name, value in scope.get("headers", []):
            if name == b"authorization" and value[:7].lower() == b"bearer ":
                token = value[7:].strip().decode("latin-1")
        user_id = None
        if token:
            async with get_sessionmaker()() as session:
                user_id = await user_by_token(session, token, tools.clock())
        if user_id is None:
            await _unauthorized(send)
            return
        ctx = tools.current_user.set(user_id)
        structlog.contextvars.bind_contextvars(user_id=str(user_id))
        try:
            await self.app(scope, receive, send)
        finally:
            tools.current_user.reset(ctx)
            structlog.contextvars.unbind_contextvars("user_id")


async def _unauthorized(send: Send) -> None:
    body = json.dumps(
        {
            "error": "unauthorized",
            "message": "Personal token required: Authorization: Bearer <token>. "
            "Get one in the bot with /connect or in the app: Профиль → Подключить Claude.",
        }
    ).encode()
    await send(
        {
            "type": "http.response.start",
            "status": 401,
            "headers": [
                (b"content-type", b"application/json"),
                (b"www-authenticate", b'Bearer realm="life-tracker"'),
                (b"content-length", str(len(body)).encode()),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


async def health(_: Request) -> JSONResponse:
    return JSONResponse({"status": "ok"})


def create_app() -> Starlette:
    settings = get_settings()
    configure_logging(settings.log_level, json=settings.app_env == "prod")
    mcp_app = tools.server.streamable_http_app(
        streamable_http_path="/mcp",
        stateless_http=True,
        json_response=True,
        host="0.0.0.0",  # noqa: S104  (behind Caddy; auth is the token, not the Host header)
    )
    limiter = SlidingWindowLimiter(settings.rate_limit_mcp)
    # Order: rate limit (cheap) → token check (one indexed DB lookup) → MCP.
    protected = RateLimitMiddleware(TokenAuth(mcp_app), limiter)

    @asynccontextmanager
    async def lifespan(_: Starlette) -> AsyncIterator[None]:
        async with mcp_app.router.lifespan_context(mcp_app):  # starts the session manager
            log.info("mcp_started", url=settings.mcp_url)
            yield

    # /health stays open for Docker; everything else (i.e. /mcp) needs a token.
    # Not a Mount: Starlette would redirect POST /mcp → /mcp/, which MCP clients don't follow.
    open_app = Starlette(routes=[Route("/health", health)], lifespan=lifespan)

    async def app(scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "lifespan" or scope.get("path") == "/health":
            await open_app(scope, receive, send)
        else:
            await protected(scope, receive, send)

    app.limiter = limiter  # type: ignore[attr-defined]
    return app  # type: ignore[return-value]


def __getattr__(name: str) -> Any:  # `uvicorn lifetracker_mcp.app:app` builds it lazily
    if name == "app":
        return create_app()
    raise AttributeError(name)
