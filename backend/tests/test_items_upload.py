"""Integration tests for POST /items (photo upload endpoint).

Each test gets its own throwaway SQLite DB file and its own throwaway
uploads directory (both under pytest's ``tmp_path``), consistent with the
pattern in ``test_models.py``, so nothing here ever touches the real dev
DB file (``backend/data/declutter.db``) or the real ``backend/uploads/``
directory. See the ``client`` fixture below for how that isolation is
wired: it monkeypatches ``app.main.engine`` and ``app.main.UPLOAD_DIR``
*before* the ``TestClient`` lifespan (which calls ``init_db``/creates the
uploads dir) runs, and overrides the ``get_session`` FastAPI dependency
to hand out sessions bound to the temp engine.
"""

from __future__ import annotations

import io
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

import app.main as main_module
from app.db import get_session, make_engine, make_session_factory
from app.main import app
from app.models import Item, ItemStatus


def _make_jpeg_bytes() -> bytes:
    """A tiny but genuinely valid JPEG, generated with Pillow."""
    image = Image.new("RGB", (2, 2), color=(255, 0, 0))
    buf = io.BytesIO()
    image.save(buf, format="JPEG")
    return buf.getvalue()


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    db_path = tmp_path / "test.db"
    test_engine = make_engine(f"sqlite:///{db_path}")
    factory = make_session_factory(test_engine)

    def _get_session_override() -> Iterator:
        session = factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_session] = _get_session_override
    monkeypatch.setattr(main_module, "engine", test_engine)
    monkeypatch.setattr(main_module, "UPLOAD_DIR", tmp_path / "uploads")

    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.clear()
    test_engine.dispose()
    if db_path.exists():
        db_path.unlink()


@pytest.fixture()
def db_session_factory(client: TestClient):
    """A session factory bound to the same temp engine the client uses."""
    return make_session_factory(main_module.engine)


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


def test_valid_jpeg_upload_returns_201_and_persists_item(
    client: TestClient, db_session_factory
) -> None:
    jpeg_bytes = _make_jpeg_bytes()

    response = client.post(
        "/items",
        files={"photo": ("lamp.jpg", jpeg_bytes, "image/jpeg")},
    )

    assert response.status_code == 201
    body = response.json()
    assert "id" in body
    assert body["status"] == "pending_identification"

    session = db_session_factory()
    try:
        fetched = session.get(Item, body["id"])
        assert fetched is not None
        assert fetched.status == ItemStatus.PENDING_IDENTIFICATION
        assert fetched.photo_path
        photo_path = Path(fetched.photo_path)
        assert photo_path.exists()
        assert photo_path.read_bytes() == jpeg_bytes
        # Stored under the (monkeypatched, temp) uploads dir, not the real
        # backend/uploads/.
        assert photo_path.parent == main_module.UPLOAD_DIR
    finally:
        session.close()


def test_valid_png_upload_returns_201(client: TestClient) -> None:
    image = Image.new("RGB", (2, 2), color=(0, 255, 0))
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    png_bytes = buf.getvalue()

    response = client.post(
        "/items",
        files={"photo": ("chair.png", png_bytes, "image/png")},
    )

    assert response.status_code == 201
    body = response.json()
    assert "id" in body
    assert body["status"] == "pending_identification"
    assert body["photo_path"].endswith(".png")


