"""FastAPI application entrypoint.

Endpoints:

* ``GET /health`` -- basic liveness check.
* ``POST /items`` -- accept a multipart photo upload, store it on disk
  under ``backend/uploads/``, create a new ``Item`` row with
  ``status=pending_identification``, and schedule the full
  identify -> search -> decide pipeline (``app/pipeline.py``) to run as a
  background task.
* ``GET /items/{id}`` -- fetch a single ``Item`` (including its
  comparable listings), showing whatever stage the pipeline has reached
  so far. See ``app/pipeline.py``'s module docstring for the full polling
  contract (which ``status`` values are terminal vs. still-processing).

Full pipeline orchestration (identification -> comparable search ->
pricing decision) lives in ``app/pipeline.py`` (sandbox-yqf.9); this
module only handles HTTP concerns (upload validation/storage, DB session
wiring, scheduling the background task, and read serialization).
"""

from __future__ import annotations

import mimetypes
import os
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4

from fastapi import BackgroundTasks, Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app.db import engine, get_session, init_db
from app.models import ComparableListing, Item, ItemStatus
from app.pipeline import run_pipeline_with_new_session

# Where uploaded photos are stored: a sibling of ``app/`` inside
# ``backend/``. Not committed to git -- see the repo-root .gitignore.
# Referenced as a bare module global (not a local/default-arg copy) so
# tests can monkeypatch ``app.main.UPLOAD_DIR`` to a temp directory.
UPLOAD_DIR = Path(__file__).resolve().parent.parent / "uploads"

MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10MB
_UPLOAD_READ_CHUNK_BYTES = 1024 * 1024  # stream to disk in 1MB chunks
# Multipart bodies include boundary/header framing overhead beyond the raw
# file bytes, so a Content-Length only slightly over the limit could still
# contain a compliant file. This margin keeps the Content-Length check a
# cheap *pre*-check (reject only when clearly, grossly oversized) without
# it becoming the source of truth -- the actual bytes read below are what
# we enforce the real limit against.
_CONTENT_LENGTH_SAFETY_MARGIN_BYTES = 1024


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ``engine``/``UPLOAD_DIR`` are looked up as module globals at call
    # time (not captured at decoration time), so tests can monkeypatch
    # ``app.main.engine`` / ``app.main.UPLOAD_DIR`` before the TestClient
    # lifespan runs, keeping this away from the real dev DB/uploads dir.
    init_db(engine)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    yield


# Default CORS allowlist for the plain "run everything on one machine"
# dev workflow (see sandbox-yqf.5). Kept as the fallback whenever
# ALLOWED_ORIGINS is unset/empty/malformed so existing local dev and the
# test suite keep working unmodified with no env var configured.
DEFAULT_ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]


def _parse_allowed_origins(raw: str | None) -> list[str]:
    """Parse the ``ALLOWED_ORIGINS`` env var into a CORS origin list.

    Expected format: a comma-separated list of scheme+host+port origins,
    e.g. ``"http://192.168.1.50:5173,http://localhost:5173"`` -- this is
    how you point the backend's CORS allowlist at a phone/LAN device
    reaching the Vite dev server over the LAN IP (``vite.config.js`` sets
    ``server.host=true`` for exactly this reason; see the frontend
    README's "Test from your phone" section for the full worked
    example).

    Falls back to ``DEFAULT_ALLOWED_ORIGINS`` if ``raw`` is ``None``,
    empty, or contains only blank/whitespace entries once split on
    commas (e.g. ``""``, ``","``, ``"  "``) -- a malformed value here is
    far more likely to be an operator typo (stray comma, unset-but-
    exported empty string, trailing whitespace) than a deliberate
    request to disable CORS entirely, so failing open to the same
    known-safe localhost pair keeps the app usable and errs toward the
    tighter, already-reviewed default rather than either crashing
    startup or silently becoming unreachable from any dev origin.
    """
    if not raw:
        return list(DEFAULT_ALLOWED_ORIGINS)
    origins = [origin.strip() for origin in raw.split(",") if origin.strip()]
    if not origins:
        return list(DEFAULT_ALLOWED_ORIGINS)
    return origins


# The actual allowlist used by the CORS middleware below, resolved once at
# import time from the ALLOWED_ORIGINS env var (comma-separated). Exposed
# as a module global (not inlined into add_middleware) so tests can
# introspect/reload it, matching the module-global convention already
# used for UPLOAD_DIR/engine above.
ALLOWED_ORIGINS = _parse_allowed_origins(os.environ.get("ALLOWED_ORIGINS"))

app = FastAPI(title="Basement Declutter API", lifespan=lifespan)

# Allow the Vite dev server -- whether reached via localhost or, for
# testing from a phone on the same LAN, the dev machine's LAN IP (e.g.
# http://192.168.1.50:5173) -- to call this API cross-origin. Scoped to
# an explicit allowlist (ALLOWED_ORIGINS env var, defaulting to the
# localhost/127.0.0.1 pair) -- deliberately NOT allow_origins=["*"],
# because this is a POST endpoint that writes files to disk and rows to
# the DB, and a wildcard origin combined with any future addition of
# cookies/auth would be a real CSRF-style risk; a scoped env var costs
# nothing extra to configure (see the frontend README) and keeps that
# door closed. allow_credentials stays at its implicit default (False,
# same as before this change) -- flipping it on would be unsafe to pair
# with a broad/LAN-scoped origin list, so it is intentionally not set
# here.
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    """Basic liveness check."""
    return {"status": "ok"}


