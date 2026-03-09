import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import String, DateTime, Integer, Float, Boolean, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class Server(Base):
    __tablename__ = "servers"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: secrets.token_urlsafe(8))
    name: Mapped[str] = mapped_column(String, nullable=False)
    icon_url: Mapped[str | None] = mapped_column(String, nullable=True)
    owner_id: Mapped[str] = mapped_column(String, nullable=False)  # Matrix user ID
    visibility: Mapped[str] = mapped_column(String, default="private")  # "private" or "public"
    abbreviation: Mapped[str | None] = mapped_column(String(3), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    channels: Mapped[list["Channel"]] = relationship(back_populates="server", cascade="all, delete-orphan")
    invites: Mapped[list["InviteToken"]] = relationship(back_populates="server", cascade="all, delete-orphan")
    members: Mapped[list["ServerMember"]] = relationship(back_populates="server", cascade="all, delete-orphan")
    bans: Mapped[list["ServerBan"]] = relationship(back_populates="server", cascade="all, delete-orphan")
    whitelist: Mapped[list["ServerWhitelist"]] = relationship(back_populates="server", cascade="all, delete-orphan")


class Channel(Base):
    __tablename__ = "channels"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    server_id: Mapped[str] = mapped_column(String, ForeignKey("servers.id"), nullable=False)
    matrix_room_id: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    channel_type: Mapped[str] = mapped_column(String, default="text")  # "text" or "voice"
    position: Mapped[int] = mapped_column(Integer, default=0)

    server: Mapped["Server"] = relationship(back_populates="channels")


class InviteToken(Base):
    __tablename__ = "invite_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    token: Mapped[str] = mapped_column(String, unique=True, nullable=False, default=lambda: secrets.token_urlsafe(16))
    server_id: Mapped[str] = mapped_column(String, ForeignKey("servers.id"), nullable=False)
    created_by: Mapped[str] = mapped_column(String, nullable=False)  # Matrix user ID
    expires_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc) + timedelta(days=7),
    )
    max_uses: Mapped[int] = mapped_column(Integer, default=10)
    use_count: Mapped[int] = mapped_column(Integer, default=0)
    permanent: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    server: Mapped["Server"] = relationship(back_populates="invites")

    @property
    def is_valid(self) -> bool:
        if self.permanent:
            return True
        now = datetime.now(timezone.utc)
        expires = self.expires_at.replace(tzinfo=timezone.utc) if self.expires_at.tzinfo is None else self.expires_at
        return self.use_count < self.max_uses and now < expires


class ServerMember(Base):
    __tablename__ = "server_members"
    __table_args__ = (
        UniqueConstraint("server_id", "user_id", name="uq_server_member"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    server_id: Mapped[str] = mapped_column(String, ForeignKey("servers.id"), nullable=False)
    user_id: Mapped[str] = mapped_column(String, nullable=False)  # Matrix user ID
    role: Mapped[str] = mapped_column(String, default="member")  # "owner", "admin", or "member"
    display_name: Mapped[str | None] = mapped_column(String, nullable=True)
    joined_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    server: Mapped["Server"] = relationship(back_populates="members")


class ServerBan(Base):
    __tablename__ = "server_bans"
    __table_args__ = (
        UniqueConstraint("server_id", "user_id", name="uq_server_ban"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    server_id: Mapped[str] = mapped_column(String, ForeignKey("servers.id"), nullable=False)
    user_id: Mapped[str] = mapped_column(String, nullable=False)  # Matrix user ID
    banned_by: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    server: Mapped["Server"] = relationship(back_populates="bans")


class ServerWhitelist(Base):
    __tablename__ = "server_whitelist"
    __table_args__ = (
        UniqueConstraint("server_id", "user_id", name="uq_server_whitelist"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    server_id: Mapped[str] = mapped_column(String, ForeignKey("servers.id"), nullable=False)
    user_id: Mapped[str] = mapped_column(String, nullable=False)  # Matrix user ID
    added_by: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    server: Mapped["Server"] = relationship(back_populates="whitelist")


class Webhook(Base):
    __tablename__ = "webhooks"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: secrets.token_urlsafe(16))
    server_id: Mapped[str] = mapped_column(String, ForeignKey("servers.id"), nullable=False)
    channel_id: Mapped[int] = mapped_column(Integer, ForeignKey("channels.id"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    created_by: Mapped[str] = mapped_column(String, nullable=False)  # Matrix user ID
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    server: Mapped["Server"] = relationship()
    channel: Mapped["Channel"] = relationship()


class SoundboardClip(Base):
    __tablename__ = "soundboard_clips"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    server_id: Mapped[str] = mapped_column(String, ForeignKey("servers.id"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    filename: Mapped[str] = mapped_column(String, nullable=False)  # stored filename on disk
    uploaded_by: Mapped[str] = mapped_column(String, nullable=False)  # Matrix user ID
    duration: Mapped[float | None] = mapped_column(Float, nullable=True)  # seconds
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    server: Mapped["Server"] = relationship()


class DirectInvite(Base):
    __tablename__ = "direct_invites"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    server_id: Mapped[str] = mapped_column(String, ForeignKey("servers.id"), nullable=False)
    inviter_id: Mapped[str] = mapped_column(String, nullable=False)  # Matrix user ID
    invitee_id: Mapped[str] = mapped_column(String, nullable=False)  # Matrix user ID
    status: Mapped[str] = mapped_column(String, default="pending")  # pending, accepted, declined
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    server: Mapped["Server"] = relationship()


class BugReport(Base):
    __tablename__ = "bug_reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    reported_by: Mapped[str] = mapped_column(String, nullable=False)  # Matrix user ID
    title: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(String, nullable=False)
    system_info: Mapped[str | None] = mapped_column(String, nullable=True)  # JSON blob
    status: Mapped[str] = mapped_column(String, default="open")  # open, in_progress, resolved, closed
    admin_notes: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
