"""Tests for the Item / ComparableListing persistence layer.

Each test gets its own throwaway SQLite DB (a fresh temp file, cleaned
up afterwards) so nothing touches the dev DB file used by the running
app.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, StatementError
from sqlalchemy.orm import Session

from app.db import init_db, make_engine, make_session_factory
from app.models import ComparableListing, Decision, Item, ItemStatus


@pytest.fixture()
def session(tmp_path: Path) -> Iterator[Session]:
    db_path = tmp_path / "test.db"
    engine = make_engine(f"sqlite:///{db_path}")
    init_db(engine)
    factory = make_session_factory(engine)
    db = factory()
    try:
        yield db
    finally:
        db.close()
        engine.dispose()
        # Belt-and-suspenders cleanup; tmp_path fixture also cleans this up.
        if db_path.exists():
            db_path.unlink()


def test_create_all_against_fresh_db_file(tmp_path: Path) -> None:
    """Running create_all() against a brand new empty DB file succeeds."""
    db_path = tmp_path / "fresh.db"
    assert not db_path.exists()

    engine = make_engine(f"sqlite:///{db_path}")
    init_db(engine)

    assert db_path.exists()
    engine.dispose()


def test_item_with_comparable_listings_round_trip(session: Session) -> None:
    item = Item(
        photo_path="/photos/lamp.jpg",
        identified_name="Desk Lamp",
        category="lighting",
        brand="IKEA",
        condition="used - good",
        search_keywords=["desk lamp", "ikea lamp", "table light"],
        suggested_price=12.50,
    )
    session.add(item)
    session.flush()

    listing_one = ComparableListing(
        item_id=item.id,
        title="IKEA desk lamp, works fine",
        price=10.0,
        url="https://kleinanzeigen.example/1",
        condition="used",
        location="Berlin",
    )
    listing_two = ComparableListing(
        item_id=item.id,
        title="Desk lamp IKEA silver",
        price=15.0,
        url="https://kleinanzeigen.example/2",
    )
    session.add_all([listing_one, listing_two])
    session.commit()

    session.expire_all()

    fetched = session.get(Item, item.id)
    assert fetched is not None
    assert fetched.photo_path == "/photos/lamp.jpg"
    assert fetched.identified_name == "Desk Lamp"
    assert fetched.decision == Decision.PENDING
    assert fetched.status == ItemStatus.PENDING_IDENTIFICATION
    assert fetched.created_at is not None
    assert fetched.updated_at is not None

    assert len(fetched.comparable_listings) == 2
    titles = {listing.title for listing in fetched.comparable_listings}
    assert titles == {
        "IKEA desk lamp, works fine",
        "Desk lamp IKEA silver",
    }
    for listing in fetched.comparable_listings:
        assert listing.item_id == item.id
        assert listing.fetched_at is not None


def test_search_keywords_round_trips_list_of_strings(session: Session) -> None:
    keywords = ["vintage chair", "wood chair", "mid century"]
    item = Item(photo_path="/photos/chair.jpg", search_keywords=keywords)
    session.add(item)
    session.commit()
    session.expire_all()

    fetched = session.get(Item, item.id)
    assert fetched is not None
    assert fetched.search_keywords == keywords
    assert isinstance(fetched.search_keywords, list)
    assert all(isinstance(kw, str) for kw in fetched.search_keywords)


def test_invalid_decision_value_rejected(session: Session) -> None:
    item = Item(photo_path="/photos/bad.jpg")
    item.decision = "not_a_real_value"  # type: ignore[assignment]
    session.add(item)
    with pytest.raises((StatementError, LookupError, ValueError)):
        session.commit()
    session.rollback()


def test_invalid_status_value_rejected(session: Session) -> None:
    item = Item(photo_path="/photos/bad2.jpg")
    item.status = "not_a_real_status"  # type: ignore[assignment]
    session.add(item)
    with pytest.raises((StatementError, LookupError, ValueError)):
        session.commit()
    session.rollback()


def test_default_decision_and_status(session: Session) -> None:
    item = Item(photo_path="/photos/default.jpg")
    session.add(item)
    session.commit()
    session.expire_all()

    fetched = session.get(Item, item.id)
    assert fetched is not None
    assert fetched.decision == Decision.PENDING
    assert fetched.status == ItemStatus.PENDING_IDENTIFICATION


def test_nullable_fields_default_to_none(session: Session) -> None:
    item = Item(photo_path="/photos/minimal.jpg")
    session.add(item)
    session.commit()
    session.expire_all()

    fetched = session.get(Item, item.id)
    assert fetched is not None
    assert fetched.identified_name is None
    assert fetched.category is None
    assert fetched.brand is None
    assert fetched.condition is None
    assert fetched.search_keywords is None
    assert fetched.suggested_price is None
    assert fetched.user_hint is None


def test_user_hint_round_trips_exact_string(session: Session) -> None:
    """sandbox-iec.1: ``user_hint`` is a free-text, nullable column.

    Verifies both the default-None case (covered above too) and that a
    supplied value round-trips byte-for-byte through a fresh
    ``session.get()`` after commit + expire.
    """
    hint = "some brand, I think"
    item = Item(photo_path="/photos/hint.jpg", user_hint=hint)
    session.add(item)
    session.commit()
    session.expire_all()

    fetched = session.get(Item, item.id)
    assert fetched is not None
    assert fetched.user_hint == hint


def test_suggested_title_and_description_round_trip(session: Session) -> None:
    """sandbox-dwl.1: ``suggested_title``/``suggested_description`` are
    free-text, nullable columns.

    Verifies both the default-None case and that supplied values round-trip
    byte-for-byte through a fresh ``session.get()`` after commit + expire.
    """
    item = Item(photo_path="/photos/no_suggestion.jpg")
    session.add(item)
    session.commit()
    session.expire_all()

    fetched = session.get(Item, item.id)
    assert fetched is not None
    assert fetched.suggested_title is None
    assert fetched.suggested_description is None

    title = "IKEA Desk Lamp - Silver, Works Great"
    description = "Barely used desk lamp, no scratches, comes with original bulb."
    item_with_suggestion = Item(
        photo_path="/photos/with_suggestion.jpg",
        suggested_title=title,
        suggested_description=description,
    )
    session.add(item_with_suggestion)
    session.commit()
    session.expire_all()

    fetched_with_suggestion = session.get(Item, item_with_suggestion.id)
    assert fetched_with_suggestion is not None
    assert fetched_with_suggestion.suggested_title == title
    assert fetched_with_suggestion.suggested_description == description


def test_comparable_listing_requires_valid_item_fk(session: Session) -> None:
    orphan = ComparableListing(
        item_id=999999,
        title="Orphan listing",
        price=5.0,
        url="https://kleinanzeigen.example/orphan",
    )
    session.add(orphan)
    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()


def test_enum_columns_store_lowercase_value_not_member_name(tmp_path: Path) -> None:
    """Regression test for sandbox-yqf.14 issue 1.

    ``Item.decision``/``Item.status`` must be persisted as the enum's
    ``.value`` (e.g. ``"sell"``, ``"pending_identification"``), not its
    Python member NAME (e.g. ``"SELL"``, ``"PENDING_IDENTIFICATION"``).
    Verified two ways: via raw ``sqlite3`` against the DB file directly,
    and via a raw SQL SELECT through the SQLAlchemy engine.
    """
    db_path = tmp_path / "enum_raw.db"
    engine = make_engine(f"sqlite:///{db_path}")
    init_db(engine)
    factory = make_session_factory(engine)
    db = factory()
    try:
        item = Item(
            photo_path="/photos/enum_check.jpg",
            decision=Decision.SELL,
            status=ItemStatus.PENDING_IDENTIFICATION,
        )
        db.add(item)
        db.commit()
        item_id = item.id
    finally:
        db.close()
    engine.dispose()

    # 1. Raw sqlite3, bypassing SQLAlchemy entirely.
    conn = sqlite3.connect(str(db_path))
    try:
        cursor = conn.execute(
            "SELECT decision, status FROM items WHERE id = ?", (item_id,)
        )
        raw_decision, raw_status = cursor.fetchone()
    finally:
        conn.close()

    assert raw_decision == "sell"
    assert raw_decision != "SELL"
    assert raw_status == "pending_identification"
    assert raw_status != "PENDING_IDENTIFICATION"

    # 2. Raw SQL through the SQLAlchemy engine, for good measure.
    engine2 = make_engine(f"sqlite:///{db_path}")
    with engine2.connect() as conn2:
        row = conn2.execute(
            text("SELECT decision, status FROM items WHERE id = :id"),
            {"id": item_id},
        ).one()
    engine2.dispose()

    assert row.decision == "sell"
    assert row.status == "pending_identification"


def test_price_columns_round_trip_as_python_float(session: Session) -> None:
    """Regression test for sandbox-yqf.14 issue 2.

    ``Item.suggested_price``/``ComparableListing.price`` are mapped as
    SQLAlchemy ``Float`` (see the "Money/price column type" docstring in
    ``app/models.py``), so reads must genuinely return Python ``float``,
    not ``decimal.Decimal``.
    """
    item = Item(photo_path="/photos/price_check.jpg", suggested_price=19.99)
    session.add(item)
    session.flush()

    listing = ComparableListing(
        item_id=item.id,
        title="Comparable listing",
        price=24.5,
        url="https://kleinanzeigen.example/price-check",
    )
    session.add(listing)
    session.commit()
    session.expire_all()

    fetched_item = session.get(Item, item.id)
    assert fetched_item is not None
    assert isinstance(fetched_item.suggested_price, float)
    assert fetched_item.suggested_price == pytest.approx(19.99)

    fetched_listing = session.get(ComparableListing, listing.id)
    assert fetched_listing is not None
    assert isinstance(fetched_listing.price, float)
    assert fetched_listing.price == pytest.approx(24.5)

    # Demonstrates the "no JSON-serialization friction" claim in the
    # models.py docstring: a bare json.dumps works with no custom
    # encoder, unlike decimal.Decimal, and round-trips to the same
    # numeric value.
    import json

    payload = json.dumps(
        {
            "suggested_price": fetched_item.suggested_price,
            "price": fetched_listing.price,
        }
    )
    parsed = json.loads(payload)
    assert parsed["suggested_price"] == pytest.approx(19.99)
    assert parsed["price"] == pytest.approx(24.5)
    assert isinstance(parsed["suggested_price"], float)
    assert isinstance(parsed["price"], float)
