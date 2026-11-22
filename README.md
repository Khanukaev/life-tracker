# Life Tracker

Multi-user tracker for habits, sleep, energy, tasks and goals — a Telegram bot,
a Telegram Mini App and a remote MCP server so each user's Claude can read and
update their own data.

> Work in progress. Done so far: backend core (data model, Telegram auth,
> CRUD API, per-user isolation). Full docs, architecture and screenshots will
> land with v0.1.0.

## Stack

- **Backend:** Python 3.12, FastAPI, SQLAlchemy 2 (async) + Alembic, PostgreSQL 17, Pydantic v2
- **Infra:** Docker Compose, Caddy (automatic HTTPS), GitHub Actions
- Coming next: Preact Mini App, aiogram 3 bot, MCP server

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

## Security model

- The Mini App sends Telegram `initData`; the backend verifies its HMAC-SHA256
  signature and age, then issues a short-lived JWT.
- `user_id` always comes from the token. Every query filters by it, and someone
  else's object is reported as *404 Not Found*.
- Composite foreign keys `(ref_id, user_id)` make cross-user references impossible
  even at the database level. `backend/tests/test_isolation.py` checks all of it.
