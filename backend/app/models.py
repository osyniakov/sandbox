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
"""

from __future__ import annotations

import enum
from datetime import datetime, timezone

from sqlalchemy import (
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Integer,
    Numeric,
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

    suggested_price: Mapped[float | None] = mapped_column(Numeric, nullable=True)

    decision: Mapped[Decision] = mapped_column(
        SAEnum(Decision, native_enum=False, validate_strings=True),
        nullable=False,
        default=Decision.PENDING,
    )
    status: Mapped[ItemStatus] = mapped_column(
        SAEnum(ItemStatus, native_enum=False, validate_strings=True),
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
    price: Mapped[float] = mapped_column(Numeric, nullable=False)
    url: Mapped[str] = mapped_column(String, nullable=False)
    condition: Mapped[str | None] = mapped_column(String, nullable=True)
    location: Mapped[str | None] = mapped_column(String, nullable=True)

    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )

    item: Mapped[Item] = relationship("Item", back_populates="comparable_listings")
