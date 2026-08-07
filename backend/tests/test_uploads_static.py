"""Tests for the ``/uploads`` static-file mount (sandbox-yqf.19).

Verifies that a photo uploaded via ``POST /items`` can actually be
fetched back over HTTP at the ``photo_url`` the API returns, with a
correct ``Content-Type``, and -- since this route serves user-uploaded
files back over HTTP -- that path-traversal-style requests genuinely
cannot escape ``UPLOAD_DIR``, rather than just trusting that
``StaticFiles``' built-in protection holds.

Uses the same throwaway-DB/throwaway-uploads-dir ``client`` fixture
pattern as ``tests/test_items_upload.py`` (monkeypatches
``app.main.engine``/``app.main.UPLOAD_DIR`` *before* the ``TestClient``
lifespan runs), so nothing here touches the real dev DB or the real
``backend/uploads/`` directory.
"""

from __future__ import annotations

import asyncio
import io
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

import app.main as main_module
from app.db import get_session, make_engine, make_session_factory
from app.main import app


async def _raw_asgi_get(target_app, raw_path: str) -> tuple[int, bytes]:
    """Invoke ``target_app`` directly over the raw ASGI interface with an
    attacker-controlled, already-decoded request path -- bypassing
    ``httpx``/``TestClient``'s own client-side URL normalization
    entirely.

    This matters because ``httpx`` (which ``fastapi.testclient.TestClient``
    is built on) normalizes ``..`` dot-segments out of a URL's path at
    *request-construction* time, per RFC 3986 -- so a test that just does
    ``client.get("/uploads/../secret.txt")`` never actually sends a path
    containing ``..`` at all; by the time it leaves the client it has
    already been rewritten to ``/secret.txt``, and any 404 you observe
    proves nothing about this app's own containment logic (it 404s simply
    because no route matches ``/secret.txt``, not because
    ``StaticFiles``/``_UploadsStaticFiles`` blocked an escape attempt).

    A raw, non-normalizing HTTP client (curl, netcat, a misbehaving
    proxy) has no obligation to perform that client-side normalization,
    so the server-side app itself is what must actually enforce
    containment. Building the ASGI ``scope`` dict by hand and calling the
    ASGI app callable directly reproduces exactly what such a client's
    request looks like once decoded onto the wire, which is what
    genuinely exercises ``starlette.staticfiles.StaticFiles.lookup_path``'s
    ``os.path.realpath``/``os.path.commonpath`` containment check (the
    real protection mechanism) end-to-end through the real routing layer
    (``Mount`` regex matching -> ``_UploadsStaticFiles.__call__`` ->
    ``get_response`` -> ``lookup_path``).
    """
    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": raw_path,
        "raw_path": raw_path.encode("utf-8"),
        "query_string": b"",
        "root_path": "",
        "headers": [(b"host", b"testserver")],
        "client": ("testclient", 123),
        "server": ("testserver", 80),
    }
    messages: list[dict] = []

    async def receive() -> dict:
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message: dict) -> None:
        messages.append(message)

    await target_app(scope, receive, send)

    status = None
    body = b""
    for message in messages:
        if message["type"] == "http.response.start":
            status = message["status"]
        elif message["type"] == "http.response.body":
            body += message.get("body", b"")
    return status, body


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


# ---------------------------------------------------------------------------
# Happy path: uploaded photo is fetchable over HTTP
# ---------------------------------------------------------------------------


def test_uploaded_photo_is_fetchable_at_its_photo_url(client: TestClient) -> None:
    jpeg_bytes = _make_jpeg_bytes()

    upload_response = client.post(
        "/items",
        files={"photo": ("lamp.jpg", jpeg_bytes, "image/jpeg")},
    )
    assert upload_response.status_code == 201
    item_body = upload_response.json()

    get_item_response = client.get(f"/items/{item_body['id']}")
    assert get_item_response.status_code == 200
    item = get_item_response.json()

    assert "photo_url" in item
    assert item["photo_url"].startswith("/uploads/")
    assert item["photo_url"] == f"/uploads/{Path(item['photo_path']).name}"

    photo_response = client.get(item["photo_url"])
    assert photo_response.status_code == 200
    assert photo_response.content == jpeg_bytes
    assert photo_response.headers["content-type"] == "image/jpeg"


def test_uploaded_png_photo_served_with_image_png_content_type(client: TestClient) -> None:
    image = Image.new("RGB", (2, 2), color=(0, 255, 0))
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    png_bytes = buf.getvalue()

    upload_response = client.post(
        "/items",
        files={"photo": ("chair.png", png_bytes, "image/png")},
    )
    assert upload_response.status_code == 201
    item_id = upload_response.json()["id"]

    item = client.get(f"/items/{item_id}").json()
    photo_response = client.get(item["photo_url"])

    assert photo_response.status_code == 200
    assert photo_response.content == png_bytes
    assert photo_response.headers["content-type"] == "image/png"


