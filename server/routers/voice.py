import logging
import os
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from livekit import api as livekit_api
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import require_server_member
from models import Channel
from routers.servers import get_user_id
from services.livekit_tokens import generate_token, LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/voice", tags=["voice"])

METERED_APP_NAME = os.getenv("METERED_APP_NAME", "")
METERED_API_KEY = os.getenv("METERED_API_KEY", "")


class VoiceTokenRequest(BaseModel):
    room_name: str  # We use the matrix_room_id as the LiveKit room name


class IceServer(BaseModel):
    urls: str | list[str]
    username: Optional[str] = None
    credential: Optional[str] = None


class VoiceTokenResponse(BaseModel):
    token: str
    livekit_url: str
    ice_servers: list[IceServer] = []


async def _fetch_turn_credentials() -> list[IceServer]:
    """Fetch TURN relay credentials from Metered.ca free API."""
    if not METERED_API_KEY or not METERED_APP_NAME:
        return []
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                f"https://{METERED_APP_NAME}.metered.live/api/v1/turn/credentials"
                f"?apiKey={METERED_API_KEY}"
            )
            resp.raise_for_status()
            servers = resp.json()
            return [IceServer(**s) for s in servers]
    except Exception as e:
        logger.warning("Failed to fetch TURN credentials: %s", e)
        return []


@router.post("/token", response_model=VoiceTokenResponse)
async def get_voice_token(
    body: VoiceTokenRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Generate a LiveKit token for joining a voice channel.

    The room_name should be the matrix_room_id of the voice channel.
    The user_id from the auth header is used as the participant identity.
    Verifies the user is a member of the server that owns this room.
    """
    # Look up which server owns this room and verify membership
    result = await db.execute(
        select(Channel).where(Channel.matrix_room_id == body.room_name)
    )
    channel = result.scalar_one_or_none()
    if not channel:
        raise HTTPException(404, "Voice channel not found")

    await require_server_member(channel.server_id, user_id, db)

    # Extract display name from Matrix user ID (@user:server -> user)
    display_name = user_id.split(":")[0].replace("@", "")

    token = generate_token(
        identity=user_id,
        room_name=body.room_name,
        name=display_name,
    )

    # Return the client-facing LiveKit URL
    # In production behind Nginx: ws://host/livekit/
    # In local dev: direct to LiveKit container
    client_url = LIVEKIT_URL

    # Fetch TURN credentials for NAT traversal
    ice_servers = await _fetch_turn_credentials()

    return VoiceTokenResponse(
        token=token, livekit_url=client_url, ice_servers=ice_servers
    )


class VoiceParticipant(BaseModel):
    identity: str
    name: str


@router.get("/participants")
async def get_voice_participants(
    rooms: str = Query(..., description="Comma-separated room IDs"),
    user_id: str = Depends(get_user_id),
):
    """List active participants in voice channels.

    Returns a dict of room_id → participant list for each requested room.
    """
    room_ids = [r.strip() for r in rooms.split(",") if r.strip()]
    if not room_ids:
        return {}

    # Convert ws:// → http:// for LiveKit REST API
    lk_url = LIVEKIT_URL.replace("ws://", "http://").replace("wss://", "https://")
    lk_client = livekit_api.LiveKitAPI(lk_url, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)

    result: dict[str, list[dict]] = {}
    try:
        for room_id in room_ids:
            try:
                resp = await lk_client.room.list_participants(
                    livekit_api.ListParticipantsRequest(room=room_id)
                )
                result[room_id] = [
                    {"identity": p.identity, "name": p.name}
                    for p in resp.participants
                ]
            except Exception:
                result[room_id] = []
    finally:
        await lk_client.aclose()

    return result
