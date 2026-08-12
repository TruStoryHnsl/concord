"""Per-user source catalogue + persona bindings (``/api/me/*``).

The docker instance acts as a *portal*: every account curates its own
catalogue of outward connections (federated Matrix homeservers, the
Reticulum mesh, other Concord instances, p2p meshes). This router is the
authoritative server-side store for that catalogue, so a user's sources
follow them across browsers and devices — and are never visible to any
other account on the instance. The only connection every user shares is
the core instance itself, which is implicit and not stored here.

Design notes:
- Auth: plain ``get_user_id`` — any authenticated user manages their OWN
  rows. Nothing here is admin-gated; nothing here can touch another
  user's rows. (Instance-level federation transport config remains the
  separate, admin-only ``/api/admin/federation`` surface.)
- No credentials: access tokens for remote homeservers stay client-side
  (localStorage / Stronghold keychain). The instance stores descriptors
  only.
- Personas: ``POST /api/me/personas`` is the docker half of the native
  superuser→persona link. The superuser never appears here — the account
  claims *personae*, and mesh/p2p reads are scoped by those bindings.
  One persona ↔ one account, first authenticated claim wins; a claim on
  a persona bound to a different account is a 409.
"""
from __future__ import annotations

import json
import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_user_id
from models import PersonaBinding, UserSource

router = APIRouter(prefix="/api/me", tags=["me"])

SOURCE_KINDS = {"matrix", "reticulum", "concord", "concord-p2p"}
# Kinds whose ``host`` is an opaque network identifier (a Reticulum
# destination hash, a libp2p peer id), not an RFC-1123 hostname.
OPAQUE_HOST_KINDS = {"reticulum", "concord-p2p"}

_OPAQUE_HOST_RE = re.compile(r"^[A-Za-z0-9._:-]{0,128}$")

# RFC-1123 hostname: dot-separated labels of alphanumerics/hyphens, no
# leading/trailing hyphen, ≤63 chars per label. Same shape the admin
# federation allowlist enforces.
_HOSTNAME_RE = re.compile(
    r"^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*"
    r"[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$"
)

_PERSONA_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")

# Per-account write bounds (2026-08-12 protections pass). These are
# generous for real use and exist so one authenticated account cannot
# turn the catalogue into unbounded free storage.
MAX_SOURCES_PER_USER = 100
MAX_PERSONAS_PER_USER = 50
MAX_META_BYTES = 4096


class UserSourceIn(BaseModel):
    kind: str
    host: str = ""
    display_name: str | None = Field(default=None, max_length=200)
    api_base: str | None = Field(default=None, max_length=500)
    homeserver_url: str | None = Field(default=None, max_length=500)
    meta: dict = Field(default_factory=dict)


class UserSourceOut(BaseModel):
    id: str
    kind: str
    host: str
    display_name: str | None
    api_base: str | None
    homeserver_url: str | None
    meta: dict
    created_at: str
    updated_at: str


class PersonaBindingIn(BaseModel):
    persona_id: str
    persona_pubkey: str | None = None  # hex, 32 bytes
    label: str | None = Field(default=None, max_length=200)


class PersonaBindingOut(BaseModel):
    persona_id: str
    persona_pubkey: str | None
    label: str | None
    created_at: str


def _source_out(row: UserSource) -> UserSourceOut:
    try:
        meta = json.loads(row.meta) if row.meta else {}
    except (TypeError, ValueError):
        meta = {}
    return UserSourceOut(
        id=row.id,
        kind=row.kind,
        host=row.host,
        display_name=row.display_name,
        api_base=row.api_base,
        homeserver_url=row.homeserver_url,
        meta=meta if isinstance(meta, dict) else {},
        created_at=_iso(row.created_at),
        updated_at=_iso(row.updated_at),
    )


def _iso(dt: datetime | None) -> str:
    return dt.isoformat() if dt else ""


def _validate_source(payload: UserSourceIn) -> tuple[str, str]:
    kind = payload.kind.strip().lower()
    if kind not in SOURCE_KINDS:
        raise HTTPException(400, f"kind must be one of {sorted(SOURCE_KINDS)}")
    host = payload.host.strip().lower()
    if kind in OPAQUE_HOST_KINDS:
        # Opaque identifiers (destination hash / peer id). "" is allowed —
        # a bare "reticulum" source with no specific peer is the account's
        # singleton mesh connection.
        if not _OPAQUE_HOST_RE.match(host):
            raise HTTPException(400, "invalid identifier for this source kind")
        return kind, host
    if not host or not _HOSTNAME_RE.match(host):
        raise HTTPException(400, "host must be a valid hostname")
    return kind, host


# ---------------------------------------------------------------------------
# Sources
# ---------------------------------------------------------------------------

@router.get("/sources", response_model=list[UserSourceOut])
async def list_my_sources(
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
) -> list[UserSourceOut]:
    """Return the caller's source catalogue — theirs alone, never anyone else's.

    Instance-node auto-seed: this docker instance IS a Reticulum node.
    When the operator has the node enabled (mode != off), EVERY account —
    existing ones included, on their next catalogue read — gets the bare
    singleton mesh source (kind="reticulum", host="") seeded into their
    catalogue. The mesh is part of the product, not an opt-in a user must
    discover: the rail's mesh group and the Reticulum surface appear for
    everyone with zero setup. Users may still delete the row; it re-seeds
    only while the node stays enabled (delete-while-enabled is respected
    within a session but the product default is mesh-on).
    """
    rows = list(
        (
            await db.execute(
                select(UserSource)
                .where(UserSource.user_id == user_id)
                .order_by(UserSource.created_at)
            )
        )
        .scalars()
        .all()
    )

    try:
        from services.reticulum_node import load_config as _load_mesh_config

        mesh_cfg = _load_mesh_config()
        mesh_enabled = mesh_cfg.mode != "off"
        mesh_name = (mesh_cfg.display_name or "").strip() or "Reticulum mesh"
    except Exception:  # config unreadable → no seed, never break the list
        mesh_enabled = False
        mesh_name = "Reticulum mesh"

    if mesh_enabled and not any(
        r.kind == "reticulum" and (r.host or "") == "" for r in rows
    ):
        seeded = UserSource(
            user_id=user_id,
            kind="reticulum",
            host="",
            display_name=mesh_name,
            api_base=None,
            homeserver_url=None,
            meta=json.dumps({"seeded": "instance-node"}),
        )
        db.add(seeded)
        await db.commit()
        await db.refresh(seeded)
        rows.append(seeded)

    return [_source_out(r) for r in rows]


