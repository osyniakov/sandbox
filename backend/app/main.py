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
* ``GET /items`` -- list all items (same serialized shape as
  ``GET /items/{id}``, each without needing a separate fetch),
  optionally filtered by ``status`` and/or ``decision`` query params.
* ``PATCH /items/{id}/status`` -- manually advance an ``Item``'s status
  to ``listed`` / ``given_away`` / ``disposed`` once the user has acted
  on the app's recommendation (e.g. actually listed it on
  Kleinanzeigen). See ``MANUAL_STATUS_TRANSITIONS`` below for the full
  transition table and the reasoning behind it (sandbox-yqf.11).

Full pipeline orchestration (identification -> comparable search ->
pricing decision) lives in ``app/pipeline.py`` (sandbox-yqf.9); this
module only handles HTTP concerns (upload validation/storage, DB session
wiring, scheduling the background task, and read serialization).
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4

from fastapi import BackgroundTasks, Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import engine, get_session, init_db
from app.models import ComparableListing, Decision, Item, ItemStatus
from app.pipeline import run_pipeline_with_new_session

def _default_upload_dir() -> Path:
    """Compute the default uploads directory.

    If the ``DATA_DIR`` env var is set (non-empty), uploads live at
    ``$DATA_DIR/uploads`` -- this lets a deployment (e.g. Railway) point
    uploads at a dedicated persistent-volume mount without that volume
    needing to be mounted directly over the app's code directory (which
    would risk masking future code deploys). If unset, falls back to the
    original default: a sibling of ``app/`` inside ``backend/``.
    """
    data_dir = os.environ.get("DATA_DIR")
    if data_dir:
        return Path(data_dir) / "uploads"
    return Path(__file__).resolve().parent.parent / "uploads"


# Where uploaded photos are stored. Not committed to git -- see the
# repo-root .gitignore. Referenced as a bare module global (not a
# local/default-arg copy) so tests can monkeypatch ``app.main.UPLOAD_DIR``
# to a temp directory.
UPLOAD_DIR = _default_upload_dir()

# URL path prefix uploaded photos are served under (see the StaticFiles
# mount below and ``_serialize_item``'s ``photo_url`` field). Kept
# relative (no scheme/host) -- the frontend already resolves every API
# path relative to ``VITE_API_BASE_URL`` (see frontend/src/api.js's
# ``fetchItem``), so a relative ``photo_url`` here is consistent with
# that existing convention and stays correct across dev/LAN/deployed
# hosts without this backend needing to know its own externally-visible
# host/port.
UPLOAD_URL_PREFIX = "/uploads"

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


class _UploadsStaticFiles(StaticFiles):
    """Serves ``UPLOAD_DIR``, re-resolved as a module global on every
    request rather than once at construction time.

    The base ``starlette.staticfiles.StaticFiles`` resolves and caches its
    serving directory once, in ``__init__`` -- but this app's mount below
    is created once at *import* time (module level), while
    ``app.main.UPLOAD_DIR`` is designed to be monkeypatched *after*
    import, per-test, to a throwaway temp directory (see ``UPLOAD_DIR``'s
    own docstring above, and the ``client`` fixture in
    ``tests/test_items_upload.py``). A plain ``StaticFiles(directory=...)``
    mount would therefore permanently point at whatever ``UPLOAD_DIR`` was
    at import time -- ignoring any later monkeypatch -- so uploaded-photo
    tests using the standard temp-dir fixture would silently serve from
    (or 404 against) the wrong directory.

    Overriding the ``all_directories`` property (which
    ``StaticFiles.lookup_path`` reads on every request, not just once) to
    always recompute from the current ``app.main.UPLOAD_DIR`` global fixes
    that, matching the "module global looked up at call time" convention
    already used for ``UPLOAD_DIR``/``engine`` elsewhere in this module.
    """

    def __init__(self) -> None:
        # ``directory=None`` + ``check_dir=False``: skip the base class's
        # construction-time "directory must already exist" check
        # entirely -- at import time UPLOAD_DIR may not exist yet (it's
        # created lazily in `lifespan`), and under test it gets
        # monkeypatched to a different directory anyway, so nothing
        # meaningful could be validated here regardless. ``self.directory
        # is None`` also short-circuits `check_config` (invoked on the
        # first request) into a no-op, so a not-yet-existing UPLOAD_DIR
        # never raises -- unresolvable requests still correctly 404 via
        # ``lookup_path`` below.
        super().__init__(directory=None, check_dir=False)

    @property
    def all_directories(self) -> list[str]:  # type: ignore[override]
        return [str(UPLOAD_DIR)]

    @all_directories.setter
    def all_directories(self, value: object) -> None:
        # The base __init__ assigns ``self.all_directories = ...`` once,
        # computed from the (possibly nonexistent, possibly stale)
        # ``directory=None`` passed above. Silently discard that -- the
        # property getter above always re-derives the current
        # ``UPLOAD_DIR`` at lookup time instead, which is the entire
        # point of this subclass (see the class docstring).
        pass


