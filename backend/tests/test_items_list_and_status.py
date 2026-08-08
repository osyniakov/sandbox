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

import pytest
from fastapi.testclient import TestClient

import app.main as main_module
from app.db import get_session, make_engine, make_session_factory
from app.main import MANUAL_STATUS_TRANSITIONS, app
from app.models import Decision, Item, ItemStatus


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
