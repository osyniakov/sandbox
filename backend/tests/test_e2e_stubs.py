"""Tests for the E2E_STUB_PROVIDERS-gated stub providers in app/e2e_stubs.py.

Exercises the *actual* no-arg service-construction defaults in
``app/pipeline.py`` (``run_pipeline`` / ``run_pipeline_with_new_session``,
reached here via the real ``POST /items`` endpoint and its background
task -- exactly the code path a real Playwright E2E test would run
against) with ``E2E_STUB_PROVIDERS`` set, rather than monkeypatching the
service classes directly (that's what ``tests/test_pipeline.py`` already
covers). This is what actually proves the env-var wiring itself works,
end to end, with zero real network calls.

Unlike ``tests/test_pipeline.py``, this file does NOT monkeypatch
``pipeline_module.ItemIdentificationService`` /
``ComparableListingSearchService`` / ``ListingTextService`` -- it lets
``run_pipeline`` construct its own defaults, gated purely by the
``E2E_STUB_PROVIDERS`` env var (plus a couple of ``E2E_STUB_*``
configuration env vars), matching how a real E2E test would configure a
backend process before starting it.
"""

from __future__ import annotations

import io
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from PIL import Image

import app.main as main_module
from app.db import get_session, make_engine, make_session_factory
from app.main import app
from app.models import Decision, Item, ItemStatus


def _make_jpeg_bytes() -> bytes:
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
    return make_session_factory(main_module.engine)


def _upload(
    client: TestClient, auth_headers: dict[str, str], *, hint: str | None = None
) -> dict[str, Any]:
    data = {"hint": hint} if hint is not None else {}
    response = client.post(
        "/items",
        files={"photo": ("lamp.jpg", _make_jpeg_bytes(), "image/jpeg")},
        data=data,
        headers=auth_headers,
    )
    assert response.status_code == 201
    return response.json()


def test_stub_providers_drive_pipeline_to_decided_with_configured_values(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    auth_headers: dict[str, str],
    db_session_factory,
) -> None:
    """With E2E_STUB_PROVIDERS set, the real pipeline reaches `decided`
    using ONLY the deterministic fakes -- no real network/API calls -- and
    the resulting fields match the E2E_STUB_* env vars, including the
    user-provided hint being reflected in the identification result.
    """
    monkeypatch.setenv("E2E_STUB_PROVIDERS", "1")
    monkeypatch.setenv("E2E_STUB_IDENTIFIED_NAME", "Retro Toaster")
    monkeypatch.setenv("E2E_STUB_CATEGORY", "kitchen")
    monkeypatch.setenv("E2E_STUB_CONDITION", "good")
    # median([12, 18, 25]) == 18.0, above the default EUR10 SELL_THRESHOLD
    # -> SELL. This also confirms app.pricing's SELL_THRESHOLD logic is
    # left completely unchanged: only the comparable-listing *inputs* are
    # faked, not the decision itself.
    monkeypatch.setenv("E2E_STUB_COMPARABLE_PRICES", "12,18,25")

    created = _upload(client, auth_headers, hint="it's a broken-ish toaster from the 70s")
    item_id = created["id"]

    session = db_session_factory()
    try:
        item = session.get(Item, item_id)
        assert item is not None

        # Reached the terminal `decided` status purely off of stubbed
        # providers -- no real network call could have succeeded inside
        # this sandboxed test run, so this is itself evidence no real
        # Claude/Kleinanzeigen call happened.
        assert item.status == ItemStatus.DECIDED

        # Identification result matches the configured env vars.
        assert item.identified_name == "Retro Toaster"
        assert item.category == "kitchen"
        assert item.condition == "good"

        # The hint is demonstrably reflected in the stubbed identification
        # output (echoed into search_keywords, per app/e2e_stubs.py).
        assert item.search_keywords is not None
        assert any(
            kw == "hint:it's a broken-ish toaster from the 70s" for kw in item.search_keywords
        )

        # Comparable-search + pricing used the configured stub prices via
        # the real, unchanged pricing logic.
        assert item.suggested_price == 18.0
        assert item.decision == Decision.SELL
        assert len(item.comparable_listings) == 3
        assert {cl.price for cl in item.comparable_listings} == {12.0, 18.0, 25.0}

        # Listing text was generated (fixed, non-empty German stub text) in
        # the same commit as the SELL decision.
        assert item.suggested_title
        assert item.suggested_description
    finally:
        session.close()


def test_stub_providers_default_values_when_config_env_vars_unset(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    auth_headers: dict[str, str],
    db_session_factory,
) -> None:
    """With only E2E_STUB_PROVIDERS set (no other E2E_STUB_* config vars),
    the stub providers fall back to their documented hardcoded defaults.
    """
    monkeypatch.setenv("E2E_STUB_PROVIDERS", "1")

    created = _upload(client, auth_headers)
    item_id = created["id"]

    session = db_session_factory()
    try:
        item = session.get(Item, item_id)
        assert item is not None
        assert item.status == ItemStatus.DECIDED
        assert item.identified_name == "Test Item"
        assert item.category == "misc"
        assert item.condition == "good"
        # No hint was provided this time -- search_keywords must not
        # contain a "hint:" marker.
        assert item.search_keywords is not None
        assert not any(kw.startswith("hint:") for kw in item.search_keywords)
        # Default stub comparable prices: median([12, 18, 25]) == 18.0.
        assert item.suggested_price == 18.0
        assert item.decision == Decision.SELL
    finally:
        session.close()
