import asyncio
import shutil
import time
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from config import MATRIX_HOMESERVER_URL, SOUNDBOARD_DIR
from database import get_db
from dependencies import require_server_member, require_server_admin, require_server_owner
from models import Server, Channel, ServerMember, ServerBan, ServerWhitelist, SoundboardClip
from services.matrix_admin import create_matrix_room, join_room

router = APIRouter(prefix="/api/servers", tags=["servers"])

# Simple TTL cache for token -> user_id validation
# Avoids hitting Matrix homeserver on every request
_token_cache: dict[str, tuple[str, float]] = {}
_token_cache_lock = asyncio.Lock()
_CACHE_TTL = 300  # 5 minutes
_CACHE_MAX_SIZE = 1000


class ServerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    visibility: str = "private"
    abbreviation: str | None = Field(default=None, max_length=3)


class ChannelCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    channel_type: Literal["text", "voice"] = "text"


class ChannelOut(BaseModel):
    id: int
    name: str
    channel_type: str
    matrix_room_id: str
    position: int

    model_config = {"from_attributes": True}


class ServerOut(BaseModel):
    id: str
    name: str
    icon_url: str | None
    owner_id: str
    visibility: str
    abbreviation: str | None
    channels: list[ChannelOut]

    model_config = {"from_attributes": True}


class ServerSettingsUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    visibility: str | None = None
    abbreviation: str | None = Field(default=None, max_length=3)


class MemberOut(BaseModel):
    user_id: str
    role: str
    display_name: str | None
    joined_at: str

    model_config = {"from_attributes": True}


class RoleUpdate(BaseModel):
    role: Literal["admin", "member"]


class DisplayNameUpdate(BaseModel):
    display_name: str | None = Field(default=None, max_length=32)


class BanCreate(BaseModel):
    user_id: str


class WhitelistAdd(BaseModel):
    user_id: str


class ServerDiscoverOut(BaseModel):
    id: str
    name: str
    icon_url: str | None
    abbreviation: str | None
    member_count: int


