# Basement Declutter

Photograph an item lying around in the basement, identify it, search
Kleinanzeigen for comparable listings, and get a sell / give-away /
throw-away recommendation.

This repository currently contains **scaffolding only**:

- `backend/` — FastAPI app with a `GET /health` endpoint.
- `frontend/` — React + Vite PWA skeleton with a placeholder home page.
- `docker-compose.yml` — builds and runs both services together for local
  dev.

No Kleinanzeigen integration, vision/identification logic, or database
persistence exists yet — those land in later tasks.

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

## Running natively (fallback / local development)

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
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
(includes the generated PWA manifest and service worker).
