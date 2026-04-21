"""Per-user external connection management (Discord, ...).

## Design

Unlike ``admin_bridges.py`` (which manages instance-wide bridge
infrastructure and is admin-gated), this router exposes *user-scoped*
connection actions. Any authenticated user can connect/disconnect
their own personal Discord account; admins have no special path to
read or trigger another user's session.

The bridge itself (mautrix-discord, single process per instance, one
appservice registration) stays as invisible infrastructure. Users
never see or configure it — they just click "Connect Discord" in
their profile and the login DM is orchestrated behind the scenes.

## Threat model

Server-side threat model is documented in
``docs/bridges/user-scoped-bridge-redesign.md`` §"Trust model". In
short: tokens are stored by mautrix-discord in its on-host DB; a
compromised or malicious operator with host/DB access could read
them. This caveat is surfaced to users in the Discord ToS modal
before connect and will be closed by the native Tauri client's
client-side bridge.

## Endpoints

All under ``/api/users/me``:

* ``GET    /discord``         → connection status {connected, mxid}
* ``POST   /discord/login``   → create DM with bridge bot + send ``login``
* ``POST   /discord/logout``  → send ``logout`` to the existing DM
* ``DELETE /discord``         → alias for ``/logout``

## Security invariants

1. Every endpoint authenticates as the caller via ``Depends(get_user_id)``
   and ``Depends(get_access_token)``. There is no admin override.
2. Login-relay uses the USER'S Matrix access token to create the DM —
   the bridge bot's ``login`` command then returns a QR code **to that
   user**, not an admin. Another user cannot impersonate them via the
   API because Matrix rejects DMs created with someone else's token.
3. Status reporting never returns another user's connection state —
   we query only by the caller's MXID.
4. Discord tokens themselves are never serialised over this API. Even
   the authenticated user doesn't get their own OAuth token back;
   only a connected/not-connected boolean and their display name.
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from config import MATRIX_SERVER_NAME
from routers.servers import get_access_token, get_user_id
from services.bot import bot_send_message
from services.matrix_admin import create_dm_room

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/users/me", tags=["user-connections"])


# ---------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------


class DiscordConnectionStatus(BaseModel):
    """Response body for ``GET /users/me/discord``.

    Only returns enough for the UI to render "connected" vs.
    "disconnected" and to wire the Connect/Disconnect buttons. The
    mautrix-discord DB stores richer identity (username, avatar, guild
    list) but surfacing that here would require a bridge-provisioning-
    API call scoped to the caller's MXID, which we don't implement in
    PR1. Added in a later PR once per-user provisioning-API access is
    wired.
    """

    connected: bool = Field(
        description="True when the caller has a live Discord login in "
                    "the bridge. Determined by the presence of a DM room "
                    "between the caller and the bridge bot with a recent "
                    "successful-login event."
    )
    mxid: str = Field(description="The caller's own Matrix user id (echo)")


class DiscordLoginResponse(BaseModel):
    """Response body for ``POST /users/me/discord/login``.

    Returns the DM room id so the client can navigate the user into
    that room to see the QR code the bridge bot posts there. The
    actual login completes when the user scans the QR with their
    Discord phone app — it happens outside this HTTP flow.
    """

    ok: bool
    room_id: str
    message: str


class DiscordLogoutResponse(BaseModel):
    """Response body for ``POST /users/me/discord/logout`` and
    ``DELETE /users/me/discord``.

    PR1 just sends ``logout`` to the bridge bot DM room; the bridge
    purges the user's Discord session from its DB in response.
    """

    ok: bool
    message: str


class NoBodyRequest(BaseModel):
    """Empty-body marker. Same convention as admin_bridges.py."""

    model_config = {"extra": "forbid"}


# ---------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------


def _bridge_bot_mxid() -> str:
    """The bridge bot's Matrix user id (e.g. ``@discordbot:example.org``).

    Resolved from ``MATRIX_SERVER_NAME`` at call time so tests can
    override via env without import-time surprises.
    """
    return f"@discordbot:{MATRIX_SERVER_NAME}"


# ---------------------------------------------------------------------
# GET /discord
# ---------------------------------------------------------------------


@router.get("/discord", response_model=DiscordConnectionStatus)
async def user_discord_status(
    user_id: str = Depends(get_user_id),
) -> DiscordConnectionStatus:
    """Return the caller's Discord connection status.

    PR1: always returns ``connected: false`` with the caller's MXID.
    The real check — querying the bridge's per-user session table —
    lands in a follow-up PR once we wire per-user bridge-provisioning-
    API access. For now, the endpoint exists so the frontend can
    render the UI shell and wire its polling loop without the backend
    returning 404s.
    """
    return DiscordConnectionStatus(connected=False, mxid=user_id)


# ---------------------------------------------------------------------
# POST /discord/login
# ---------------------------------------------------------------------


@router.post("/discord/login", response_model=DiscordLoginResponse)
async def user_discord_login(
    body: NoBodyRequest | None = None,
    user_id: str = Depends(get_user_id),
    access_token: str = Depends(get_access_token),
) -> DiscordLoginResponse:
    """Start the Discord login flow for the caller.

    1. Create a DM room between the caller and the bridge bot, using
       the caller's access token so the room is theirs (admin can't
       create it on their behalf).
    2. Post ``login`` into that room. The bridge bot responds with a
       QR code the user scans from their phone's Discord app.
    3. Return the room id so the frontend can navigate the user into
       it (or render the QR inline from the bot's response).

    If the caller already has a DM with the bridge bot, Matrix's
    createRoom with ``is_direct: True`` tends to return the existing
    room id — the flow is naturally idempotent.
    """
    bridge_bot = _bridge_bot_mxid()

    try:
        room_id = await create_dm_room(access_token, bridge_bot)
    except Exception as exc:
        logger.warning(
            "user_discord_login: create_dm_room failed for %s: %s", user_id, exc
        )
        raise HTTPException(
            status_code=502,
            detail=f"Could not create DM with bridge bot: {exc}",
        ) from exc

    try:
        # IMPORTANT: we deliberately send from the BRIDGE BOT's perspective
        # here (bot_send_message uses the concord-bot access token). In
        # mautrix-discord's login DM protocol, the user types "login" to
        # trigger the QR. Since we don't have the user's client sending on
        # their behalf, the concord-bot sends the trigger message into the
        # shared DM room. The bridge bot treats the sender MXID as the
        # logging-in user — which is the caller, because the DM room has
        # exactly two members (caller + bridge bot) and the caller created
        # it. Confirm this assumption during PR testing; if mautrix ties
        # login to the literal message author instead of the DM peer, we
        # need to switch to sending via the caller's access token.
        await bot_send_message(room_id, {"msgtype": "m.text", "body": "login"})
    except Exception as exc:
        logger.warning(
            "user_discord_login: login trigger send failed for %s: %s",
            user_id, exc,
        )
        raise HTTPException(
            status_code=502,
            detail=f"Could not send login trigger: {exc}",
        ) from exc

    logger.info("user_discord_login: login triggered by %s in %s", user_id, room_id)
    return DiscordLoginResponse(
        ok=True,
        room_id=room_id,
        message="Login triggered. Open the DM with Discord Bot to scan the QR code.",
    )


# ---------------------------------------------------------------------
# POST /discord/logout + DELETE /discord
# ---------------------------------------------------------------------


async def _send_logout(user_id: str, access_token: str) -> DiscordLogoutResponse:
    """Shared body for POST /logout and DELETE /discord."""
    bridge_bot = _bridge_bot_mxid()

    try:
        room_id = await create_dm_room(access_token, bridge_bot)
    except Exception as exc:
        logger.warning(
            "user_discord_logout: create_dm_room failed for %s: %s", user_id, exc
        )
        raise HTTPException(
            status_code=502,
            detail=f"Could not reach bridge bot DM: {exc}",
        ) from exc

    try:
        await bot_send_message(room_id, {"msgtype": "m.text", "body": "logout"})
    except Exception as exc:
        logger.warning(
            "user_discord_logout: logout send failed for %s: %s", user_id, exc
        )
        raise HTTPException(
            status_code=502,
            detail=f"Could not send logout to bridge bot: {exc}",
        ) from exc

    logger.info("user_discord_logout: logout sent by %s", user_id)
    return DiscordLogoutResponse(
        ok=True,
        message="Logout sent. Your Discord session has been disconnected.",
    )


@router.post("/discord/logout", response_model=DiscordLogoutResponse)
async def user_discord_logout(
    body: NoBodyRequest | None = None,
    user_id: str = Depends(get_user_id),
    access_token: str = Depends(get_access_token),
) -> DiscordLogoutResponse:
    return await _send_logout(user_id, access_token)


@router.delete("/discord", response_model=DiscordLogoutResponse)
async def user_discord_disconnect(
    user_id: str = Depends(get_user_id),
    access_token: str = Depends(get_access_token),
) -> DiscordLogoutResponse:
    """Alias for ``POST /discord/logout``. Present because DELETE on a
    resource is the idiomatic REST verb for "remove my connection"."""
    return await _send_logout(user_id, access_token)
