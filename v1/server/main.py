import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import init_db
from routers import servers, invites, registration, voice, soundboard, webhooks, admin, direct_invites, stats, totp, moderation, preview, media


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Auto-migrate old database filename from pre-rename era (concorrd → concord)
    from config import DATA_DIR
    old_db = DATA_DIR / "concorrd.db"
    new_db = DATA_DIR / "concord.db"
    if old_db.exists() and not new_db.exists():
        old_db.rename(new_db)
        import logging
        logging.getLogger(__name__).info("Migrated database: concorrd.db -> concord.db")

    await init_db()

    # Migrate existing tables: add new columns if missing
    from database import engine
    from sqlalchemy import text, inspect as sa_inspect

    async with engine.begin() as conn:
        def _migrate(connection):
            insp = sa_inspect(connection)

            # Server: add visibility, abbreviation
            server_cols = {c["name"] for c in insp.get_columns("servers")}
            if "visibility" not in server_cols:
                connection.execute(text(
                    "ALTER TABLE servers ADD COLUMN visibility VARCHAR DEFAULT 'private'"
                ))
            if "abbreviation" not in server_cols:
                connection.execute(text(
                    "ALTER TABLE servers ADD COLUMN abbreviation VARCHAR(3)"
                ))

            # ServerMember: add display_name
            member_cols = {c["name"] for c in insp.get_columns("server_members")}
            if "display_name" not in member_cols:
                connection.execute(text(
                    "ALTER TABLE server_members ADD COLUMN display_name VARCHAR"
                ))

            # InviteToken: add permanent flag
            invite_cols = {c["name"] for c in insp.get_columns("invite_tokens")}
            if "permanent" not in invite_cols:
                connection.execute(text(
                    "ALTER TABLE invite_tokens ADD COLUMN permanent BOOLEAN DEFAULT 0"
                ))

            # Webhooks table
            if not insp.has_table("webhooks"):
                connection.execute(text("""
                    CREATE TABLE webhooks (
                        id VARCHAR PRIMARY KEY,
                        server_id VARCHAR NOT NULL REFERENCES servers(id),
                        channel_id INTEGER NOT NULL REFERENCES channels(id),
                        name VARCHAR NOT NULL,
                        created_by VARCHAR NOT NULL,
                        enabled BOOLEAN DEFAULT 1,
                        created_at DATETIME
                    )
                """))

            # Direct invites table
            if not insp.has_table("direct_invites"):
                connection.execute(text("""
                    CREATE TABLE direct_invites (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        server_id VARCHAR NOT NULL REFERENCES servers(id),
                        inviter_id VARCHAR NOT NULL,
                        invitee_id VARCHAR NOT NULL,
                        status VARCHAR DEFAULT 'pending',
                        created_at DATETIME
                    )
                """))

            # Voice sessions table
            if not insp.has_table("voice_sessions"):
                connection.execute(text("""
                    CREATE TABLE voice_sessions (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id VARCHAR NOT NULL,
                        channel_id VARCHAR NOT NULL,
                        server_id VARCHAR NOT NULL REFERENCES servers(id),
                        started_at DATETIME NOT NULL,
                        ended_at DATETIME,
                        duration_seconds INTEGER
                    )
                """))

            # Message counts table
            if not insp.has_table("message_counts"):
                connection.execute(text("""
                    CREATE TABLE message_counts (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id VARCHAR NOT NULL,
                        channel_id VARCHAR NOT NULL,
                        server_id VARCHAR NOT NULL REFERENCES servers(id),
                        day VARCHAR NOT NULL,
                        count INTEGER DEFAULT 0,
                        UNIQUE(user_id, channel_id, day)
                    )
                """))

            # Server: add kick/ban settings
            if "kick_limit" not in server_cols:
                connection.execute(text(
                    "ALTER TABLE servers ADD COLUMN kick_limit INTEGER DEFAULT 3"
                ))
            if "kick_window_minutes" not in server_cols:
                connection.execute(text(
                    "ALTER TABLE servers ADD COLUMN kick_window_minutes INTEGER DEFAULT 30"
                ))
            if "ban_mode" not in server_cols:
                connection.execute(text(
                    "ALTER TABLE servers ADD COLUMN ban_mode VARCHAR DEFAULT 'soft'"
                ))
            if "media_uploads_enabled" not in server_cols:
                connection.execute(text(
                    "ALTER TABLE servers ADD COLUMN media_uploads_enabled BOOLEAN DEFAULT 1"
                ))

            # ServerMember: add can_kick, can_ban permissions
            if "can_kick" not in member_cols:
                connection.execute(text(
                    "ALTER TABLE server_members ADD COLUMN can_kick BOOLEAN DEFAULT 0"
                ))
            if "can_ban" not in member_cols:
                connection.execute(text(
                    "ALTER TABLE server_members ADD COLUMN can_ban BOOLEAN DEFAULT 0"
                ))

            # Channel locks table
            if not insp.has_table("channel_locks"):
                connection.execute(text("""
                    CREATE TABLE channel_locks (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        channel_id INTEGER NOT NULL UNIQUE REFERENCES channels(id),
                        pin_hash VARCHAR NOT NULL,
                        locked_by VARCHAR NOT NULL,
                        created_at DATETIME
                    )
                """))

            # Vote kicks table
            if not insp.has_table("vote_kicks"):
                connection.execute(text("""
                    CREATE TABLE vote_kicks (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        server_id VARCHAR NOT NULL REFERENCES servers(id),
                        channel_id VARCHAR NOT NULL,
                        target_user_id VARCHAR NOT NULL,
                        initiated_by VARCHAR NOT NULL,
                        votes_yes VARCHAR DEFAULT '',
                        votes_no VARCHAR DEFAULT '',
                        total_eligible INTEGER DEFAULT 0,
                        status VARCHAR DEFAULT 'active',
                        created_at DATETIME
                    )
                """))

            # Kick records table
            if not insp.has_table("kick_records"):
                connection.execute(text("""
                    CREATE TABLE kick_records (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        server_id VARCHAR NOT NULL REFERENCES servers(id),
                        user_id VARCHAR NOT NULL,
                        kicked_by VARCHAR NOT NULL,
                        reason VARCHAR,
                        created_at DATETIME
                    )
                """))

            # IP bans table
            if not insp.has_table("ip_bans"):
                connection.execute(text("""
                    CREATE TABLE ip_bans (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        ip_address VARCHAR NOT NULL,
                        user_id VARCHAR NOT NULL,
                        server_id VARCHAR NOT NULL REFERENCES servers(id),
                        banned_by VARCHAR NOT NULL,
                        reason VARCHAR,
                        created_at DATETIME
                    )
                """))

            # User TOTP table
            if not insp.has_table("user_totp"):
                connection.execute(text("""
                    CREATE TABLE user_totp (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id VARCHAR NOT NULL UNIQUE,
                        secret VARCHAR NOT NULL,
                        enabled BOOLEAN DEFAULT 0,
                        created_at DATETIME
                    )
                """))

            # Bug reports table
            if not insp.has_table("bug_reports"):
                connection.execute(text("""
                    CREATE TABLE bug_reports (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        reported_by VARCHAR NOT NULL,
                        title VARCHAR NOT NULL,
                        description VARCHAR NOT NULL,
                        system_info VARCHAR,
                        status VARCHAR DEFAULT 'open',
                        admin_notes VARCHAR,
                        created_at DATETIME,
                        updated_at DATETIME
                    )
                """))

            # SoundboardClip: add keybind
            clip_cols = {c["name"] for c in insp.get_columns("soundboard_clips")}
            if "keybind" not in clip_cols:
                connection.execute(text(
                    "ALTER TABLE soundboard_clips ADD COLUMN keybind VARCHAR"
                ))

        await conn.run_sync(_migrate)

    # Initialize bot user for webhook message delivery
    from services.bot import init_bot
    try:
        await init_bot()
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning("Bot init failed (webhooks will not work): %s", e)

    # Seed default public server on first run
    try:
        await _seed_default_server()
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning("Default server seed failed: %s", e)

    yield


