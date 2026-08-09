"""Integration tests for the ``/auth/*`` HTTP endpoints and the
``require_user`` dependency in ``app.main``.

Mirrors ``test_items_upload.py``'s ``client`` fixture pattern (own
throwaway SQLite DB + uploads dir per test, via ``tmp_path``) so nothing
here touches the real dev DB or uploads directory. Google ID token
verification is faked by monkeypatching ``app.main.verify_google_id_token``
directly (the endpoint-level equivalent of ``test_auth.py``'s injectable
``verify_fn`` fake) -- no real network call to Google is ever made.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import app.main as main_module
from app.auth import AuthError, issue_session_token
from app.db import get_session, make_engine, make_session_factory
from app.main import app


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
    monkeypatch.setenv("SESSION_SECRET", "test-session-secret")

    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.clear()
    test_engine.dispose()
    if db_path.exists():
        db_path.unlink()


def _fake_verify_success(email: str):
    def _verify(id_token_str: str) -> str:
        return email

    return _verify


def _fake_verify_failure(message: str = "verification failed"):
    def _verify(id_token_str: str) -> str:
        raise AuthError(message)

    return _verify


# ---------------------------------------------------------------------------
# POST /auth/google
# ---------------------------------------------------------------------------


def test_auth_google_success_returns_token_and_email(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        main_module, "verify_google_id_token", _fake_verify_success("alice@example.com")
    )

    response = client.post("/auth/google", json={"id_token": "fake-valid-token"})

    assert response.status_code == 200
    body = response.json()
    assert body["email"] == "alice@example.com"
    assert isinstance(body["token"], str) and body["token"]

    # The returned token is a real, usable session token: it authenticates
    # a subsequent GET /auth/me call for the same email.
    me_response = client.get(
        "/auth/me", headers={"Authorization": f"Bearer {body['token']}"}
    )
    assert me_response.status_code == 200
    assert me_response.json() == {"email": "alice@example.com"}


def test_auth_google_failed_verification_returns_401(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        main_module, "verify_google_id_token", _fake_verify_failure("not whitelisted")
    )

    response = client.post("/auth/google", json={"id_token": "fake-bad-token"})

    assert response.status_code == 401


# ---------------------------------------------------------------------------
# GET /auth/me
# ---------------------------------------------------------------------------


def test_auth_me_no_authorization_header_returns_401(client: TestClient) -> None:
    response = client.get("/auth/me")
    assert response.status_code == 401


def test_auth_me_malformed_header_returns_401(client: TestClient) -> None:
    response = client.get("/auth/me", headers={"Authorization": "NotBearer sometoken"})
    assert response.status_code == 401


def test_auth_me_garbage_token_returns_401(client: TestClient) -> None:
    response = client.get(
        "/auth/me", headers={"Authorization": "Bearer this-is-not-a-real-token"}
    )
    assert response.status_code == 401


# ---------------------------------------------------------------------------
# POST /auth/logout
# ---------------------------------------------------------------------------


def test_auth_logout_valid_session_returns_200(client: TestClient) -> None:
    token = issue_session_token("alice@example.com")
    response = client.post("/auth/logout", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_auth_logout_no_session_returns_401(client: TestClient) -> None:
    response = client.post("/auth/logout")
    assert response.status_code == 401
