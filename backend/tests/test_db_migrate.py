"""Tests for app.db_migrate.upgrade_to_head() covering all three DB states:

1. Fresh/empty DB (file doesn't exist yet).
2. Legacy pre-Alembic DB (already has the old-schema tables, no
   alembic_version table).
3. DB already at head, called twice, to prove idempotency.

All tests use a real temporary SQLite file via pytest's ``tmp_path`` fixture
-- no mocks -- so we exercise the actual Alembic machinery end to end.

``upgrade_to_head(database_url)`` operates on the exact URL it is passed:
``app.db_migrate._build_config()`` sets ``sqlalchemy.url`` explicitly on the
``Config`` object, and ``alembic/env.py`` only falls back to
``app.db.get_database_url()`` when no URL has already been set. No
monkeypatching of ``app.db.DEFAULT_DB_PATH``/``DATA_DIR`` is required to
point Alembic's actual migration run at our temp DB file; see
``test_upgrade_to_head_ignores_app_default_db`` below, which is a direct
regression guard proving this.
"""

from __future__ import annotations

import sqlalchemy

from app.db_migrate import upgrade_to_head


def _make_database_url(tmp_path, monkeypatch, filename: str) -> str:
    """Build a sqlite URL under ``tmp_path``."""
    db_path = tmp_path / filename
    monkeypatch.delenv("DATA_DIR", raising=False)
    return f"sqlite:///{db_path}"


def _table_columns(engine: sqlalchemy.engine.Engine, table_name: str) -> set[str]:
    inspector = sqlalchemy.inspect(engine)
    return {col["name"] for col in inspector.get_columns(table_name)}


def _alembic_version(engine: sqlalchemy.engine.Engine) -> str | None:
    with engine.connect() as connection:
        result = connection.execute(
            sqlalchemy.text("SELECT version_num FROM alembic_version")
        ).fetchone()
        return result[0] if result else None


def _head_revision() -> str:
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    from app.db_migrate import ALEMBIC_INI_PATH

    config = Config(str(ALEMBIC_INI_PATH))
    script_dir = ScriptDirectory.from_config(config)
    return script_dir.get_current_head()


def test_upgrade_to_head_fresh_db(tmp_path, monkeypatch) -> None:
    """A DB that doesn't exist yet: upgrade_to_head() creates it at head."""
    db_path = tmp_path / "fresh.db"
    database_url = _make_database_url(tmp_path, monkeypatch, "fresh.db")
    assert not db_path.exists()

    upgrade_to_head(database_url)

    assert db_path.exists()
    engine = sqlalchemy.create_engine(database_url)
    columns = _table_columns(engine, "items")
    assert "user_hint" in columns
    assert _alembic_version(engine) == _head_revision()
    engine.dispose()


def test_upgrade_to_head_legacy_db_preserves_data(tmp_path, monkeypatch) -> None:
    """A pre-Alembic DB (tables exist, no alembic_version) gets stamped at
    baseline and then upgraded -- without losing existing data and without
    re-running baseline's DDL (which would error since tables already
    exist).

    Setup builds the OLD (pre-user_hint) schema directly via SQLAlchemy Core
    ``Table`` objects mirroring the DDL in the baseline migration
    (304649b20ea1_baseline_schema.py), rather than importing the current
    ``app.models`` (which already has user_hint) or checking out an old
    version of that module (fragile/impossible from within a test). This
    keeps the test self-contained and immune to future changes to
    app.models.
    """
    database_url = _make_database_url(tmp_path, monkeypatch, "legacy.db")

    setup_engine = sqlalchemy.create_engine(database_url)
    metadata = sqlalchemy.MetaData()
    items = sqlalchemy.Table(
        "items",
        metadata,
        sqlalchemy.Column("id", sqlalchemy.Integer, primary_key=True, autoincrement=True),
        sqlalchemy.Column("photo_path", sqlalchemy.String, nullable=False),
        sqlalchemy.Column("identified_name", sqlalchemy.String, nullable=True),
        sqlalchemy.Column("category", sqlalchemy.String, nullable=True),
        sqlalchemy.Column("brand", sqlalchemy.String, nullable=True),
        sqlalchemy.Column("condition", sqlalchemy.String, nullable=True),
        sqlalchemy.Column("search_keywords", sqlalchemy.JSON, nullable=True),
        sqlalchemy.Column("suggested_price", sqlalchemy.Float, nullable=True),
        sqlalchemy.Column("decision", sqlalchemy.String, nullable=False),
        sqlalchemy.Column("status", sqlalchemy.String, nullable=False),
        sqlalchemy.Column("created_at", sqlalchemy.DateTime(timezone=True), nullable=False),
        sqlalchemy.Column("updated_at", sqlalchemy.DateTime(timezone=True), nullable=False),
    )
    sqlalchemy.Table(
        "comparable_listings",
        metadata,
        sqlalchemy.Column("id", sqlalchemy.Integer, primary_key=True, autoincrement=True),
        sqlalchemy.Column("item_id", sqlalchemy.Integer, sqlalchemy.ForeignKey("items.id"), nullable=False),
        sqlalchemy.Column("title", sqlalchemy.String, nullable=False),
        sqlalchemy.Column("price", sqlalchemy.Float, nullable=False),
        sqlalchemy.Column("url", sqlalchemy.String, nullable=False),
        sqlalchemy.Column("condition", sqlalchemy.String, nullable=True),
        sqlalchemy.Column("location", sqlalchemy.String, nullable=True),
        sqlalchemy.Column("fetched_at", sqlalchemy.DateTime(timezone=True), nullable=False),
    )
    metadata.create_all(bind=setup_engine)

    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    with setup_engine.begin() as connection:
        connection.execute(
            items.insert().values(
                photo_path="legacy/photo.jpg",
                identified_name="Old Lamp",
                category="furniture",
                brand="Acme",
                condition="used",
                search_keywords=["lamp"],
                suggested_price=12.5,
                decision="pending",
                status="pending_identification",
                created_at=now,
                updated_at=now,
            )
        )

    # Confirm no alembic_version table exists yet -- this is a genuine
    # pre-Alembic legacy DB, not one that was previously stamped.
    inspector = sqlalchemy.inspect(setup_engine)
    assert not inspector.has_table("alembic_version")
    assert inspector.has_table("items")
    assert "user_hint" not in _table_columns(setup_engine, "items")
    setup_engine.dispose()

    upgrade_to_head(database_url)

    engine = sqlalchemy.create_engine(database_url)
    columns = _table_columns(engine, "items")
    assert "user_hint" in columns
    assert _alembic_version(engine) == _head_revision()

    with engine.connect() as connection:
        row = connection.execute(
            sqlalchemy.text(
                "SELECT photo_path, identified_name, user_hint FROM items"
            )
        ).fetchone()
    assert row is not None
    assert row[0] == "legacy/photo.jpg"
    assert row[1] == "Old Lamp"
    assert row[2] is None
    engine.dispose()


