"""Pending-message relay (``/api/relay/*``) — store-and-forward for the
p2p pathway.

The UX hole this fills: Concord's native messenger is pure p2p; an
undelivered message lives only in the SENDER's local queue and flushes
on the next direct connection. Two peers that are never online at the
same moment can never exchange a message. The docker instance — the
always-on node — closes that hole as a *mailbox*, without ever becoming
a message reader:

- **Deposit** (``POST /api/relay/messages``): an authenticated caller
  leaves an opaque payload for a recipient persona. The recipient must
  be a validated user of this instance (a ``persona_bindings`` row) —
  the pillar stores for its own users, not the open internet. A sender
  MAY attest a sending persona with an Ed25519 signature over the
  deposit canonical message (same pattern as mesh presence); if that
  persona is bound to a key on this instance, the signature MUST verify
  against it.
- **Fetch** (``GET /api/relay/messages``): strictly user-scoped — only
  rows addressed to personas bound to the calling account.
- **Ack** (``POST /api/relay/messages/ack``): marks rows delivered;
  delivered rows are retained (until TTL) so the sender can see
  delivery receipts, then swept.
- **Deposit receipts** (``GET /api/relay/deposits``): the sender's own
  view — did my deposit get picked up? User-scoped to the caller's
  deposits.

Bounds (2026-08-12 protections pass): payload <= 256 KiB (matches the
native protocol's MAX_FRAME_BYTES), <= 500 pending rows per recipient,
default TTL 30 days (clamped 1 hour .. 90 days). The global rate-limit
middleware additionally throttles ``/api/relay/`` as a sensitive path.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import logging
import re
from datetime import datetime, timedelta, timezone

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_user_id
from models import PendingMessage, PersonaBinding

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/relay", tags=["relay"])

MAX_PAYLOAD_BYTES = 256 * 1024  # matches /concord/social-inbox MAX_FRAME_BYTES
MAX_PENDING_PER_RECIPIENT = 500
DEFAULT_TTL_SECS = 30 * 24 * 3600
MIN_TTL_SECS = 3600
MAX_TTL_SECS = 90 * 24 * 3600

_PERSONA_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")

DEPOSIT_SIG_CONTEXT = "concord-relay-deposit/v1"


def deposit_canonical_message(
    sender_persona: str,
    sender_pubkey_hex: str,
    to_persona: str,
    wire_id: str,
    payload_sha256_hex: str,
) -> bytes:
    """Canonical byte string a sender's persona key signs over a deposit.

    Mirrors the mesh-presence canonical-message style (stable framing,
    newline-separated, hex-normalized) so native implementations can
    reuse the same signing plumbing:

        concord-relay-deposit/v1\\n<sender_persona>\\n<pubkey_hex>\\n
        <to_persona>\\n<wire_id>\\n<sha256_hex(payload)>
    """
    msg = (
        f"{DEPOSIT_SIG_CONTEXT}\n"
        f"{sender_persona}\n"
        f"{sender_pubkey_hex}\n"
        f"{to_persona}\n"
        f"{wire_id}\n"
        f"{payload_sha256_hex}"
    )
    return msg.encode("utf-8")


class DepositRequest(BaseModel):
    to_persona: str = Field(min_length=1, max_length=128)
    payload_b64: str = Field(min_length=1)
    # Sender-side message id the recipient dedupes on (the inbox ULID).
    wire_id: str = Field(min_length=1, max_length=64)
    ttl_secs: int = Field(default=DEFAULT_TTL_SECS)
    # Optional persona attestation (hex pubkey + hex Ed25519 signature
    # over deposit_canonical_message).
    sender_persona: str | None = Field(default=None, max_length=128)
    sender_pubkey: str | None = None
    sig: str | None = None


class DepositResponse(BaseModel):
    id: str
    expires_at: str


class PendingOut(BaseModel):
    id: str
    to_persona: str
    payload_b64: str
    wire_id: str | None
    channel: str
    sender_user_id: str | None
    sender_persona: str | None
    sender_pubkey: str | None
    sender_identity_hash: str | None
    deposited_at: str


class AckRequest(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=200)


class DepositReceipt(BaseModel):
    id: str
    to_persona: str
    wire_id: str | None
    deposited_at: str
    expires_at: str
    delivered: bool


async def _bound_personas(db: AsyncSession, user_id: str) -> list[str]:
    result = await db.execute(
        select(PersonaBinding.persona_id).where(PersonaBinding.user_id == user_id)
    )
    return [row[0] for row in result.all()]


@router.post("/messages", response_model=DepositResponse)
async def deposit_message(
    body: DepositRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
) -> DepositResponse:
    """Deposit an opaque payload for an offline recipient persona."""
    if not _PERSONA_ID_RE.match(body.to_persona):
        raise HTTPException(400, "invalid recipient persona id")

    try:
        payload = base64.b64decode(body.payload_b64, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(400, "payload_b64 must be valid base64")
    if not payload or len(payload) > MAX_PAYLOAD_BYTES:
        raise HTTPException(400, f"payload must be 1..{MAX_PAYLOAD_BYTES} bytes")

    # Recipient must be a validated user of this instance. 404 (not 403)
    # so the endpoint is not an oracle distinguishing "exists but not
    # yours" from "doesn't exist".
    recipient_binding = (
        await db.execute(
            select(PersonaBinding).where(
                PersonaBinding.persona_id == body.to_persona
            )
        )
    ).scalar_one_or_none()
    if recipient_binding is None:
        raise HTTPException(404, "unknown recipient")

    # Optional sender persona attestation.
    sender_persona: str | None = None
    sender_pubkey_bytes: bytes | None = None
    if body.sender_persona:
        if not body.sender_pubkey or not body.sig:
            raise HTTPException(400, "sender attestation requires sender_pubkey and sig")
        if not _PERSONA_ID_RE.match(body.sender_persona):
            raise HTTPException(400, "invalid sender persona id")
        try:
            sender_pubkey_bytes = bytes.fromhex(body.sender_pubkey)
            sig_bytes = bytes.fromhex(body.sig)
        except ValueError:
            raise HTTPException(400, "sender_pubkey and sig must be hex")
        if len(sender_pubkey_bytes) != 32 or len(sig_bytes) != 64:
            raise HTTPException(400, "sender_pubkey must be 32 bytes, sig 64 bytes")
        message = deposit_canonical_message(
            body.sender_persona,
            sender_pubkey_bytes.hex(),
            body.to_persona,
            body.wire_id,
            hashlib.sha256(payload).hexdigest(),
        )
        try:
            Ed25519PublicKey.from_public_bytes(sender_pubkey_bytes).verify(
                sig_bytes, message
            )
        except (InvalidSignature, Exception):  # noqa: BLE001 — fail closed
            raise HTTPException(400, "deposit signature verification failed")
        # If this persona is bound on this instance, the attesting key
        # must be ITS key — the same hijack guard mesh presence applies.
        sender_binding = (
            await db.execute(
                select(PersonaBinding).where(
                    PersonaBinding.persona_id == body.sender_persona
                )
            )
        ).scalar_one_or_none()
        if (
            sender_binding is not None
            and sender_binding.persona_pubkey is not None
            and sender_binding.persona_pubkey != sender_pubkey_bytes
        ):
            raise HTTPException(403, "sender persona is bound to a different key")
        sender_persona = body.sender_persona

    # Per-recipient mailbox cap (undelivered rows only).
    pending_count = (
        await db.execute(
            select(func.count())
            .select_from(PendingMessage)
            .where(
                PendingMessage.recipient_persona_id == body.to_persona,
                PendingMessage.delivered_at.is_(None),
            )
        )
    ).scalar_one()
    if pending_count >= MAX_PENDING_PER_RECIPIENT:
        raise HTTPException(429, "recipient mailbox is full")

    ttl = max(MIN_TTL_SECS, min(int(body.ttl_secs), MAX_TTL_SECS))
    now = datetime.now(timezone.utc)
    row = PendingMessage(
        recipient_persona_id=body.to_persona,
        sender_user_id=user_id,
        sender_persona_id=sender_persona,
        sender_pubkey=sender_pubkey_bytes,
        channel="http",
        wire_id=body.wire_id,
        payload=payload,
        deposited_at=now,
        expires_at=now + timedelta(seconds=ttl),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return DepositResponse(id=row.id, expires_at=row.expires_at.isoformat())


@router.get("/messages", response_model=list[PendingOut])
async def fetch_pending(
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
) -> list[PendingOut]:
    """The caller's pending mail: rows addressed to THEIR bound personas
    only. Non-destructive — ack to mark delivered."""
    personas = await _bound_personas(db, user_id)
    if not personas:
        return []
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(PendingMessage)
        .where(
            PendingMessage.recipient_persona_id.in_(personas),
            PendingMessage.delivered_at.is_(None),
            PendingMessage.expires_at > now,
        )
        .order_by(PendingMessage.deposited_at)
        .limit(200)
    )
    return [
        PendingOut(
            id=r.id,
            to_persona=r.recipient_persona_id,
            payload_b64=base64.b64encode(r.payload).decode("ascii"),
            wire_id=r.wire_id,
            channel=r.channel,
            sender_user_id=r.sender_user_id,
            sender_persona=r.sender_persona_id,
            sender_pubkey=r.sender_pubkey.hex() if r.sender_pubkey else None,
            sender_identity_hash=r.sender_identity_hash,
            deposited_at=r.deposited_at.isoformat(),
        )
        for r in result.scalars().all()
    ]


@router.post("/messages/ack")
async def ack_messages(
    body: AckRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Mark fetched rows delivered. Only rows addressed to the caller's
    personas are affected; foreign ids are silently ignored (they are
    indistinguishable from nonexistent ones)."""
    personas = await _bound_personas(db, user_id)
    if not personas:
        return {"acked": 0}
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(PendingMessage).where(
            PendingMessage.id.in_(body.ids),
            PendingMessage.recipient_persona_id.in_(personas),
            PendingMessage.delivered_at.is_(None),
        )
    )
    rows = list(result.scalars().all())
    for r in rows:
        r.delivered_at = now
    await db.commit()
    return {"acked": len(rows)}


@router.get("/deposits", response_model=list[DepositReceipt])
async def my_deposits(
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
) -> list[DepositReceipt]:
    """Delivery receipts for the CALLER's own deposits (user-scoped)."""
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(PendingMessage)
        .where(
            PendingMessage.sender_user_id == user_id,
            PendingMessage.expires_at > now,
        )
        .order_by(PendingMessage.deposited_at.desc())
        .limit(200)
    )
    return [
        DepositReceipt(
            id=r.id,
            to_persona=r.recipient_persona_id,
            wire_id=r.wire_id,
            deposited_at=r.deposited_at.isoformat(),
            expires_at=r.expires_at.isoformat(),
            delivered=r.delivered_at is not None,
        )
        for r in result.scalars().all()
    ]


async def sweep_expired_messages(db: AsyncSession) -> int:
    """Delete expired rows (delivered or not). Called from the lifespan
    sweeper alongside mesh-presence eviction."""
    now = datetime.now(timezone.utc)
    result = await db.execute(
        delete(PendingMessage).where(PendingMessage.expires_at <= now)
    )
    await db.commit()
    return result.rowcount or 0
