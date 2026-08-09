"""Tests for the ALLOWED_ORIGINS-driven CORS allowlist (sandbox-yqf.18).

The CORS allowlist is resolved once at import time from the
``ALLOWED_ORIGINS`` env var (see ``app.main._parse_allowed_origins`` and
the ``app.add_middleware(CORSMiddleware, ...)`` call in ``app/main.py``).
To exercise the env-var-driven path (not just the parsing helper in
isolation) these tests set the env var via ``monkeypatch`` and then
``importlib.reload`` ``app.main`` so the module-level ``ALLOWED_ORIGINS``
and the ``CORSMiddleware`` it's baked into are rebuilt from the new env
value, matching how a real process would pick up the env var at startup.

Each test's ``TestClient`` is used *without* entering it as a context
manager, so the app's ``lifespan`` (which calls ``init_db``/creates the
uploads dir) never runs -- these tests only exercise CORS header
behavior on ``GET /health`` and never touch the real dev DB or uploads
dir. An autouse fixture reloads ``app.main`` back to its default
(env-unset) state after every test in this module, since other test
modules also `import app.main` and expect its default localhost-only
CORS config.

Safety note (reviewed in sandbox-yqf.18): reload also re-executes
``from app.db import engine``, resetting ``app.main.engine`` /
``app.main.UPLOAD_DIR`` to the real dev DB/uploads dir. This is safe
today because pytest runs this suite with no cross-file interleaving
(no pytest-randomly/pytest-random-order installed) and every fixture in
the other test modules is function-scoped. If order-randomizing plugins
are ever added to this repo, a reload landing mid-test in another file
could point it at the real dev DB -- revisit this technique (e.g. patch
os.environ + re-run just ``_parse_allowed_origins`` instead of a full
module reload) if that happens.
"""

from __future__ import annotations

import importlib

import pytest
from fastapi.testclient import TestClient

import app.main as main_module
from app.main import _parse_allowed_origins


@pytest.fixture(autouse=True)
def _restore_main_module_after_test():
    yield
    importlib.reload(main_module)


def test_default_allowlist_rejects_lan_origin(monkeypatch: pytest.MonkeyPatch) -> None:
    """With no ALLOWED_ORIGINS set, a LAN-style origin is NOT allowed."""
    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)
    importlib.reload(main_module)

    client = TestClient(main_module.app)
    response = client.get("/health", headers={"Origin": "http://192.168.1.50:5173"})

    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers


def test_default_allowlist_still_accepts_localhost(monkeypatch: pytest.MonkeyPatch) -> None:
    """Existing localhost dev workflow keeps working unmodified."""
    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)
    importlib.reload(main_module)

    client = TestClient(main_module.app)
    response = client.get("/health", headers={"Origin": "http://localhost:5173"})

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_allowed_origins_env_var_accepts_matching_lan_origin(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A LAN origin listed in ALLOWED_ORIGINS is genuinely accepted by CORS."""
    lan_origin = "http://192.168.1.50:5173"
    monkeypatch.setenv("ALLOWED_ORIGINS", lan_origin)
    importlib.reload(main_module)

    client = TestClient(main_module.app)
    response = client.get("/health", headers={"Origin": lan_origin})

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == lan_origin


def test_allowed_origins_env_var_rejects_nonmatching_origin(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Setting ALLOWED_ORIGINS to one LAN origin does not open it to others."""
    monkeypatch.setenv("ALLOWED_ORIGINS", "http://192.168.1.50:5173")
    importlib.reload(main_module)

    client = TestClient(main_module.app)
    response = client.get("/health", headers={"Origin": "http://10.0.0.9:5173"})

    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers


def test_allowed_origins_env_var_supports_comma_separated_list(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Multiple origins (e.g. localhost + LAN IP) can be listed together."""
    monkeypatch.setenv(
        "ALLOWED_ORIGINS", "http://localhost:5173,http://192.168.1.50:5173"
    )
    importlib.reload(main_module)

    client = TestClient(main_module.app)
    response = client.get("/health", headers={"Origin": "http://192.168.1.50:5173"})

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://192.168.1.50:5173"


def test_malformed_allowed_origins_falls_back_to_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A malformed env value (blank entries only) falls back to the default pair."""
    monkeypatch.setenv("ALLOWED_ORIGINS", " , , ")
    importlib.reload(main_module)

    client = TestClient(main_module.app)
    response = client.get("/health", headers={"Origin": "http://localhost:5173"})

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_empty_string_allowed_origins_falls_back_to_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An explicitly-set-but-empty env value also falls back sensibly."""
    monkeypatch.setenv("ALLOWED_ORIGINS", "")
    importlib.reload(main_module)

    client = TestClient(main_module.app)
    response = client.get("/health", headers={"Origin": "http://127.0.0.1:5173"})

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"


class TestParseAllowedOrigins:
    """Unit tests for the parsing/fallback helper in isolation."""

    def test_none_returns_default(self) -> None:
        assert _parse_allowed_origins(None) == main_module.DEFAULT_ALLOWED_ORIGINS

    def test_empty_string_returns_default(self) -> None:
        assert _parse_allowed_origins("") == main_module.DEFAULT_ALLOWED_ORIGINS

    def test_only_commas_returns_default(self) -> None:
        assert _parse_allowed_origins(",,,") == main_module.DEFAULT_ALLOWED_ORIGINS

    def test_only_whitespace_returns_default(self) -> None:
        assert _parse_allowed_origins("   ") == main_module.DEFAULT_ALLOWED_ORIGINS

    def test_single_origin(self) -> None:
        assert _parse_allowed_origins("http://192.168.1.50:5173") == [
            "http://192.168.1.50:5173"
        ]

    def test_multiple_origins_with_surrounding_whitespace(self) -> None:
        raw = " http://192.168.1.50:5173 , http://localhost:5173 "
        assert _parse_allowed_origins(raw) == [
            "http://192.168.1.50:5173",
            "http://localhost:5173",
        ]

    def test_trailing_comma_is_ignored(self) -> None:
        assert _parse_allowed_origins("http://192.168.1.50:5173,") == [
            "http://192.168.1.50:5173"
        ]
