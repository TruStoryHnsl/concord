"""Per-user conversation + contact store (``/api/me/conversations``,
``/api/me/contacts``) — the D1/D2 portal messenger backend.

The docker instance is a PORTAL: the browser never holds superuser or
p2p keys (identity model: superuser = device↔device only). This router
is the server-side history the pillar persists on an account's behalf so
the web session behaves like a real threaded messenger instead of a
one-shot sender:

- **D1 conversation store** — durable rows for what the pillar SENDS for
  the account (web-originated mesh sends via ``POST /api/reticulum/send``
  and the composer here). On READ it UNIFIES three inbound/other sources
  into ONE inbox, keyed like native (``reticulum:<dest>`` etc.):
    1. the durable store rows (outbound web sends),
    2. device-roamed rows the native app pushed (``user_sync`` kinds
       ``conversation`` / ``message``),
    3. relay-mailbox deliveries addressed to the account's personas
       (``pending_messages``), folded in live so mail shows in-thread.
- **D2 known-peers registry** — per-user contacts folded from mesh sends,
  relay senders, and roamed contacts, with account-local label/trust the
  browser may edit (X1) — never touching superuser keys.
- **D5 delivery states** — each stored message carries an LXMF-style
  ``state`` (queued → sent → failed for outbound; received for inbound);
  the pillar advances it only as far as it actually knows.

Write-path split (X2/N5): the browser may ORIGINATE mesh sends, mailbox
deposits, contact label/trust edits, and prefs. It may NOT originate
superuser ops or key/trust cryptographic changes — those stay device-only
(see ``docs`` block in ``user_sync.py``). Every read/write here is
strictly scoped to the calling account.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_user_id
from models import (
    PendingMessage,
    PersonaBinding,
    UserContact,
    UserConversation,
    UserConversationMessage,
    UserSyncItem,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/me", tags=["me-conversations"])

_PEER_KEY_RE = re.compile(r"^[A-Za-z0-9._:+/=-]{1,160}$")
_DEST_RE = re.compile(r"^[0-9a-fA-F]{32}$")
_PERSONA_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")

MAX_CONVERSATIONS_PER_USER = 2_000
MAX_MESSAGES_PER_CONVERSATION = 500
MAX_CONTACTS_PER_USER = 2_000
TRUST_VALUES = {"unverified", "verified", "blocked"}


# ---------------------------------------------------------------------------
# Serialization models
# ---------------------------------------------------------------------------

class ConversationOut(BaseModel):
    peer_key: str
    persona_id: str | None = None
    label: str | None = None
    last_preview: str | None = None
    last_message_at: str | None = None
    sources: list[str]


class MessageOut(BaseModel):
    id: str
    peer_key: str
    direction: str
    body: str | None = None
    payload_b64: str | None = None
    from_name: str | None = None
    channel: str
    state: str
    wire_id: str | None = None
    at: str
    source: str


class SendMessageIn(BaseModel):
    body: str = Field(min_length=1, max_length=4096)
    persona_id: str | None = Field(default=None, max_length=128)
    label: str | None = Field(default=None, max_length=200)


class ContactOut(BaseModel):
    peer_key: str
    persona_id: str | None = None
    label: str | None = None
    trust: str
    source: str
    last_seen: str | None = None


class ContactIn(BaseModel):
    peer_key: str = Field(min_length=1, max_length=160)
    persona_id: str | None = Field(default=None, max_length=128)
    label: str | None = Field(default=None, max_length=200)
    trust: str | None = None


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _relay_peer_key(row: PendingMessage) -> str:
    """Derive a stable conversation key for a relayed inbound message."""
    if row.sender_persona_id:
        return f"persona:{row.sender_persona_id}"
    if row.sender_identity_hash:
        return f"rns:{row.sender_identity_hash}"
    if row.sender_user_id:
        return f"user:{row.sender_user_id}"
    return "rns:unknown"


def _decode_relay_body(payload: bytes) -> str | None:
    """Best-effort plaintext of a relayed RelayFrame/social payload."""
    try:
        parsed = json.loads(payload.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None
    if isinstance(parsed, dict):
        b = parsed.get("body")
        if isinstance(b, dict) and isinstance(b.get("body"), str):
            return b["body"]
        if isinstance(b, str):
            return b
    return None


async def _bound_personas(db: AsyncSession, user_id: str) -> list[str]:
    result = await db.execute(
        select(PersonaBinding.persona_id).where(PersonaBinding.user_id == user_id)
    )
    return [r[0] for r in result.all()]


# ---------------------------------------------------------------------------
# Shared recording helpers (imported by routers/reticulum.py)
# ---------------------------------------------------------------------------

async def record_outbound_message(
    db: AsyncSession,
    user_id: str,
    peer_key: str,
    body: str,
    *,
    persona_id: str | None = None,
    from_name: str | None = None,
    channel: str = "reticulum",
    state: str = "sent",
    label: str | None = None,
) -> UserConversationMessage:
    """Persist an outbound message + bump the conversation head. Also folds
    the peer into the account's contacts registry (source=mesh_send).

    Idempotent-ish: bounded per conversation (oldest pruned past the cap).
    The caller commits.
    """
    now = datetime.now(timezone.utc)
    msg = UserConversationMessage(
        user_id=user_id,
        peer_key=peer_key,
        direction="out",
        body=body,
        from_name=from_name,
        channel=channel,
        state=state,
    )
    db.add(msg)

    convo = (
        await db.execute(
            select(UserConversation).where(
                UserConversation.user_id == user_id,
                UserConversation.peer_key == peer_key,
            )
        )
    ).scalar_one_or_none()
    preview = body[:512]
    if convo is None:
        convo = UserConversation(
            user_id=user_id,
            peer_key=peer_key,
            persona_id=persona_id,
            label=label,
            last_preview=preview,
            last_message_at=now,
        )
        db.add(convo)
    else:
        convo.last_preview = preview
        convo.last_message_at = now
        if persona_id:
            convo.persona_id = persona_id
        if label:
            convo.label = label

    await _upsert_contact(
        db, user_id, peer_key, persona_id=persona_id, source="mesh_send", seen=now
    )
    await _prune_conversation_messages(db, user_id, peer_key)
    return msg


async def _prune_conversation_messages(
    db: AsyncSession, user_id: str, peer_key: str
) -> None:
    count = (
        await db.execute(
            select(func.count())
            .select_from(UserConversationMessage)
            .where(
                UserConversationMessage.user_id == user_id,
                UserConversationMessage.peer_key == peer_key,
            )
        )
    ).scalar_one()
    if count <= MAX_MESSAGES_PER_CONVERSATION:
        return
    overflow = count - MAX_MESSAGES_PER_CONVERSATION
    oldest = (
        await db.execute(
            select(UserConversationMessage.id)
            .where(
                UserConversationMessage.user_id == user_id,
                UserConversationMessage.peer_key == peer_key,
            )
            .order_by(UserConversationMessage.created_at)
            .limit(overflow)
        )
    ).scalars().all()
    if oldest:
        await db.execute(
            delete(UserConversationMessage).where(
                UserConversationMessage.id.in_(oldest)
            )
        )


async def _upsert_contact(
    db: AsyncSession,
    user_id: str,
    peer_key: str,
    *,
    persona_id: str | None = None,
    label: str | None = None,
    trust: str | None = None,
    source: str = "manual",
    seen: datetime | None = None,
) -> UserContact:
    row = (
        await db.execute(
            select(UserContact).where(
                UserContact.user_id == user_id,
                UserContact.peer_key == peer_key,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        count = (
            await db.execute(
                select(func.count())
                .select_from(UserContact)
                .where(UserContact.user_id == user_id)
            )
        ).scalar_one()
        if count >= MAX_CONTACTS_PER_USER:
            # Registry is full: skip auto-learned folds silently; a manual
            # add still surfaces the 429 to the caller.
            if source != "manual":
                return None  # type: ignore[return-value]
            raise HTTPException(429, "contact registry is full")
        row = UserContact(
            user_id=user_id,
            peer_key=peer_key,
            persona_id=persona_id,
            label=label,
            trust=trust or "unverified",
            source=source,
            last_seen=seen,
        )
        db.add(row)
    else:
        if persona_id and not row.persona_id:
            row.persona_id = persona_id
        if label is not None:
            row.label = label
        if trust is not None:
            row.trust = trust
        if seen is not None:
            row.last_seen = seen
    return row


# ---------------------------------------------------------------------------
# Conversations
# ---------------------------------------------------------------------------

@router.get("/conversations", response_model=list[ConversationOut])
async def list_conversations(
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
) -> list[ConversationOut]:
    """The account's unified inbox: durable pillar-sent threads + roamed
    device threads + live relay mail, deduped by peer key."""
    merged: dict[str, dict] = {}

    def touch(key: str, source: str, *, preview=None, at=None, persona=None, label=None):
        entry = merged.setdefault(
            key,
            {
                "peer_key": key,
                "persona_id": None,
                "label": None,
                "last_preview": None,
                "last_message_at": None,
                "sources": set(),
            },
        )
        entry["sources"].add(source)
        if persona and not entry["persona_id"]:
            entry["persona_id"] = persona
        if label and not entry["label"]:
            entry["label"] = label
        if at and (entry["last_message_at"] is None or at > entry["last_message_at"]):
            entry["last_message_at"] = at
            if preview is not None:
                entry["last_preview"] = preview

    # 1. durable store
    store = (
        await db.execute(
            select(UserConversation).where(UserConversation.user_id == user_id)
        )
    ).scalars().all()
    for c in store:
        touch(
            c.peer_key,
            "pillar",
            preview=c.last_preview,
            at=_iso(c.last_message_at),
            persona=c.persona_id,
            label=c.label,
        )

    # 2. roamed device conversations
    roamed = (
        await db.execute(
            select(UserSyncItem).where(
                UserSyncItem.user_id == user_id,
                UserSyncItem.kind == "conversation",
                UserSyncItem.deleted == False,  # noqa: E712
            )
        )
    ).scalars().all()
    for r in roamed:
        try:
            data = json.loads(r.data)
        except ValueError:
            data = {}
        gn = data.get("groupName")
        touch(
            r.key,
            "roamed",
            preview=data.get("lastPreview"),
            at=data.get("lastMessageAt"),
            label=gn if isinstance(gn, str) and gn else None,
        )

    # 3. live relay mail
    personas = await _bound_personas(db, user_id)
    if personas:
        now = datetime.now(timezone.utc)
        pending = (
            await db.execute(
                select(PendingMessage).where(
                    PendingMessage.recipient_persona_id.in_(personas),
                    PendingMessage.delivered_at.is_(None),
                    PendingMessage.expires_at > now,
                )
            )
        ).scalars().all()
        for p in pending:
            touch(
                _relay_peer_key(p),
                "mailbox",
                preview=_decode_relay_body(p.payload) or "(sealed message)",
                at=_iso(p.deposited_at),
                persona=p.sender_persona_id,
            )

    out = [
        ConversationOut(
            peer_key=e["peer_key"],
            persona_id=e["persona_id"],
            label=e["label"],
            last_preview=e["last_preview"],
            last_message_at=e["last_message_at"],
            sources=sorted(e["sources"]),
        )
        for e in merged.values()
    ]
    out.sort(key=lambda c: c.last_message_at or "", reverse=True)
    return out


@router.get("/conversations/export")
async def export_conversations(
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """X1 — the account's full portal history as a JSON blob it can save
    off. Store rows only (durable pillar-side history + contacts); roamed
    rows already live on the device that pushed them."""
    convos = (
        await db.execute(
            select(UserConversation).where(UserConversation.user_id == user_id)
        )
    ).scalars().all()
    msgs = (
        await db.execute(
            select(UserConversationMessage).where(
                UserConversationMessage.user_id == user_id
            )
        )
    ).scalars().all()
    contacts = (
        await db.execute(
            select(UserContact).where(UserContact.user_id == user_id)
        )
    ).scalars().all()
    return {
        "exported_at": _iso(datetime.now(timezone.utc)),
        "conversations": [
            {
                "peer_key": c.peer_key,
                "persona_id": c.persona_id,
                "label": c.label,
                "last_preview": c.last_preview,
                "last_message_at": _iso(c.last_message_at),
            }
            for c in convos
        ],
        "messages": [
            {
                "peer_key": m.peer_key,
                "direction": m.direction,
                "body": m.body,
                "payload_b64": m.payload_b64,
                "from_name": m.from_name,
                "channel": m.channel,
                "state": m.state,
                "wire_id": m.wire_id,
                "at": _iso(m.created_at),
            }
            for m in msgs
        ],
        "contacts": [
            {
                "peer_key": c.peer_key,
                "persona_id": c.persona_id,
                "label": c.label,
                "trust": c.trust,
                "source": c.source,
            }
            for c in contacts
        ],
    }


def _validate_peer_key(peer_key: str) -> str:
    if not _PEER_KEY_RE.match(peer_key):
        raise HTTPException(400, "invalid peer key")
    return peer_key


@router.get("/conversations/{peer_key}/messages", response_model=list[MessageOut])
async def conversation_messages(
    peer_key: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
) -> list[MessageOut]:
    """One thread's messages: durable store + roamed device rows + live
    relay mail for this peer, ordered oldest→newest, deduped by wire id."""
    _validate_peer_key(peer_key)
    seen_wire: set[str] = set()
    out: list[MessageOut] = []

    store = (
        await db.execute(
            select(UserConversationMessage)
            .where(
                UserConversationMessage.user_id == user_id,
                UserConversationMessage.peer_key == peer_key,
            )
            .order_by(UserConversationMessage.created_at)
        )
    ).scalars().all()
    for m in store:
        if m.wire_id:
            seen_wire.add(m.wire_id)
        out.append(
            MessageOut(
                id=m.id,
                peer_key=m.peer_key,
                direction=m.direction,
                body=m.body,
                payload_b64=m.payload_b64,
                from_name=m.from_name,
                channel=m.channel,
                state=m.state,
                wire_id=m.wire_id,
                at=_iso(m.created_at) or "",
                source="pillar",
            )
        )

    # roamed messages for this conversation
    roamed = (
        await db.execute(
            select(UserSyncItem).where(
                UserSyncItem.user_id == user_id,
                UserSyncItem.kind == "message",
                UserSyncItem.deleted == False,  # noqa: E712
            )
        )
    ).scalars().all()
    for r in roamed:
        try:
            data = json.loads(r.data)
        except ValueError:
            continue
        if data.get("conversation") != peer_key:
            continue
        if r.key in seen_wire:
            continue
        seen_wire.add(r.key)
        out.append(
            MessageOut(
                id=r.key,
                peer_key=peer_key,
                direction="out" if data.get("direction") == "out" else "in",
                body=str(data.get("body")) if data.get("body") is not None else None,
                payload_b64=None,
                from_name=data.get("from") if isinstance(data.get("from"), str) else None,
                channel="roamed",
                state="delivered",
                wire_id=r.key,
                at=str(data.get("sentAt") or ""),
                source="roamed",
            )
        )

    # live relay mail addressed to this peer
    personas = await _bound_personas(db, user_id)
    if personas:
        now = datetime.now(timezone.utc)
        pending = (
            await db.execute(
                select(PendingMessage).where(
                    PendingMessage.recipient_persona_id.in_(personas),
                    PendingMessage.delivered_at.is_(None),
                    PendingMessage.expires_at > now,
                )
            )
        ).scalars().all()
        for p in pending:
            if _relay_peer_key(p) != peer_key:
                continue
            if p.wire_id and p.wire_id in seen_wire:
                continue
            if p.wire_id:
                seen_wire.add(p.wire_id)
            out.append(
                MessageOut(
                    id=p.id,
                    peer_key=peer_key,
                    direction="in",
                    body=_decode_relay_body(p.payload),
                    payload_b64=base64.b64encode(p.payload).decode("ascii"),
                    from_name=p.sender_persona_id,
                    channel=p.channel,
                    state="received",
                    wire_id=p.wire_id,
                    at=_iso(p.deposited_at) or "",
                    source="mailbox",
                )
            )

    out.sort(key=lambda m: m.at)
    return out


@router.post("/conversations/{peer_key}/messages", response_model=MessageOut)
async def send_conversation_message(
    peer_key: str,
    body: SendMessageIn,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
) -> MessageOut:
    """Composer send — the account originates a message THROUGH the pillar
    (X2 browser-origination). For ``reticulum:<dest>`` keys the pillar is
    the transport; the message is persisted regardless so the thread is
    durable and roams, and its D5 state reflects what actually happened:
      - ``sent``   handed to an RNS link;
      - ``queued`` recorded but not transmittable (node down / persona
                   unknown) — the user still sees it in-thread;
      - ``failed`` transport raised.
    """
    _validate_peer_key(peer_key)

    # cap conversations for a brand-new key
    exists = (
        await db.execute(
            select(UserConversation.id).where(
                UserConversation.user_id == user_id,
                UserConversation.peer_key == peer_key,
            )
        )
    ).first()
    if exists is None:
        count = (
            await db.execute(
                select(func.count())
                .select_from(UserConversation)
                .where(UserConversation.user_id == user_id)
            )
        ).scalar_one()
        if count >= MAX_CONVERSATIONS_PER_USER:
            raise HTTPException(429, "conversation limit reached")

    persona_id = (body.persona_id or "").strip() or None
    if persona_id and not _PERSONA_ID_RE.match(persona_id):
        raise HTTPException(400, "invalid persona_id")

    from_name = user_id.split(":", 1)[0].lstrip("@") or "concord"
    state = "queued"
    channel = "reticulum" if peer_key.startswith("reticulum:") else "local"

    dest_hash = None
    if peer_key.startswith("reticulum:"):
        candidate = peer_key.split(":", 1)[1]
        if _DEST_RE.match(candidate):
            dest_hash = candidate.lower()

    # Attempt live transport only for a fully-addressable reticulum peer.
    if dest_hash and persona_id:
        try:
            from services import reticulum_node as svc

            if svc.runtime.status().get("running"):
                loop = asyncio.get_event_loop()
                try:
                    await loop.run_in_executor(
                        None,
                        lambda: svc.runtime.send_text(
                            dest_hash, persona_id, from_name, body.body
                        ),
                    )
                    state = "sent"
                except RuntimeError as exc:
                    logger.info("composer send failed to %s: %s", dest_hash, exc)
                    state = "failed"
        except Exception as exc:  # noqa: BLE001 — never break persistence
            logger.warning("composer transport unavailable: %s", exc)

    msg = await record_outbound_message(
        db,
        user_id,
        peer_key,
        body.body,
        persona_id=persona_id,
        from_name=from_name,
        channel=channel,
        state=state,
        label=body.label,
    )
    await db.commit()
    await db.refresh(msg)
    return MessageOut(
        id=msg.id,
        peer_key=msg.peer_key,
        direction=msg.direction,
        body=msg.body,
        payload_b64=msg.payload_b64,
        from_name=msg.from_name,
        channel=msg.channel,
        state=msg.state,
        wire_id=msg.wire_id,
        at=_iso(msg.created_at) or "",
        source="pillar",
    )


@router.delete("/conversations/{peer_key}")
async def delete_conversation(
    peer_key: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """X1 — prune a thread from the portal: drop durable store rows AND the
    roamed device rows for it. (Relay mail is TTL-swept on its own.)"""
    _validate_peer_key(peer_key)
    await db.execute(
        delete(UserConversationMessage).where(
            UserConversationMessage.user_id == user_id,
            UserConversationMessage.peer_key == peer_key,
        )
    )
    await db.execute(
        delete(UserConversation).where(
            UserConversation.user_id == user_id,
            UserConversation.peer_key == peer_key,
        )
    )
    # roamed conversation head
    await db.execute(
        delete(UserSyncItem).where(
            UserSyncItem.user_id == user_id,
            UserSyncItem.kind == "conversation",
            UserSyncItem.key == peer_key,
        )
    )
    # roamed messages whose payload names this conversation
    roamed_msgs = (
        await db.execute(
            select(UserSyncItem).where(
                UserSyncItem.user_id == user_id,
                UserSyncItem.kind == "message",
            )
        )
    ).scalars().all()
    to_drop = []
    for r in roamed_msgs:
        try:
            if json.loads(r.data).get("conversation") == peer_key:
                to_drop.append(r.id)
        except ValueError:
            continue
    if to_drop:
        await db.execute(
            delete(UserSyncItem).where(UserSyncItem.id.in_(to_drop))
        )
    await db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Contacts (D2 known-peers registry)
# ---------------------------------------------------------------------------

@router.get("/contacts", response_model=list[ContactOut])
async def list_contacts(
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
) -> list[ContactOut]:
    """The account's known peers: stored contacts + roamed device contacts +
    live relay senders, deduped by peer key (stored rows win)."""
    merged: dict[str, ContactOut] = {}

    stored = (
        await db.execute(
            select(UserContact).where(UserContact.user_id == user_id)
        )
    ).scalars().all()
    for c in stored:
        merged[c.peer_key] = ContactOut(
            peer_key=c.peer_key,
            persona_id=c.persona_id,
            label=c.label,
            trust=c.trust,
            source=c.source,
            last_seen=_iso(c.last_seen),
        )

    roamed = (
        await db.execute(
            select(UserSyncItem).where(
                UserSyncItem.user_id == user_id,
                UserSyncItem.kind == "contact",
                UserSyncItem.deleted == False,  # noqa: E712
            )
        )
    ).scalars().all()
    for r in roamed:
        if r.key in merged:
            continue
        try:
            data = json.loads(r.data)
        except ValueError:
            data = {}
        merged[r.key] = ContactOut(
            peer_key=r.key,
            persona_id=None,
            label=data.get("label") if isinstance(data.get("label"), str) else None,
            trust=data.get("trust") if isinstance(data.get("trust"), str) else "unverified",
            source="roamed",
            last_seen=None,
        )

    personas = await _bound_personas(db, user_id)
    if personas:
        now = datetime.now(timezone.utc)
        pending = (
            await db.execute(
                select(PendingMessage).where(
                    PendingMessage.recipient_persona_id.in_(personas),
                    PendingMessage.delivered_at.is_(None),
                    PendingMessage.expires_at > now,
                )
            )
        ).scalars().all()
        for p in pending:
            key = _relay_peer_key(p)
            if key in merged:
                continue
            merged[key] = ContactOut(
                peer_key=key,
                persona_id=p.sender_persona_id,
                label=None,
                trust="unverified",
                source="relay",
                last_seen=_iso(p.deposited_at),
            )

    return sorted(merged.values(), key=lambda c: (c.label or c.peer_key).lower())


@router.post("/contacts", response_model=ContactOut)
async def upsert_contact(
    body: ContactIn,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
) -> ContactOut:
    """X1 — the browser edits a contact's account-local label/trust. Never a
    cryptographic trust change (those are device-only); purely a portal
    annotation."""
    peer_key = _validate_peer_key(body.peer_key)
    trust = body.trust
    if trust is not None and trust not in TRUST_VALUES:
        raise HTTPException(400, f"trust must be one of {sorted(TRUST_VALUES)}")
    persona_id = (body.persona_id or "").strip() or None
    if persona_id and not _PERSONA_ID_RE.match(persona_id):
        raise HTTPException(400, "invalid persona_id")

    row = await _upsert_contact(
        db,
        user_id,
        peer_key,
        persona_id=persona_id,
        label=body.label,
        trust=trust,
        source="manual",
    )
    await db.commit()
    await db.refresh(row)
    return ContactOut(
        peer_key=row.peer_key,
        persona_id=row.persona_id,
        label=row.label,
        trust=row.trust,
        source=row.source,
        last_seen=_iso(row.last_seen),
    )


@router.delete("/contacts/{peer_key}")
async def delete_contact(
    peer_key: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Remove a stored contact. Roamed/relay-derived rows re-appear on the
    next read (they are not owned here) — deleting only affects the
    account's manual annotation."""
    _validate_peer_key(peer_key)
    row = (
        await db.execute(
            select(UserContact).where(
                UserContact.user_id == user_id,
                UserContact.peer_key == peer_key,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "contact not found")
    await db.delete(row)
    await db.commit()
    return {"ok": True}
