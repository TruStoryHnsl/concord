"""Authenticated media proxy.

Proxies Matrix media requests so the client can avoid putting long-lived
access tokens in URL query parameters (which leak into logs, referrers,
and browser history).

Accepts auth via:
- Authorization: Bearer header (preferred, used by fetch() calls)
- ?token= query parameter (for <img>/<audio>/<video> tags that can't send headers)

The query parameter token is the same Matrix access token but is only exposed
on same-origin requests (Caddy sets strict Referrer-Policy) and is not logged
by Caddy since it proxies to the backend internally.
"""

import httpx
from fastapi import APIRouter, Depends, HTTPException, Header, Query
from fastapi.responses import StreamingResponse

from config import MATRIX_HOMESERVER_URL

router = APIRouter(prefix="/api/media", tags=["media"])


def _extract_token(
    authorization: str | None = Header(default=None),
    token: str | None = Query(default=None),
) -> str:
    """Extract access token from header or query parameter."""
    if authorization and authorization.startswith("Bearer "):
        return authorization[7:]
    if token:
        return token
    raise HTTPException(401, "Authentication required")


@router.get("/download/{server_name}/{media_id}")
async def proxy_download(
    server_name: str,
    media_id: str,
    access_token: str = Depends(_extract_token),
):
    """Proxy a Matrix media download with proper auth headers."""
    url = (
        f"{MATRIX_HOMESERVER_URL}/_matrix/client/v1/media/download"
        f"/{server_name}/{media_id}"
    )
    return await _proxy_media(url, access_token)


@router.get("/thumbnail/{server_name}/{media_id}")
async def proxy_thumbnail(
    server_name: str,
    media_id: str,
    width: int = 128,
    height: int = 128,
    method: str = "crop",
    access_token: str = Depends(_extract_token),
):
    """Proxy a Matrix media thumbnail with proper auth headers."""
    url = (
        f"{MATRIX_HOMESERVER_URL}/_matrix/client/v1/media/thumbnail"
        f"/{server_name}/{media_id}"
        f"?width={width}&height={height}&method={method}"
    )
    return await _proxy_media(url, access_token)


async def _proxy_media(url: str, access_token: str) -> StreamingResponse:
    """Stream a media response from the Matrix homeserver."""
    client = httpx.AsyncClient(timeout=30.0)
    try:
        resp = await client.get(
            url,
            headers={"Authorization": f"Bearer {access_token}"},
        )
    except httpx.RequestError:
        await client.aclose()
        raise HTTPException(502, "Failed to fetch media from homeserver")

    if resp.status_code != 200:
        await client.aclose()
        raise HTTPException(resp.status_code, "Media not found")

    content_type = resp.headers.get("content-type", "application/octet-stream")

    async def stream():
        try:
            yield resp.content
        finally:
            await client.aclose()

    return StreamingResponse(
        stream(),
        media_type=content_type,
        headers={
            "Cache-Control": "private, max-age=86400",
        },
    )
