import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from database import get_db
from models import InviteToken, Channel, ServerMember
from services.matrix_admin import register_matrix_user, join_room

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/register", tags=["registration"])


class RegisterRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)
    invite_token: str | None = None


class RegisterResponse(BaseModel):
    access_token: str
    user_id: str
    device_id: str
    server_id: str | None = None
    server_name: str | None = None


@router.post("", response_model=RegisterResponse)
async def register_user(
    body: RegisterRequest,
    db: AsyncSession = Depends(get_db),
):
    """Register a new user account.

    If an invite_token is provided, also joins the user to that server.
    If no invite_token, just creates the Matrix account.
    """
    invite = None

    if body.invite_token:
        # Validate invite exists and is not expired
        result = await db.execute(
            select(InviteToken)
            .options(selectinload(InviteToken.server))
            .where(InviteToken.token == body.invite_token)
        )
        invite = result.scalar_one_or_none()

        if not invite or not invite.is_valid:
            raise HTTPException(400, "Invalid or expired invite token")

        # Atomically reserve an invite slot (skip for permanent invites)
        if not invite.permanent:
            reserve_result = await db.execute(
                update(InviteToken)
                .where(
                    InviteToken.id == invite.id,
                    InviteToken.use_count < InviteToken.max_uses,
                )
                .values(use_count=InviteToken.use_count + 1)
            )
            if reserve_result.rowcount == 0:
                raise HTTPException(400, "Invite has reached its maximum uses")

    # Register on Matrix homeserver
    try:
        matrix_result = await register_matrix_user(body.username, body.password)
    except Exception as e:
        # Compensating transaction: release the reserved slot
        if invite and not invite.permanent:
            await db.execute(
                update(InviteToken)
                .where(InviteToken.id == invite.id)
                .values(use_count=InviteToken.use_count - 1)
            )
            await db.commit()
        error_msg = str(e)
        logger.error("Matrix registration failed for %s: %s", body.username, error_msg)
        # Pass through the Matrix homeserver error for meaningful feedback
        if "User ID already taken" in error_msg or "taken" in error_msg.lower():
            raise HTTPException(400, "Username is already taken")
        elif "exclusive" in error_msg.lower():
            raise HTTPException(400, "That username is reserved")
        elif "invalid" in error_msg.lower() or "not allowed" in error_msg.lower():
            raise HTTPException(400, f"Invalid username: {error_msg}")
        else:
            raise HTTPException(400, f"Registration failed: {error_msg}")

    access_token = matrix_result["access_token"]
    user_id = matrix_result["user_id"]
    device_id = matrix_result["device_id"]

    server_id = None
    server_name = None

    # If invite provided, join the server
    if invite:
        db.add(ServerMember(
            server_id=invite.server_id,
            user_id=user_id,
            role="member",
        ))

        channels_result = await db.execute(
            select(Channel).where(Channel.server_id == invite.server_id)
        )
        for channel in channels_result.scalars().all():
            try:
                await join_room(access_token, channel.matrix_room_id)
            except Exception as e:
                logger.warning(
                    "Failed to auto-join %s to room %s: %s",
                    user_id, channel.matrix_room_id, e,
                )

        server_id = invite.server_id
        server_name = invite.server.name

    await db.commit()

    return RegisterResponse(
        access_token=access_token,
        user_id=user_id,
        device_id=device_id,
        server_id=server_id,
        server_name=server_name,
    )
