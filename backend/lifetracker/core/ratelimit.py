"""Rate limiting for the API and the MCP server.

Sliding-window counter (the "two buckets" approximation used by Cloudflare and nginx):
the estimate is ``current + previous * (share of the previous window still in view)``.
It needs two integers per client, has no burst at window edges like a fixed window,
and is O(1) per request.

State lives in process memory. That is enough for one instance per service, which is
how this project is deployed; several replicas would move the counters to Redis behind
the same ``hit()`` interface.
"""

import hashlib
import math
import time
from collections.abc import Awaitable, Callable, MutableMapping
from dataclasses import dataclass
from typing import Any

Scope = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[MutableMapping[str, Any]]]
Send = Callable[[MutableMapping[str, Any]], Awaitable[None]]
ASGIApp = Callable[[Scope, Receive, Send], Awaitable[None]]

PRUNE_AT = 50_000  # keys; dropping idle ones keeps memory bounded


@dataclass(slots=True)
class _Bucket:
    window: int
    current: int
    previous: int


class SlidingWindowLimiter:
    def __init__(
        self, limit: int, period_s: float = 60.0, clock: Callable[[], float] = time.monotonic
    ) -> None:
        self.limit = limit
        self.period = period_s
        self.clock = clock
        self.enabled = True
        self._buckets: dict[str, _Bucket] = {}

    def hit(self, key: str) -> float | None:
        """Count a request. Returns None if allowed, else seconds to wait."""
        if not self.enabled:
            return None
        now = self.clock()
        window = int(now // self.period)
        b = self._buckets.get(key)
        if b is None:
            if len(self._buckets) >= PRUNE_AT:
                self._prune(window)
            b = self._buckets[key] = _Bucket(window, 0, 0)
        elif b.window != window:
            b.previous = b.current if b.window == window - 1 else 0
            b.current = 0
            b.window = window
        elapsed = (now % self.period) / self.period
        estimate = b.current + b.previous * (1 - elapsed)
        if estimate >= self.limit:
            # Wait until enough of the previous window has slid out of view.
            if b.previous:
                need = (estimate - self.limit + 1) / b.previous * self.period
                return max(1.0, math.ceil(need))
            return max(1.0, math.ceil((1 - elapsed) * self.period))
        b.current += 1
        return None

    def _prune(self, window: int) -> None:
        self._buckets = {k: b for k, b in self._buckets.items() if b.window >= window - 1}


def client_key(scope: Scope) -> str:
    """Bearer token (hashed) if present, else the client IP set by the trusted proxy."""
    for name, value in scope.get("headers", []):
        if name == b"authorization" and value[:7].lower() == b"bearer ":
            return "t:" + hashlib.sha256(value[7:].strip()).hexdigest()[:32]
    client = scope.get("client")
    return "ip:" + (client[0] if client else "unknown")


class RateLimitMiddleware:
    """ASGI middleware: 429 with Retry-After once a client exceeds its limit."""

    def __init__(
        self,
        app: ASGIApp,
        limiter: SlidingWindowLimiter,
        *,
        skip: Callable[[str], bool] = lambda path: path.startswith("/health"),
        strict: SlidingWindowLimiter | None = None,
        strict_paths: tuple[str, ...] = (),
    ) -> None:
        self.app = app
        self.limiter = limiter
        self.skip = skip
        self.strict = strict
        self.strict_paths = strict_paths

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or self.skip(scope["path"]):
            await self.app(scope, receive, send)
            return
        key = client_key(scope)
        limiter = self.limiter
        if self.strict is not None and scope["path"].startswith(self.strict_paths):
            # Login endpoints: no token yet, so limit by IP and much tighter.
            limiter, key = self.strict, "ip:" + (scope.get("client") or ("unknown",))[0]
        retry = limiter.hit(key)
        if retry is None:
            await self.app(scope, receive, send)
            return
        body = b'{"error":{"code":"rate_limited","message":"Too many requests"}}'
        await send(
            {
                "type": "http.response.start",
                "status": 429,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"retry-after", str(int(retry)).encode()),
                    (b"content-length", str(len(body)).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})