# ---------------------------------------------------------------------------
# Edge case: photo file missing from disk
# ---------------------------------------------------------------------------


def test_missing_file_returns_404_not_error(client: TestClient) -> None:
    response = client.get("/uploads/does-not-exist.jpg")
    assert response.status_code == 404


def test_uploads_mount_survives_upload_dir_not_yet_existing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """UPLOAD_DIR is created lazily in `lifespan`; before any upload (or
    on a machine's very first run) it may not exist yet. The mount itself
    is created once at import time (module level, before `lifespan` ever
    runs), so this deliberately bypasses `lifespan`'s
    startup (by not using the `with TestClient(app) as ...:` form, which
    is what triggers FastAPI/Starlette startup events) to reproduce that
    "mount exists, directory does not yet" ordering, and confirms
    unresolved requests still 404 cleanly rather than raising.
    """
    # A directory that does not exist, and is never created by anything
    # in this test (no lifespan startup runs -- see docstring above).
    never_created_dir = tmp_path / "uploads-not-created"
    monkeypatch.setattr(main_module, "UPLOAD_DIR", never_created_dir)
    assert not never_created_dir.exists()

    test_client = TestClient(app)  # no `with`: lifespan startup does not run
    response = test_client.get("/uploads/anything.jpg")

    assert response.status_code == 404
    assert not never_created_dir.exists()


# ---------------------------------------------------------------------------
# Security: path traversal must not escape UPLOAD_DIR
#
# The "raw ASGI" tests below are the authoritative check: they bypass
# httpx's own client-side dot-segment normalization (see
# `_raw_asgi_get`'s docstring) so they genuinely exercise this app's
# server-side containment logic, not the test client's URL hygiene. The
# plain `client.get(...)` tests are kept alongside them as an extra,
# closer-to-real-world confirmation of what a normalizing HTTP client
# observes (a clean 404), even though -- as documented -- they end up
# sending an already-normalized path.
# ---------------------------------------------------------------------------


def test_path_traversal_dotdot_does_not_escape_upload_dir_raw_asgi(
    client: TestClient, tmp_path: Path
) -> None:
    # A secret file that lives outside UPLOAD_DIR (a sibling of it, both
    # under tmp_path) -- if traversal protection ever regressed, a request
    # for "../secret.txt" relative to UPLOAD_DIR would return this.
    secret_path = tmp_path / "secret.txt"
    secret_path.write_text("top secret, must never be served")

    status, body = asyncio.run(_raw_asgi_get(app, "/uploads/../secret.txt"))

    assert status == 404
    assert b"top secret" not in body


def test_path_traversal_deep_dotdot_toward_etc_passwd_does_not_escape_raw_asgi(
    client: TestClient,
) -> None:
    status, body = asyncio.run(
        _raw_asgi_get(app, "/uploads/../../../../../../etc/passwd")
    )

    assert status == 404
    assert b"root:" not in body


def test_path_traversal_dotdot_does_not_escape_upload_dir(
    client: TestClient, tmp_path: Path
) -> None:
    """Same attack via the ordinary `TestClient`/httpx path -- see the
    module-level note above on why this is a secondary, not primary,
    verification (httpx normalizes ``..`` out of the URL before the
    request is even sent).
    """
    secret_path = tmp_path / "secret.txt"
    secret_path.write_text("top secret, must never be served")

    response = client.get("/uploads/../secret.txt", follow_redirects=False)
    assert response.status_code in (404, 403)
    assert b"top secret" not in response.content


def test_path_traversal_url_encoded_dotdot_does_not_escape(
    client: TestClient, tmp_path: Path
) -> None:
    secret_path = tmp_path / "secret.txt"
    secret_path.write_text("top secret, must never be served")

    # %2e%2e%2f is a URL-encoded "../".
    response = client.get("/uploads/%2e%2e%2fsecret.txt", follow_redirects=False)
    assert response.status_code in (404, 403)
    assert b"top secret" not in response.content


def test_path_traversal_encoded_dotdot_toward_etc_passwd_does_not_escape(
    client: TestClient,
) -> None:
    response = client.get(
        "/uploads/%2e%2e%2f%2e%2e%2f%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd",
        follow_redirects=False,
    )
    assert response.status_code in (404, 403)
    assert b"root:" not in response.content
