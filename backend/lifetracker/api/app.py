"""FastAPI application factory."""

import time
import uuid
from collections.abc import Awaitable, Callable

import structlog
from fastapi import APIRouter, FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from lifetracker.api.deps import SessionDep
from lifetracker.api.routes import (
    auth,
    claude,
    days,
    habits,
    imports,
    me,
    tasks,
    views,
)
from lifetracker.core.config import get_settings
from lifetracker.core.errors import AppError
from lifetracker.core.logging import configure_logging
from lifetracker.core.ratelimit import RateLimitMiddleware, SlidingWindowLimiter

log = structlog.get_logger("api")


def _error(status: int, code: str, message: str, details: object = None) -> JSONResponse:
    body: dict[str, object] = {"code": code, "message": message}
    if details is not None:
        body["details"] = jsonable_encoder(details)
    return JSONResponse(status_code=status, content={"error": body})


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level, json=settings.app_env == "prod")
    app = FastAPI(
        title="Life Tracker API",
        version="0.1.0",
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
    )

    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        return _error(exc.status_code, exc.code, exc.message)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        return _error(422, "invalid", "Request validation failed", exc.errors())

    @app.exception_handler(IntegrityError)
    async def _integrity_error(_: Request, exc: IntegrityError) -> JSONResponse:
        # Safety net: services check constraints first, so this means a race or a bug.
        log.warning("integrity_error", error=str(exc.orig))
        return _error(409, "conflict", "Conflicting data")

    @app.middleware("http")
    async def _access_log(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
        structlog.contextvars.bind_contextvars(request_id=request_id)
        started = time.perf_counter()
        try:
            response = await call_next(request)
        finally:
            structlog.contextvars.unbind_contextvars("request_id")
        response.headers["x-request-id"] = request_id
        log.info(
            "request",
            request_id=request_id,
            method=request.method,
            path=request.url.path,
            status=response.status_code,
            duration_ms=round((time.perf_counter() - started) * 1000, 1),
        )
        return response

    @app.get("/health", tags=["health"])
    async def health() -> dict[str, str]:
        """Liveness: the process is up."""
        return {"status": "ok"}

    @app.get("/health/ready", tags=["health"])
    async def ready(session: SessionDep) -> dict[str, str]:
        """Readiness: the database answers."""
        await session.execute(text("SELECT 1"))
        return {"status": "ok"}

    # Outermost: a client over its limit costs us nothing beyond this check.
    app.state.rate_limiter = SlidingWindowLimiter(settings.rate_limit_api)
    app.state.auth_limiter = SlidingWindowLimiter(settings.rate_limit_auth)
    app.add_middleware(
        RateLimitMiddleware,
        limiter=app.state.rate_limiter,
        strict=app.state.auth_limiter,
        strict_paths=("/api/v1/auth/",),
    )

    api = APIRouter(prefix="/api/v1")
    for module in (auth, me, habits, days, tasks, views, claude, imports):
        api.include_router(module.router)
    app.include_router(api)
    return app


app = create_app()
