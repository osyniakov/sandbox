"""Integration tests: POST /items -> full pipeline -> GET /items/{id}.

Exercises the wiring in ``app/pipeline.py`` end-to-end through the real
HTTP endpoints, with the identification and comparable-search *services*
replaced by fakes (monkeypatched onto ``app.pipeline``) so no real
LLM/Kleinanzeigen network calls ever happen. The pricing/decision service
is left real (it has no external dependency, per its own module
docstring) so these tests also verify the genuine end-to-end
``suggested_price``/``decision`` computation.

Reuses the ``client``/``db_session_factory`` fixture pattern from
``test_items_upload.py`` (own temp SQLite DB + own temp uploads dir per
test, via ``tmp_path`` + monkeypatching ``app.main.engine`` /
``app.main.UPLOAD_DIR``).

Note on background-task execution: ``app/pipeline.py`` documents the
choice to run the pipeline as a FastAPI ``BackgroundTask`` rather than
inline in the upload request. Starlette's ``TestClient`` runs background
tasks to completion as part of the same ASGI request/response cycle
*before* ``client.post(...)`` returns control to the test (verified
against Starlette's ``BackgroundTask`` + ``TestClient`` implementation),
so these tests can assert on pipeline results immediately after the
upload call returns -- no polling loop or sleep needed here, even though
a real client talking to a real server would need to poll
``GET /items/{id}``.
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
import app.pipeline as pipeline_module
from app.db import get_session, make_engine, make_session_factory
from app.main import app
from app.models import ComparableListing, Decision, Item, ItemStatus


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


def _upload(client: TestClient) -> dict[str, Any]:
    response = client.post(
        "/items",
        files={"photo": ("lamp.jpg", _make_jpeg_bytes(), "image/jpeg")},
    )
    assert response.status_code == 201
    return response.json()


# ---------------------------------------------------------------------------
# Fakes for identification / search (never touch the real network)
# ---------------------------------------------------------------------------


class FakeIdentificationService:
    """Always succeeds, mimicking a confident vision-model response."""

    def identify_item(self, item: Item) -> bool:
        item.identified_name = "IKEA desk lamp"
        item.category = "lighting"
        item.brand = "IKEA"
        item.condition = "good"
        item.search_keywords = ["ikea", "desk lamp"]
        item.status = ItemStatus.PENDING_SEARCH
        return True


class FailingIdentificationService:
    def identify_item(self, item: Item) -> bool:
        return False


class FakeSearchServiceWithResults:
    """Always succeeds with a couple of comparable listings."""

    def search_item(self, item: Item) -> bool:
        item.comparable_listings = [
            ComparableListing(
                title="IKEA desk lamp, used",
                price=15.0,
                url="https://kleinanzeigen.example/1",
                condition="good",
                location="Berlin",
            ),
            ComparableListing(
                title="IKEA lamp, working",
                price=25.0,
                url="https://kleinanzeigen.example/2",
                condition="fair",
                location="Munich",
            ),
        ]
        item.status = ItemStatus.PENDING_DECISION
        return True


class FailingSearchService:
    """Always fails (both attempts exhausted), per the real service's contract."""

    def search_item(self, item: Item) -> bool:
        return False


class SpyPricingService:
    """Wraps the real ``PricingDecisionService`` but records whether it ran."""

    def __init__(self) -> None:
        from app.pricing import PricingDecisionService

        self._real = PricingDecisionService()
        self.called = False

    def decide_item(self, item: Item):
        self.called = True
        return self._real.decide_item(item)


# ---------------------------------------------------------------------------
# Happy path: full pipeline reaches `decided`
# ---------------------------------------------------------------------------


