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
| `VITE_API_BASE_URL` | frontend | `http://localhost:8000` | where the frontend calls the backend |

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
  `http://localhost:8000/health`).
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

`backend/Dockerfile.railway` and `frontend/Dockerfile.railway` are
production-oriented Dockerfiles kept separate from the dev-oriented
`backend/Dockerfile` / `frontend/Dockerfile` used above by Docker Compose
(which have no production build step and use a JSON-array `CMD` that
doesn't support runtime `$PORT` substitution). They exist specifically
for platforms like Railway that build a service directly from a
Dockerfile — point the service's `dockerfilePath` explicitly at the
`.railway` file (auto-detection picks up the dev Dockerfile instead).

For the frontend image, `VITE_API_BASE_URL` must be passed as a Docker
**build arg** (`--build-arg VITE_API_BASE_URL=<url>`, or the platform's
equivalent build-arg setting), not just a runtime/service env var — Vite
inlines `VITE_*` variables into the compiled JS bundle at build time, so
setting it only as a runtime env var has no effect on the built image.

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
curl http://localhost:8000/health
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
`frontend/README.md` for the `VITE_API_BASE_URL` setup and a full
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
3. Once you've acted on an item (listed it, given it away, or thrown it
   out), go to **View basement inventory** and mark its status — the
   app never posts to Kleinanzeigen for you, you always list manually.

### API surface, if you want to script against it

- `POST /items` — multipart photo upload, starts the pipeline. Accepts
  an optional `hint` form field (string, trimmed, max 500 chars after
  trimming — whitespace-only or empty is treated as absent, longer
  values get a 400) with extra context for the vision model.
- `GET /items/{id}` — full item detail (identification, decision,
  comparable listings, status, hint).
- `GET /items?status=&decision=` — list items, optionally filtered.
- `PATCH /items/{id}/status` — manually transition status (e.g.
  `{"status": "listed"}`); rejects invalid transitions with a 400
  explaining what's actually valid from the item's current state.
- `GET /uploads/{filename}` — serves the stored photo.

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
- Either way, nothing about the app breaks — it just means that item's
  results page will show a "still working on this item" message
  indefinitely instead of a decision.
