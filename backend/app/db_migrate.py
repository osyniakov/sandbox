"""Reconcile a database to Alembic 'head', regardless of its starting state.

This module provides a single idempotent entrypoint, ``upgrade_to_head()``,
that brings a database to the latest Alembic revision no matter which of
three states it currently starts in:

1. Fresh/empty DB (no tables at all) -- Alembic runs every migration from
   scratch.
2. Legacy pre-Alembic DB (already has the app's tables, e.g. ``items``, but
   no ``alembic_version`` row because it predates Alembic or was built by
   ``Base.metadata.create_all()``) -- the schema may be at ANY historical
   model version. We inspect the columns, walk ``REVISION_MARKERS`` in chain
   order, and stamp at the newest revision whose marker columns (and those of
   every earlier revision) are all present (baseline if none). The final
   ``upgrade head`` then applies only the remaining migrations.
3. DB already tracked by Alembic and at (or behind) head -- Alembic upgrades
   it to head, which is a no-op if it's already there.

Runs as a pre-start deploy step (see ``backend/Dockerfile`` /
``backend/Dockerfile.railway``'s ``CMD``, which chain
``python -m app.db_migrate`` before starting the server) and,
eventually, against the live Railway DB to reconcile it now that Alembic
exists (pending Railway access -- see the sandbox-64f epic notes).
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

import sqlalchemy
from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory

logger = logging.getLogger(__name__)

ALEMBIC_INI_PATH = Path(__file__).resolve().parent.parent / "alembic.ini"

# Ordered (oldest first) map: post-baseline revision id -> (table, column)
# pairs that revision adds. Presence of all of them proves that revision's
# schema is in place. MUST list every post-baseline revision in chain order;
# tests/test_db_migrate.py fails if a migration is added without an entry or
# the order drifts from the Alembic chain.
REVISION_MARKERS: dict[str, tuple[tuple[str, str], ...]] = {
    "56db6b756990": (("items", "user_hint"),),
    "5e5bc01d3d06": (("items", "suggested_title"), ("items", "suggested_description")),
    "c19b13a0cfc6": (("items", "search_query_used"),),
    "ed31718d3904": (("comparable_listings", "price_type"),),
    "85b6c1c63d41": (("items", "decision_confidence"),),
    "86771ea861cc": (("item_photos", "photo_path"),),
    "b7a2c4d9e1f3": (("items", "owner_email"),),
}


def _build_config(database_url: str) -> Config:
    """Build an Alembic Config pointing at backend/alembic.ini.

    Resolved relative to this file's location so this works regardless of
    the caller's current working directory.
    """
    config = Config(str(ALEMBIC_INI_PATH))
    config.set_main_option("sqlalchemy.url", database_url)
    return config


def _baseline_revision_id(config: Config) -> str:
    """Read the baseline (first, i.e. down_revision is None) revision id.

    Read dynamically from the script directory rather than hardcoded, so
    this keeps working if the migration chain is ever renumbered/rebased.
    """
    script_dir = ScriptDirectory.from_config(config)
    for revision in script_dir.walk_revisions():
        if revision.down_revision is None:
            return revision.revision
    raise RuntimeError("No baseline revision (down_revision is None) found in alembic script directory")


def _detect_stamp_revision(inspector: sqlalchemy.Inspector, baseline_revision: str) -> str:
    """Return the revision an unstamped legacy DB's schema corresponds to.

    Prefix semantics: walk ``REVISION_MARKERS`` in order and stop at the first
    revision with any missing marker column; the answer is the last revision
    fully satisfied (baseline if none).

    Edge cases:
    - Out-of-order markers (a later revision's column present while an earlier
      one is missing): we stamp at the satisfied prefix and log a warning. The
      following ``upgrade head`` then re-adds the later column and fails with
      a duplicate-column error. This is deliberate: a loud failure on an
      inconsistent schema beats silently stamping too high and skipping a
      migration.
    - A marker's table is missing (e.g. ``comparable_listings``): its columns
      count as absent, so stamping stops before that revision and the upgrade
      fails loudly if the table truly does not exist.
    """
    columns_cache: dict[str, set[str]] = {}

    def has_column(table: str, column: str) -> bool:
        if table not in columns_cache:
            columns_cache[table] = (
                {c["name"] for c in inspector.get_columns(table)} if inspector.has_table(table) else set()
            )
        return column in columns_cache[table]

    stamp_at = baseline_revision
    broken = False
    for revision, markers in REVISION_MARKERS.items():
        satisfied = all(has_column(t, c) for t, c in markers)
        if broken:
            if satisfied:
                logger.warning(
                    "Unstamped DB has markers for revision %s but is missing an earlier revision's columns; "
                    "stamping at %s -- the upgrade will likely fail with a duplicate column.",
                    revision,
                    stamp_at,
                )
            continue
        if satisfied:
            stamp_at = revision
        else:
            broken = True
    return stamp_at


def upgrade_to_head(database_url: str) -> None:
    """Bring the database at ``database_url`` to Alembic 'head'.

    Safe to call repeatedly (idempotent): a DB already at head is left
    untouched by the final ``upgrade head`` call.
    """
    config = _build_config(database_url)

    engine = sqlalchemy.create_engine(database_url)
    try:
        with engine.connect() as connection:
            migration_context = MigrationContext.configure(connection)
            current_revision = migration_context.get_current_revision()

        if current_revision is None:
            inspector = sqlalchemy.inspect(engine)
            if inspector.has_table("items"):
                # Unstamped legacy DB: tables exist but were never tracked by
                # Alembic, and may match any historical model version. Stamp
                # at the newest revision whose schema is present (see
                # _detect_stamp_revision); stamping is a no-op that does not
                # run DDL, and `upgrade head` below applies the rest.
                stamp_revision = _detect_stamp_revision(inspector, _baseline_revision_id(config))
                command.stamp(config, stamp_revision)
            # else: genuinely fresh/empty DB -- nothing to stamp; `upgrade
            # head` below will run every revision from scratch.
    finally:
        engine.dispose()

    command.upgrade(config, "head")


def claim_legacy_items(database_url: str) -> int:
    """Assign NULL-owner items to the first ``ALLOWED_EMAILS`` entry.

    Idempotent: only rows with ``owner_email IS NULL`` are touched, so a
    second call claims nothing. If ``ALLOWED_EMAILS`` is unset/empty, nothing
    is changed (a warning is logged when NULL-owner items exist). Running this
    on every start covers the case where the env var is set only after the
    first deploy. Returns the number of items claimed.
    """
    from app.auth import _parse_allowed_emails

    owners = _parse_allowed_emails(os.environ.get("ALLOWED_EMAILS"))
    owner = owners[0] if owners else None

    engine = sqlalchemy.create_engine(database_url)
    try:
        with engine.begin() as connection:
            if owner is None:
                orphans = connection.execute(
                    sqlalchemy.text("SELECT COUNT(*) FROM items WHERE owner_email IS NULL")
                ).scalar_one()
                if orphans:
                    logger.warning(
                        "%d item(s) have no owner and ALLOWED_EMAILS is unset; "
                        "they stay unclaimed until it is set.",
                        orphans,
                    )
                return 0
            result = connection.execute(
                sqlalchemy.text("UPDATE items SET owner_email = :owner WHERE owner_email IS NULL"),
                {"owner": owner},
            )
            claimed = result.rowcount or 0
    finally:
        engine.dispose()
    logger.info("Claimed %d legacy item(s) for %s", claimed, owner)
    return claimed


if __name__ == "__main__":
    from app.db import get_database_url

    _url = get_database_url()
    upgrade_to_head(_url)
    # Alembic's fileConfig (run during upgrade) resets the root logger to
    # WARNING; reconfigure afterwards so the claim INFO line is visible.
    logging.basicConfig(level=logging.INFO, force=True)
    logging.getLogger(__name__).disabled = False
    claim_legacy_items(_url)
