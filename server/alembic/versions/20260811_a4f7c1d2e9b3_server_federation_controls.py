"""add per-server federation control columns

Federation UI wiring (feat/federation-ui-w4). Adds two columns to
``servers``:

* ``federation_visible`` (bool, default false) — whether the place's
  channel rooms are published to the Matrix public room directory
  (discoverable over federation, subject to the instance allowlist).
* ``federation_invite_policy`` (string, default ``"local_only"``) —
  whether direct invites may target remote-homeserver MXIDs.

Purely additive. Idempotent guards mirror the mesh_presence migration so
a pre-Alembic / re-stamped DB doesn't error.

Revision ID: a4f7c1d2e9b3
Revises: 8d97c98c99ca
Create Date: 2026-08-11

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = 'a4f7c1d2e9b3'
down_revision: Union[str, None] = '8d97c98c99ca'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(table: str, column: str) -> bool:
    bind = op.get_bind()
    insp = inspect(bind)
    if not insp.has_table(table):
        return False
    return column in {c["name"] for c in insp.get_columns(table)}


def upgrade() -> None:
    if not _has_column("servers", "federation_visible"):
        op.add_column(
            "servers",
            sa.Column(
                "federation_visible",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
        )
    if not _has_column("servers", "federation_invite_policy"):
        op.add_column(
            "servers",
            sa.Column(
                "federation_invite_policy",
                sa.String(),
                nullable=False,
                server_default="local_only",
            ),
        )


def downgrade() -> None:
    if _has_column("servers", "federation_invite_policy"):
        op.drop_column("servers", "federation_invite_policy")
    if _has_column("servers", "federation_visible"):
        op.drop_column("servers", "federation_visible")
