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
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Bulk-upsert the caller's rows (device push). Upsert key = (kind, key)."""
    _check_kind(kind)
    if len(items) > MAX_ITEMS_PER_REQUEST:
        raise HTTPException(429, f"max {MAX_ITEMS_PER_REQUEST} items per request")

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
                deleted=item.deleted, updated_at=now,
            )
            db.add(row)
            by_key[item.key] = row
            count += 1
        else:
            row.data = payload
            row.deleted = item.deleted
            row.updated_at = now
        written += 1

    await db.commit()
    return {"ok": True, "written": written}


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
