"""Shared pytest fixtures for the backend test suite.

Currently holds a single fixture, ``auth_headers``, used by every test
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

import pytest

from app.auth import issue_session_token


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

    Deliberately does NOT touch ``ALLOWED_EMAILS``: ``verify_session_token``
    (what every gated route actually calls, via ``require_user``) only
    checks the token's own signature/expiry, never ``ALLOWED_EMAILS`` again
    -- that whitelist is only consulted once, at the point of exchanging a
    Google ID token for a session token in ``POST /auth/google`` (see
    ``app.auth.verify_google_id_token``). So minting a session token
    directly, as this fixture does, never touches the whitelist at all, and
    tests using this fixture don't need to configure it.
    """
    monkeypatch.setenv("SESSION_SECRET", "test-session-secret")
    token = issue_session_token("test@example.com")
    return {"Authorization": f"Bearer {token}"}
