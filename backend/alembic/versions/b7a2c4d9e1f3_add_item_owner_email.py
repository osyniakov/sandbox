"""add items.owner_email column and backfill legacy owner

Revision ID: b7a2c4d9e1f3
Revises: 86771ea861cc
Create Date: 2026-10-06 12:00:00.000000

"""
import os
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7a2c4d9e1f3'
down_revision: Union[str, Sequence[str], None] = '86771ea861cc'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('items', schema=None) as batch_op:
        batch_op.add_column(sa.Column('owner_email', sa.String(length=320), nullable=True))
        batch_op.create_index(batch_op.f('ix_items_owner_email'), ['owner_email'], unique=False)

    # Data backfill (hand-added): assign existing items to the first
    # ALLOWED_EMAILS entry (lowercased/trimmed by the app's parser). Skipped
    # when unset; app.db_migrate.claim_legacy_items retries on every start.
    from app.auth import _parse_allowed_emails

    owners = _parse_allowed_emails(os.environ.get('ALLOWED_EMAILS'))
    if owners:
        op.get_bind().execute(
            sa.text('UPDATE items SET owner_email = :owner WHERE owner_email IS NULL'),
            {'owner': owners[0]},
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('items', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_items_owner_email'))
        batch_op.drop_column('owner_email')
