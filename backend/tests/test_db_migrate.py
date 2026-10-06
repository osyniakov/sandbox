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

import pytest
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
    assert "price_type" in _table_columns(engine, "comparable_listings")
    assert "decision_confidence" in _table_columns(engine, "items")
    assert _alembic_version(engine) == _head_revision()
    engine.dispose()


def test_upgrade_head_then_downgrade_one_drops_decision_confidence_column(
    tmp_path, monkeypatch
) -> None:
    """``decision_confidence`` (sandbox-8jm.6) is added by the head migration
    and must be cleanly removed by downgrading one step, exercising both
    directions of that migration on a scratch SQLite DB."""
    from alembic import command

    from app.db_migrate import _build_config

    database_url = _make_database_url(tmp_path, monkeypatch, "decision_confidence.db")

    upgrade_to_head(database_url)

    engine = sqlalchemy.create_engine(database_url)
    assert "decision_confidence" in _table_columns(engine, "items")
    assert _alembic_version(engine) == _head_revision()
    engine.dispose()

    config = _build_config(database_url)
    command.downgrade(config, "ed31718d3904")  # below decision_confidence (head is now item_photos)

    engine = sqlalchemy.create_engine(database_url)
    assert "decision_confidence" not in _table_columns(engine, "items")
    assert _alembic_version(engine) != _head_revision()
    engine.dispose()


def test_upgrade_head_then_downgrade_one_drops_price_type_column(tmp_path, monkeypatch) -> None:
    """``price_type`` (sandbox-8jm.2) is added by the ``ed31718d3904`` migration
    and must be cleanly removed by downgrading to its ``down_revision``,
    exercising both directions of that migration on a scratch SQLite DB.

    Downgrades to the specific pre-price_type revision (``c19b13a0cfc6``)
    rather than a relative ``-1``, since ``ed31718d3904`` is no longer
    necessarily the head (sandbox-8jm.6's ``decision_confidence`` migration
    was added on top of it) -- a relative ``-1`` would only undo whatever
    happens to be the newest migration, not this one specifically.
    """
    from alembic import command

    from app.db_migrate import _build_config

    database_url = _make_database_url(tmp_path, monkeypatch, "price_type.db")

    upgrade_to_head(database_url)

    engine = sqlalchemy.create_engine(database_url)
    assert "price_type" in _table_columns(engine, "comparable_listings")
    assert _alembic_version(engine) == _head_revision()
    engine.dispose()

    config = _build_config(database_url)
    command.downgrade(config, "c19b13a0cfc6")

    engine = sqlalchemy.create_engine(database_url)
    assert "price_type" not in _table_columns(engine, "comparable_listings")
    assert _alembic_version(engine) != _head_revision()
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


def test_upgrade_to_head_legacy_db_already_at_head_schema(tmp_path, monkeypatch) -> None:
    """A legacy DB whose ``items`` table was created via
    ``Base.metadata.create_all()`` against the CURRENT ``app.models`` (so it
    already has ``user_hint``), but was never stamped by Alembic (no
    ``alembic_version`` table) -- e.g. a local dev DB created by running the
    app's own ``init_db()`` after ``user_hint`` was added to the model but
    before this Alembic epic shipped.

    Regression guard: previously ``upgrade_to_head()`` unconditionally
    stamped this shape at the pre-hint BASELINE revision, and the
    subsequent ``upgrade head`` then tried to re-run the
    "add user_hint column" migration's DDL against a table that already
    had that column, raising ``OperationalError: duplicate column name:
    user_hint``. It must instead detect that the schema already matches
    head and stamp at head directly (a no-op), preserving existing data.
    """
    database_url = _make_database_url(tmp_path, monkeypatch, "legacy_at_head.db")

    # Build the DB directly via Base.metadata.create_all() against the
    # CURRENT app.models -- no Alembic involved in setup at all, matching
    # how a real create_all()-based legacy DB would actually look.
    from app.models import Base, Decision, Item, ItemStatus

    setup_engine = sqlalchemy.create_engine(database_url)
    Base.metadata.create_all(bind=setup_engine)

    # Confirm the setup actually produced the shape under test: items has
    # user_hint, and there is no alembic_version table yet.
    inspector = sqlalchemy.inspect(setup_engine)
    assert not inspector.has_table("alembic_version")
    assert inspector.has_table("items")
    assert "user_hint" in _table_columns(setup_engine, "items")

    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    from sqlalchemy.orm import Session

    with Session(setup_engine) as session:
        session.add(
            Item(
                photo_path="legacy/photo.jpg",
                identified_name="Old Lamp",
                category="furniture",
                brand="Acme",
                condition="used",
                user_hint="found in the attic",
                search_keywords=["lamp"],
                suggested_price=12.5,
                decision=Decision.PENDING,
                status=ItemStatus.PENDING_IDENTIFICATION,
                created_at=now,
                updated_at=now,
            )
        )
        session.commit()

    expected_columns = _table_columns(setup_engine, "items")
    setup_engine.dispose()

    # Must not raise (previously raised OperationalError: duplicate column
    # name: user_hint).
    upgrade_to_head(database_url)

    engine = sqlalchemy.create_engine(database_url)
    assert _table_columns(engine, "items") == expected_columns
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
    assert row[2] == "found in the attic"
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


