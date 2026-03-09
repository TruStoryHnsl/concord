from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from pydantic import EmailStr

from database import get_db
from dependencies import require_server_member, require_server_admin
from models import InviteToken, Server, ServerMember, ServerBan, Channel
from routers.servers import get_user_id, get_access_token
from services.matrix_admin import join_room
from services.email import send_invite_email, is_configured as email_configured

router = APIRouter(prefix="/api/invites", tags=["invites"])


class InviteCreate(BaseModel):
    server_id: str
    max_uses: int = Field(default=10, ge=1, le=1000)
    expires_in_hours: int = Field(default=168, ge=1, le=8760)  # max 1 year
    permanent: bool = False


class InviteOut(BaseModel):
    id: int
    token: str
    server_id: str
    server_name: str
    max_uses: int
    use_count: int
    expires_at: datetime
    permanent: bool
    is_valid: bool

    model_config = {"from_attributes": True}


class InviteValidation(BaseModel):
    valid: bool
    server_name: str | None = None
    server_id: str | None = None


@router.post("", response_model=InviteOut)
async def create_invite(
    body: InviteCreate,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Create an invite link for a server. Any member can create invites."""
    await require_server_member(body.server_id, user_id, db)

    server = await db.get(Server, body.server_id)
    if not server:
        raise HTTPException(404, "Server not found")

    from datetime import timedelta
    invite = InviteToken(
        server_id=body.server_id,
        created_by=user_id,
        max_uses=body.max_uses,
        permanent=body.permanent,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=body.expires_in_hours),
    )
    db.add(invite)
    await db.commit()
    await db.refresh(invite)

    return InviteOut(
        id=invite.id,
        token=invite.token,
        server_id=invite.server_id,
        server_name=server.name,
        max_uses=invite.max_uses,
        use_count=invite.use_count,
        expires_at=invite.expires_at,
        permanent=invite.permanent,
        is_valid=invite.is_valid,
    )


@router.get("/validate/{token}", response_model=InviteValidation)
async def validate_invite(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    """Validate an invite token — public endpoint (no auth required)."""
    result = await db.execute(
        select(InviteToken)
        .options(selectinload(InviteToken.server))
        .where(InviteToken.token == token)
    )
    invite = result.scalar_one_or_none()

    if not invite or not invite.is_valid:
        return InviteValidation(valid=False)

    return InviteValidation(
        valid=True,
        server_name=invite.server.name,
        server_id=invite.server_id,
    )


@router.get("/{server_id}", response_model=list[InviteOut])
async def list_server_invites(
    server_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    """List all invites for a server. Requires server membership."""
    await require_server_member(server_id, user_id, db)

    result = await db.execute(
        select(InviteToken)
        .options(selectinload(InviteToken.server))
        .where(InviteToken.server_id == server_id)
        .order_by(InviteToken.created_at.desc())
    )
    invites = result.scalars().all()
    return [
        InviteOut(
            id=inv.id,
            token=inv.token,
            server_id=inv.server_id,
            server_name=inv.server.name,
            max_uses=inv.max_uses,
            use_count=inv.use_count,
            expires_at=inv.expires_at,
            permanent=inv.permanent,
            is_valid=inv.is_valid,
        )
        for inv in invites
    ]


@router.delete("/{invite_id}")
async def revoke_invite(
    invite_id: int,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Revoke an invite. Requires admin or owner."""
    invite = await db.get(InviteToken, invite_id)
    if not invite:
        raise HTTPException(404, "Invite not found")

    await require_server_admin(invite.server_id, user_id, db)

    await db.delete(invite)
    await db.commit()
    return {"status": "revoked"}


class EmailInviteRequest(BaseModel):
    server_id: str
    email: EmailStr


@router.get("/email-available")
async def check_email_available():
    """Check if email invites are configured on this server."""
    return {"available": email_configured()}


@router.post("/email")
async def send_email_invite(
    body: EmailInviteRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Create an invite and send it to an email address. Any member can do this."""
    if not email_configured():
        raise HTTPException(400, "Email is not configured on this server")

    await require_server_member(body.server_id, user_id, db)

    server = await db.get(Server, body.server_id)
    if not server:
        raise HTTPException(404, "Server not found")

    from datetime import timedelta
    invite = InviteToken(
        server_id=body.server_id,
        created_by=user_id,
        max_uses=1,
        permanent=False,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=168),
    )
    db.add(invite)
    await db.commit()
    await db.refresh(invite)

    # Extract a display name from the Matrix user ID (@user:server -> user)
    inviter_display = user_id.split(":")[0].lstrip("@") if ":" in user_id else user_id

    try:
        await send_invite_email(body.email, invite.token, server.name, inviter_display)
    except Exception as e:
        # Clean up the invite if email fails
        await db.delete(invite)
        await db.commit()
        raise HTTPException(500, f"Failed to send email: {e}")

    return {"status": "sent", "email": body.email}


@router.post("/{token}/redeem")
async def redeem_invite(
    token: str,
    user_id: str = Depends(get_user_id),
    access_token: str = Depends(get_access_token),
    db: AsyncSession = Depends(get_db),
):
    """Redeem an invite as a logged-in user. Joins the server and all its rooms."""
    result = await db.execute(
        select(InviteToken)
        .options(selectinload(InviteToken.server))
        .where(InviteToken.token == token)
    )
    invite = result.scalar_one_or_none()

    if not invite or not invite.is_valid:
        raise HTTPException(400, "Invalid or expired invite")

    # Check if banned
    ban = await db.execute(
        select(ServerBan).where(
            ServerBan.server_id == invite.server_id,
            ServerBan.user_id == user_id,
        )
    )
    if ban.scalar_one_or_none():
        raise HTTPException(403, "You are banned from this server")

    # Check if already a member
    existing = await db.execute(
        select(ServerMember).where(
            ServerMember.server_id == invite.server_id,
            ServerMember.user_id == user_id,
        )
    )
    if existing.scalar_one_or_none():
        return {
            "status": "already_member",
            "server_id": invite.server_id,
            "server_name": invite.server.name,
        }

    # Add as member
    db.add(ServerMember(
        server_id=invite.server_id,
        user_id=user_id,
        role="member",
    ))

    # Increment use count (for non-permanent invites)
    if not invite.permanent:
        invite.use_count += 1

    # Join all Matrix rooms
    channels = await db.execute(
        select(Channel).where(Channel.server_id == invite.server_id)
    )
    for channel in channels.scalars().all():
        try:
            await join_room(access_token, channel.matrix_room_id)
        except Exception:
            pass  # Best-effort

    await db.commit()
    return {
        "status": "joined",
        "server_id": invite.server_id,
        "server_name": invite.server.name,
    }
