"""add mesh_presence table

Spec B (docker-pillar). Creates the ``mesh_presence`` table that holds
signed presence records pushed to a docker PILLAR by connected
p2p-capable (native) instances. The pillar folds non-expired rows into
the topology it serves at ``/api/mesh/topology`` as hop-1, web-threaded
nodes. Rows are TTL'd; ``expires_at`` is indexed for the eviction sweep
and the non-expired topology query.

Purely additive — no existing table is touched. Idempotent guards mirror
the soundboard migration so a pre-Alembic / re-stamped DB doesn't error.

Revision ID: 8d97c98c99ca
Revises: 2db467f7988f
Create Date: 2026-06-14

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = '8d97c98c99ca'
down_revision: Union[str, None] = '2db467f7988f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(table: str) -> bool:
    bind = op.get_bind()
    return inspect(bind).has_table(table)


def upgrade() -> None:
    if _has_table("mesh_presence"):
        return
    op.create_table(
        "mesh_presence",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("persona_id", sa.String(), nullable=False),
        sa.Column("persona_pubkey", sa.LargeBinary(), nullable=False),
        sa.Column("sig", sa.LargeBinary(), nullable=False),
        sa.Column("adjacency", sa.String(), nullable=False, server_default="[]"),
        sa.Column("ttl", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("posted_at", sa.DateTime(), nullable=False),
        sa.Column("via_pillar", sa.String(), nullable=False),
        sa.UniqueConstraint("persona_id", name="uq_mesh_presence_persona"),
    )
    op.create_index(
        "ix_mesh_presence_expires_at", "mesh_presence", ["expires_at"]
    )


def downgrade() -> None:
    if not _has_table("mesh_presence"):
        return
    op.drop_index("ix_mesh_presence_expires_at", table_name="mesh_presence")
    op.drop_table("mesh_presence")
