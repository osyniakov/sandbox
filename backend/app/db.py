"""Database engine/session setup.

Migration strategy is split in two:

- ``Base.metadata.create_all()`` (via ``init_db()``, called from
  ``app.main``'s ``lifespan()``) creates any tables that don't already
  exist. It runs on every app startup and is idempotent, but it's
  structurally unable to evolve an already-populated DB's schema (e.g.
  adding a column to an existing table).
- Alembic (``backend/alembic/``, ``backend/app/db_migrate.py``) handles
  that: evolving a populated DB's schema without losing data. It's
  invoked as an explicit pre-start deploy step
  (``python -m app.db_migrate``, see ``backend/Dockerfile`` /
  ``backend/Dockerfile.railway``'s ``CMD``), not from app import time or
  ``lifespan()`` -- so the app's own startup path (and therefore the
  API/fixture test suite, which drives that same path) never triggers
  Alembic. ``backend/tests/test_db_migrate.py`` exercises Alembic
  directly, against its own throwaway DBs, as a deliberate exception.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.models import Base


@event.listens_for(Engine, "connect")
def _enable_sqlite_foreign_keys(dbapi_connection, connection_record) -> None:
    """Enforce FK constraints on SQLite, which ignores them by default."""
    if type(dbapi_connection).__module__.startswith("sqlite3"):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

def _default_db_path() -> Path:
    """Compute the default SQLite DB path.

    If the ``DATA_DIR`` env var is set (non-empty), the DB file lives at
    ``$DATA_DIR/declutter.db`` -- this lets a deployment (e.g. Railway)
    point the DB at a dedicated persistent-volume mount without that
    volume needing to be mounted directly over the app's code directory
    (which would risk masking future code deploys). If unset, falls back
    to the original ``backend/data/declutter.db`` default so local/dev
    behavior is unchanged.
    """
    data_dir = os.environ.get("DATA_DIR")
    if data_dir:
        return Path(data_dir) / "declutter.db"
    return Path(__file__).resolve().parent.parent / "data" / "declutter.db"


# Computed once at import time (matches the existing pattern of
# ``engine = make_engine()`` also running at import time below). Kept as a
# module-level ``Path`` constant -- other code (and tests) imports/monkeypatches
# ``DEFAULT_DB_PATH`` directly, so its name/type must stay stable.
DEFAULT_DB_PATH = _default_db_path()


def get_database_url() -> str:
    """Compute the default SQLite database URL, ensuring the parent dir exists.

    Shared by ``make_engine()`` (runtime default) and Alembic's ``env.py`` so
    both resolve the DB location identically, including ``DATA_DIR`` env var
    handling (see ``_default_db_path()``).
    """
    DEFAULT_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{DEFAULT_DB_PATH}"


def make_engine(db_url: str | None = None):
    """Create a SQLAlchemy engine.

    Defaults to a SQLite file under ``backend/data/declutter.db``. Pass an
    explicit ``db_url`` (e.g. ``"sqlite:///:memory:"`` or a temp file URL)
    for tests so the dev DB file is never touched.
    """
    if db_url is None:
        db_url = get_database_url()

    connect_args = {"check_same_thread": False} if db_url.startswith("sqlite") else {}
    return create_engine(db_url, connect_args=connect_args)


def init_db(engine) -> None:
    """Create all tables that don't already exist."""
    Base.metadata.create_all(bind=engine)


def make_session_factory(engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, autoflush=False, autocommit=False)


# Default engine/session for app runtime use (not imported by tests).
engine = make_engine()
SessionLocal = make_session_factory(engine)


def get_session() -> Iterator[Session]:
    """FastAPI-style dependency for a request-scoped session."""
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
