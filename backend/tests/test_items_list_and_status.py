"""Integration tests for ``GET /items`` (list + filter) and
``PATCH /items/{id}/status`` (manual status transitions).

Uses the same throwaway-SQLite-DB ``client``/``db_session_factory``
fixture pattern as ``test_items_upload.py`` (see that module's docstring
for why), but creates ``Item`` rows directly against the DB session
rather than via ``POST /items`` -- these tests care about pre-existing
items at specific status/decision combinations, not about exercising the
upload + background pipeline flow.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

import app.main as main_module
from app.db import get_session, make_engine, make_session_factory
from app.main import MANUAL_STATUS_TRANSITIONS, app
from app.models import ComparableListing, Decision, Item, ItemStatus


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


def _make_item(
    db_session_factory,
    *,
    status: ItemStatus,
    decision: Decision = Decision.PENDING,
    identified_name: str | None = None,
    user_hint: str | None = None,
    suggested_title: str | None = None,
    suggested_description: str | None = None,
) -> int:
    session = db_session_factory()
    try:
        item = Item(
            photo_path="/x/uploads/fake.jpg",
            status=status,
            decision=decision,
            identified_name=identified_name,
            user_hint=user_hint,
            suggested_title=suggested_title,
            suggested_description=suggested_description,
        )
        session.add(item)
        session.commit()
        session.refresh(item)
        return item.id
    finally:
        session.close()


# ---------------------------------------------------------------------------
# Auth gate: no session -> 401 (sandbox-dfr.3)
# ---------------------------------------------------------------------------


def test_list_items_missing_authorization_header_rejected_with_401(
    client: TestClient,
) -> None:
    response = client.get("/items")
    assert response.status_code == 401


def test_get_item_missing_authorization_header_rejected_with_401(
    client: TestClient, db_session_factory
) -> None:
    item_id = _make_item(
        db_session_factory, status=ItemStatus.PENDING_IDENTIFICATION
    )

    response = client.get(f"/items/{item_id}")

    assert response.status_code == 401


def test_patch_status_missing_authorization_header_rejected_with_401_and_no_side_effect(
    client: TestClient, db_session_factory
) -> None:
    """PATCH /items/{id}/status without a valid session must be rejected
    401 -- and, critically, the item's status must be left unchanged."""
    item_id = _make_item(db_session_factory, status=ItemStatus.DECIDED)

    response = client.patch(f"/items/{item_id}/status", json={"status": "listed"})

    assert response.status_code == 401

    session = db_session_factory()
    try:
        item = session.get(Item, item_id)
        assert item is not None
        assert item.status == ItemStatus.DECIDED
    finally:
        session.close()


# ---------------------------------------------------------------------------
# GET /items -- listing + filtering
# ---------------------------------------------------------------------------


def test_list_items_returns_all_items_with_full_serialized_shape(
    client: TestClient, db_session_factory, auth_headers: dict[str, str]
) -> None:
    id1 = _make_item(
        db_session_factory,
        status=ItemStatus.DECIDED,
        decision=Decision.SELL,
        identified_name="Drill",
        user_hint="Bosch drill, orange casing",
    )
    id2 = _make_item(
        db_session_factory,
        status=ItemStatus.PENDING_SEARCH,
        decision=Decision.PENDING,
        identified_name="Lamp",
    )

    response = client.get("/items", headers=auth_headers)

    assert response.status_code == 200
    body = response.json()
    assert [item["id"] for item in body] == sorted([id1, id2])
    for item in body:
        assert "photo_url" in item
        assert "comparable_listings" in item
        assert "decision" in item
        assert "status" in item
        assert "hint" in item
        assert "suggested_title" in item
        assert "suggested_description" in item

    by_id = {item["id"]: item for item in body}
    assert by_id[id1]["hint"] == "Bosch drill, orange casing"
    assert by_id[id2]["hint"] is None