async def get_user_id(authorization: str = Header(...)) -> str:
    """Validate the Bearer token against the Matrix homeserver and return the user ID.

    The client sends: Authorization: Bearer <matrix_access_token>
    We call /_matrix/client/v3/account/whoami to verify ownership.
    Results are cached for 5 minutes to reduce per-request overhead.
    """
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Authorization header must use Bearer scheme")

    token = authorization[7:]  # Strip "Bearer "
    if not token:
        raise HTTPException(401, "Missing access token")

    # Check cache (lock-free read for the fast path)
    now = time.time()
    cached = _token_cache.get(token)
    if cached:
        user_id, expires = cached
        if now < expires:
            return user_id

    # Validate against Matrix homeserver
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{MATRIX_HOMESERVER_URL}/_matrix/client/v3/account/whoami",
                headers={"Authorization": f"Bearer {token}"},
            )
    except httpx.RequestError:
        raise HTTPException(502, "Unable to reach Matrix homeserver for auth")

    if resp.status_code == 401:
        raise HTTPException(401, "Invalid or expired access token")
    if resp.status_code != 200:
        raise HTTPException(502, "Matrix homeserver auth check failed")

    user_id = resp.json().get("user_id")
    if not user_id:
        raise HTTPException(401, "Token did not resolve to a user")

    # Write to cache under lock to prevent race conditions
    async with _token_cache_lock:
        # Evict if cache is at capacity
        if len(_token_cache) >= _CACHE_MAX_SIZE:
            expired = [k for k, (_, exp) in _token_cache.items() if now >= exp]
            for k in expired:
                del _token_cache[k]
            if len(_token_cache) >= _CACHE_MAX_SIZE:
                sorted_keys = sorted(_token_cache, key=lambda k: _token_cache[k][1])
                for k in sorted_keys[: len(sorted_keys) // 4]:
                    del _token_cache[k]

        _token_cache[token] = (user_id, now + _CACHE_TTL)

    return user_id


def get_access_token(authorization: str = Header(...)) -> str:
    """Extract the Matrix access token from the Authorization: Bearer header."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Authorization header must use Bearer scheme")
    return authorization[7:]


@router.get("", response_model=list[ServerOut])
async def list_servers(
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    """List servers the user is a member of."""
    result = await db.execute(
        select(Server)
        .join(ServerMember, ServerMember.server_id == Server.id)
        .where(ServerMember.user_id == user_id)
        .options(selectinload(Server.channels))
        .order_by(Server.created_at)
    )
    return result.scalars().all()


@router.post("", response_model=ServerOut)
async def create_server(
    body: ServerCreate,
    user_id: str = Depends(get_user_id),
    access_token: str = Depends(get_access_token),
    db: AsyncSession = Depends(get_db),
):
    """Create a new server with a default 'general' text channel."""
    # Create the server record and flush to populate the generated ID
    server = Server(
        name=body.name,
        owner_id=user_id,
        visibility=body.visibility,
        abbreviation=body.abbreviation,
    )
    db.add(server)
    await db.flush()

    # Auto-create owner membership
    db.add(ServerMember(server_id=server.id, user_id=user_id, role="owner"))

    # Create a default "general" channel as a Matrix room
    room_id = await create_matrix_room(access_token, f"{body.name} - general")
    channel = Channel(
        server_id=server.id,
        matrix_room_id=room_id,
        name="general",
        channel_type="text",
        position=0,
    )
    db.add(channel)
    await db.commit()

    # Reload with channels
    result = await db.execute(
        select(Server).options(selectinload(Server.channels)).where(Server.id == server.id)
    )
    return result.scalar_one()


@router.post("/{server_id}/channels", response_model=ChannelOut)
async def create_channel(
    server_id: str,
    body: ChannelCreate,
    user_id: str = Depends(get_user_id),
    access_token: str = Depends(get_access_token),
    db: AsyncSession = Depends(get_db),
):
    """Add a new channel to a server."""
    await require_server_owner(server_id, user_id, db)

    server = await db.get(Server, server_id)
    if not server:
        raise HTTPException(404, "Server not found")

    # Get the next position
    result = await db.execute(
        select(Channel).where(Channel.server_id == server_id).order_by(Channel.position.desc())
    )
    last = result.scalars().first()
    position = (last.position + 1) if last else 0

    room_id = await create_matrix_room(access_token, f"{server.name} - {body.name}")
    channel = Channel(
        server_id=server_id,
        matrix_room_id=room_id,
        name=body.name,
        channel_type=body.channel_type,
        position=position,
    )
    db.add(channel)
    await db.commit()
    await db.refresh(channel)
    return channel


@router.delete("/{server_id}")
async def delete_server(
    server_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Delete a server. Owner only. Cascades to channels, members, invites, soundboard clips."""
    await require_server_owner(server_id, user_id, db)

    server = await db.get(Server, server_id)
    if not server:
        raise HTTPException(404, "Server not found")

    # Delete soundboard files from disk
    clip_dir = SOUNDBOARD_DIR / server_id
    if clip_dir.exists():
        shutil.rmtree(clip_dir)

    # SQLAlchemy cascade handles channels, invites, members
    # But soundboard_clips don't have cascade on Server, so delete explicitly
    result = await db.execute(
        select(SoundboardClip).where(SoundboardClip.server_id == server_id)
    )
    for clip in result.scalars().all():
        await db.delete(clip)

    await db.delete(server)
    await db.commit()
    return {"status": "deleted"}


@router.delete("/{server_id}/channels/{channel_id}")
async def delete_channel(
    server_id: str,
    channel_id: int,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Delete a channel from a server. Owner only."""
    await require_server_owner(server_id, user_id, db)

    channel = await db.get(Channel, channel_id)
    if not channel or channel.server_id != server_id:
        raise HTTPException(404, "Channel not found")

    await db.delete(channel)
    await db.commit()
    return {"status": "deleted"}


@router.delete("/{server_id}/members/me")
async def leave_server(
    server_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Leave a server. Owners cannot leave — they must delete the server."""
    member = await require_server_member(server_id, user_id, db)

    if member.role == "owner":
        raise HTTPException(400, "Owners cannot leave their server. Delete the server instead.")

    await db.delete(member)
    await db.commit()
    return {"status": "left"}


# --- Discovery ---

@router.get("/discover", response_model=list[ServerDiscoverOut])
async def discover_servers(
    q: str = "",
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    """List public servers, optionally filtered by search query."""
    from sqlalchemy import func

    query = select(
        Server.id,
        Server.name,
        Server.icon_url,
        Server.abbreviation,
        func.count(ServerMember.id).label("member_count"),
    ).join(ServerMember, ServerMember.server_id == Server.id).where(
        Server.visibility == "public"
    ).group_by(Server.id)

    if q.strip():
        query = query.where(Server.name.ilike(f"%{q.strip()}%"))

    query = query.order_by(Server.name)
    result = await db.execute(query)
    return [
        ServerDiscoverOut(
            id=row.id,
            name=row.name,
            icon_url=row.icon_url,
            abbreviation=row.abbreviation,
            member_count=row.member_count,
        )
        for row in result.all()
    ]


@router.post("/{server_id}/join")
async def join_server(
    server_id: str,
    user_id: str = Depends(get_user_id),
    access_token: str = Depends(get_access_token),
    db: AsyncSession = Depends(get_db),
):
    """Join a public server. Creates membership and joins all Matrix rooms."""
    server = await db.get(Server, server_id)
    if not server:
        raise HTTPException(404, "Server not found")
    if server.visibility != "public":
        raise HTTPException(403, "This server is private. You need an invite.")

    # Check if banned
    ban = await db.execute(
        select(ServerBan).where(
            ServerBan.server_id == server_id,
            ServerBan.user_id == user_id,
        )
    )
    if ban.scalar_one_or_none():
        raise HTTPException(403, "You are banned from this server")

    # Check if already a member
    existing = await db.execute(
        select(ServerMember).where(
            ServerMember.server_id == server_id,
            ServerMember.user_id == user_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(400, "Already a member")

    db.add(ServerMember(server_id=server_id, user_id=user_id, role="member"))

    # Join all Matrix rooms
    result = await db.execute(select(Channel).where(Channel.server_id == server_id))
    for channel in result.scalars().all():
        try:
            await join_room(access_token, channel.matrix_room_id)
        except Exception:
            pass  # Best-effort join

    await db.commit()
    return {"status": "joined"}


# --- Server Settings ---

@router.get("/{server_id}/settings")
async def get_server_settings(
    server_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Get full server settings. Admin or owner only."""
    await require_server_admin(server_id, user_id, db)
    server = await db.get(Server, server_id)
    if not server:
        raise HTTPException(404, "Server not found")
    return {
        "id": server.id,
        "name": server.name,
        "visibility": server.visibility,
        "abbreviation": server.abbreviation,
        "icon_url": server.icon_url,
        "owner_id": server.owner_id,
    }


@router.patch("/{server_id}/settings")
async def update_server_settings(
    server_id: str,
    body: ServerSettingsUpdate,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Update server settings. Admin or owner only."""
    await require_server_admin(server_id, user_id, db)
    server = await db.get(Server, server_id)
    if not server:
        raise HTTPException(404, "Server not found")

    if body.name is not None:
        server.name = body.name
    if body.visibility is not None:
        if body.visibility not in ("public", "private"):
            raise HTTPException(400, "Visibility must be 'public' or 'private'")
        server.visibility = body.visibility
    if body.abbreviation is not None:
        server.abbreviation = body.abbreviation if body.abbreviation else None

    await db.commit()
    return {
        "id": server.id,
        "name": server.name,
        "visibility": server.visibility,
        "abbreviation": server.abbreviation,
    }


# --- Members ---

@router.get("/{server_id}/members", response_model=list[MemberOut])
async def list_members(
    server_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    """List all members of a server with roles and display names."""
    await require_server_member(server_id, user_id, db)
    result = await db.execute(
        select(ServerMember)
        .where(ServerMember.server_id == server_id)
        .order_by(ServerMember.joined_at)
    )
    members = result.scalars().all()
    return [
        MemberOut(
            user_id=m.user_id,
            role=m.role,
            display_name=m.display_name,
            joined_at=m.joined_at.isoformat(),
        )
        for m in members
    ]


@router.patch("/{server_id}/members/{member_user_id}/role")
async def update_member_role(
    server_id: str,
    member_user_id: str,
    body: RoleUpdate,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Change a member's role. Owner only."""
    await require_server_owner(server_id, user_id, db)

    result = await db.execute(
        select(ServerMember).where(
            ServerMember.server_id == server_id,
            ServerMember.user_id == member_user_id,
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(404, "Member not found")
    if member.role == "owner":
        raise HTTPException(400, "Cannot change the owner's role")

    member.role = body.role
    await db.commit()
    return {"status": "updated", "role": member.role}


@router.patch("/{server_id}/members/{member_user_id}/display-name")
async def update_display_name(
    server_id: str,
    member_user_id: str,
    body: DisplayNameUpdate,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Set display name for a member. Users can only change their own."""
    await require_server_member(server_id, user_id, db)
    if user_id != member_user_id:
        raise HTTPException(403, "You can only change your own display name")

    result = await db.execute(
        select(ServerMember).where(
            ServerMember.server_id == server_id,
            ServerMember.user_id == member_user_id,
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(404, "Member not found")

    member.display_name = body.display_name
    await db.commit()
    return {"status": "updated", "display_name": member.display_name}


@router.delete("/{server_id}/members/{member_user_id}")
async def kick_member(
    server_id: str,
    member_user_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Kick a member from the server. Admin or owner only."""
    await require_server_admin(server_id, user_id, db)

    result = await db.execute(
        select(ServerMember).where(
            ServerMember.server_id == server_id,
            ServerMember.user_id == member_user_id,
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(404, "Member not found")
    if member.role == "owner":
        raise HTTPException(400, "Cannot kick the owner")

    await db.delete(member)
    await db.commit()
    return {"status": "kicked"}


# --- Bans ---

@router.get("/{server_id}/bans")
async def list_bans(
    server_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    """List banned users. Admin or owner only."""
    await require_server_admin(server_id, user_id, db)
    result = await db.execute(
        select(ServerBan).where(ServerBan.server_id == server_id)
    )
    return [
        {
            "id": b.id,
            "user_id": b.user_id,
            "banned_by": b.banned_by,
            "created_at": b.created_at.isoformat(),
        }
        for b in result.scalars().all()
    ]


@router.post("/{server_id}/bans")
async def ban_user(
    server_id: str,
    body: BanCreate,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Ban a user from the server. Admin or owner only. Also kicks them."""
    await require_server_admin(server_id, user_id, db)

    server = await db.get(Server, server_id)
    if not server:
        raise HTTPException(404, "Server not found")
    if body.user_id == server.owner_id:
        raise HTTPException(400, "Cannot ban the server owner")

    # Check if already banned
    existing = await db.execute(
        select(ServerBan).where(
            ServerBan.server_id == server_id,
            ServerBan.user_id == body.user_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(400, "User is already banned")

    # Ban
    db.add(ServerBan(
        server_id=server_id,
        user_id=body.user_id,
        banned_by=user_id,
    ))

    # Also kick if they're a member
    result = await db.execute(
        select(ServerMember).where(
            ServerMember.server_id == server_id,
            ServerMember.user_id == body.user_id,
        )
    )
    member = result.scalar_one_or_none()
    if member:
        await db.delete(member)

    await db.commit()
    return {"status": "banned"}


@router.delete("/{server_id}/bans/{ban_user_id}")
async def unban_user(
    server_id: str,
    ban_user_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Unban a user. Admin or owner only."""
    await require_server_admin(server_id, user_id, db)

    result = await db.execute(
        select(ServerBan).where(
            ServerBan.server_id == server_id,
            ServerBan.user_id == ban_user_id,
        )
    )
    ban = result.scalar_one_or_none()
    if not ban:
        raise HTTPException(404, "Ban not found")

    await db.delete(ban)
    await db.commit()
    return {"status": "unbanned"}


# --- Whitelist ---

@router.get("/{server_id}/whitelist")
async def list_whitelist(
    server_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    """List whitelisted users. Admin or owner only."""
    await require_server_admin(server_id, user_id, db)
    result = await db.execute(
        select(ServerWhitelist).where(ServerWhitelist.server_id == server_id)
    )
    return [
        {
            "id": w.id,
            "user_id": w.user_id,
            "added_by": w.added_by,
            "created_at": w.created_at.isoformat(),
        }
        for w in result.scalars().all()
    ]


@router.post("/{server_id}/whitelist")
async def add_to_whitelist(
    server_id: str,
    body: WhitelistAdd,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Add a user to the whitelist. Admin or owner only."""
    await require_server_admin(server_id, user_id, db)

    existing = await db.execute(
        select(ServerWhitelist).where(
            ServerWhitelist.server_id == server_id,
            ServerWhitelist.user_id == body.user_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(400, "User is already whitelisted")

    db.add(ServerWhitelist(
        server_id=server_id,
        user_id=body.user_id,
        added_by=user_id,
    ))
    await db.commit()
    return {"status": "added"}


@router.delete("/{server_id}/whitelist/{wl_user_id}")
async def remove_from_whitelist(
    server_id: str,
    wl_user_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Remove a user from the whitelist. Admin or owner only."""
    await require_server_admin(server_id, user_id, db)

    result = await db.execute(
        select(ServerWhitelist).where(
            ServerWhitelist.server_id == server_id,
            ServerWhitelist.user_id == wl_user_id,
        )
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(404, "Whitelist entry not found")

    await db.delete(entry)
    await db.commit()
    return {"status": "removed"}
