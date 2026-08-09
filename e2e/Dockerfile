# Standalone image for the E2E test suite (sandbox-634 epic). Unlike
# ../backend/Dockerfile.railway and ../frontend/Dockerfile.railway, this
# image is NOT a long-running service -- its CMD runs the full Playwright
# suite once, against the ALREADY-DEPLOYED real frontend + backend, and
# exits with the suite's own pass/fail exit code. It bundles no
# application source beyond the two things needed to mint a session
# token (see step below): the whole app runs elsewhere (Railway), this
# container only drives a real browser against it.
#
# This image has been built and run for real (sandbox-634.7's review found
# a usable Docker daemon in that verification pass): a real build, a real
# token-minting round-trip, and a real (against-a-bogus-URL) suite run
# confirming failure propagates as a non-zero container exit code. The
# first run against the REAL deployed app still happens in sandbox-634.8,
# on Railway.
#
# Build context MUST be the repo root, not e2e/ -- unlike
# ../backend/Dockerfile.railway and ../frontend/Dockerfile.railway (which
# each build from their own service subdirectory), this Dockerfile's COPY
# instructions below reach into backend/ and frontend/ as well as e2e/, so
# it needs the whole repo as context with this file's path passed
# explicitly, e.g. `docker build -f e2e/Dockerfile .` from repo root (on
# Railway: root directory left as the repo root, dockerfilePath set to
# e2e/Dockerfile).
#
# Required environment variables at RUNTIME (never baked into the image --
# matching ../backend/Dockerfile.railway's / ../frontend/Dockerfile.railway's
# convention of taking all secrets as env vars supplied by the platform,
# not COPYed/ARGed in):
#   E2E_FRONTEND_URL     Base URL of the deployed frontend to test against,
#                         e.g. https://<app>.up.railway.app. See
#                         playwright.config.js -- no default, must be set.
#   E2E_SESSION_SECRET    The real deployed backend's actual SESSION_SECRET.
#                         Consumed by helpers/mint_token.py to mint a
#                         validly-signed session token. Must exactly match
#                         the real backend's configured SESSION_SECRET.
#   E2E_TEST_EMAIL        The designated E2E test identity's email. Must
#                         already be present in the real deployed
#                         backend's ALLOWED_EMAILS whitelist.
#
# Optional environment variables at runtime (see playwright.config.js for
# full detail and defaults):
#   E2E_TEST_TIMEOUT_MS         Per-test timeout override, in ms.
#   E2E_EXPECT_TIMEOUT_MS       expect().toBeVisible()-style polling
#                                timeout override, in ms.
#   E2E_NAVIGATION_TIMEOUT_MS   page.goto()/navigation timeout override,
#                                in ms.
#   E2E_ACTION_TIMEOUT_MS       Individual-action (click/fill/...) timeout
#                                override, in ms.
#
# Do NOT set PLAYWRIGHT_CHROMIUM_PATH in this image: that env var exists
# only so playwright.config.js can point at a sandbox-specific
# preinstalled Chromium binary for local verification outside this image
# (see sandbox-634.2). This image's base already bundles its own matching
# Chromium build at Playwright's normal auto-resolved location -- leave
# PLAYWRIGHT_CHROMIUM_PATH unset here so playwright.config.js falls back
# to that bundled browser instead.

# Base image: bundles Chromium plus every system dependency Playwright
# needs, pre-installed. Tag pinned to match @playwright/test's exact
# pinned/resolved version in package.json / package-lock.json
# (^1.62.1 -> resolves to 1.62.1) -- a mismatched Playwright-server vs.
# browser-image version can fail at runtime with a clear "browser type
# not found" / version-mismatch error, so these must move together.
# "-noble" selects the Ubuntu 24.04-based variant (Microsoft's current
# default OS base for this image family).
FROM mcr.microsoft.com/playwright:v1.62.1-noble

WORKDIR /app

