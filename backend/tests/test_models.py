"""Tests for the Item / ComparableListing persistence layer.

Each test gets its own throwaway SQLite DB (a fresh temp file, cleaned
up afterwards) so nothing touches the dev DB file used by the running
app.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
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