@router.post("/sources", response_model=UserSourceOut)
async def upsert_my_source(
    payload: UserSourceIn,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
) -> UserSourceOut:
    """Add (or refresh) one source in the caller's catalogue.

    Upsert key is ``(user_id, kind, host)`` — re-adding the same remote
    updates its descriptor instead of duplicating the tile.
    """
    kind, host = _validate_source(payload)
    meta_json = json.dumps(payload.meta or {})
    if len(meta_json.encode("utf-8")) > MAX_META_BYTES:
        raise HTTPException(400, f"meta must be <= {MAX_META_BYTES} bytes")

    existing = (
        await db.execute(
            select(UserSource).where(
                UserSource.user_id == user_id,
                UserSource.kind == kind,
                UserSource.host == host,
            )
        )
    ).scalar_one_or_none()

    if existing is not None:
        existing.display_name = payload.display_name
        existing.api_base = payload.api_base
        existing.homeserver_url = payload.homeserver_url
        existing.meta = meta_json
        row = existing
    else:
        count = len(
            (
                await db.execute(
                    select(UserSource.id).where(UserSource.user_id == user_id)
                )
            ).all()
        )
        if count >= MAX_SOURCES_PER_USER:
            raise HTTPException(429, "source catalogue limit reached")
        row = UserSource(
            user_id=user_id,
            kind=kind,
            host=host,
            display_name=payload.display_name,
            api_base=payload.api_base,
            homeserver_url=payload.homeserver_url,
            meta=meta_json,
        )
        db.add(row)
    await db.commit()
    await db.refresh(row)
    return _source_out(row)


@router.delete("/sources/{source_id}")
async def delete_my_source(
    source_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Remove one of the caller's sources. 404 for anything not theirs —
    other users' rows are indistinguishable from nonexistent ones."""
    row = (
        await db.execute(
            select(UserSource).where(
                UserSource.id == source_id,
                UserSource.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "source not found")
    await db.delete(row)
    await db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Persona bindings
# ---------------------------------------------------------------------------

def _binding_out(row: PersonaBinding) -> PersonaBindingOut:
    return PersonaBindingOut(
        persona_id=row.persona_id,
        persona_pubkey=row.persona_pubkey.hex() if row.persona_pubkey else None,
        label=row.label,
        created_at=_iso(row.created_at),
    )


@router.get("/personas", response_model=list[PersonaBindingOut])
async def list_my_personas(
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
) -> list[PersonaBindingOut]:
    result = await db.execute(
        select(PersonaBinding)
        .where(PersonaBinding.user_id == user_id)
        .order_by(PersonaBinding.created_at)
    )
    return [_binding_out(r) for r in result.scalars().all()]


@router.post("/personas", response_model=PersonaBindingOut)
async def claim_persona(
    payload: PersonaBindingIn,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
) -> PersonaBindingOut:
    """Bind a persona to the calling account (first authenticated claim wins).

    409 if the persona is already bound to a different account. Re-claiming
    a persona the caller already owns refreshes its label/pubkey.
    """
    persona_id = payload.persona_id.strip()
    if not _PERSONA_ID_RE.match(persona_id):
        raise HTTPException(400, "invalid persona_id")

    pubkey_bytes: bytes | None = None
    if payload.persona_pubkey:
        try:
            pubkey_bytes = bytes.fromhex(payload.persona_pubkey)
        except ValueError:
            raise HTTPException(400, "persona_pubkey must be valid hex")
        if len(pubkey_bytes) != 32:
            raise HTTPException(400, "persona_pubkey must be 32 bytes (Ed25519)")

    existing = (
        await db.execute(
            select(PersonaBinding).where(PersonaBinding.persona_id == persona_id)
        )
    ).scalar_one_or_none()

    if existing is not None:
        if existing.user_id != user_id:
            raise HTTPException(409, "persona is bound to a different account")
        if payload.label is not None:
            existing.label = payload.label
        if pubkey_bytes is not None:
            existing.persona_pubkey = pubkey_bytes
        row = existing
    else:
        count = len(
            (
                await db.execute(
                    select(PersonaBinding.id).where(PersonaBinding.user_id == user_id)
                )
            ).all()
        )
        if count >= MAX_PERSONAS_PER_USER:
            raise HTTPException(429, "persona binding limit reached")
        row = PersonaBinding(
            user_id=user_id,
            persona_id=persona_id,
            persona_pubkey=pubkey_bytes,
            label=payload.label,
        )
        db.add(row)
    await db.commit()
    await db.refresh(row)
    return _binding_out(row)


@router.delete("/personas/{persona_id}")
async def release_persona(
    persona_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    row = (
        await db.execute(
            select(PersonaBinding).where(
                PersonaBinding.persona_id == persona_id,
                PersonaBinding.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "persona binding not found")
    await db.delete(row)
    await db.commit()
    return {"ok": True}
