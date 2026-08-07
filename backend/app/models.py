"""SQLAlchemy ORM models for the persistence layer.

Migration strategy: see the docstring in ``app/db.py`` -- short version,
we use ``Base.metadata.create_all()`` rather than Alembic because this
app is single-user/local/SQLite with no production deployment yet.

Two tables:

* ``Item`` -- a photographed basement item, tracked from "just
  photographed" through identification, comparable-listing search, and
  a final sell/give-away/throw-away decision.
* ``ComparableListing`` -- a Kleinanzeigen (or similar) listing found
  to be comparable to a given ``Item``, many-to-one against ``Item``.

Enum column storage: ``Item.decision`` and ``Item.status`` map to
``SAEnum(..., values_callable=lambda e: [m.value for m in e])``. Without
``values_callable``, SQLAlchemy's ``Enum`` type stores the Python enum
MEMBER NAME (e.g. ``"SELL"``) rather than its ``.value`` (e.g.
``"sell"``). Both happen to work on read/write here because ``Decision``
and ``ItemStatus`` are ``str`` mixins with member names that
case-insensitively resemble their values, but the raw stored bytes
matter for anything that touches the DB directly (raw SQL, exports,
a future Alembic migration, or an API layer that serializes the ORM
value's underlying string). ``values_callable`` makes the column store
and validate against ``.value`` (lowercase snake_case, matching the
bead spec), not ``.name``.

Money/price column type: ``Item.suggested_price`` and
``ComparableListing.price`` are mapped as SQLAlchemy ``Float`` (not
``Numeric``/``Decimal``), so reads genuinely round-trip as Python
``float``, matching their ``Mapped[float]`` type hints. This is a
deliberate choice, not an oversight: this app is a single-user personal
"should I sell/give away/throw away this thing" helper, not a ledger or
payments system. Every price here already originates from an inherently
imprecise source -- a scraped third-party listing price or an
LLM-suggested estimate -- so ``Decimal``'s exact-precision guarantees
buy nothing; they'd just add ``Decimal`` handling in every service and
future API bead (``.4``, ``.9``) for no real benefit, and ``Decimal``
does not serialize to JSON out of the box (raises `TypeError` in
`json.dumps` / needs a custom Pydantic encoder), which is exactly the
friction this bead exists to remove. If a later bead ever needs exact
decimal precision for real money movement (e.g. actual payment
processing), that's the point to revisit this and reintroduce
``Numeric``/``Decimal`` deliberately for that narrower use case.
"""

from __future__ import annotations

import enum
from datetime import datetime, timezone

from sqlalchemy import (
    DateTime,
    Enum as SAEnum,
    Float,
    ForeignKey,
    Integer,
    String,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.types import JSON


class Base(DeclarativeBase):
    pass


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Decision(str, enum.Enum):
    PENDING = "pending"
    SELL = "sell"
    GIVE_AWAY = "give_away"
    THROW_AWAY = "throw_away"


class ItemStatus(str, enum.Enum):
    PENDING_IDENTIFICATION = "pending_identification"
    PENDING_SEARCH = "pending_search"
    PENDING_DECISION = "pending_decision"
    DECIDED = "decided"
    LISTED = "listed"
    GIVEN_AWAY = "given_away"
    DISPOSED = "disposed"


class Item(Base):
    __tablename__ = "items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    photo_path: Mapped[str] = mapped_column(String, nullable=False)

    identified_name: Mapped[str | None] = mapped_column(String, nullable=True)
    category: Mapped[str | None] = mapped_column(String, nullable=True)
    brand: Mapped[str | None] = mapped_column(String, nullable=True)
    condition: Mapped[str | None] = mapped_column(String, nullable=True)

    # Stored as a JSON array of strings.
    search_keywords: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)

    suggested_price: Mapped[float | None] = mapped_column(Float, nullable=True)

    decision: Mapped[Decision] = mapped_column(
        SAEnum(
            Decision,
            native_enum=False,
            validate_strings=True,
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        nullable=False,
        default=Decision.PENDING,
    )
    status: Mapped[ItemStatus] = mapped_column(
        SAEnum(
            ItemStatus,
            native_enum=False,
            validate_strings=True,
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        nullable=False,
        default=ItemStatus.PENDING_IDENTIFICATION,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_utcnow,
        onupdate=_utcnow,
    )

    comparable_listings: Mapped[list["ComparableListing"]] = relationship(
        "ComparableListing",
        back_populates="item",
        cascade="all, delete-orphan",
    )


class ComparableListing(Base):
    __tablename__ = "comparable_listings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    item_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("items.id"), nullable=False
    )

    title: Mapped[str] = mapped_column(String, nullable=False)
    price: Mapped[float] = mapped_column(Float, nullable=False)
    url: Mapped[str] = mapped_column(String, nullable=False)
    condition: Mapped[str | None] = mapped_column(String, nullable=True)
    location: Mapped[str | None] = mapped_column(String, nullable=True)

    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )

    item: Mapped[Item] = relationship("Item", back_populates="comparable_listings")