def test_list_items_empty_when_no_items(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.get("/items", headers=auth_headers)
    assert response.status_code == 200
    assert response.json() == []


def test_list_items_filter_by_status(
    client: TestClient, db_session_factory, auth_headers: dict[str, str]
) -> None:
    decided_id = _make_item(db_session_factory, status=ItemStatus.DECIDED)
    _make_item(db_session_factory, status=ItemStatus.PENDING_SEARCH)
    _make_item(db_session_factory, status=ItemStatus.LISTED)

    response = client.get("/items", params={"status": "decided"}, headers=auth_headers)

    assert response.status_code == 200
    body = response.json()
    assert [item["id"] for item in body] == [decided_id]


def test_list_items_filter_by_decision(
    client: TestClient, db_session_factory, auth_headers: dict[str, str]
) -> None:
    sell_id = _make_item(
        db_session_factory, status=ItemStatus.DECIDED, decision=Decision.SELL
    )
    _make_item(
        db_session_factory, status=ItemStatus.DECIDED, decision=Decision.GIVE_AWAY
    )
    _make_item(
        db_session_factory, status=ItemStatus.DECIDED, decision=Decision.THROW_AWAY
    )

    response = client.get("/items", params={"decision": "sell"}, headers=auth_headers)

    assert response.status_code == 200
    body = response.json()
    assert [item["id"] for item in body] == [sell_id]


def test_list_items_filter_by_status_and_decision_together(
    client: TestClient, db_session_factory, auth_headers: dict[str, str]
) -> None:
    match_id = _make_item(
        db_session_factory, status=ItemStatus.DECIDED, decision=Decision.SELL
    )
    # Same status, different decision -- should not match.
    _make_item(
        db_session_factory, status=ItemStatus.DECIDED, decision=Decision.GIVE_AWAY
    )
    # Same decision, different status -- should not match.
    _make_item(
        db_session_factory, status=ItemStatus.LISTED, decision=Decision.SELL
    )

    response = client.get("/items", params={"status": "decided", "decision": "sell"}, headers=auth_headers)

    assert response.status_code == 200
    body = response.json()
    assert [item["id"] for item in body] == [match_id]


def test_list_items_no_filters_returns_everything(
    client: TestClient, db_session_factory, auth_headers: dict[str, str]
) -> None:
    ids = [
        _make_item(db_session_factory, status=ItemStatus.PENDING_IDENTIFICATION),
        _make_item(db_session_factory, status=ItemStatus.DECIDED, decision=Decision.SELL),
        _make_item(db_session_factory, status=ItemStatus.DISPOSED, decision=Decision.THROW_AWAY),
    ]

    response = client.get("/items", headers=auth_headers)

    assert response.status_code == 200
    body = response.json()
    assert sorted(item["id"] for item in body) == sorted(ids)


def test_list_items_invalid_status_filter_returns_422(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.get("/items", params={"status": "not_a_real_status"}, headers=auth_headers)
    assert response.status_code == 422


# ---------------------------------------------------------------------------
# ``hint`` -- serialized from ``Item.user_hint`` (sandbox-iec.4)
# ---------------------------------------------------------------------------


def test_get_item_includes_hint_when_set(
    client: TestClient, db_session_factory, auth_headers: dict[str, str]
) -> None:
    item_id = _make_item(
        db_session_factory,
        status=ItemStatus.PENDING_IDENTIFICATION,
        user_hint="Bosch drill, orange casing",
    )

    response = client.get(f"/items/{item_id}", headers=auth_headers)

    assert response.status_code == 200
    assert response.json()["hint"] == "Bosch drill, orange casing"


def test_get_item_hint_is_none_when_not_set(
    client: TestClient, db_session_factory, auth_headers: dict[str, str]
) -> None:
    item_id = _make_item(db_session_factory, status=ItemStatus.PENDING_IDENTIFICATION)

    response = client.get(f"/items/{item_id}", headers=auth_headers)

    assert response.status_code == 200
    assert response.json()["hint"] is None


# ---------------------------------------------------------------------------
# ``suggested_title``/``suggested_description`` -- serialized from
# ``Item.suggested_title``/``Item.suggested_description`` (sandbox-dwl.4)
# ---------------------------------------------------------------------------


def test_get_item_includes_suggested_title_and_description_when_set(
    client: TestClient, db_session_factory, auth_headers: dict[str, str]
) -> None:
    item_id = _make_item(
        db_session_factory,
        status=ItemStatus.DECIDED,
        decision=Decision.SELL,
        suggested_title="Bosch Cordless Drill, Orange",
        suggested_description="Lightly used cordless drill, works great.",
    )

    response = client.get(f"/items/{item_id}", headers=auth_headers)

    assert response.status_code == 200
    body = response.json()
    assert body["suggested_title"] == "Bosch Cordless Drill, Orange"
    assert body["suggested_description"] == "Lightly used cordless drill, works great."


def test_get_item_suggested_title_and_description_are_none_when_not_set(
    client: TestClient, db_session_factory, auth_headers: dict[str, str]
) -> None:
    item_id = _make_item(
        db_session_factory,
        status=ItemStatus.DECIDED,
        decision=Decision.THROW_AWAY,
    )

    response = client.get(f"/items/{item_id}", headers=auth_headers)

    assert response.status_code == 200
    body = response.json()
    assert body["suggested_title"] is None
    assert body["suggested_description"] is None


def test_list_items_includes_suggested_title_and_description(
    client: TestClient, db_session_factory, auth_headers: dict[str, str]
) -> None:
    id1 = _make_item(
        db_session_factory,
        status=ItemStatus.DECIDED,
        decision=Decision.SELL,
        suggested_title="Bosch Cordless Drill, Orange",
        suggested_description="Lightly used cordless drill, works great.",
    )
    id2 = _make_item(
        db_session_factory,
        status=ItemStatus.DECIDED,
        decision=Decision.THROW_AWAY,
    )

    response = client.get("/items", headers=auth_headers)

    assert response.status_code == 200
    by_id = {item["id"]: item for item in response.json()}
    assert by_id[id1]["suggested_title"] == "Bosch Cordless Drill, Orange"
    assert by_id[id1]["suggested_description"] == "Lightly used cordless drill, works great."
    assert by_id[id2]["suggested_title"] is None
    assert by_id[id2]["suggested_description"] is None


# ---------------------------------------------------------------------------
# ``valid_next_statuses`` -- server-derived from MANUAL_STATUS_TRANSITIONS
# (sandbox-yqf.21: this is the single source of truth the frontend must
# read instead of maintaining its own duplicate copy of the transition
# table).
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "status",
    [
        ItemStatus.PENDING_IDENTIFICATION,
        ItemStatus.PENDING_SEARCH,
        ItemStatus.PENDING_DECISION,
        ItemStatus.DECIDED,
        ItemStatus.LISTED,
        ItemStatus.GIVEN_AWAY,
        ItemStatus.DISPOSED,
    ],
)
def test_get_item_valid_next_statuses_matches_transition_table(
    client: TestClient, db_session_factory, status: ItemStatus, auth_headers: dict[str, str]
) -> None:
    item_id = _make_item(db_session_factory, status=status)
    expected = sorted(s.value for s in MANUAL_STATUS_TRANSITIONS[status])

    response = client.get(f"/items/{item_id}", headers=auth_headers)

    assert response.status_code == 200
    assert response.json()["valid_next_statuses"] == expected


@pytest.mark.parametrize(
    "status",
    [
        ItemStatus.PENDING_IDENTIFICATION,
        ItemStatus.PENDING_SEARCH,
        ItemStatus.PENDING_DECISION,
        ItemStatus.DECIDED,
        ItemStatus.LISTED,
        ItemStatus.GIVEN_AWAY,
        ItemStatus.DISPOSED,
    ],
)
def test_list_items_valid_next_statuses_matches_transition_table(
    client: TestClient, db_session_factory, status: ItemStatus, auth_headers: dict[str, str]
) -> None:
    item_id = _make_item(db_session_factory, status=status)
    expected = sorted(s.value for s in MANUAL_STATUS_TRANSITIONS[status])

    response = client.get("/items", headers=auth_headers)

    assert response.status_code == 200
    body = response.json()
    (item,) = [i for i in body if i["id"] == item_id]
    assert item["valid_next_statuses"] == expected


def test_pending_statuses_have_empty_valid_next_statuses(
    client: TestClient, db_session_factory, auth_headers: dict[str, str]
) -> None:
    for status in (
        ItemStatus.PENDING_IDENTIFICATION,
        ItemStatus.PENDING_SEARCH,
        ItemStatus.PENDING_DECISION,
    ):
        item_id = _make_item(db_session_factory, status=status)
        response = client.get(f"/items/{item_id}", headers=auth_headers)
        assert response.json()["valid_next_statuses"] == []


def test_decided_valid_next_statuses_is_listed_given_away_disposed(
    client: TestClient, db_session_factory, auth_headers: dict[str, str]
) -> None:
    item_id = _make_item(db_session_factory, status=ItemStatus.DECIDED)
    response = client.get(f"/items/{item_id}", headers=auth_headers)
    assert response.json()["valid_next_statuses"] == [
        "disposed",
        "given_away",
        "listed",
    ]


# ---------------------------------------------------------------------------
# ``comparable_listings`` -- new-condition listings hidden from the
# serialized response (sandbox-yjz, follow-up to sandbox-igd.1's pricing-
# only exclusion). Presentation-layer only: the underlying
# ``ComparableListing`` DB rows (and the pricing/decision calculation,
# already covered by test_pricing.py) must never be touched by this
# filtering.
# ---------------------------------------------------------------------------


def test_get_item_excludes_new_condition_listing_from_comparable_listings(
    client: TestClient, db_session_factory, auth_headers: dict[str, str]
) -> None:
    item_id = _make_item(
        db_session_factory, status=ItemStatus.DECIDED, decision=Decision.SELL
    )
    session = db_session_factory()
    try:
        item = session.get(Item, item_id)
        item.comparable_listings.append(
            ComparableListing(
                title="Used Drill",
                price=19.99,
                url="https://example.com/listing/used",
                condition="used",
            )
        )
        item.comparable_listings.append(
            ComparableListing(
                title="Bosch Akkuschrauber NEU",
                price=40.0,
                url="https://example.com/listing/new",
                condition="new",
            )
        )
        session.commit()
    finally:
        session.close()

    response = client.get(f"/items/{item_id}", headers=auth_headers)

    assert response.status_code == 200
    body = response.json()
    titles = [listing["title"] for listing in body["comparable_listings"]]
    assert titles == ["Used Drill"]


def test_get_item_does_not_exclude_wie_neu_or_neuwertig_listings(
    client: TestClient, db_session_factory, auth_headers: dict[str, str]
) -> None:
    """"wie neu"/"neuwertig" is a used-but-excellent-condition tier, not
    "brand new" -- it must remain in the serialized comparable_listings
    (same negative case rigor as sandbox-igd.1's own pricing tests)."""
    item_id = _make_item(
        db_session_factory, status=ItemStatus.DECIDED, decision=Decision.SELL
    )
    session = db_session_factory()
    try:
        item = session.get(Item, item_id)
        item.comparable_listings.append(
            ComparableListing(
                title="Wie Neu Drill",
                price=29.99,
                url="https://example.com/listing/wie-neu",
                condition="wie neu",
            )
        )
        item.comparable_listings.append(
            ComparableListing(
                title="Neuwertig Drill",
                price=27.5,
                url="https://example.com/listing/neuwertig",
                condition="neuwertig",
            )
        )
        session.commit()
    finally:
        session.close()

    response = client.get(f"/items/{item_id}", headers=auth_headers)

    assert response.status_code == 200
    body = response.json()
    titles = {listing["title"] for listing in body["comparable_listings"]}
    assert titles == {"Wie Neu Drill", "Neuwertig Drill"}


def test_get_item_falls_back_to_full_list_when_all_comparable_listings_are_new(
    client: TestClient, db_session_factory, auth_headers: dict[str, str]
) -> None:
    """If literally every comparable listing found is new-condition,
    filtering them all out would leave an empty array -- fall back to
    showing the full unfiltered list instead (same graceful-degradation
    philosophy as ``_median_price``'s own fallback in app/pricing.py)."""
    item_id = _make_item(
        db_session_factory, status=ItemStatus.DECIDED, decision=Decision.SELL
    )
    session = db_session_factory()
    try:
        item = session.get(Item, item_id)
        item.comparable_listings.append(
            ComparableListing(
                title="New Drill One",
                price=40.0,
                url="https://example.com/listing/new1",
                condition="neu",
            )
        )
        item.comparable_listings.append(
            ComparableListing(
                title="New Drill Two",
                price=45.0,
                url="https://example.com/listing/new2",
                condition="brand new",
            )
        )
        session.commit()
    finally:
        session.close()

    response = client.get(f"/items/{item_id}", headers=auth_headers)

    assert response.status_code == 200
    body = response.json()
    titles = {listing["title"] for listing in body["comparable_listings"]}
    assert titles == {"New Drill One", "New Drill Two"}


def test_get_item_new_condition_filtering_does_not_delete_underlying_db_rows(
    client: TestClient, db_session_factory, auth_headers: dict[str, str]
) -> None:
    """The most important negative case: filtering new-condition listings
    out of the serialized response must NOT reassign/mutate
    ``item.comparable_listings`` (which has
    ``cascade="all, delete-orphan"`` -- reassigning it would actually
    DELETE rows from the DB). Confirmed here by querying the DB directly,
    via a fresh session, after the request that triggers the filtering."""
    item_id = _make_item(
        db_session_factory, status=ItemStatus.DECIDED, decision=Decision.SELL
    )
    session = db_session_factory()
    try:
        item = session.get(Item, item_id)
        item.comparable_listings.append(
            ComparableListing(
                title="Used Drill",
                price=19.99,
                url="https://example.com/listing/used",
                condition="used",
            )
        )
        item.comparable_listings.append(
            ComparableListing(
                title="Bosch Akkuschrauber NEU",
                price=40.0,
                url="https://example.com/listing/new",
                condition="new",
            )
        )
        session.commit()
    finally:
        session.close()

    response = client.get(f"/items/{item_id}", headers=auth_headers)
    assert response.status_code == 200
    # Sanity: the response did indeed filter the new-condition listing out.
    body = response.json()
    assert len(body["comparable_listings"]) == 1

    # But the underlying DB rows for BOTH listings (including the excluded
    # new-condition one) must still exist untouched.
    fresh_session = db_session_factory()
    try:
        remaining_listings = (
            fresh_session.query(ComparableListing)
            .filter(ComparableListing.item_id == item_id)
            .all()
        )
        assert len(remaining_listings) == 2
        titles = {listing.title for listing in remaining_listings}
        assert titles == {"Used Drill", "Bosch Akkuschrauber NEU"}
    finally:
        fresh_session.close()


# ---------------------------------------------------------------------------
# PATCH /items/{id}/status -- valid transitions
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "target",
    ["listed", "given_away", "disposed"],
)
def test_decided_item_can_transition_to_any_manual_target(
    client: TestClient, db_session_factory, target: str, auth_headers: dict[str, str]
) -> None:
    item_id = _make_item(
        db_session_factory, status=ItemStatus.DECIDED, decision=Decision.SELL
    )

    response = client.patch(f"/items/{item_id}/status", json={"status": target}, headers=auth_headers)

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == target