def _pick_extension(filename: str | None, content_type: str) -> str:
    """Best-effort file extension for the stored filename.

    Prefers the extension implied by the already-validated content type;
    falls back to the client-supplied filename's suffix (sanitized -- we
    don't trust the client filename for content validation, but it's fine
    as a cosmetic fallback for the extension); finally falls back to "".
    """
    guessed = mimetypes.guess_extension(content_type)
    if guessed:
        return guessed
    if filename:
        suffix = Path(filename).suffix
        if suffix and len(suffix) <= 10 and "/" not in suffix and "\\" not in suffix:
            return suffix
    return ""


@app.post("/items", status_code=201)
async def create_item(
    request: Request,
    background_tasks: BackgroundTasks,
    photo: UploadFile | None = File(None),
    session: Session = Depends(get_session),
) -> dict[str, object]:
    """Create a new ``Item`` from an uploaded photo and start the pipeline.

    Handles photo storage + ``Item`` creation with
    ``status=pending_identification`` synchronously (fast: file I/O + one
    DB insert), then schedules the identify -> search -> decide pipeline
    (``app/pipeline.py``) to run as a ``BackgroundTask`` *after* this
    response is sent -- see ``app/pipeline.py``'s module docstring for why
    this runs in the background rather than inline in this request, and
    for the ``GET /items/{id}`` polling contract clients should use to
    observe progress.
    """
    if photo is None or not photo.filename:
        raise HTTPException(status_code=400, detail="No photo file was uploaded.")

    content_type = photo.content_type or ""
    if not content_type.startswith("image/"):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported content type '{content_type or 'unknown'}'; "
                "expected an image/*."
            ),
        )

    # Fast-path pre-check using Content-Length, if the client sent one.
    # Not trusted alone (see the module-level comment on the margin
    # constant) -- the real enforcement is the chunked read below.
    content_length_header = request.headers.get("content-length")
    if content_length_header is not None:
        try:
            content_length = int(content_length_header)
        except ValueError:
            content_length = None
        if (
            content_length is not None
            and content_length > MAX_UPLOAD_BYTES + _CONTENT_LENGTH_SAFETY_MARGIN_BYTES
        ):
            raise HTTPException(
                status_code=413,
                detail="Uploaded file exceeds the 10MB size limit.",
            )

    extension = _pick_extension(photo.filename, content_type)
    dest_path = UPLOAD_DIR / f"{uuid4().hex}{extension}"

    total_bytes = 0
    oversized = False
    try:
        with dest_path.open("wb") as dest_file:
            while True:
                chunk = await photo.read(_UPLOAD_READ_CHUNK_BYTES)
                if not chunk:
                    break
                total_bytes += len(chunk)
                if total_bytes > MAX_UPLOAD_BYTES:
                    oversized = True
                    break
                dest_file.write(chunk)
    finally:
        await photo.close()

    if oversized:
        dest_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=413, detail="Uploaded file exceeds the 10MB size limit."
        )

    if total_bytes == 0:
        dest_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    item = Item(photo_path=str(dest_path), status=ItemStatus.PENDING_IDENTIFICATION)
    session.add(item)
    session.commit()
    session.refresh(item)

    # ``engine`` is looked up as a module global at call time (not bound
    # at import time), matching the ``lifespan`` convention above, so
    # tests that monkeypatch ``app.main.engine`` before hitting this
    # endpoint have the background task run against the same temp engine
    # as the rest of the test -- never the real dev DB.
    background_tasks.add_task(run_pipeline_with_new_session, item.id, engine)

    return {"id": item.id, "status": item.status.value, "photo_path": item.photo_path}


def _serialize_comparable_listing(listing: ComparableListing) -> dict[str, object]:
    return {
        "id": listing.id,
        "title": listing.title,
        "price": listing.price,
        "url": listing.url,
        "condition": listing.condition,
        "location": listing.location,
    }


def _serialize_item(item: Item) -> dict[str, object]:
    return {
        "id": item.id,
        "photo_path": item.photo_path,
        "identified_name": item.identified_name,
        "category": item.category,
        "brand": item.brand,
        "condition": item.condition,
        "search_keywords": item.search_keywords,
        "suggested_price": item.suggested_price,
        "decision": item.decision.value,
        "status": item.status.value,
        "created_at": item.created_at.isoformat(),
        "updated_at": item.updated_at.isoformat(),
        "comparable_listings": [
            _serialize_comparable_listing(listing) for listing in item.comparable_listings
        ],
    }


@app.get("/items/{item_id}")
def get_item(
    item_id: int,
    session: Session = Depends(get_session),
) -> dict[str, object]:
    """Fetch a single ``Item`` by id, including its comparable listings.

    Always returns a valid 200 response reflecting the ``Item``'s actual
    current ``status`` -- including when a pipeline stage has failed and
    the item is stuck at an intermediate ``pending_*`` status -- never a
    500; the failure is visible through the ``status`` field (and the
    still-default ``decision``/``suggested_price`` values), not an
    exception. Returns 404 if no ``Item`` with ``item_id`` exists. See
    ``app/pipeline.py``'s module docstring for the full polling contract
    (which ``status`` values are terminal vs. still-processing).
    """
    item = session.get(Item, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail=f"No item with id {item_id}.")

    return _serialize_item(item)
