# syntax=docker/dockerfile:1.7
# Build context: repository root (the Mini App tests read golden/ fixtures).
FROM node:24.11-alpine AS build
RUN npm install -g pnpm@12.16.1
WORKDIR /app/miniapp
COPY miniapp/package.json miniapp/pnpm-lock.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
COPY miniapp/ ./
RUN pnpm build

# Caddy 2.10.x answers precompressed files with "206 Partial Content" (regression);
# 2.8 serves them correctly with 200 + Content-Encoding.
FROM caddy:2.8.4-alpine
COPY miniapp/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/miniapp/dist /srv
EXPOSE 8080
