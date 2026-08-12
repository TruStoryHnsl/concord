"""Reticulum pillar endpoints (``/api/reticulum/*``).

Surfaces the server-side reticulum node (services/reticulum_node.py):

- ``GET/PUT /api/admin/reticulum`` — operator config (mode, entrypoint
  domain/port, announce cadence). Follows the service-node config
  pattern: full view is admin-only.
- ``GET /api/reticulum/entrypoint`` — the routing descriptor a client
  needs to dial this pillar. Mode-gated:
    * ``public``  → any authenticated user gets it (and it is also
      advertised in ``/.well-known/concord/client``);
    * ``private`` → ONLY accounts with at least one persona binding —
      validated concord-native users of this instance. The domain is a
      secret; this endpoint is its sole distribution channel.
    * ``off``     → 404 for everyone.
- ``GET /api/reticulum/status`` — coarse runtime health for the UI.
  Never includes the entry domain (that is the entrypoint endpoint's
  job, with its gating).
- ``POST /api/reticulum/send`` — send a Concord ``RelayFrame`` v1 text
  frame to a persona destination over the mesh. This is the web user's
  reticulum messaging path: the pillar is their transport.
"""
from __future__ import annotations

import asyncio
import logging
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_user_id
from models import PersonaBinding
from routers.admin import require_admin

logger = logging.getLogger(__name__)

router = APIRouter(tags=["reticulum"])

_DOMAIN_RE = re.compile(
    r"^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*"
    r"[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$"
)
_PERSONA_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
_DEST_RE = re.compile(r"^[0-9a-fA-F]{32}$")


class ReticulumAdminConfig(BaseModel):
    model_config = {"extra": "forbid"}

    mode: str | None = None
    entry_domain: str | None = None
    listen_port: int | None = Field(default=None, ge=1, le=65535)
    announce_interval_secs: int | None = Field(default=None, ge=30, le=86400)
    display_name: str | None = Field(default=None, max_length=64)


class EntrypointDescriptor(BaseModel):
    mode: str
    domain: str | None
    port: int
    pillar_identity: str | None
    mailbox_destination: str | None
    # How a native client consumes this: add a TCPClientInterface with
    # target_host=domain, target_port=port via the R6 interface editor.
    interface_type: str = "TCPClientInterface"


def _service():
    # Inline import so test monkeypatching of the service module works
    # (same rationale as wellknown.py's inline imports).
    from services import reticulum_node

    return reticulum_node


@router.get("/api/admin/reticulum")
async def get_admin_reticulum(user_id: str = Depends(get_user_id)) -> dict:
    require_admin(user_id)
    svc = _service()
    cfg = svc.load_config()
    return {
        "config": {
            "mode": cfg.mode,
            "entry_domain": cfg.entry_domain,
            "listen_host": cfg.listen_host,
            "listen_port": cfg.listen_port,
            "announce_interval_secs": cfg.announce_interval_secs,
            "display_name": cfg.display_name,
        },
        "status": svc.runtime.status(),
        "limits": {
            "modes": list(svc.MODES),
            "announce_interval_secs": {"min": 30, "max": 86400},
        },
    }


@router.put("/api/admin/reticulum")
async def put_admin_reticulum(
    body: ReticulumAdminConfig,
    user_id: str = Depends(get_user_id),
) -> dict:
    require_admin(user_id)
    svc = _service()
    cfg = svc.load_config()

    if body.mode is not None:
        cfg.mode = body.mode.strip().lower()
    if body.entry_domain is not None:
        domain = body.entry_domain.strip().lower()
        if domain and not _DOMAIN_RE.match(domain):
            raise HTTPException(400, "entry_domain must be a valid hostname")
        cfg.entry_domain = domain or None
    if body.listen_port is not None:
        cfg.listen_port = body.listen_port
    if body.announce_interval_secs is not None:
        cfg.announce_interval_secs = body.announce_interval_secs
    if body.display_name is not None:
        cfg.display_name = body.display_name.strip() or "Concord Pillar"

    errors = cfg.validate()
    if errors:
        raise HTTPException(400, "; ".join(errors))

    svc.save_config(cfg)
    if not svc.runtime.rns_available() and cfg.mode != "off":
        return {
            "saved": True,
            "running": False,
            "restart_required": False,
            "warning": (
                "rns is not installed in this image — rebuild with "
                "CONCORD_INSTALL_RNS=1 (docker-compose.reticulum.yml)"
            ),
        }
    apply_result = svc.runtime.apply_config(cfg)
    return {"saved": True, **apply_result}


@router.get("/api/reticulum/status")
async def reticulum_status(user_id: str = Depends(get_user_id)) -> dict:
    """Coarse node health for any authenticated user. Never carries the
    entry domain — private-mode secrecy lives in /entrypoint."""
    svc = _service()
    status = svc.runtime.status()
    return {
        "mode": status["mode"],
        "available": status["available"],
        "running": status["running"],
        "mailbox_destination": status["mailbox_destination"],
    }


@router.get("/api/reticulum/entrypoint", response_model=EntrypointDescriptor)
async def reticulum_entrypoint(
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
) -> EntrypointDescriptor:
    svc = _service()
    cfg = svc.load_config()
    if cfg.mode == "off":
        raise HTTPException(404, "this instance is not a reticulum entrypoint")
    if cfg.mode == "private":
        # Validated concord-native users only: the account must have
        # claimed at least one persona through the auth pathway. 404 —
        # to anyone else, private mode is indistinguishable from off.
        bound = (
            await db.execute(
                select(PersonaBinding.id)
                .where(PersonaBinding.user_id == user_id)
                .limit(1)
            )
        ).first()
        if bound is None:
            raise HTTPException(404, "this instance is not a reticulum entrypoint")
    return EntrypointDescriptor(
        mode=cfg.mode,
        domain=cfg.entry_domain,
        port=cfg.listen_port,
        pillar_identity=svc.runtime.identity_hash(),
        mailbox_destination=svc.runtime.mailbox_destination_hash(),
    )


class SendTextRequest(BaseModel):
    destination_hash: str = Field(min_length=32, max_length=32)
    persona_id: str = Field(min_length=1, max_length=128)
    body: str = Field(min_length=1, max_length=4096)
    from_name: str | None = Field(default=None, max_length=64)


@router.post("/api/reticulum/send")
async def reticulum_send(
    body: SendTextRequest,
    user_id: str = Depends(get_user_id),
) -> dict:
    """Send a RelayFrame v1 text frame to a persona destination.

    The pillar is the web user's reticulum transport: it opens (or
    reuses) an encrypted RNS link to the destination and sends the same
    wire bytes a native peer would. ``from`` defaults to the caller's
    Matrix localpart — free-text display attribution, exactly like the
    native frame.
    """
    if not _DEST_RE.match(body.destination_hash):
        raise HTTPException(400, "destination_hash must be 32 hex chars")
    if not _PERSONA_ID_RE.match(body.persona_id):
        raise HTTPException(400, "invalid persona_id")
    svc = _service()
    status = svc.runtime.status()
    if not status["running"]:
        raise HTTPException(503, "reticulum node is not running on this instance")

    from_name = body.from_name or user_id.split(":", 1)[0].lstrip("@") or "concord"
    loop = asyncio.get_event_loop()
    try:
        await loop.run_in_executor(
            None,
            lambda: svc.runtime.send_text(
                body.destination_hash.lower(),
                body.persona_id,
                from_name,
                body.body,
            ),
        )
    except RuntimeError as exc:
        raise HTTPException(502, str(exc))
    return {"sent": True}