def test_stored_extension_derived_from_sniffed_format_not_content_type_or_filename(
    client: TestClient,
) -> None:
    """The stored file's extension must come from the SNIFFED format (the
    magic-byte check), never from the client-supplied Content-Type header
    or filename (sandbox-yqf.23). Real JPEG bytes, sent with an unusual
    Content-Type and a client filename claiming a different extension,
    must still be stored (and served back) as ``.jpg``."""
    jpeg_bytes = _make_jpeg_bytes()

    response = client.post(
        "/items",
        files={"photo": ("totally-a-lamp.svg", jpeg_bytes, "image/x-weird")},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["photo_path"].endswith(".jpg")
    assert not body["photo_path"].endswith(".svg")

    stored_path = Path(body["photo_path"])
    assert stored_path.exists()
    assert stored_path.suffix == ".jpg"
    assert stored_path.read_bytes() == jpeg_bytes


def test_uppercase_content_type_with_real_jpeg_bytes_accepted(
    client: TestClient,
) -> None:
    """HTTP media types are case-insensitive (RFC 9110); "IMAGE/JPEG" must
    be accepted just like "image/jpeg" (sandbox-yqf.16)."""
    jpeg_bytes = _make_jpeg_bytes()

    response = client.post(
        "/items",
        files={"photo": ("lamp.jpg", jpeg_bytes, "IMAGE/JPEG")},
    )

    assert response.status_code == 201
    body = response.json()
    assert "id" in body
    assert body["status"] == "pending_identification"


# ---------------------------------------------------------------------------
# Edge case: non-image content type
# ---------------------------------------------------------------------------


def test_non_image_content_type_rejected_with_400(client: TestClient) -> None:
    response = client.post(
        "/items",
        files={"photo": ("notes.txt", b"just some text, not an image", "text/plain")},
    )

    assert response.status_code == 400
    assert "image" in response.json()["detail"].lower()


def test_image_extension_but_non_image_content_type_still_rejected(
    client: TestClient,
) -> None:
    """A .jpg filename with a non-image content type must not be trusted."""
    response = client.post(
        "/items",
        files={"photo": ("fake.jpg", b"not actually a jpeg", "application/octet-stream")},
    )

    assert response.status_code == 400


# ---------------------------------------------------------------------------
# Edge case: SVG rejection (sandbox-yqf.16)
# ---------------------------------------------------------------------------
#
# /uploads is served back to the browser as static files (sandbox-yqf.19)
# and rendered directly via <img src=...> on the results page
# (ItemResultPage.jsx) -- an SVG containing an embedded <script> stored
# under UPLOAD_DIR would be a real stored-XSS vector against whoever views
# that item. Both tests below use the same malicious payload to make that
# concrete.

_MALICIOUS_SVG_BYTES = (
    b'<svg xmlns="http://www.w3.org/2000/svg">'
    b"<script>alert(1)</script>"
    b"</svg>"
)


def test_svg_with_honest_content_type_rejected_with_400(client: TestClient) -> None:
    """An SVG correctly labeled image/svg+xml is still rejected -- this app
    only accepts raster photo formats, and SVG can carry a <script>."""
    response = client.post(
        "/items",
        files={"photo": ("evil.svg", _MALICIOUS_SVG_BYTES, "image/svg+xml")},
    )

    assert response.status_code == 400


def test_svg_bytes_mislabeled_as_jpeg_still_rejected_with_400(
    client: TestClient,
) -> None:
    """A client that lies about Content-Type (real SVG bytes labeled
    image/jpeg, to smuggle past a header-only check) must still be caught
    -- this proves the magic-byte sniff inspects actual file content, not
    just the client-supplied header."""
    response = client.post(
        "/items",
        files={"photo": ("evil.jpg", _MALICIOUS_SVG_BYTES, "image/jpeg")},
    )

    assert response.status_code == 400


def test_svg_upload_does_not_leave_a_stored_file_or_item_row(
    client: TestClient, db_session_factory
) -> None:
    """A rejected SVG upload must not persist to disk or the DB -- same
    cleanup guarantee as the other rejection paths in this file."""
    response = client.post(
        "/items",
        files={"photo": ("evil.svg", _MALICIOUS_SVG_BYTES, "image/svg+xml")},
    )
    assert response.status_code == 400

    session = db_session_factory()
    try:
        assert session.query(Item).count() == 0
    finally:
        session.close()

    uploads_dir = main_module.UPLOAD_DIR
    if uploads_dir.exists():
        assert list(uploads_dir.iterdir()) == []


# ---------------------------------------------------------------------------
# Edge case: oversized upload
# ---------------------------------------------------------------------------


def test_oversized_upload_rejected_with_413(client: TestClient) -> None:
    oversized_bytes = b"\xff" * (main_module.MAX_UPLOAD_BYTES + 1)

    response = client.post(
        "/items",
        files={"photo": ("huge.jpg", oversized_bytes, "image/jpeg")},
    )

    assert response.status_code == 413


def test_oversized_upload_does_not_leave_partial_file_or_item_row(
    client: TestClient, db_session_factory
) -> None:
    oversized_bytes = b"\xff" * (main_module.MAX_UPLOAD_BYTES + 1)

    response = client.post(
        "/items",
        files={"photo": ("huge.jpg", oversized_bytes, "image/jpeg")},
    )
    assert response.status_code == 413

    session = db_session_factory()
    try:
        assert session.query(Item).count() == 0
    finally:
        session.close()

    uploads_dir = main_module.UPLOAD_DIR
    if uploads_dir.exists():
        assert list(uploads_dir.iterdir()) == []


# ---------------------------------------------------------------------------
# Edge case: missing/empty file part
# ---------------------------------------------------------------------------


def test_missing_file_part_rejected_with_400(client: TestClient) -> None:
    response = client.post("/items")

    assert response.status_code == 400


def test_empty_file_rejected_with_400(client: TestClient) -> None:
    response = client.post(
        "/items",
        files={"photo": ("empty.jpg", b"", "image/jpeg")},
    )

    assert response.status_code == 400


def test_empty_file_does_not_create_item_row(
    client: TestClient, db_session_factory
) -> None:
    response = client.post(
        "/items",
        files={"photo": ("empty.jpg", b"", "image/jpeg")},
    )
    assert response.status_code == 400

    session = db_session_factory()
    try:
        assert session.query(Item).count() == 0
    finally:
        session.close()