async def _seed_default_server():
    """Create a default public lobby server on first startup."""
    import json
    import logging
    from datetime import datetime, timezone
    from config import INSTANCE_SETTINGS_FILE, INSTANCE_NAME_DEFAULT
    from services.bot import BOT_ACCESS_TOKEN, BOT_USER_ID
    from services.matrix_admin import create_matrix_room
    from database import async_session
    from models import Server, Channel, ServerMember

    logger = logging.getLogger(__name__)

    # Check if already seeded
    settings: dict = {}
    if INSTANCE_SETTINGS_FILE.exists():
        settings = json.loads(INSTANCE_SETTINGS_FILE.read_text())
    if settings.get("default_server_seeded"):
        return

    if not BOT_ACCESS_TOKEN:
        logger.warning("Cannot seed default server: bot not initialized")
        return

    instance_name = settings.get("name", INSTANCE_NAME_DEFAULT)
    server_name = f"{instance_name} Lobby"

    # Define the pre-created channels
    channel_defs = [
        ("general", "text"),
        ("off-topic", "text"),
        ("introductions", "text"),
        ("media-sharing", "text"),
        ("hangout", "voice"),
        ("music-lounge", "voice"),
    ]

    async with async_session() as db:
        # Create server record
        server = Server(
            name=server_name,
            owner_id=BOT_USER_ID,
            visibility="public",
            abbreviation="LOB",
        )
        db.add(server)
        await db.flush()

        # Bot is owner
        db.add(ServerMember(server_id=server.id, user_id=BOT_USER_ID, role="owner"))

        # Create Matrix rooms and channel records
        for position, (ch_name, ch_type) in enumerate(channel_defs):
            room_id = await create_matrix_room(
                BOT_ACCESS_TOKEN, f"{server_name} - {ch_name}"
            )
            db.add(Channel(
                server_id=server.id,
                matrix_room_id=room_id,
                name=ch_name,
                channel_type=ch_type,
                position=position,
            ))

        await db.commit()

        # Save the default server ID and mark as seeded
        settings["default_server_id"] = server.id
        settings["default_server_seeded"] = True
        INSTANCE_SETTINGS_FILE.write_text(json.dumps(settings, indent=2))

        logger.info("Default server '%s' created with ID %s", server_name, server.id)


app = FastAPI(title="Concord API", lifespan=lifespan)

_default_origins = (
    "https://concorrd.com,"
    "https://www.concorrd.com,"
    "http://localhost:5173,"
    "http://localhost:8080"
)
allowed_origins = os.getenv("CORS_ORIGINS", _default_origins).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in allowed_origins],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(servers.router)
app.include_router(invites.router)
app.include_router(registration.router)
app.include_router(voice.router)
app.include_router(soundboard.router)
app.include_router(webhooks.router)
app.include_router(admin.router)
app.include_router(direct_invites.router)
app.include_router(stats.router)
app.include_router(totp.router)
app.include_router(moderation.router)
app.include_router(preview.router)
app.include_router(media.router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}
