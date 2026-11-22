.DEFAULT_GOAL := help
COMPOSE := docker compose

help: ## Show available commands
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

up: ## Build and start the whole stack (applies migrations first)
	$(COMPOSE) up -d --build --wait postgres
	$(COMPOSE) run --rm --build backend alembic upgrade head
	$(COMPOSE) up -d --build

down: ## Stop the stack
	$(COMPOSE) down

logs: ## Follow logs of all services
	$(COMPOSE) logs -f --tail=100

migrate: ## Apply database migrations
	$(COMPOSE) run --rm backend alembic upgrade head

seed: ## Create demo users with different habits (idempotent)
	$(COMPOSE) run --rm backend python -m lifetracker.seed

db: ## Start only PostgreSQL (local development and tests)
	$(COMPOSE) up -d --wait postgres

dev: db ## Run the API locally with auto-reload
	cd backend && uv run alembic upgrade head
	uv run uvicorn lifetracker.api.app:app --reload --port 8000

web: ## Run the Mini App dev server (API on :8000 with DEV_AUTH=true for browser login)
	cd miniapp && pnpm install && pnpm dev

test: db ## Run all tests (backend + Mini App)
	uv run pytest -q
	cd miniapp && pnpm test

golden: ## Regenerate golden expectations by running the original JS in Node
	python3 golden/make_fixtures.py
	node golden/run-legacy.mjs

bench: db ## Latency of the screens on a user with a year of data
	LOG_LEVEL=WARNING uv run --env-file .env python backend/scripts/bench_views.py

lint: ## Ruff + mypy
	uv run ruff check .
	uv run ruff format --check .
	uv run mypy backend/lifetracker

fmt: ## Auto-format code
	uv run ruff check --fix .
	uv run ruff format .

.PHONY: help up down logs migrate seed db dev web test golden bench lint fmt
