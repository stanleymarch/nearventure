# Nearventure application image (production).
# Multi-stage: builds frontend + backend in a full Node image, then ships a slim
# runtime that serves both the NestJS API (/api/*) and the built SPA (fallback).
#
# This is the single artefact the prod compose runs as the `app` service.
# nginx (separate service) terminates TLS in front of it.

# ---------- stage 1: build ----------
FROM node:22-alpine AS build
WORKDIR /repo

# Non-secret source revision injected by Compose at image build time.
ARG GIT_SHA
ENV GIT_SHA=${GIT_SHA}

# Install workspace deps first (better layer caching — code changes don't bust deps).
# `npm ci` at the repo root installs every workspace's deps from the lockfile.
COPY package.json package-lock.json ./
COPY apps/frontend/package.json apps/frontend/package.json
COPY apps/backend/package.json apps/backend/package.json
COPY apps/miniapp/package.json apps/miniapp/package.json
RUN npm ci

# Copy the whole repo (docker/data/ and node_modules are gitignored → excluded by .dockerignore).
COPY . .

# Build all three workspaces. Frontend → apps/frontend/dist, miniapp →
# apps/miniapp/dist (served at /tg/), backend → apps/backend/dist.
RUN npm run build:frontend && npm run build:miniapp && npm run build:backend

# Prune dev deps so the runtime image stays small.
RUN npm prune --omit=dev --workspace=apps/backend 2>/dev/null || true

# ---------- stage 2: runtime ----------
FROM node:22-alpine AS runtime
WORKDIR /app
ARG GIT_SHA
ENV NODE_ENV=production \
    GIT_SHA=${GIT_SHA}
RUN apk add --no-cache tini

# Backend compiled output + its runtime node_modules.
COPY --from=build /repo/apps/backend/dist ./dist
COPY --from=build /repo/apps/backend/package.json ./package.json
COPY --from=build /repo/node_modules ./node_modules
# Frontend static assets — main.ts serves them from `./apps/frontend/dist` (cwd=/app).
COPY --from=build /repo/apps/frontend/dist ./apps/frontend/dist
# Mini App static assets — served at /tg/ (see main.ts static route).
COPY --from=build /repo/apps/miniapp/dist ./apps/miniapp/dist

EXPOSE 3000
# tini = proper PID 1 / signal handling for graceful shutdown.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
