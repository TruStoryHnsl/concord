"""soundboard effect_metadata

Adds a nullable ``effect_metadata`` TEXT column to ``soundboard_clips``
for the Effects board. It stores the client's ``EffectMetadata`` JSON
(``{"visualId": "confetti", "config": {...}, "version": 1}``) so a
soundboard item can carry an optional screenspace visual effect alongside
(or instead of) its sound. NULL for every existing sound-only clip — the
upgrade is purely additive and backward-compatible.

Revision ID: 2db467f7988f
Revises: 532e6b8befd6
Create Date: 2026-06-13

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = '2db467f7988f'
down_revision: Union[str, None] = '532e6b8befd6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(table: str, column: str) -> bool:
    bind = op.get_bind()
    insp = inspect(bind)
    return any(col["name"] == column for col in insp.get_columns(table))


def upgrade() -> None:
    # Idempotent guard: a pre-Alembic deploy whose schema was assembled by
    # the inline _migrate() block may already have this column. add_column
    # would then fail, so skip when present.
    if not _has_column("soundboard_clips", "effect_metadata"):
        op.add_column(
            "soundboard_clips",
            sa.Column("effect_metadata", sa.String(), nullable=True),
        )


def downgrade() -> None:
    if _has_column("soundboard_clips", "effect_metadata"):
        # SQLite needs batch mode to drop a column on older engines.
        with op.batch_alter_table("soundboard_clips") as batch:
            batch.drop_column("effect_metadata")