# ---------------------------------------------------------------------------
# Marker-based stamping of unstamped legacy DBs (sandbox-8v6)
# ---------------------------------------------------------------------------


def _chain_post_baseline() -> list[str]:
    """Post-baseline revision ids in chain order (oldest first)."""
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    from app.db_migrate import ALEMBIC_INI_PATH

    script_dir = ScriptDirectory.from_config(Config(str(ALEMBIC_INI_PATH)))
    revs = list(script_dir.walk_revisions())  # newest first
    revs.reverse()
    assert revs[0].down_revision is None
    return [r.revision for r in revs[1:]]


def test_revision_markers_cover_chain_in_order() -> None:
    """Drift guard: every post-baseline migration needs a marker entry, in chain order."""
    from app.db_migrate import REVISION_MARKERS

    assert list(REVISION_MARKERS) == _chain_post_baseline()
    for revision, markers in REVISION_MARKERS.items():
        assert markers, f"revision {revision} has no markers"


def _build_unstamped_at(database_url: str, revision: str) -> None:
    """Upgrade a fresh DB to ``revision`` then drop alembic_version (unstamped)."""
    from alembic import command

    from app.db_migrate import _build_config

    command.upgrade(_build_config(database_url), revision)
    engine = sqlalchemy.create_engine(database_url)
    try:
        with engine.begin() as connection:
            connection.execute(
                sqlalchemy.text(
                    "INSERT INTO items (photo_path, decision, status, created_at, updated_at) "
                    "VALUES ('a.jpg', 'sell', 'new', '2024-01-01', '2024-01-01')"
                )
            )
            connection.execute(sqlalchemy.text("DROP TABLE alembic_version"))
    finally:
        engine.dispose()


def _all_marker_columns_present(engine: sqlalchemy.engine.Engine) -> bool:
    from app.db_migrate import REVISION_MARKERS

    return all(
        column in _table_columns(engine, table)
        for markers in REVISION_MARKERS.values()
        for table, column in markers
    )


@pytest.mark.parametrize("start_index", range(-1, 6))
def test_unstamped_db_at_intermediate_schema_reaches_head(tmp_path, monkeypatch, start_index) -> None:
    """Unstamped DB at baseline (-1) or any post-baseline revision ends at head, data kept."""
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    from app.db_migrate import ALEMBIC_INI_PATH

    chain = _chain_post_baseline()
    if start_index == -1:
        script_dir = ScriptDirectory.from_config(Config(str(ALEMBIC_INI_PATH)))
        start = next(r.revision for r in script_dir.walk_revisions() if r.down_revision is None)
    else:
        start = chain[start_index]

    database_url = _make_database_url(tmp_path, monkeypatch, f"unstamped_{start_index}.db")
    _build_unstamped_at(database_url, start)

    upgrade_to_head(database_url)

    engine = sqlalchemy.create_engine(database_url)
    try:
        assert _alembic_version(engine) == _head_revision()
        assert _all_marker_columns_present(engine)
        with engine.connect() as connection:
            rows = connection.execute(sqlalchemy.text("SELECT photo_path FROM items")).fetchall()
        assert [r[0] for r in rows] == ["a.jpg"]
    finally:
        engine.dispose()


