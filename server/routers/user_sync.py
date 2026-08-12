"""Superuser roaming sync (``/api/me/sync/*``) — the docker half.

A native install pushes its device-local messenger state into the
account it holds on this instance, so the same user opening the BROWSER
at the instance domain finds their chat history, connections, and
personalizations intact. The server stores opaque JSON rows scoped to
``(user_id, kind, key)``; the web client renders them.

Kinds:
  conversation  one row per peer conversation (key = peer id)
  message       one row per message (key = message ulid)
  contact       one row per learned contact/connection (key = dest/peer)
  prefs         a single row (key = "prefs") of personalization state

Security posture:
  - plain ``get_user_id`` auth — every read/write is strictly scoped to
    the caller's rows; nothing here is visible to another account.
  - the server never interprets payloads; bounded sizes + per-user row
    caps keep one account from bloating the instance DB.

Write-path split (X2/N5 roaming hardening). This surface is DEVICE→SERVER
push only by design — the browser is a portal mirror and the p2p/superuser
keys live on the device. The account MAY originate, from the browser, the
following (NOT here — via other routers): mesh sends + the composer
(``/api/reticulum/send``, ``/api/me/conversations/*``), mailbox deposits
(``/api/relay/messages``), and contact label/trust edits + prefs
(``/api/me/contacts``). It may NEVER originate superuser ops or
cryptographic key/trust changes — those stay device-only.

Conflict policy is LAST-WRITER-WINS PER (kind, key): each PUT upserts by
that pair and stamps ``updated_at`` + the caller's ``device_id``, so the
most recent push is authoritative even when two native devices push the
same account. ``GET /api/me/sync/status`` surfaces the per-device row
counts + last-write times that Settings→Devices renders.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_user_id
from models import UserSyncItem

router = APIRouter(prefix="/api/me/sync", tags=["me-sync"])

SYNC_KINDS = {"conversation", "message", "contact", "prefs"}

MAX_ITEMS_PER_REQUEST = 500
MAX_DATA_BYTES = 32 * 1024
# Generous but bounded: history for a busy device fits; one account
# cannot grow the DB without limit.
MAX_ROWS_PER_USER_KIND = 20_000


class SyncItemIn(BaseModel):
    key: str = Field(min_length=1, max_length=256)
    data: dict = Field(default_factory=dict)
    deleted: bool = False


class SyncItemOut(BaseModel):
    key: str
    data: dict
    deleted: bool
    updated_at: str


def _check_kind(kind: str) -> str:
    if kind not in SYNC_KINDS:
        raise HTTPException(400, f"kind must be one of {sorted(SYNC_KINDS)}")
    return kind


def _out(row: UserSyncItem) -> SyncItemOut:
    try:
        data = json.loads(row.data)
    except ValueError:
        data = {}
    ts = row.updated_at
    if ts is not None and ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return SyncItemOut(
        key=row.key,
        data=data,
        deleted=row.deleted,
        updated_at=ts.isoformat() if ts else "",
    )


@router.get("/{kind}", response_model=list[SyncItemOut])
async def list_sync_items(
    kind: str,
    since: str | None = Query(default=None),
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
) -> list[SyncItemOut]:
    """The caller's synced rows of one kind — theirs alone, never anyone else's."""
    _check_kind(kind)
    q = select(UserSyncItem).where(
        UserSyncItem.user_id == user_id, UserSyncItem.kind == kind
    )
    if since:
        try:
            cutoff = datetime.fromisoformat(since.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(400, "since must be an ISO-8601 timestamp")
        if cutoff.tzinfo is not None:
            cutoff = cutoff.astimezone(timezone.utc).replace(tzinfo=None)
        q = q.where(UserSyncItem.updated_at >= cutoff)
    q = q.order_by(UserSyncItem.updated_at)
    rows = (await db.execute(q)).scalars().all()
    return [_out(r) for r in rows]


@router.put("/{kind}")
async def upsert_sync_items(
    kind: str,
    items: list[SyncItemIn],
    device_id: str | None = Query(default=None, max_length=128),
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Bulk-upsert the caller's rows (device push). Upsert key = (kind, key).

    ``device_id`` (X2/N5): the pushing install's stable id, stamped on each
    written row for last-writer attribution. Optional + bounded.
    """
    _check_kind(kind)
    if len(items) > MAX_ITEMS_PER_REQUEST:
        raise HTTPException(429, f"max {MAX_ITEMS_PER_REQUEST} items per request")
    dev = (device_id or "").strip() or None

    count = (
        await db.execute(
            select(func.count())
            .select_from(UserSyncItem)
            .where(UserSyncItem.user_id == user_id, UserSyncItem.kind == kind)
        )
    ).scalar_one()

    existing_rows = (
        await db.execute(
            select(UserSyncItem).where(
                UserSyncItem.user_id == user_id,
                UserSyncItem.kind == kind,
                UserSyncItem.key.in_([i.key for i in items]),
            )
        )
    ).scalars().all()
    by_key = {r.key: r for r in existing_rows}

    now = datetime.now(timezone.utc)
    written = 0
    for item in items:
        payload = json.dumps(item.data)
        if len(payload.encode("utf-8")) > MAX_DATA_BYTES:
            raise HTTPException(400, f"item {item.key!r} exceeds {MAX_DATA_BYTES} bytes")
        row = by_key.get(item.key)
        if row is None:
            if count >= MAX_ROWS_PER_USER_KIND:
                raise HTTPException(429, "sync store limit reached for this kind")
            row = UserSyncItem(
                user_id=user_id, kind=kind, key=item.key, data=payload,
                deleted=item.deleted, updated_at=now, device_id=dev,
            )
            db.add(row)
            by_key[item.key] = row
            count += 1
        else:
            row.data = payload
            row.deleted = item.deleted
            row.updated_at = now
            if dev is not None:
                row.device_id = dev
        written += 1

    await db.commit()
    return {"ok": True, "written": written}


