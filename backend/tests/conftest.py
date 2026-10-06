"""Shared pytest fixtures for the backend test suite.

Holds ``auth_headers`` plus the shared ``client``/``db_session_factory``
fixtures and ``_make_jpeg_bytes`` helper. ``auth_headers`` is used by every test
file that calls a route gated behind ``app.main.require_user`` (the
``/items*`` routes and ``GET /uploads/{filename}``; see sandbox-dfr.3).
Introduced as a top-level ``conftest.py`` (none existed before) rather
than a small importable helper module, since this fixture needs
``monkeypatch`` (a pytest fixture itself, for isolated per-test env var
setup/teardown) and is needed across most of this package's test
files -- a real pytest fixture, auto-discovered by every test module in
this directory, is the natural fit and avoids every test file having to
remember to import a helper function.
"""

from __future__ import annotations

import io
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

import app.main as main_module
from app.auth import issue_session_token
from app.db import get_session, make_engine, make_session_factory
from app.main import app


TEST_USER_EMAIL = "test@example.com"
"""Email behind the default ``auth_headers`` fixture; tests that seed ``Item``
rows directly must set ``owner_email=TEST_USER_EMAIL`` for them to be visible."""


@pytest.fixture()
def auth_headers_for(monkeypatch: pytest.MonkeyPatch):
    """Factory: ``auth_headers_for("bob@example.com")`` -> Authorization header
    dict with a real session token for that email (for multi-user tests)."""
    monkeypatch.setenv("SESSION_SECRET", "test-session-secret")

    def _make(email: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {issue_session_token(email)}"}

    return _make


@pytest.fixture()
def auth_headers(monkeypatch: pytest.MonkeyPatch) -> dict[str, str]:
    """A ready-to-use ``{"Authorization": "Bearer <token>"}`` header dict
    for hitting a route gated behind ``require_user``.

    Mints a real, valid session token directly via
    ``app.auth.issue_session_token`` (not through the ``POST /auth/google``
    HTTP flow -- no need to fake a Google ID token just to get a session
    token in tests that only care about *having* one). Ensures
    ``SESSION_SECRET`` is set first (``issue_session_token`` raises
    ``RuntimeError`` otherwise) via ``monkeypatch.setenv``, matching the
    per-test env var convention already used in
    ``tests/test_auth.py``/``tests/test_auth_endpoints.py`` -- cleaned up
    automatically after the test.

    Does not touch ``ALLOWED_EMAILS`` (no longer a sign-in allowlist).
    """
    monkeypatch.setenv("SESSION_SECRET", "test-session-secret")
    token = issue_session_token(TEST_USER_EMAIL)
    return {"Authorization": f"Bearer {token}"}


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