# Serves uploaded photos back over HTTP at ``UPLOAD_URL_PREFIX`` (e.g.
# ``GET /uploads/<filename>``) so the frontend can render them (see
# ``_serialize_item``'s ``photo_url`` field below). ``StaticFiles``
# resolves each request path against its serving directory via
# ``os.path.realpath`` and rejects any result that escapes that directory
# (see ``starlette.staticfiles.StaticFiles.lookup_path``) -- this is
# verified explicitly (not just assumed) by
# ``tests/test_uploads_static.py``'s path-traversal tests.
app.mount(UPLOAD_URL_PREFIX, _UploadsStaticFiles(), name="uploads")


@app.get("/health")
def health() -> dict[str, str]:
    """Basic liveness check."""
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Upload content validation (sandbox-yqf.16)
# ---------------------------------------------------------------------------
#
# Two independent gaps existed in the original content-type-only check
# (sandbox-yqf.4):
#
# 1. The ``Content-Type`` comparison was case-sensitive, so a technically
#    valid ``"IMAGE/JPEG"`` header (HTTP media types are case-insensitive
#    per RFC 9110) was wrongly rejected. Fixed below by comparing against
#    a lowercased copy of the header.
#
# 2. Only the client-supplied ``Content-Type`` header was ever checked --
#    never the actual bytes. This app now (as of sandbox-yqf.10/.19)
#    mounts ``/uploads`` as a static file server and the frontend renders
#    ``<img src="{API_BASE_URL}{item.photo_url}">`` pointing straight at
#    whatever was stored. An uploaded SVG can contain an embedded
#    ``<script>``, so a stored malicious SVG is a *live* stored-XSS vector
#    against whoever views that item's results page today -- not a
#    hypothetical future risk.
#
#    Threat model accepted here: this is a personal, single-user tool with
#    no auth, but the "attacker" doesn't need to compromise anything --
#    they just need the ONE upload (a photo of the item itself) to be a
#    malicious file, e.g. because someone hands the uploader a booby-
#    trapped image, or the uploader deliberately links to this instance
#    and social-engineers the user into uploading something. Given the
#    stored file is later actively served back into a browser context
#    (the results page's <img> tag) and reflects who did the uploading
#    with no access control in between, checking bytes rather than trusting
#    a client-supplied header is worth the (small) added complexity here.
#
#    Chosen approach: (b), magic-byte sniffing -- rejecting anything whose
#    first bytes don't match one of the raster formats this app actually
#    needs from a phone camera (JPEG/PNG/WEBP/HEIC), REGARDLESS of what
#    Content-Type header the client sent. This is strictly stronger than
#    approach (a) (denylisting ``image/svg+xml`` by header alone): a client
#    that lies about Content-Type -- e.g. sending real SVG bytes labeled
#    ``image/jpeg`` -- would sail straight through an (a)-only check, but
#    is still caught here because the header lie doesn't change the bytes.
#    The existing ``image/*`` prefix check (now case-insensitive) is kept
#    as a cheap, human-readable first-pass rejection (e.g. a plain-text
#    upload never even reaches the byte-sniffing stage); the magic-byte
#    check below is the actual security boundary.
_RASTER_IMAGE_SIGNATURES: dict[str, tuple[bytes, ...]] = {
    "jpeg": (b"\xff\xd8\xff",),
    "png": (b"\x89PNG\r\n\x1a\n",),
    # WEBP: RIFF????WEBP -- "RIFF" at offset 0, "WEBP" at offset 8.
    "webp": (b"RIFF",),
    # HEIC/HEIF (ISO base media "ftyp" box): 4-byte size, "ftyp" at offset
    # 4, then a 4-byte "major brand" identifying HEIC/HEIF variants that a
    # phone camera would plausibly produce.
    "heic": (b"ftyp",),
}
_HEIC_BRANDS = {b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis", b"hevm", b"hevs", b"mif1", b"msf1"}
# Longest prefix any signature check below needs to inspect (WEBP's "WEBP"
# marker at offset 8..12 is the deepest lookup).
_SNIFF_HEADER_BYTES = 12


def _sniff_raster_format(header: bytes) -> str | None:
    """Identify which supported raster format (if any) ``header`` (the
    first ``_SNIFF_HEADER_BYTES`` bytes of an uploaded file) matches, by
    the exact same magic-number checks ``_looks_like_supported_raster_image``
    uses -- but returning the matched format name ("jpeg"/"png"/"webp"/
    "heic") instead of a bool, so the caller can derive the STORED file's
    extension from the sniffed format itself (sandbox-yqf.23) rather than
    from the client-supplied ``Content-Type`` header or filename, which are
    not trustworthy (see the module-level comment above).
    """
    if header.startswith(_RASTER_IMAGE_SIGNATURES["jpeg"][0]):
        return "jpeg"
    if header.startswith(_RASTER_IMAGE_SIGNATURES["png"][0]):
        return "png"
    if header[:4] == b"RIFF" and header[8:12] == b"WEBP":
        return "webp"
    if header[4:8] == b"ftyp" and header[8:12] in _HEIC_BRANDS:
        return "heic"
    return None


def _looks_like_supported_raster_image(header: bytes) -> bool:
    """True iff ``header`` (the first ``_SNIFF_HEADER_BYTES`` bytes of an
    uploaded file) matches a known magic number for JPEG, PNG, WEBP, or
    HEIC -- the raster formats this app actually needs from a phone
    camera. See the module-level comment above for why this check exists
    and is independent of the client-supplied ``Content-Type`` header.
    """
    return _sniff_raster_format(header) is not None


# Maps a sniffed raster format name (``_sniff_raster_format``'s return
# value) to the extension the file is stored under. Deliberately keyed off
# the SNIFFED format -- never the client-supplied ``Content-Type`` header
# or filename -- so the stored extension always matches the file's actual
# bytes (sandbox-yqf.23; see the module-level comment above for the
# extension-mismatch class of issue this closes structurally). ".jpg"
# (not ".jpeg") is used for the jpeg format to match this app's existing
# convention (uploads/tests elsewhere already assume ".jpg").
_EXTENSION_BY_SNIFFED_FORMAT: dict[str, str] = {
    "jpeg": ".jpg",
    "png": ".png",
    "webp": ".webp",
    "heic": ".heic",
}


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
    # Case-insensitive: HTTP media types are case-insensitive per RFC 9110,
    # so e.g. "IMAGE/JPEG" must be accepted just like "image/jpeg". This is
    # a cheap, human-readable first-pass filter only (e.g. it rejects a
    # plain-text upload outright without even reading its bytes) -- it is
    # NOT trusted as the actual content-safety boundary; see the
    # magic-byte sniff below (and the module-level comment above
    # ``_looks_like_supported_raster_image``) for that.
    if not content_type.lower().startswith("image/"):
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

    # The stored filename's extension is decided AFTER sniffing below, from
    # the sniffed format -- never from the client-supplied Content-Type
    # header or filename (sandbox-yqf.23). Until then, stream to disk under
    # a bare uuid with no extension; ``dest_path`` is renamed in place once
    # the sniffed format (and therefore the correct extension) is known.
    dest_path = UPLOAD_DIR / uuid4().hex

    total_bytes = 0
    oversized = False
    # Captured from the very first chunk read below (which, at
    # ``_UPLOAD_READ_CHUNK_BYTES`` == 1MB, is always >= the handful of
    # bytes any of the magic-number checks need unless the whole upload is
    # itself shorter than that -- in which case ``header_bytes`` is simply
    # the entire file, and the sniff below correctly fails to match rather
    # than erroring). Only ever set once; later chunks don't touch it.
    header_bytes = b""
    try:
        with dest_path.open("wb") as dest_file:
            while True:
                chunk = await photo.read(_UPLOAD_READ_CHUNK_BYTES)
                if not chunk:
                    break
                if not header_bytes:
                    header_bytes = chunk[:_SNIFF_HEADER_BYTES]
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

    # The actual content-safety boundary (see the module-level comment
    # above ``_looks_like_supported_raster_image``): reject anything whose
    # bytes don't match a known raster-image magic number, regardless of
    # what Content-Type header the client claimed -- this is what catches
    # e.g. real SVG bytes mislabeled as "image/jpeg", which the
    # Content-Type check above alone would not. ``sniffed_format`` is the
    # SAME check as ``_looks_like_supported_raster_image`` (both are
    # defined off ``_sniff_raster_format``); calling it directly here (
    # instead of the bool-returning wrapper) also gives us the matched
    # format name, which is what decides the stored extension below --
    # never the client-supplied Content-Type header or filename
    # (sandbox-yqf.23).
    sniffed_format = _sniff_raster_format(header_bytes)
    if sniffed_format is None:
        dest_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=400,
            detail=(
                "Uploaded file's content does not match a supported image "
                "format (JPEG, PNG, WEBP, or HEIC); the file's actual "
                "bytes did not pass validation, regardless of its "
                "Content-Type header."
            ),
        )

    # Rename the temp (extensionless) file in place to carry the extension
    # implied by the SNIFFED format -- e.g. real JPEG bytes are always
    # stored as ``.jpg``, regardless of what Content-Type header or
    # client-supplied filename extension were sent (sandbox-yqf.23). Same
    # directory, so this is a cheap rename, not a copy.
    extension = _EXTENSION_BY_SNIFFED_FORMAT[sniffed_format]
    final_path = dest_path.with_name(dest_path.name + extension)
    dest_path.rename(final_path)
    dest_path = final_path

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


