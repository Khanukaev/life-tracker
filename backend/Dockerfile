# syntax=docker/dockerfile:1.7
# Build context: repository root (the uv workspace lock file lives there).

FROM python:3.12.12-slim AS build
COPY --from=ghcr.io/astral-sh/uv:0.13.9 /uv /bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app

# Dependencies first: this layer stays cached until the lock file changes.
COPY pyproject.toml uv.lock ./
COPY backend/pyproject.toml backend/pyproject.toml
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-workspace --package lifetracker

COPY backend backend
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-editable --package lifetracker

FROM python:3.12.12-slim
RUN useradd --create-home --uid 10001 app
WORKDIR /app/backend
COPY --from=build --chown=app:app /app/.venv /app/.venv
COPY --from=build --chown=app:app /app/backend/alembic /app/backend/alembic
COPY --from=build --chown=app:app /app/backend/alembic.ini /app/backend/alembic.ini
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1
USER app
EXPOSE 8000
CMD ["uvicorn", "lifetracker.api.app:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