def test_upgrade_to_head_is_idempotent(tmp_path, monkeypatch) -> None:
    """Calling upgrade_to_head() twice against the same DB is a true no-op
    the second time: no exception, same schema, same alembic_version."""
    database_url = _make_database_url(tmp_path, monkeypatch, "idempotent.db")

    upgrade_to_head(database_url)

    engine = sqlalchemy.create_engine(database_url)
    columns_after_first = _table_columns(engine, "items")
    version_after_first = _alembic_version(engine)
    engine.dispose()

    upgrade_to_head(database_url)

    engine = sqlalchemy.create_engine(database_url)
    columns_after_second = _table_columns(engine, "items")
    version_after_second = _alembic_version(engine)
    engine.dispose()

    assert columns_after_first == columns_after_second
    assert version_after_first == version_after_second == _head_revision()


def test_upgrade_to_head_ignores_app_default_db(tmp_path, monkeypatch) -> None:
    """Regression guard: upgrade_to_head(database_url) must operate on the
    passed-in ``database_url`` and must NOT touch the app's own default DB
    (as resolved by ``app.db.get_database_url()`` / ``DATA_DIR``), even
    though ``alembic/env.py`` also knows how to compute that default.

    This is a direct reproduction of a real bug: ``alembic/env.py`` used to
    unconditionally call
    ``config.set_main_option("sqlalchemy.url", get_database_url())`` at
    module-exec time, which runs every time Alembic actually executes a
    command (``command.stamp()``/``command.upgrade()``) -- i.e. AFTER
    ``db_migrate._build_config()`` already set the caller's
    ``database_url`` on the Config object. env.py's recomputation silently
    won, so ``upgrade_to_head(database_url)`` actually migrated the WRONG
    database (the app's current default) while leaving a harmless empty
    0-byte file at the URL that was actually requested.

    Setup: point the app's default DB ("decoy") at one temp location via
    ``DATA_DIR``, then call ``upgrade_to_head()`` with a deliberately
    different ``database_url`` ("target") pointing elsewhere. Assert the
    target was actually migrated to head and the decoy was left completely
    untouched.
    """
    import app.db as db_module

    # app.db.DEFAULT_DB_PATH is computed once at import time from DATA_DIR
    # (see app/db.py), so setting the env var alone wouldn't affect an
    # already-imported process; monkeypatch the resolved path directly
    # instead (the same pattern used in tests/test_data_dir_config.py) to
    # set up the app's "default" DB location for this test.
    decoy_dir = tmp_path / "decoy_data_dir"
    decoy_dir.mkdir()
    decoy_path = decoy_dir / "declutter.db"
    monkeypatch.setattr(db_module, "DEFAULT_DB_PATH", decoy_path)
    decoy_url = db_module.get_database_url()
    assert decoy_url == f"sqlite:///{decoy_path}"
    assert not decoy_path.exists()

    target_path = tmp_path / "target_db" / "target.db"
    target_path.parent.mkdir()
    target_url = f"sqlite:///{target_path}"

    upgrade_to_head(target_url)

    # The decoy (app's own default DB) must be completely untouched: not
    # even created, let alone migrated.
    assert not decoy_path.exists()

    # The target (the URL we actually asked for) must be genuinely
    # migrated to head.
    assert target_path.exists()
    target_engine = sqlalchemy.create_engine(target_url)
    columns = _table_columns(target_engine, "items")
    assert "user_hint" in columns
    assert _alembic_version(target_engine) == _head_revision()
    target_engine.dispose()
