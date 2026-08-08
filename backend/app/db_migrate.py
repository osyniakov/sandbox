"""Reconcile a database to Alembic 'head', regardless of its starting state.

This module provides a single idempotent entrypoint, ``upgrade_to_head()``,
that brings a database to the latest Alembic revision no matter which of
three states it currently starts in:

1. Fresh/empty DB (no tables at all) -- Alembic runs every migration from
   scratch.
2. Legacy pre-Alembic DB (already has the app's tables, e.g. ``items``, but
   no ``alembic_version`` table because it predates Alembic) -- we stamp it
   at the baseline revision (a no-op against the DB, since that revision's
   schema already matches) and then let Alembic apply only the migrations
   that came after baseline.
3. DB already tracked by Alembic and at (or behind) head -- Alembic upgrades
   it to head, which is a no-op if it's already there.

Intended to run as a pre-start deploy step (see follow-up bead) and,
eventually, against the live Railway DB to reconcile it now that Alembic
exists.
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
                # tracked by Alembic. Stamp at baseline (a true no-op against
                # this exact schema -- it must NOT execute baseline's DDL,
                # which would fail since the tables already exist) so the
                # upgrade below only applies migrations after baseline.
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