def _photo_url(photo_path: str) -> str:
    """Build the fetchable ``/uploads/...`` URL for a stored photo.

    Relative (no scheme/host) -- see ``UPLOAD_URL_PREFIX``'s docstring for
    why. Derived from just the filename (``Path(photo_path).name``), not
    the full stored path, since ``photo_path`` is a server-side filesystem
    path (potentially absolute, potentially OS-specific) that must never
    leak to/be trusted from the client -- the filename alone is all
    ``_UploadsStaticFiles``/``UPLOAD_DIR`` needs to look the file back up.
    """
    return f"{UPLOAD_URL_PREFIX}/{Path(photo_path).name}"


def _serialize_item(item: Item) -> dict[str, object]:
    return {
        "id": item.id,
        "photo_path": item.photo_path,
        "photo_url": _photo_url(item.photo_path),
        "identified_name": item.identified_name,
        "category": item.category,
        "brand": item.brand,
        "condition": item.condition,
        "search_keywords": item.search_keywords,
        "suggested_price": item.suggested_price,
        "decision": item.decision.value,
        "status": item.status.value,
        "valid_next_statuses": sorted(
            s.value for s in MANUAL_STATUS_TRANSITIONS.get(item.status, frozenset())
        ),
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


@app.get("/items")
def list_items(
    status: ItemStatus | None = None,
    decision: Decision | None = None,
    session: Session = Depends(get_session),
) -> list[dict[str, object]]:
    """List all ``Item``s, optionally filtered by ``status`` and/or
    ``decision`` query params (e.g. ``GET /items?status=decided&decision=sell``).

    Either, both, or neither filter may be supplied -- an omitted filter
    param simply isn't applied. FastAPI validates the query values against
    the ``ItemStatus``/``Decision`` enums automatically (422 on an
    unrecognized value), since both query params are typed against those
    enums directly.

    Returns the same per-item serialized shape as ``GET /items/{id}``
    (via ``_serialize_item``, including ``comparable_listings``), ordered
    by ``id`` ascending for a stable, deterministic response order.
    """
    query = session.query(Item)
    if status is not None:
        query = query.filter(Item.status == status)
    if decision is not None:
        query = query.filter(Item.decision == decision)
    items = query.order_by(Item.id).all()
    return [_serialize_item(item) for item in items]


class ItemStatusUpdateRequest(BaseModel):
    status: ItemStatus


# ---------------------------------------------------------------------------
# Manual status transition state machine (sandbox-yqf.11)
# ---------------------------------------------------------------------------
#
# ``PATCH /items/{id}/status`` lets the user record that they've actually
# acted on the app's recommendation outside the app itself (listed the
# item on Kleinanzeigen, given it away, or thrown it out) -- there is no
# automated posting integration (see the epic's assumption/decision), so
# this is purely a manual bookkeeping transition on ``Item.status``.
#
# This dict is the single source of truth for which transitions are
# allowed: keys are the item's CURRENT status, values are the set of
# statuses it may be manually advanced to from there. Every design
# question the bead deliberately left open is resolved here, explicitly,
# rather than via scattered if/else checks in the endpoint body:
#
# 1. **Which source statuses can reach listed/given_away/disposed?**
#    Only ``decided``. The pipeline (identify -> search -> decide, see
#    ``app/pipeline.py``) has to have actually finished and produced a
#    recommendation (decision + suggested_price + comparable listings)
#    before the user acts on it -- that's the entire point of this app
#    (an *informed* sell/give-away/throw-away decision, not a guess).
#    Allowing e.g. ``pending_identification`` to jump straight to
#    ``disposed`` would let a user bypass the app's analysis entirely,
#    which defeats its purpose and is exactly the case the bead's edge
#    example calls out as something that must be REJECTED with 400.
#    Concretely, this means the ``pending_*`` statuses each map to an
#    empty transition set below -- a still-running (or stuck) pipeline
#    has no valid manual next state; the user's only recourse there is to
#    wait (or, out of scope for this bead, some future manual-retry/
#    override feature).
#
# 2. **Must the target match ``Item.decision``?** No -- deliberately NOT
#    enforced here. ``Item.decision`` is the app's *recommendation*
#    (sell/give_away/throw_away), not a binding constraint on what the
#    user is allowed to do with their own physical basement item. A
#    recommended "sell" item that fails to attract a buyer, or that the
#    user simply changes their mind about, should still be markable as
#    ``given_away`` or ``disposed`` without the app standing in the way.
#    This is a single-user personal tool: the user always has final say.
#
# 3. **Are listed/given_away/disposed terminal?** No -- they can freely
#    move to either of the *other two* (e.g. ``listed`` -> ``disposed``
#    if a listing never sells and the user gives up; ``given_away`` ->
#    ``disposed`` if the recipient falls through; a straightforward
#    misclick can also be corrected this way). They can NOT move back to
#    ``decided`` or any ``pending_*`` status -- once the user has acted
#    on the item in the real world, "un-deciding" it or re-running the
#    pipeline doesn't correspond to anything real; the only meaningful
#    moves from there are to one of the other two post-action statuses.
#
# Full transition table:
#
#   pending_identification -> (none)
#   pending_search          -> (none)
#   pending_decision        -> (none)
#   decided                 -> listed, given_away, disposed
#   listed                  -> given_away, disposed
#   given_away              -> listed, disposed
#   disposed                -> listed, given_away
MANUAL_STATUS_TRANSITIONS: dict[ItemStatus, frozenset[ItemStatus]] = {
    ItemStatus.PENDING_IDENTIFICATION: frozenset(),
    ItemStatus.PENDING_SEARCH: frozenset(),
    ItemStatus.PENDING_DECISION: frozenset(),
    ItemStatus.DECIDED: frozenset(
        {ItemStatus.LISTED, ItemStatus.GIVEN_AWAY, ItemStatus.DISPOSED}
    ),
    ItemStatus.LISTED: frozenset({ItemStatus.GIVEN_AWAY, ItemStatus.DISPOSED}),
    ItemStatus.GIVEN_AWAY: frozenset({ItemStatus.LISTED, ItemStatus.DISPOSED}),
    ItemStatus.DISPOSED: frozenset({ItemStatus.LISTED, ItemStatus.GIVEN_AWAY}),
}


@app.patch("/items/{item_id}/status")
def update_item_status(
    item_id: int,
    body: ItemStatusUpdateRequest,
    session: Session = Depends(get_session),
) -> dict[str, object]:
    """Manually advance an ``Item``'s status per ``MANUAL_STATUS_TRANSITIONS``.

    Returns 404 if no ``Item`` with ``item_id`` exists. Returns 400 (not a
    generic "invalid transition" message, but one naming the item's
    CURRENT status and the VALID next states from there) if
    ``body.status`` isn't in the current status's allowed transition set.
    On success, returns 200 with the updated, freshly-serialized item
    (same shape as ``GET /items/{id}``).
    """
    item = session.get(Item, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail=f"No item with id {item_id}.")

    valid_next_statuses = MANUAL_STATUS_TRANSITIONS.get(item.status, frozenset())
    if body.status not in valid_next_statuses:
        valid_desc = (
            ", ".join(sorted(s.value for s in valid_next_statuses))
            if valid_next_statuses
            else "(none -- this item has no valid manual status transitions"
            " from its current status)"
        )
        raise HTTPException(
            status_code=400,
            detail=(
                f"Cannot transition item {item_id} from status "
                f"'{item.status.value}' to '{body.status.value}'. "
                f"Current status: '{item.status.value}'. "
                f"Valid next states: {valid_desc}."
            ),
        )

    item.status = body.status
    session.commit()
    session.refresh(item)
    return _serialize_item(item)
