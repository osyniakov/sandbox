"""Reconcile a database to Alembic 'head', regardless of its starting state.

This module provides a single idempotent entrypoint, ``upgrade_to_head()``,
that brings a database to the latest Alembic revision no matter which of
three states it currently starts in:

1. Fresh/empty DB (no tables at all) -- Alembic runs every migration from
   scratch.
2. Legacy pre-Alembic DB (already has the app's tables, e.g. ``items``, but
   no ``alembic_version`` table because it predates Alembic) -- which of two
   shapes this actually is gets detected by inspecting the existing schema:
   if it's missing columns that later migrations add (e.g. ``user_hint``),
   we stamp it at the baseline revision (a no-op, since that revision's
   schema already matches) and let Alembic apply only the migrations that
   came after baseline; if it already has those columns (e.g. a DB whose
   tables were created via ``create_all()`` after the column was added to
   the models but before Alembic tracking existed), we stamp it straight at
   head instead, since re-running those migrations would fail against
   columns that already exist.
3. DB already tracked by Alembic and at (or behind) head -- Alembic upgrades
   it to head, which is a no-op if it's already there.

Runs as a pre-start deploy step (see ``backend/Dockerfile`` /
``backend/Dockerfile.railway``'s ``CMD``, which chain
``python -m app.db_migrate`` before starting the server) and,
eventually, against the live Railway DB to reconcile it now that Alembic
exists (pending Railway access -- see the sandbox-64f epic notes).
"""

from __future__ import annotations

from pathlib import Path

import sqlalchemy
from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory

ALEMBIC_INI_PATH = Path(__file__).resolve().parent.parent / "alembic.ini"


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
                # Legacy pre-Alembic DB: tables already exist but were never
                # tracked by Alembic. This could mean one of two different
                # actual schema shapes though, and stamping at the wrong one
                # is not a no-op:
                #
                # - The tables match the pre-hint BASELINE shape (the
                #   original schema, before `user_hint` was added to
                #   `Item`). This is the common case: a genuinely old DB
                #   that predates Alembic entirely.
                # - The tables were actually created via
                #   ``Base.metadata.create_all()`` against a CURRENT
                #   ``app.models`` (e.g. the app's own ``init_db()`` ran
                #   against a fresh file sometime after `user_hint` was
                #   added to the model but before this Alembic epic
                #   shipped). Such a DB already has `user_hint` even
                #   though it was never stamped. Stamping this one at
                #   baseline would be WRONG: the subsequent `upgrade head`
                #   would then try to re-run the "add user_hint column"
                #   migration's DDL against a table that already has that
                #   column, raising ``OperationalError: duplicate column
                #   name: user_hint``.
                #
                # We distinguish the two by checking for the specific
                # column that the (currently only) post-baseline migration
                # adds. If it's already present, this DB in fact matches
                # HEAD's schema already, so we stamp at head (a true
                # no-op) instead of baseline.
                #
                # This column-existence check is proportionate to today's
                # single-migration chain, not a general schema differ. If
                # a THIRD migration is added later, this same pattern
                # generalizes: check, in migration order, whether the
                # specific column(s)/table(s) each subsequent migration
                # would add already exist in the legacy DB, and stamp at
                # the latest revision whose changes are already present.
                # That generalization isn't built here -- only extend it
                # if/when a second post-baseline migration actually exists.
                items_columns = {col["name"] for col in inspector.get_columns("items")}
                if "user_hint" in items_columns:
                    # Already matches HEAD's schema; stamp at head so the
                    # `upgrade head` call below is correctly a no-op.
                    command.stamp(config, "head")
                else:
                    # Genuinely pre-hint baseline shape: stamp at baseline
                    # (a true no-op against this exact schema -- it must
                    # NOT execute baseline's DDL, which would fail since
                    # the tables already exist) so the upgrade below only
                    # applies migrations after baseline.
                    baseline_revision = _baseline_revision_id(config)
                    command.stamp(config, baseline_revision)
            # else: genuinely fresh/empty DB -- nothing to stamp; `upgrade
            # head` below will run every revision from scratch.
    finally:
        engine.dispose()

    command.upgrade(config, "head")


if __name__ == "__main__":
    from app.db import get_database_url

    upgrade_to_head(get_database_url())
