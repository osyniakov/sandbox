# Basement Declutter

Photograph an item lying around in the basement, identify it, search
Kleinanzeigen for comparable listings, and get a sell / give-away /
throw-away recommendation with a suggested price.

## What's here

- `backend/` — FastAPI app. Photo upload runs a background pipeline:
  **identify** the item (Claude vision) → **search** Kleinanzeigen for
  comparable listings → **decide** sell/give-away/throw-away with a
  suggested price. SQLite persistence, plus an inventory API for
  listing items and manually tracking what you did with them (listed,
  given away, disposed).
- `frontend/` — React + Vite PWA: a photo capture/upload page, a
  per-item results page (polls until the pipeline finishes), and a
  basement inventory list with status-tracking controls.
- `docker-compose.yml` — builds and runs both services together for
  local dev.
- `docs/kleinanzeigen-access.md` — background on how/why the
  Kleinanzeigen integration works the way it does (there's no official
  public API).

## Configuration

The backend needs a real Anthropic API key to run photo identification:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Without it, uploads still work, but the pipeline stops at the
identification step (`status` stays `pending_identification`) rather
than erroring — see "How the pipeline behaves without a working step"
below.

Other environment variables, all optional with sensible defaults:

| Variable | Where | Default | Purpose |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | backend | — (required for real identification) | Claude vision API key |
| `ANTHROPIC_VISION_MODEL` | backend | `claude-sonnet-5` | override the vision model |
| `ALLOWED_ORIGINS` | backend | `http://localhost:5173,http://127.0.0.1:5173` | comma-separated CORS allowlist |
| `VITE_API_BASE_URL` | frontend (build) | unset (same-origin `/api`) | optional origin-only override for where the frontend calls the backend; normally unset in the single-container deploy. Transitional two-service Railway deploys set it to the backend URL |
| `GOOGLE_CLIENT_ID` | backend | — (required for sign-in) | OAuth 2.0 client ID that Google ID tokens must be issued for; see [Access control](#access-control) |
| `VITE_GOOGLE_CLIENT_ID` | frontend | — (required for sign-in) | same Google OAuth client ID, exposed to the frontend build so it can render the Sign-In button; see [Access control](#access-control) |
| `ALLOWED_EMAILS` | backend | — (optional) | no longer restricts sign-in; its first entry owns pre-multi-tenancy items (see [Access control](#access-control)) |
| `SESSION_SECRET` | backend | — (required) | secret key used to sign/verify this app's own session tokens issued after Google sign-in. Must be set to a real random secret in any real deployment — e.g. generate one with `python -c "import secrets; print(secrets.token_urlsafe(32))"`. Leaving it unset is not silently insecure: token issuance raises rather than operating without a secret. |

Kleinanzeigen client overrides (backend, runtime). Leave these unset
normally: the `kleinanzeigen-api` library ships working defaults.

| Variable | Default | Purpose |
|---|---|---|
| `KLEINANZEIGEN_BASIC_USER` | library default (`android`) | Basic-auth user, read directly by `kleinanzeigen-api` |
| `KLEINANZEIGEN_BASIC_PW` | library default | Basic-auth password, read directly by `kleinanzeigen-api` |
| `KLEINANZEIGEN_APP_VERSION` | library default | app version sent in the request headers; read by the backend (`KleinanzeigenAPIProvider._get_client`) and passed to the library |

Use them only as a stop-gap when comparable-price searches start failing
with 401/403 ("Basic-auth credentials likely rotated"). First check for a
newer `kleinanzeigen-api` release, because bumping the pin is the preferred
fix. See also the guardrails in
[docs/kleinanzeigen-access.md](docs/kleinanzeigen-access.md) §4.

- Set them as runtime service variables (on Railway: backend service →
  Variables), not build args. Saving redeploys the service, which is
  required: the client reads them once per process.
- An empty value counts as unset. To revert to the defaults, delete the
  variable.
- Set the user and password together. Each one falls back to its default
  on its own.
- Keep the password in the platform's variables only, and never commit it.
- Remove the overrides once the library catches up, so they don't shadow
  newer defaults.

`backend/app/config.py` also has a `SELL_THRESHOLD` constant (currently
a placeholder €10 cutoff between "sell" and "give away") if you want to
tune the decision logic without touching env vars.

## Running with Docker Compose

From the repo root:

```bash
docker compose up
```

This builds and starts:

- `backend` — served at `http://localhost:8000` (health check at
  `http://localhost:8000/api/health`).
- `frontend` — Vite dev server at `http://localhost:5173`.

Stop with `Ctrl+C`, or `docker compose down` to remove the containers.

Run the backend test suite inside the container with:

```bash
docker compose run --rm backend pytest
```

`backend/app` and `backend/tests` are both bind-mounted into the
container, so this reflects live host edits to app or test code
without an image rebuild.

> **Note:** in this sandboxed development environment, `docker compose
> build` could not be fully verified — the sandbox's outbound network
> policy blocks `production.cloudfront.docker.com` (the CDN Docker Hub
> uses to serve image layer blobs), so pulling the `python:3.11-slim` and
> `node:22-slim` base images fails with a `403` at the network gateway
> (`docker pull python:3.11-slim` reproduces this directly). This is a
> policy denial, not a bug in the compose files — in a normal environment
> with unrestricted internet access `docker compose up` should work as
> described above. The native fallback commands below were fully verified
> as a substitute in this environment.

## Deployment

Production is a **single container**: the root `Dockerfile` (build context =
repo root) builds the frontend with Node, then produces a Python image whose
FastAPI backend serves both the `/api` routes and the built frontend (SPA
fallback, from `/app/static`). The frontend calls same-origin `/api` paths, so
there is no CORS setup and no `VITE_API_BASE_URL`. Run
`python -m app.db_migrate` and then uvicorn on `$PORT` (default 8000) via the
image's shell-form `CMD`. Liveness check: `GET /api/health`.

`VITE_GOOGLE_CLIENT_ID` must be passed as a Docker **build arg** (on Railway:
set it as a service variable; Railway forwards variables declared as `ARG`),
because Vite inlines `VITE_*` variables into the JS bundle at build time.

The dev-oriented `backend/Dockerfile` / `frontend/Dockerfile` are used only by
Docker Compose. `backend/Dockerfile.railway` and `frontend/Dockerfile.railway`
are **transitional** (the pre-cutover two-service setup) and are deleted after
the cutover below, together with the root `/health` alias in
`backend/app/main.py`.

### Railway cutover (manual, one-time)

Merging changes nothing on Railway: the old backend service keeps building
`backend/Dockerfile.railway` (API only; `/health` still answers via the alias),
and the old frontend service keeps calling `<backend>/api/...` with CORS. To
move to the single service, do these in order:

1. Backend service → Variables: add `VITE_GOOGLE_CLIENT_ID` (same Client ID as
   `GOOGLE_CLIENT_ID`); it is needed as a build arg. Keep `DATA_DIR=/data` and
   the volume mounted at `/data`.
2. Backend service → Settings → **Root Directory**: set to empty (repo root).
3. Backend service → Settings → **Dockerfile Path**: set to `Dockerfile`.
   Change Root Directory and Dockerfile Path together, before any redeploy:
   changing only one makes the build fail (the live deploy keeps running).
4. Backend service → Settings → **Healthcheck Path**: set to `/api/health`
   (leaving it at `/health` also works while the alias exists).
5. Redeploy the backend service and check `/api/health` and `/`.
6. Networking: add the public domain (move the frontend's custom domain, or
   generate a Railway domain) on the backend service.
7. Google Cloud Console → Credentials → your OAuth client → **Authorized
   JavaScript origins**: add that origin.
8. GitHub → Settings → Secrets and variables → Actions: update the
   `E2E_FRONTEND_URL` secret to that origin.
9. Delete the old frontend service.
10. `ALLOWED_ORIGINS` can then be removed from the backend service (same-origin
    needs no CORS allowlist).

The backend keeps its SQLite database (`declutter.db`) and uploaded photos
under `DATA_DIR`. On Railway, `DATA_DIR=/data` and a persistent volume
(`backend-data`) is mounted at `/data` on the backend service. Without that
volume, every deploy starts with an empty database. The deployed
Railway service(s) deploy from `master`, so every push
to `master` redeploys them. The e2e suite is no longer auto-deployed on
Railway; it is run manually from GitHub Actions (see "End-to-end tests").

## Access control

The app requires Google Sign-In to use — there is no anonymous or
password-based access. Sign-in is open: any Google account with a
verified email can sign in and gets its own private workspace. Items,
photos and comparables are scoped per account (the lowercased email from
the session token); another account's items and photos return 404, the
same as nonexistent ones.

**`ALLOWED_EMAILS` is now optional and no longer restricts sign-in.**
Its first entry is used only to claim items that have no owner (data
created before multi-tenancy): once at migration and at each
`python -m app.db_migrate` start. After the first deploy has claimed
them, the variable can be removed.

**Setting up the Google OAuth Client ID** (one-time, per Google Cloud
project):

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
   and create or pick a project.
2. Under **APIs & Services → OAuth consent screen**, configure it with
   user type **External**. While the app is in **Testing** status, add
   the Google accounts that need to sign in as test users.
3. Under **APIs & Services → Credentials**, click **Create
   Credentials → OAuth client ID**, and choose application type **Web
   application**.
4. Under **Authorized JavaScript origins**, add both the deployed
   app URL (the single service's public origin) and `http://localhost:5173` (for local dev). No
   **Authorized redirect URI** is needed — this app uses Google
   Identity Services' token sign-in flow (a JS-rendered button that
   returns an ID token directly), not a redirect-based OAuth flow.
5. Click **Create**. Google shows you both a **Client ID** and a
   **Client secret** — this app only uses the Client ID; the secret
   isn't needed anywhere (there's no server-side redirect exchange to
   protect it for), so you can ignore/discard it. Copy the Client ID.

`GOOGLE_CLIENT_ID` (backend) and `VITE_GOOGLE_CLIENT_ID` (frontend)
must both be set to that *same* Client ID — they're just two
differently-scoped env vars (backend runtime vs. frontend build-time),
the same runtime-vs-build-time split as above.

## Database migrations

Fresh tables are still created automatically by `create_all()` on app
startup, but evolving the schema of an already-populated DB (e.g.
adding a column) needs an Alembic migration:

1. Change the SQLAlchemy model in `backend/app/models.py`.
2. `cd backend && alembic revision --autogenerate -m "description"`.
3. Review the generated file under `backend/alembic/versions/`, then
   commit it.

Migrations are applied automatically on Docker/Railway deploy — the
`CMD` chain runs `python -m app.db_migrate` before starting the server.
For a native/non-Docker run, apply them manually with
`cd backend && python -m app.db_migrate` (or `alembic upgrade head`
directly). A pre-existing DB from before Alembic was introduced is
automatically detected and reconciled the first time the migration step
runs against it — no manual intervention needed.

## End-to-end tests

`e2e/` is a Playwright suite that drives a real browser against the
**already-deployed real frontend + backend** (Railway) — not local
processes, and not stubbed external services: real Claude vision/
listing-text generation and real Kleinanzeigen search happen for real,
exactly as for a real user. Point it at a deployment with
`E2E_FRONTEND_URL`, plus `E2E_SESSION_SECRET`/`E2E_TEST_EMAIL` for
sign-in. Since Google blocks automated sign-in, sign-in is bypassed by
minting a session token directly for a pre-designated test identity,
using the target backend's own real `SESSION_SECRET` — this adds zero
new backend surface, since it reuses the same internal function
(`app.auth.issue_session_token`) the backend's own unit tests and its
real `/auth/google` handler already call. Because it exercises real
Claude and real Kleinanzeigen search, it's not deterministic which
decision (sell/give_away/throw_away) a given test upload lands on, so
its assertions are written to be structurally correct for whichever
real outcome occurs rather than forcing a specific one.

**How it runs:** manually from GitHub Actions (Actions → "E2E Tests" →
Run workflow, `.github/workflows/e2e-ci.yml`) against the deployed app.
There is no automatic run on merge, so trigger it after a deploy finishes.
The workflow needs these repository secrets (Settings → Secrets and
variables → Actions):

- `E2E_FRONTEND_URL` — base URL of the deployed app to test (the single service's public origin).
- `E2E_SESSION_SECRET` — the deployed backend's real `SESSION_SECRET`,
  used to mint the test session token.
- `E2E_TEST_EMAIL` — the test identity's email; it needs no whitelisting
  (sign-in is open) and the suite runs in that account's own workspace.

`e2e/Dockerfile` remains available for running the suite in a container,
but it is no longer deployed as a Railway service. See `e2e/README.md` for
full setup, environment variables, and how the auth bypass works.

## Running natively (fallback / local development)

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...   # optional but needed for real identification
uvicorn app.main:app --reload --port 8000
```

Verify:

```bash
curl http://localhost:8000/api/health
# {"status":"ok"}
```

### Backend tests

```bash
cd backend
source .venv/bin/activate   # if not already active
pytest
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

This starts the Vite dev server (default `http://localhost:5173`). Use
`npm run build` to produce a production build in `frontend/dist`
(includes the generated PWA manifest and service worker). See
`frontend/README.md` for the dev proxy setup and a full
walkthrough of testing from your phone (the point of this app is
camera capture, so a desktop-only test misses the main use case).

## Using the app

1. Open the frontend (`http://localhost:5173` or your phone's LAN
   address, see `frontend/README.md`). There's an optional "Hint"
   text field for giving the vision model context it can't get from
   the photo alone (e.g. a brand or model number) — type it *before*
   choosing a photo, since taking/choosing the photo uploads
   immediately and takes you straight to that item's results page.
2. The results page polls `GET /items/{id}` every ~2.5s while the
   pipeline runs, showing the photo, identified name/category, the
   recommended decision (sell/give-away/throw-away), a suggested price
   for sellable items, and clickable comparable Kleinanzeigen listings.
   For sell/give-away items, it also shows a ready-to-use German-language
   Kleinanzeigen title and description, generated by Claude, with
   copy-to-clipboard buttons so you can paste them straight into a
   listing.
3. Once you've acted on an item (listed it, given it away, or thrown it
   out), go to **View basement inventory** and mark its status — the
   app never posts to Kleinanzeigen for you, you always list manually.

### API surface, if you want to script against it

- `POST /items` — multipart photo upload, starts the pipeline. Accepts
  an optional `hint` form field (string, trimmed, max 500 chars after
  trimming — whitespace-only or empty is treated as absent, longer
  values get a 400) with extra context for the vision model.
- `GET /api/items/{id}` — full item detail (identification, decision,
  comparable listings, status, hint, `suggested_title` /
  `suggested_description`).
- `GET /api/items?status=&decision=` — list items, optionally filtered.
- `PATCH /api/items/{id}/status` — manually transition status (e.g.
  `{"status": "listed"}`); rejects invalid transitions with a 400
  explaining what's actually valid from the item's current state.
- `GET /api/uploads/{filename}` — serves the stored photo.

### How the pipeline behaves without a working step

Each pipeline stage (identify → search → decide) either advances the
item's `status` on success or leaves it exactly where it was on
failure — nothing crashes or silently skips ahead. So:

- No `ANTHROPIC_API_KEY` (or a failing vision call) → item stays at
  `pending_identification` forever; `GET /items/{id}` still returns
  200, just with null identification fields.
- No internet access for Kleinanzeigen search → item stays at
  `pending_search`, with whatever identification results it already
  has.
- A failure generating the Kleinanzeigen listing text (e.g. a bad/
  missing API key, or an LLM error) → `suggested_title`/
  `suggested_description` simply stay `null`; the item still reaches
  `decided` normally. This generation step is a best-effort
  enhancement layered on top of the core pipeline, not a required one.
- Either way, nothing about the app breaks — it just means that item's
  results page will show a "still working on this item" message
  indefinitely instead of a decision (or, for the listing-text step,
  a decision with no suggested listing text to copy).
