# Keel

Multi-user tracker for habits, tasks, sleep and energy — a Telegram bot, a Telegram
Mini App and a remote MCP server so each user's Claude can read and update their own
data, write reviews and plan the day.

> Work in progress. Done: backend (data model, Telegram auth, API, per-user isolation,
> domain logic proven against the original app by golden tests), the bot, the MCP server
> and the import from the old app. In progress: the redesigned Mini App
> (`reference/design-v2/`). Full docs, architecture and screenshots will land with v0.1.0.

## Model in one paragraph

A habit is a *check* (one tap) or a *count* (a daily norm, each tap adds a step: 8 glasses,
20 minutes), plus *bedtime*, which follows from the sleep log. Habits run daily, on
weekdays or by a cycle like `1101100`. A task has a date (or the inbox), an optional time
and two flags: *important* (top of the list, ×3 in the day score) and *fresh* (needs a fresh
head: best at the energy peak). The day score is the weighted share of what got done:
habits ×1, tasks ×2, important tasks ×3. Energy is a forecast from sleep and the time
of day, split into peak, steady and recharge zones.

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
  with ✅/❌ buttons, unfinished important tasks.
- Morning message at the chosen time: Claude's plan for the day, the number of tasks and
  the important ones; it asks about sleep only if it isn't logged yet.
- A reminder on a task or a habit with «Сделано» (a count habit gets its norm); habits
  only on their working days and while not done.
- On Sundays (optional): a nudge to write «неделя словами» for Claude's weekly review.
- Scheduling is a SQL query per tick ("whose local reminder time has come?"); each
  message is first claimed in `deliveries` (user, kind, day, item) with
  `ON CONFLICT DO NOTHING`, so it goes out
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

- **Auth:** a personal token (`Authorization: Bearer lt_…`) from the app or the bot
  (`/connect`). Only its SHA-256 is stored; reissuing
  revokes the old one at once. Claude's custom connectors send it as a request header.
- **Read tools:** `get_profile`, `get_today`, `get_day`, `get_progress` (with the user's
  own note about the week or month), `get_week_summary`, `get_streaks`, `get_energy`,
  `list_habits`, `list_tasks`.
- **Write tools:** `log_habit`, `log_sleep`, `create_task`, `update_task`, `complete_task`,
  `create_habit`, `update_habit`, `save_review` (day, week, month; «учёл заметку») and
  `save_plan` («План на сегодня» with «Добавить в день» in the app).
- Every change Claude makes is written to a journal as a plain line («Добавил задачу
  «Отчёт» на 23 ноя»), and the next review lists them: nothing changes unnoticed.
- Server instructions and tool descriptions explain the data model (logical day,
  habit types, task flags, energy zones, score), so Claude needs no extra prompting.
- Stateless Streamable HTTP with JSON responses: no server-side sessions, restarts and
  scaling don't break clients, and the user id lives only in the request's context.
- The server never calls an LLM itself: analysis happens in the user's own Claude.

```bash
make mcp     # locally on :8001
```

## Data: export and import

**Export** (`GET /api/v1/export`, «Скопировать JSON»
or «Сохранить файл») writes the whole account in the layout the import reads, so the same
file is a backup and a way to move to another account. **Import**: paste the JSON from «Скопировать данные (JSON)»
or pick the file. `POST /api/v1/import?dry_run=true` shows exactly what will happen;
the real import is one transaction.

- Merge, not replace: existing habits are reused by name and type, your own logs win.
- The old app's water, minutes and two-flag habits become counts, "every N days" a cycle;
  its goals are counted and skipped (this app has none).
- Idempotent: ids already yours are reused, others become `uuid5(user, old id)`, so
  re-importing never duplicates and your own export round-trips unchanged.
- Same legacy adapter as the golden tests; `backend/tests/test_import.py` checks that
  imported days get the same score as in the old app (re-weighted to this app's rules).

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
  habit or task id, looked up together with its owner, so a forged button gets
  "not found".

## Migrations

Schema changes go through Alembic, data included: the redesign turned water/minutes
habits into counts, three importance levels into one flag and so on, and each migration
moves existing rows (`backend/tests/test_migrations.py` checks one on real data). Every
migration has a working downgrade.
