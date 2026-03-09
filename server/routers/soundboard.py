import asyncio
import mimetypes
import secrets
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import SOUNDBOARD_DIR, FREESOUND_API_KEY, ADMIN_USER_IDS
from database import get_db
from dependencies import require_server_member
from models import SoundboardClip, Server
from routers.servers import get_user_id

router = APIRouter(prefix="/api/soundboard", tags=["soundboard"])

ALLOWED_EXTENSIONS = {".mp3", ".wav", ".ogg", ".webm", ".m4a"}
MAX_FILE_SIZE = 5 * 1024 * 1024  # 5MB

# Magic bytes for validating audio file types
MAGIC_BYTES = {
    ".mp3": [b"\xff\xfb", b"\xff\xf3", b"\xff\xf2", b"ID3"],
    ".wav": [b"RIFF"],
    ".ogg": [b"OggS"],
    ".webm": [b"\x1a\x45\xdf\xa3"],
    ".m4a": [b"\x00\x00\x00"],  # ftyp box (offset varies, checked loosely)
}


class ClipOut(BaseModel):
    id: int
    name: str = Field(min_length=1, max_length=100)
    server_id: str
    uploaded_by: str
    duration: float | None
    url: str

    model_config = {"from_attributes": True}


# IMPORTANT: /file/{clip_id} must be declared BEFORE /{server_id}
# because FastAPI uses first-match routing — otherwise "file" is
# captured as a server_id and this endpoint becomes unreachable.
@router.get("/file/{clip_id}")
async def serve_clip(
    clip_id: int,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Serve a soundboard clip file. Requires server membership."""
    clip = await db.get(SoundboardClip, clip_id)
    if not clip:
        raise HTTPException(404, "Clip not found")

    await require_server_member(clip.server_id, user_id, db)

    file_path = SOUNDBOARD_DIR / clip.server_id / clip.filename
    if not file_path.exists():
        raise HTTPException(404, "File not found")

    content_type, _ = mimetypes.guess_type(clip.filename)
    return FileResponse(file_path, media_type=content_type or "application/octet-stream")


# ── Freesound library integration ─────────────────────────────────────

class LibraryResult(BaseModel):
    id: int
    name: str
    duration: float
    preview_url: str


FREESOUND_SORT_OPTIONS = {
    "relevance": "score",
    "popular": "downloads_desc",
    "rating": "rating_desc",
    "newest": "created_desc",
    "shortest": "duration_asc",
    "longest": "duration_desc",
}


@router.get("/library/search", response_model=list[LibraryResult])
async def search_library(
    q: str = Query(..., min_length=1, max_length=200),
    sort: str = Query("relevance"),
    page: int = Query(1, ge=1, le=20),
    user_id: str = Depends(get_user_id),
):
    """Search Freesound library for sound effects."""
    if not FREESOUND_API_KEY:
        raise HTTPException(501, "Sound library not configured (missing API key)")

    fs_sort = FREESOUND_SORT_OPTIONS.get(sort, "score")

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            "https://freesound.org/apiv2/search/text/",
            params={
                "query": q,
                "fields": "id,name,duration,previews",
                "page": page,
                "page_size": 15,
                "filter": "duration:[0.1 TO 30]",
                "sort": fs_sort,
                "token": FREESOUND_API_KEY,
            },
        )
        if resp.status_code != 200:
            raise HTTPException(502, "Freesound API error")

    data = resp.json()
    results = []
    for item in data.get("results", []):
        previews = item.get("previews", {})
        preview_url = previews.get("preview-hq-mp3") or previews.get("preview-lq-mp3", "")
        if preview_url:
            results.append(LibraryResult(
                id=item["id"],
                name=item["name"],
                duration=item.get("duration", 0),
                preview_url=preview_url,
            ))
    return results


class ImportRequest(BaseModel):
    freesound_id: int
    name: str = Field(min_length=1, max_length=100)
    preview_url: str


@router.post("/library/import/{server_id}", response_model=ClipOut)
async def import_from_library(
    server_id: str,
    body: ImportRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Import a sound from Freesound into a server's soundboard."""
    if not FREESOUND_API_KEY:
        raise HTTPException(501, "Sound library not configured")

    await require_server_member(server_id, user_id, db)

    server = await db.get(Server, server_id)
    if not server:
        raise HTTPException(404, "Server not found")

    # Download the preview MP3
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(body.preview_url)
        if resp.status_code != 200:
            raise HTTPException(502, "Failed to download sound from Freesound")

    content = resp.content
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(400, "Sound file too large")

    # Validate it's actually an MP3
    if not any(content.startswith(m) for m in MAGIC_BYTES[".mp3"]):
        raise HTTPException(400, "Downloaded file is not a valid MP3")

    # Save file
    stored_name = f"fs_{body.freesound_id}_{secrets.token_urlsafe(8)}.mp3"
    server_dir = SOUNDBOARD_DIR / server_id
    server_dir.mkdir(parents=True, exist_ok=True)
    file_path = server_dir / stored_name
    await asyncio.to_thread(file_path.write_bytes, content)

    # Create DB record
    clip = SoundboardClip(
        server_id=server_id,
        name=body.name,
        filename=stored_name,
        uploaded_by=user_id,
    )
    db.add(clip)
    await db.commit()
    await db.refresh(clip)

    return ClipOut(
        id=clip.id,
        name=clip.name,
        server_id=clip.server_id,
        uploaded_by=clip.uploaded_by,
        duration=clip.duration,
        url=f"/api/soundboard/file/{clip.id}",
    )


@router.get("/{server_id}", response_model=list[ClipOut])
async def list_clips(
    server_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    """List all soundboard clips for a server. Requires server membership."""
    await require_server_member(server_id, user_id, db)
    result = await db.execute(
        select(SoundboardClip)
        .where(SoundboardClip.server_id == server_id)
        .order_by(SoundboardClip.name)
    )
    clips = result.scalars().all()
    return [
        ClipOut(
            id=c.id,
            name=c.name,
            server_id=c.server_id,
            uploaded_by=c.uploaded_by,
            duration=c.duration,
            url=f"/api/soundboard/file/{c.id}",
        )
        for c in clips
    ]


@router.post("/{server_id}", response_model=ClipOut)
async def upload_clip(
    server_id: str,
    name: str = Form(...),
    file: UploadFile = File(...),
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Upload a soundboard clip. Requires server membership."""
    await require_server_member(server_id, user_id, db)

    # Verify server exists
    server = await db.get(Server, server_id)
    if not server:
        raise HTTPException(404, "Server not found")

    # Validate file
    if not file.filename:
        raise HTTPException(400, "No file provided")

    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"Unsupported format. Allowed: {', '.join(ALLOWED_EXTENSIONS)}")

    # Stream-read up to MAX_FILE_SIZE + 1 to detect oversized files
    # without buffering unlimited data into RAM
    chunks = []
    total = 0
    while True:
        chunk = await file.read(64 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_FILE_SIZE:
            raise HTTPException(400, "File too large (max 5MB)")
        chunks.append(chunk)
    content = b"".join(chunks)

    # Validate magic bytes match the claimed extension
    magic_patterns = MAGIC_BYTES.get(ext, [])
    if magic_patterns and not any(content.startswith(m) for m in magic_patterns):
        raise HTTPException(400, f"File content does not match {ext} format")

    # Save file (async to avoid blocking the event loop)
    stored_name = f"{secrets.token_urlsafe(12)}{ext}"
    server_dir = SOUNDBOARD_DIR / server_id
    server_dir.mkdir(parents=True, exist_ok=True)
    file_path = server_dir / stored_name
    await asyncio.to_thread(file_path.write_bytes, content)

    # Create DB record
    clip = SoundboardClip(
        server_id=server_id,
        name=name,
        filename=stored_name,
        uploaded_by=user_id,
    )
    db.add(clip)
    await db.commit()
    await db.refresh(clip)

    return ClipOut(
        id=clip.id,
        name=clip.name,
        server_id=clip.server_id,
        uploaded_by=clip.uploaded_by,
        duration=clip.duration,
        url=f"/api/soundboard/file/{clip.id}",
    )


@router.delete("/{clip_id}")
async def delete_clip(
    clip_id: int,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Delete a soundboard clip. Requires uploader, server owner, or admin."""
    clip = await db.get(SoundboardClip, clip_id)
    if not clip:
        raise HTTPException(404, "Clip not found")

    # Allow deletion by the uploader, server owner, or global admin
    if clip.uploaded_by != user_id and user_id not in ADMIN_USER_IDS:
        server = await db.get(Server, clip.server_id)
        if not server or server.owner_id != user_id:
            raise HTTPException(403, "Only the uploader, server owner, or admin can delete clips")

    # Delete file
    file_path = SOUNDBOARD_DIR / clip.server_id / clip.filename
    if file_path.exists():
        file_path.unlink()

    await db.delete(clip)
    await db.commit()
    return {"status": "deleted"}