def test_already_stamped_intermediate_db_unchanged_behaviour(tmp_path, monkeypatch) -> None:
    """A stamped DB behind head is simply upgraded (markers are not consulted)."""
    from alembic import command

    from app.db_migrate import _build_config

    database_url = _make_database_url(tmp_path, monkeypatch, "stamped.db")
    command.upgrade(_build_config(database_url), _chain_post_baseline()[1])
    upgrade_to_head(database_url)
    engine = sqlalchemy.create_engine(database_url)
    try:
        assert _alembic_version(engine) == _head_revision()
        assert _all_marker_columns_present(engine)
    finally:
        engine.dispose()


def test_unstamped_out_of_order_markers_fail_loudly(tmp_path, monkeypatch) -> None:
    """Later column present but an earlier one missing: stamp prefix, upgrade fails (no silent skip)."""
    database_url = _make_database_url(tmp_path, monkeypatch, "ooo.db")
    _build_unstamped_at(database_url, _chain_post_baseline()[0])  # has user_hint only
    engine = sqlalchemy.create_engine(database_url)
    try:
        with engine.begin() as connection:
            connection.execute(sqlalchemy.text("ALTER TABLE items ADD COLUMN search_query_used VARCHAR"))
    finally:
        engine.dispose()

    with pytest.raises(sqlalchemy.exc.OperationalError, match="duplicate column"):
        upgrade_to_head(database_url)


def test_item_photos_backfill_one_row_per_existing_item(tmp_path, monkeypatch) -> None:
    """Upgrading a DB at the previous head creates one position-0 photo per item."""
    from alembic import command

    from app.db_migrate import _build_config

    database_url = _make_database_url(tmp_path, monkeypatch, "photos_backfill.db")
    config = _build_config(database_url)
    command.upgrade(config, _chain_post_baseline()[-2])

    engine = sqlalchemy.create_engine(database_url)
    try:
        with engine.begin() as connection:
            for name in ("a.jpg", "b.jpg", "c.jpg"):
                connection.execute(
                    sqlalchemy.text(
                        "INSERT INTO items (photo_path, decision, status, created_at, updated_at) "
                        "VALUES (:p, 'pending', 'pending_identification', '2024-01-01', '2024-01-01')"
                    ),
                    {"p": name},
                )
        command.upgrade(config, "head")
        with engine.connect() as connection:
            items = connection.execute(sqlalchemy.text("SELECT id, photo_path FROM items ORDER BY id")).fetchall()
            photos = connection.execute(
                sqlalchemy.text("SELECT item_id, photo_path, position FROM item_photos ORDER BY item_id")
            ).fetchall()
        assert [tuple(p) for p in photos] == [(i[0], i[1], 0) for i in items]
        assert len(photos) == 3
    finally:
        engine.dispose()


def test_unstamped_db_below_item_photos_is_stamped_and_backfilled(tmp_path, monkeypatch) -> None:
    """A legacy DB without item_photos is stamped below that revision, then backfilled."""
    database_url = _make_database_url(tmp_path, monkeypatch, "photos_legacy.db")
    _build_unstamped_at(database_url, _chain_post_baseline()[-2])

    upgrade_to_head(database_url)

    engine = sqlalchemy.create_engine(database_url)
    try:
        with engine.connect() as connection:
            rows = connection.execute(sqlalchemy.text("SELECT photo_path, position FROM item_photos")).fetchall()
        assert [tuple(r) for r in rows] == [("a.jpg", 0)]
    finally:
        engine.dispose()


def test_detect_stamp_missing_marker_table_counts_as_absent(tmp_path, monkeypatch) -> None:
    """With item_photos absent, detection stops at the previous revision."""
    from app.db_migrate import _detect_stamp_revision

    database_url = _make_database_url(tmp_path, monkeypatch, "photos_detect.db")
    _build_unstamped_at(database_url, _chain_post_baseline()[-2])
    engine = sqlalchemy.create_engine(database_url)
    try:
        stamp = _detect_stamp_revision(sqlalchemy.inspect(engine), "baseline-unused")
    finally:
        engine.dispose()
    assert stamp == _chain_post_baseline()[-2]
