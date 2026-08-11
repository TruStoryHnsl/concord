"""User-scoped federation discovery ("explore") endpoints.

Historically this router projected the instance-global federation
allowlist (``tuwunel.toml``) to EVERY authenticated user — which meant
one user adding a Matrix server surfaced a source tile for everyone on
the instance. That was an instance-scoping bug: the catalogue of
connections is user-specific.

The endpoint now returns:
  1. the core instance itself (always first — it is the only default
     connection any account starts with), and
  2. the caller's OWN sources from the per-user catalogue
     (``user_sources`` — see ``routers/user_sources.py``).

The federation allowlist remains a transport-level, admin-owned concern
(``/api/admin/federation``); it is no longer surfaced to regular users
as a discovery list.
"""
from __future__ import annotations

import os

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_user_id
from models import UserSource

router = APIRouter(prefix="/api/explore", tags=["explore"])


class ExploreServerEntry(BaseModel):
    """A single federated server entry in the explore list.

    ``domain`` is the canonical identifier and is always equal to ``name``
    for now. They are kept as separate fields so a future change can
    introduce human-friendly display names (stored elsewhere) without
    breaking the wire contract clients already depend on.
    """

    domain: str
    name: str
    description: str | None = None


@router.get("/servers", response_model=list[ExploreServerEntry])
async def list_federated_servers(
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
) -> list[ExploreServerEntry]:
    """Return the caller's explore cards: the core instance + their own sources.

    User-scoped by design: no user ever sees another account's
    connections here. The instance-global allowlist is deliberately NOT
    projected — it is homeserver transport config, not a user catalogue.
    """
    # Always show the local instance first. Derived from the required
    # CONDUWUIT_SERVER_NAME env var — never hardcoded to any domain.
    local = os.environ.get("CONDUWUIT_SERVER_NAME", "").strip()
    entries: list[ExploreServerEntry] = []
    if local:
        entries.append(
            ExploreServerEntry(domain=local, name=local, description="This instance")
        )

    result = await db.execute(
        select(UserSource)
        .where(
            UserSource.user_id == user_id,
            UserSource.kind.in_(["matrix", "concord"]),
        )
        .order_by(UserSource.created_at)
    )
    for row in result.scalars().all():
        if row.host and row.host != local:
            entries.append(
                ExploreServerEntry(
                    domain=row.host,
                    name=row.display_name or row.host,
                    description=None,
                )
            )
    return entries