def test_decided_item_can_transition_to_disposed_even_when_decision_is_sell(
    client: TestClient, db_session_factory, auth_headers: dict[str, str]
) -> None:
    """The target status doesn't need to match Item.decision -- the user
    is free to override the app's recommendation (see the
    MANUAL_STATUS_TRANSITIONS docstring in app/main.py)."""
    item_id = _make_item(
        db_session_factory, status=ItemStatus.DECIDED, decision=Decision.SELL
    )

    response = client.patch(f"/items/{item_id}/status", json={"status": "disposed"}, headers=auth_headers)

    assert response.status_code == 200
    assert response.json()["status"] == "disposed"


@pytest.mark.parametrize(
    "start,target",
    [
        ("listed", "given_away"),
        ("listed", "disposed"),
        ("given_away", "listed"),
        ("given_away", "disposed"),
        ("disposed", "listed"),
        ("disposed", "given_away"),
    ],
)
def test_post_action_statuses_can_move_between_each_other(
    client: TestClient, db_session_factory, start: str, target: str, auth_headers: dict[str, str]
) -> None:
    item_id = _make_item(db_session_factory, status=ItemStatus(start))

    response = client.patch(f"/items/{item_id}/status", json={"status": target}, headers=auth_headers)

    assert response.status_code == 200
    assert response.json()["status"] == target


