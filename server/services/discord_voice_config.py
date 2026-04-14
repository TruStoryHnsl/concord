from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import TypedDict

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import Channel, DiscordVoiceBridge


CONFIG_DIR = Path(os.getenv("CONCORD_DISCORD_VOICE_CONFIG_DIR", "/etc/concord-config/discord-voice-bridge"))
ROOMS_FILE = CONFIG_DIR / "rooms.json"


class DiscordVoiceRoom(TypedDict):
    id: int
    server_id: str
    channel_id: int
    matrix_room_id: str
    discord_guild_id: str
    discord_channel_id: str
    enabled: bool


def _atomic_write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(payload, indent=2, sort_keys=True).encode("utf-8")

    fd, tmp_name = tempfile.mkstemp(
        prefix=f".{path.name}.",
        suffix=".tmp",
        dir=path.parent,
    )
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(encoded)
            fh.write(b"\n")
            fh.flush()
            os.fsync(fh.fileno())
        os.chmod(tmp_path, 0o640)
        os.replace(tmp_path, path)
    finally:
        if tmp_path.exists():
            tmp_path.unlink()


async def list_voice_bridge_rooms(db: AsyncSession) -> list[DiscordVoiceRoom]:
    result = await db.execute(
        select(DiscordVoiceBridge).order_by(DiscordVoiceBridge.id)
    )
    rooms: list[DiscordVoiceRoom] = []
    for row in result.scalars().all():
        rooms.append({
            "id": row.id,
            "server_id": row.server_id,
            "channel_id": row.channel_id,
            "matrix_room_id": row.matrix_room_id,
            "discord_guild_id": row.discord_guild_id,
            "discord_channel_id": row.discord_channel_id,
            "enabled": bool(row.enabled),
        })
    return rooms


async def reconcile_voice_bridge_row(
    db: AsyncSession,
    row: DiscordVoiceBridge,
) -> tuple[Channel | None, bool]:
    """Repair stale bridge rows when the backing Concord voice channel moved.

    The common regression shape is:
    - `discord_voice_bridges.channel_id` points at a deleted voice channel
    - `discord_voice_bridges.matrix_room_id` still points at the old room id

    Prefer an exact `channel_id` hit, then an exact `matrix_room_id` hit. If
    both are stale but the server now has exactly one voice channel, heal the
    row to that sole candidate.
    """
    changed = False

    channel = await db.get(Channel, row.channel_id)
    if channel and channel.channel_type == "voice" and channel.server_id == row.server_id:
        if row.matrix_room_id != channel.matrix_room_id:
            row.matrix_room_id = channel.matrix_room_id
            changed = True
        return channel, changed

    result = await db.execute(
        select(Channel).where(Channel.matrix_room_id == row.matrix_room_id)
    )
    by_room = result.scalar_one_or_none()
    if by_room and by_room.channel_type == "voice" and by_room.server_id == row.server_id:
        if row.channel_id != by_room.id:
            row.channel_id = by_room.id
            changed = True
        if row.matrix_room_id != by_room.matrix_room_id:
            row.matrix_room_id = by_room.matrix_room_id
            changed = True
        return by_room, changed

    result = await db.execute(
        select(Channel)
        .where(
            Channel.server_id == row.server_id,
            Channel.channel_type == "voice",
        )
        .order_by(Channel.id)
    )
    candidates = result.scalars().all()
    if len(candidates) == 1:
        fallback = candidates[0]
        if row.channel_id != fallback.id:
            row.channel_id = fallback.id
            changed = True
        if row.matrix_room_id != fallback.matrix_room_id:
            row.matrix_room_id = fallback.matrix_room_id
            changed = True
        return fallback, changed

    return None, changed


async def reconcile_voice_bridge_rows(db: AsyncSession) -> bool:
    result = await db.execute(
        select(DiscordVoiceBridge).order_by(DiscordVoiceBridge.id)
    )
    changed = False
    for row in result.scalars().all():
        _, repaired = await reconcile_voice_bridge_row(db, row)
        changed = changed or repaired
    return changed


async def write_voice_bridge_rooms(db: AsyncSession) -> None:
    if await reconcile_voice_bridge_rows(db):
        await db.commit()
    rooms = await list_voice_bridge_rooms(db)
    _atomic_write_json(ROOMS_FILE, {"rooms": rooms})