@router.get("/status/devices")
async def sync_status(
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """X2/N5 — roaming sync status for Settings→Devices: how many rows each
    device last wrote, and when. Strictly the caller's own rows.

    Placed under ``/status/devices`` (not ``/{kind}``) so it never shadows
    a sync kind. Returns totals + a per-device breakdown.
    """
    rows = (
        await db.execute(
            select(
                UserSyncItem.device_id,
                UserSyncItem.kind,
                func.count(),
                func.max(UserSyncItem.updated_at),
            )
            .where(UserSyncItem.user_id == user_id)
            .group_by(UserSyncItem.device_id, UserSyncItem.kind)
        )
    ).all()

    devices: dict[str, dict] = {}
    kinds: dict[str, int] = {}
    total = 0
    for device_id, kind, count, last in rows:
        total += count
        kinds[kind] = kinds.get(kind, 0) + count
        dkey = device_id or "unknown"
        d = devices.setdefault(
            dkey, {"device_id": device_id, "rows": 0, "last_write": None, "kinds": {}}
        )
        d["rows"] += count
        d["kinds"][kind] = count
        last_iso = None
        if last is not None:
            if last.tzinfo is None:
                last = last.replace(tzinfo=timezone.utc)
            last_iso = last.isoformat()
        if last_iso and (d["last_write"] is None or last_iso > d["last_write"]):
            d["last_write"] = last_iso

    return {
        "total_rows": total,
        "by_kind": kinds,
        "devices": sorted(
            devices.values(),
            key=lambda x: x["last_write"] or "",
            reverse=True,
        ),
    }


@router.delete("/{kind}")
async def clear_sync_kind(
    kind: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Hard-clear the caller's rows of one kind (device-initiated reset)."""
    _check_kind(kind)
    await db.execute(
        delete(UserSyncItem).where(
            UserSyncItem.user_id == user_id, UserSyncItem.kind == kind
        )
    )
    await db.commit()
    return {"ok": True}
