# Single-container production image: the FastAPI backend serves the built
# frontend (SPA) and the /api routes from one service. Build context is the
# REPO ROOT (not backend/ or frontend/).
#
# This is intentionally SEPARATE from backend/Dockerfile and
# frontend/Dockerfile, the dev-oriented images used by docker-compose.yml.
# backend/Dockerfile.railway and frontend/Dockerfile.railway are transitional
# and are superseded by this file (removed after the Railway cutover).

# ---- frontend build stage ------------------------------------------------
FROM node:22-slim AS build

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci

COPY frontend/ .

# Vite bakes VITE_* env vars into the compiled JS bundle at BUILD time via
# import.meta.env -- Railway does NOT automatically forward service
# environment variables into a Dockerfile build unless they're explicitly
# declared as ARG and promoted to ENV before the build step runs. Without
# these lines VITE_GOOGLE_CLIENT_ID would be undefined in the built bundle,
# silently breaking Google Sign-In in production. The frontend calls
# same-origin /api paths, so no VITE_API_BASE_URL is needed. Invoke the
# build with `--build-arg VITE_GOOGLE_CLIENT_ID=<id>`.
ARG VITE_GOOGLE_CLIENT_ID
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID

RUN npm run build

# ---- runtime stage -------------------------------------------------------
FROM python:3.11-slim

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# alembic.ini and alembic/ are copied in (alongside app/) so that the
# `python -m app.db_migrate` pre-start step below has the migration
# tooling and scripts available in the built image.
COPY backend/app ./app
COPY backend/alembic.ini ./alembic.ini
COPY backend/alembic ./alembic

# app/main.py defaults STATIC_DIR to <parent of app/>/static == /app/static,
# so no STATIC_DIR env var is needed.
COPY --from=build /app/dist ./static

EXPOSE 8000

# Shell-form CMD (no JSON-array brackets) is required here: Railway's
# `startCommand` override replaces this CMD with a literal string that is
# NOT passed through a shell, so a JSON-array CMD would never get $PORT
# shell-expanded and the app would crash with
# "Invalid value for '--port': '$PORT' is not a valid integer". Docker
# implicitly wraps shell-form CMD in `/bin/sh -c`, which does expand
# ${PORT:-8000} at container start. Railway injects PORT at runtime;
# ${PORT:-8000} falls back to 8000 when PORT is unset (e.g. running this
# image outside Railway). Shell form also lets us chain the migration step
# with `&&`, so the container fails closed: if `python -m app.db_migrate`
# fails, uvicorn never starts.
CMD python -m app.db_migrate && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