# ---------------------------------------------------------------------------
# PATCH /items/{id}/status -- invalid transitions (the bead's core edge case)
# ---------------------------------------------------------------------------


def test_pending_identification_to_disposed_is_rejected_with_400(
    client: TestClient, db_session_factory, auth_headers: dict[str, str]
) -> None:
    """The bead's explicit edge-case example: jumping straight from
    pending_identification to disposed must be rejected."""
    item_id = _make_item(db_session_factory, status=ItemStatus.PENDING_IDENTIFICATION)

    response = client.patch(f"/items/{item_id}/status", json={"status": "disposed"}, headers=auth_headers)

    assert response.status_code == 400
    detail = response.json()["detail"]
    assert "pending_identification" in detail
    assert "disposed" in detail


@pytest.mark.parametrize(
    "start_status",
    ["pending_identification", "pending_search", "pending_decision"],
)
@pytest.mark.parametrize("target", ["listed", "given_away", "disposed"])
def test_pending_statuses_reject_all_manual_targets(
    client: TestClient, db_session_factory, start_status: str, target: str, auth_headers: dict[str, str]
) -> None:
    item_id = _make_item(db_session_factory, status=ItemStatus(start_status))

    response = client.patch(f"/items/{item_id}/status", json={"status": target}, headers=auth_headers)

    assert response.status_code == 400
    detail = response.json()["detail"]
    assert start_status in detail
    # No valid next states from a pending status.
    assert "none" in detail.lower()