# Python for helpers/mint_token.py: a bare python3 interpreter plus
# exactly the two third-party packages that script's own docstring says
# it needs importable -- itsdangerous (used directly by
# app.auth.issue_session_token) and google-auth[requests] (app/auth.py
# imports google.auth.transport.requests / google.oauth2.id_token
# unconditionally at module scope, even though issue_session_token itself
# never calls into them -- see mint_token.py's docstring, confirmed by
# sandbox-634.2's direct reproduction). Deliberately NOT
# backend/requirements.txt -- this image never runs the backend itself,
# only this one standalone auth-minting script.
#
# --break-system-packages: this Ubuntu-Noble-based image enforces PEP 668
# ("externally-managed-environment") for the system python3-pip, which
# refuses a plain `pip install` outside a virtualenv. A dedicated venv is
# unnecessary complexity for a single-purpose, throwaway container image
# that runs nothing else in Python -- installing straight into the
# system interpreter this Dockerfile controls entirely is fine here.
# Version constraints match backend/requirements.txt's own pins for these
# two packages exactly (itsdangerous>=2.1,<3 / google-auth[requests]>=2.29,<3)
# -- not because this image runs any other backend code that could drift,
# but so the itsdangerous serialization format this script mints tokens
# with can't silently diverge from the version the real deployed backend
# verifies them with.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip \
    && rm -rf /var/lib/apt/lists/* \
    && pip3 install --no-cache-dir --break-system-packages \
         "itsdangerous>=2.1,<3" "google-auth[requests]>=2.29,<3"

# The minimal slice of the backend needed for
# `from app.auth import issue_session_token` (see mint_token.py) to work
# standalone: auth.py itself, plus the (empty) package marker
# backend/app/__init__.py so `app` is importable as a package at all.
# auth.py's own module-scope imports are only stdlib (os, typing) and
# third-party (google.auth.*, itsdangerous, installed above) -- it does
# NOT import app.db, app.models, app.main, or any other sibling module
# in backend/app/, so no other files from backend/ need to be copied in.
#
# Copied to ./backend/app/ (i.e. /app/backend/app/ given WORKDIR /app
# above) to mirror this repo's real backend/app/ layout one-for-one:
# helpers/mint_token.py resolves the directory to add to sys.path
# relative to its OWN file location (two directories up from
# e2e/helpers/, i.e. sibling-of-e2e/'s backend/), not relative to the
# process's cwd, so this only works if the copied backend/ ends up as a
# sibling of the copied e2e/ below with the same nesting depth as in the
# real repo -- which this layout satisfies regardless of what WORKDIR
# happens to be at container-run time.
COPY backend/app/__init__.py backend/app/auth.py ./backend/app/

# helpers/auth.js reads SESSION_TOKEN_STORAGE_KEY directly out of
# frontend/src/api.js's source at import time (by path, not by importing
# the module -- see that file's own comment for why), resolving the path
# the same way as above: relative to auth.js's own file location
# (e2e/helpers/ -> two directories up -> repo-root-equivalent ->
# frontend/src/api.js), not the process's cwd. Only this one file is
# needed (read as plain text for one exported constant, never imported/
# executed), not the rest of the frontend source or its build.
COPY frontend/src/api.js ./frontend/src/api.js

# The whole E2E suite: config, helpers (auth.js, mint_token.py already
# covered above, decision.js), every *.spec.js, and fixtures/*.png.
# Copied as a whole directory rather than an explicit file list so newly
# added specs/fixtures are picked up automatically without this
# Dockerfile needing to be updated every time e2e/ gains a file.
COPY e2e/ ./e2e/

WORKDIR /app/e2e

# e2e/node_modules is git-ignored, so it's never present in a real
# git-checkout build context (e.g. Railway's) -- only package.json/
# package-lock.json matter there. If this were ever built from a local
# working tree that happens to already have e2e/node_modules on disk (no
# root-level .dockerignore excludes it), `npm ci` deletes and replaces it
# with a clean, lockfile-exact install anyway (including @playwright/test
# itself), so correctness doesn't depend on which case applies -- only
# build-context transfer size would differ.
RUN npm ci

# Runs the full suite exactly the way sandbox-634.2 defined it (see
# package.json's "test:e2e" script: `playwright test`, picking up
# playwright.config.js from this WORKDIR) and exits with npm's forwarded
# exit code from that underlying process -- 0 if every test passed,
# non-zero otherwise. Exec (JSON-array) form is used deliberately (not
# shell form): this command needs no shell variable expansion the way
# ../backend/Dockerfile.railway's ${PORT:-8000} does, and exec form runs
# the process directly as PID 1 rather than wrapped in a `/bin/sh -c`
# layer, so its real exit code reaches the container's exit code with
# nothing in between to swallow or remap it.
CMD ["npm", "run", "test:e2e"]
