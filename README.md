# Life Tracker

Multi-user tracker for habits, sleep, energy, tasks and goals — a Telegram bot,
a Telegram Mini App and a remote MCP server so each user's Claude can read and
update their own data.

> Work in progress. Done so far: backend (data model, Telegram auth, API,
> per-user isolation, domain logic proven 1:1 by golden tests), the Mini App, the
> bot and the MCP server. Full docs, architecture and screenshots will land with v0.1.0.

## Stack

- **Backend:** Python 3.12, FastAPI, SQLAlchemy 2 (async) + Alembic, PostgreSQL 17, Pydantic v2
- **Mini App:** Vite + TypeScript + Preact, ~73 KB of JS (gzip)
- **Bot:** aiogram 3, long polling + a reminder worker in the same process
- **Infra:** Docker Compose, Caddy (automatic HTTPS), GitHub Actions
- **MCP:** official Python SDK (`MCPServer`), Streamable HTTP, stateless, personal bearer tokens

## Quick start

```bash
cp .env.example .env          # set JWT_SECRET (openssl rand -hex 32) and BOT_TOKEN
make up                       # build, migrate and start postgres + backend + caddy
make seed                     # two demo users with different habits
```

API docs: <http://localhost/api/docs> (via Caddy) or `make dev` → <http://localhost:8000/api/docs>.

## Development

```bash
make db      # start PostgreSQL only
make test    # pytest against a real PostgreSQL (schema built by migrations)
make lint    # ruff + mypy (strict)
```

## Bot

- `/start` creates the account and opens the Mini App (also via the menu button).
- `/connect` issues or rotates the personal MCP token (only its SHA-256 is stored).
- Evening summary at the user's own time and time zone: day score, unmarked habits
  with ✅/❌ buttons, unfinished critical tasks. Optional morning "How did you sleep?"
  that opens the sleep sheet.
- Scheduling is one SQL query per tick ("whose local reminder time has come?"); each
  message is first claimed in `deliveries` with `ON CONFLICT DO NOTHING`, so it goes out
  exactly once even with several workers. Sends are rate-limited below Telegram's limit
  and honour `retry_after`; users who blocked the bot are marked and skipped.

```bash
make bot                               # locally, needs BOT_TOKEN in .env
docker compose --profile bot up -d     # in the stack
```

The bot calls the same `lifetracker.services` as the API (no HTTP hop) and ships in the
same Docker image.

## MCP server: your own Claude in the tracker

`https://<domain>/mcp` — a remote MCP server on the same services and database.

- **Auth:** a personal token (`Authorization: Bearer lt_…`) from the app (Профиль →
  Подключить Claude) or the bot (`/connect`). Only its SHA-256 is stored; reissuing
  revokes the old one at once. Claude's custom connectors send it as a request header.
- **Read tools:** `get_profile`, `get_today`, `get_day`, `get_progress`, `get_week_summary`,
  `get_streaks`, `get_energy`, `list_habits`, `list_tasks`, `list_goals`.
- **Write tools:** `log_habit`, `log_sleep`, `create_task`, `update_task`, `complete_task`,
  `create_habit`, `update_habit`, `create_goal`, `update_goal` (history says "by: claude"),
  `save_review` — reviews show up in the Mini App.
- Server instructions and tool descriptions explain the data model (logical day,
  habit types, energy zones, score), so Claude needs no extra prompting.
- Stateless Streamable HTTP with JSON responses: no server-side sessions, restarts and
  scaling don't break clients, and the user id lives only in the request's context.
- The server never calls an LLM itself: analysis happens in the user's own Claude.

```bash
make mcp     # locally on :8001
```

## Rate limiting

Sliding-window counters (two buckets per client, O(1)): API per access token,
login per IP, MCP per personal token; `429` + `Retry-After`. In-process state fits one
instance per service; several replicas would move the counters to Redis.

## Security model

- The Mini App sends Telegram `initData`; the backend verifies its HMAC-SHA256
  signature and age, then issues a short-lived JWT.
- `user_id` always comes from the token. Every query filters by it, and someone
  else's object is reported as *404 Not Found*.
- Composite foreign keys `(ref_id, user_id)` make cross-user references impossible
  even at the database level. `backend/tests/test_isolation.py` checks all of it.
- MCP: the user comes only from the token; every tool is tested to answer "not found"
  for another user's ids (`mcp/tests/test_mcp.py`).
- The bot takes the user from the Telegram update itself; a button carries only a
  habit id, looked up together with its owner, so a forged button gets "not found".