def test_decided_cannot_transition_back_to_pending_or_itself(
    client: TestClient, db_session_factory, auth_headers: dict[str, str]
) -> None:
    item_id = _make_item(db_session_factory, status=ItemStatus.DECIDED)

    response = client.patch(
        f"/items/{item_id}/status",
        json={"status": "pending_search"},
        headers=auth_headers,
    )

    assert response.status_code == 400
    detail = response.json()["detail"]
    assert "decided" in detail
    assert "listed" in detail
    assert "given_away" in detail
    assert "disposed" in detail


def test_error_message_lists_current_status_and_valid_next_states(
    client: TestClient, db_session_factory, auth_headers: dict[str, str]
) -> None:
    item_id = _make_item(db_session_factory, status=ItemStatus.LISTED)

    response = client.patch(f"/items/{item_id}/status", json={"status": "decided"}, headers=auth_headers)

    assert response.status_code == 400
    detail = response.json()["detail"]
    # Current status named explicitly.
    assert "listed" in detail
    # Valid next states (given_away, disposed) named explicitly -- not a
    # generic "invalid transition" message.
    assert "given_away" in detail
    assert "disposed" in detail


def test_patch_status_on_missing_item_returns_404(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.patch("/items/999999/status", json={"status": "disposed"}, headers=auth_headers)
    assert response.status_code == 404


def test_patch_status_invalid_target_value_returns_422(
    client: TestClient, db_session_factory, auth_headers: dict[str, str]
) -> None:
    item_id = _make_item(db_session_factory, status=ItemStatus.DECIDED)

    response = client.patch(
        f"/items/{item_id}/status",
        json={"status": "not_a_real_status"},
        headers=auth_headers,
    )

    assert response.status_code == 422


# ---------------------------------------------------------------------------
# DELETE /items/{id} (sandbox-uii.1)
# ---------------------------------------------------------------------------
#
# Covers: successful delete (DB row gone, cascade-deleted
# comparable_listings gone, photo file removed from disk), 404 for a
# nonexistent item, 401 without auth, and the ``missing_ok=True``
# already-missing-photo-file case explicitly.


def _make_item_with_photo(
    db_session_factory,
    tmp_path: Path,
    *,
    status: ItemStatus = ItemStatus.DECIDED,
    create_photo_file: bool = True,
) -> tuple[int, Path]:
    """Like ``_make_item``, but points ``photo_path`` at a real file under
    ``tmp_path`` (optionally actually creating it on disk) so delete tests
    can assert on real filesystem state rather than a fake path string."""
    photo_path = tmp_path / f"photo-{uuid4().hex}.jpg"
    if create_photo_file:
        photo_path.write_bytes(b"fake-jpeg-bytes")

    session = db_session_factory()
    try:
        item = Item(
            photo_path=str(photo_path),
            status=status,
        )
        session.add(item)
        session.commit()
        session.refresh(item)
        return item.id, photo_path
    finally:
        session.close()


def test_delete_item_missing_authorization_header_rejected_with_401_and_no_side_effect(
    client: TestClient, db_session_factory, tmp_path: Path
) -> None:
    item_id, photo_path = _make_item_with_photo(db_session_factory, tmp_path)

    response = client.delete(f"/items/{item_id}")

    assert response.status_code == 401

    session = db_session_factory()
    try:
        item = session.get(Item, item_id)
        assert item is not None
    finally:
        session.close()
    assert photo_path.exists()


def test_delete_item_on_missing_item_returns_404(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.delete("/items/999999", headers=auth_headers)

    assert response.status_code == 404
    assert response.json()["detail"] == "No item with id 999999."


def test_delete_item_success_removes_row_cascade_listings_and_photo_file(
    client: TestClient, db_session_factory, tmp_path: Path, auth_headers: dict[str, str]
) -> None:
    item_id, photo_path = _make_item_with_photo(db_session_factory, tmp_path)

    # Attach comparable listings to the item, to confirm the cascade
    # actually deletes them (not just trusting the ORM config) rather than
    # e.g. leaving orphaned rows referencing a now-deleted item_id.
    session = db_session_factory()
    try:
        item = session.get(Item, item_id)
        item.comparable_listings.append(
            ComparableListing(
                title="Comparable Drill",
                price=19.99,
                url="https://example.com/listing/1",
            )
        )
        item.comparable_listings.append(
            ComparableListing(
                title="Another Comparable Drill",
                price=24.5,
                url="https://example.com/listing/2",
            )
        )
        session.commit()
    finally:
        session.close()

    response = client.delete(f"/items/{item_id}", headers=auth_headers)

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == item_id
    assert body["deleted"] is True

    # DB row is gone -- subsequent GET returns 404.
    get_response = client.get(f"/items/{item_id}", headers=auth_headers)
    assert get_response.status_code == 404

    # Cascade-deleted comparable_listings rows are gone too (queried
    # directly, not just trusted).
    session = db_session_factory()
    try:
        assert session.get(Item, item_id) is None
        remaining_listings = (
            session.query(ComparableListing)
            .filter(ComparableListing.item_id == item_id)
            .all()
        )
        assert remaining_listings == []
    finally:
        session.close()

    # The uploaded photo file is removed from disk.
    assert not photo_path.exists()


def test_delete_item_already_missing_photo_file_still_deletes_successfully(
    client: TestClient, db_session_factory, tmp_path: Path, auth_headers: dict[str, str]
) -> None:
    """Exercises ``Path.unlink(missing_ok=True)`` explicitly: a photo file
    that's already gone from disk (e.g. removed out-of-band) must not turn
    the delete into a 500 -- the item should still delete cleanly."""
    item_id, photo_path = _make_item_with_photo(
        db_session_factory, tmp_path, create_photo_file=False
    )
    assert not photo_path.exists()

    response = client.delete(f"/items/{item_id}", headers=auth_headers)

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == item_id
    assert body["deleted"] is True

    session = db_session_factory()
    try:
        assert session.get(Item, item_id) is None
    finally:
        session.close()