def test_full_pipeline_reaches_decided_with_populated_fields(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(pipeline_module, "ItemIdentificationService", FakeIdentificationService)
    monkeypatch.setattr(pipeline_module, "ComparableListingSearchService", FakeSearchServiceWithResults)

    created = _upload(client)
    item_id = created["id"]

    response = client.get(f"/items/{item_id}")
    assert response.status_code == 200
    body = response.json()

    assert body["status"] == "decided"
    assert body["identified_name"] == "IKEA desk lamp"
    assert body["category"] == "lighting"
    assert body["brand"] == "IKEA"
    assert body["condition"] == "good"
    assert body["search_keywords"] == ["ikea", "desk lamp"]

    # median([15.0, 25.0]) == 20.0, above the default EUR10 SELL_THRESHOLD.
    assert body["suggested_price"] == 20.0
    assert body["decision"] == Decision.SELL.value

    listings = body["comparable_listings"]
    assert len(listings) == 2
    titles = {listing["title"] for listing in listings}
    assert titles == {"IKEA desk lamp, used", "IKEA lamp, working"}
    for listing in listings:
        assert listing["price"] in (15.0, 25.0)
        assert listing["url"].startswith("https://kleinanzeigen.example/")
        assert listing["condition"] in ("good", "fair")
        assert listing["location"] in ("Berlin", "Munich")


def test_full_pipeline_zero_comparables_still_reaches_decided(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    class FakeSearchServiceZeroResults:
        def search_item(self, item: Item) -> bool:
            item.comparable_listings = []
            item.status = ItemStatus.PENDING_DECISION
            return True

    monkeypatch.setattr(pipeline_module, "ItemIdentificationService", FakeIdentificationService)
    monkeypatch.setattr(pipeline_module, "ComparableListingSearchService", FakeSearchServiceZeroResults)

    created = _upload(client)
    item_id = created["id"]

    response = client.get(f"/items/{item_id}")
    assert response.status_code == 200
    body = response.json()

    # Zero comparables is not a failure: pipeline still reaches `decided`.
    assert body["status"] == "decided"
    assert body["comparable_listings"] == []
    # No market signal at all -> throw_away, per app/pricing.py's documented
    # boundary rule 2.
    assert body["decision"] == Decision.THROW_AWAY.value
    assert body["suggested_price"] is None


# ---------------------------------------------------------------------------
# Stage-failure edge cases: GET /items/{id} must still return 200
# ---------------------------------------------------------------------------


def test_identification_failure_leaves_item_pending_identification(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(pipeline_module, "ItemIdentificationService", FailingIdentificationService)
    # Search/pricing should never even be reached; make sure of that too.
    search_spy = {"called": False}

    class UnreachableSearchService:
        def search_item(self, item: Item) -> bool:
            search_spy["called"] = True
            return True

    monkeypatch.setattr(pipeline_module, "ComparableListingSearchService", UnreachableSearchService)

    created = _upload(client)
    item_id = created["id"]

    response = client.get(f"/items/{item_id}")
    assert response.status_code == 200
    body = response.json()

    assert body["status"] == "pending_identification"
    assert body["identified_name"] is None
    assert body["decision"] == Decision.PENDING.value
    assert body["suggested_price"] is None
    assert body["comparable_listings"] == []
    assert search_spy["called"] is False


def test_search_failure_leaves_item_pending_search_and_skips_decision(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(pipeline_module, "ItemIdentificationService", FakeIdentificationService)
    monkeypatch.setattr(pipeline_module, "ComparableListingSearchService", FailingSearchService)

    spy = SpyPricingService()
    monkeypatch.setattr(pipeline_module, "PricingDecisionService", lambda: spy)

    created = _upload(client)
    item_id = created["id"]

    response = client.get(f"/items/{item_id}")
    assert response.status_code == 200
    body = response.json()

    # Search failed -> status stuck at pending_search, not a 500.
    assert body["status"] == "pending_search"
    # Identification did succeed and persisted (mandatory requirement #1:
    # identify_item's results are committed even though the pipeline halts
    # at the next stage).
    assert body["identified_name"] == "IKEA desk lamp"
    # Mandatory requirement #2: decide_item must NOT have been called.
    assert spy.called is False
    assert body["decision"] == Decision.PENDING.value
    assert body["suggested_price"] is None
    assert body["comparable_listings"] == []


# ---------------------------------------------------------------------------
# GET /items/{id} basics
# ---------------------------------------------------------------------------


def test_get_item_404_for_unknown_id(client: TestClient) -> None:
    response = client.get("/items/999999")
    assert response.status_code == 404


def test_get_item_returns_all_documented_fields(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(pipeline_module, "ItemIdentificationService", FakeIdentificationService)
    monkeypatch.setattr(pipeline_module, "ComparableListingSearchService", FakeSearchServiceWithResults)

    created = _upload(client)
    item_id = created["id"]

    response = client.get(f"/items/{item_id}")
    assert response.status_code == 200
    body = response.json()

    expected_keys = {
        "id",
        "photo_path",
        "identified_name",
        "category",
        "brand",
        "condition",
        "search_keywords",
        "suggested_price",
        "decision",
        "status",
        "created_at",
        "updated_at",
        "comparable_listings",
    }
    assert expected_keys.issubset(body.keys())
    assert body["id"] == item_id
    assert isinstance(body["created_at"], str)
    assert isinstance(body["updated_at"], str)
