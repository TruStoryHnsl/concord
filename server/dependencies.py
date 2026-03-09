from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import ServerMember


async def require_server_member(
    server_id: str, user_id: str, db: AsyncSession
) -> ServerMember:
    """Raise 403 if the user is not a member of the server."""
    result = await db.execute(
        select(ServerMember).where(
            ServerMember.server_id == server_id,
            ServerMember.user_id == user_id,
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(403, "You are not a member of this server")
    return member


async def require_server_admin(
    server_id: str, user_id: str, db: AsyncSession
) -> ServerMember:
    """Raise 403 if the user is not an admin or owner of the server."""
    member = await require_server_member(server_id, user_id, db)
    if member.role not in ("owner", "admin"):
        raise HTTPException(403, "Only admins and the server owner can do this")
    return member


async def require_server_owner(
    server_id: str, user_id: str, db: AsyncSession
) -> ServerMember:
    """Raise 403 if the user is not the owner of the server."""
    member = await require_server_member(server_id, user_id, db)
    if member.role != "owner":
        raise HTTPException(403, "Only the server owner can do this")
    return member
