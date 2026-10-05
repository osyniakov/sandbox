# Kanban API Contract

Single source of truth for the mini Kanban board. Three components are built
independently against this document: `backend/` (FastAPI), `frontend/`
(static HTML/CSS/JS), `tests/` (pytest). If this file and any code disagree,
this file wins.

## Overview

A single board with three fixed columns: `todo`, `doing`, `done`.
Tasks live in exactly one column and are ordered within it by `position`
(0-based, contiguous: 0, 1, 2, … per column).

## Task object

```json
{
  "id": "9f1c2a4b8d3e4f5a9b0c1d2e3f4a5b6c",
  "title": "Buy milk",
  "column": "todo",
  "position": 0
}
```

- `id`: server-generated, `uuid4().hex` (32 lowercase hex chars). Opaque to clients.
- `title`: non-empty string, at most 200 characters (after stripping leading/trailing whitespace; the stripped value is what gets stored).
- `column`: one of `"todo" | "doing" | "done"`.
- `position`: integer index of the task within its column, 0-based.

## Endpoints

All request/response bodies are JSON. Validation failures return **422**
(FastAPI's default validation error shape). A missing task id returns
**404** with body `{"detail": "Task not found"}`.

### GET /api/board → 200

```json
{
  "columns": {
    "todo":  [Task, ...],
    "doing": [Task, ...],
    "done":  [Task, ...]
  }
}
```

All three keys are always present (empty arrays when a column is empty).
Each array is sorted by `position` ascending.

### POST /api/tasks → 201

Request body:

```json
{ "title": "Buy milk", "column": "doing" }
```

- `title`: required; must be non-empty after stripping; max 200 chars → otherwise 422.
- `column`: optional, defaults to `"todo"`; must be a valid column → otherwise 422.

The new task is appended to the **end** of its column
(`position == current column length before insert`). Response is the created Task.

### PATCH /api/tasks/{id} → 200

Request body — all fields optional; at least the ones provided are applied:

```json
{ "title": "New title", "column": "done", "position": 0 }
```

- `title`: same validation as POST → 422 if invalid.
- `column`: valid column name → 422 if invalid.
- `position`: integer ≥ 0. Values beyond the end of the target column are
  **clamped** to the end (no error).
- Unknown task id → 404.

Move semantics:
- `column` provided, `position` omitted → task is appended to the end of the target column.
- `position` provided (with or without `column`) → task is inserted at that
  index in the target column (target = new column if given, else its current
  column); other tasks shift accordingly.
- After any move, positions in every affected column are re-normalized to be
  contiguous from 0.
- A PATCH with an empty body `{}` is a no-op and returns the unchanged task (200).

Response is the updated Task.

### DELETE /api/tasks/{id} → 204

Empty response body. Positions of remaining tasks in that column are
re-normalized. Unknown id → 404.

## Static frontend

The backend serves the `kanban/frontend/` directory at `/`:
`GET /` returns `frontend/index.html`; sibling assets (`/app.js`,
`/style.css`) are served from the same directory. The frontend calls the API
with same-origin relative paths (`/api/...`). No external CDNs, no build step.

## Runtime & storage

- ASGI app object: `backend.app:app`, importable with `kanban/` as the
  working directory / on `sys.path` (i.e. `from backend.app import app`).
  Run with: `uvicorn backend.app:app` from inside `kanban/`.
- Storage: SQLite via stdlib `sqlite3`. **The database path is read from the
  `KANBAN_DB` environment variable at connection time on every request**
  (default: `kanban.db` in the current working directory). The schema is
  created on demand (`CREATE TABLE IF NOT EXISTS`). No connection caching at
  import time — tests point `KANBAN_DB` at a fresh temp file per test and it
  must Just Work.
- Dependencies: `fastapi`, `uvicorn` (backend); `pytest`, `httpx` +
  `fastapi.testclient.TestClient` (tests). Nothing else.

## Ownership map (for parallel development)

| Directory          | Owner          | May touch other dirs? |
|--------------------|----------------|-----------------------|
| `kanban/backend/`  | Backend agent  | No                    |
| `kanban/frontend/` | Frontend agent | No                    |
| `kanban/tests/`    | Test agent     | No                    |
