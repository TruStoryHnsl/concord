"""Tests for the invite token pillar.

Scope: the public validate endpoint + the `InviteToken.is_valid` model
property. These are the cheapest, most regression-prone pieces of the
invite flow:

- The validate endpoint is unauthenticated, so a broken implementation
  could leak server names to strangers or accept expired tokens
  silently.
- `is_valid` bakes in subtle timezone handling (see `models.py:68`) —
  the exact kind of thing that quietly breaks when a dependency is
  upgraded or a DB column type changes.

Redemption (`POST /api/invites/{token}/redeem`) is NOT covered here
because it calls `services.matrix_admin.join_room` which hits the real
conduwuit homeserver. That's a separate test file that needs a stub
for the matrix_admin module — landing as a follow-up.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from models import Server, InviteToken


# ---------------------------------------------------------------------
# Fixtures local to this file
# ---------------------------------------------------------------------

@pytest.fixture
async def seeded_server(db_session):
    """Insert a single Server row and return it. Tests that need an
    invite token attached to a real server use this."""
    server = Server(
        id="srv_test_001",
        name="Test Server",
        owner_id="@owner:test.local",
    )
    db_session.add(server)
    await db_session.commit()
    await db_session.refresh(server)
    return server


async def _make_invite(db_session, server_id: str, **overrides) -> InviteToken:
    """Helper that builds an InviteToken with sensible defaults.

    Not a fixture because multiple tests in the same test function
    need to make several different invites (valid, expired, exhausted,
    etc.) and a fixture would force awkward parameterisation.
    """
    defaults = dict(
        server_id=server_id,
        created_by="@owner:test.local",
        max_uses=10,
        use_count=0,
        permanent=False,
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
    )
    defaults.update(overrides)
    invite = InviteToken(**defaults)
    db_session.add(invite)
    await db_session.commit()
    await db_session.refresh(invite)
    return invite


# ---------------------------------------------------------------------
# GET /api/invites/validate/{token}
# ---------------------------------------------------------------------

async def test_validate_nonexistent_token_returns_invalid(client):
    """A made-up token should return valid=false with no server info.

    Regression guard: a previous version of this endpoint could leak
    "this token does not exist" vs "this token is expired" via different
    error bodies, giving attackers a way to probe for valid tokens. The
    contract here is that both cases return the same shape:
    {"valid": false}. No server_name, no server_id, no hints.
    """
    resp = await client.get("/api/invites/validate/does-not-exist-12345")
    assert resp.status_code == 200
    body = resp.json()
    assert body["valid"] is False
    assert body.get("server_name") is None
    assert body.get("server_id") is None


async def test_validate_valid_token_returns_server_name(client, seeded_server, db_session):
    """A valid non-expired token with uses remaining should return
    valid=true and the server's display name (not its opaque id)."""
    invite = await _make_invite(db_session, seeded_server.id)

    resp = await client.get(f"/api/invites/validate/{invite.token}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["valid"] is True
    assert body["server_name"] == "Test Server"
    assert body["server_id"] == seeded_server.id


async def test_validate_expired_token_returns_invalid(client, seeded_server, db_session):
    """A token past its expiry should report invalid even if use_count
    is still under max_uses.

    This is the single most important invite test: expiry is the main
    security boundary. A bug in timezone handling or comparison
    direction would silently turn every expired invite into a valid
    one. Must fail loud.
    """
    expired_invite = await _make_invite(
        db_session,
        seeded_server.id,
        expires_at=datetime.now(timezone.utc) - timedelta(hours=1),
    )

    resp = await client.get(f"/api/invites/validate/{expired_invite.token}")
    assert resp.status_code == 200
    assert resp.json()["valid"] is False


async def test_validate_exhausted_token_returns_invalid(client, seeded_server, db_session):
    """A token whose use_count has reached max_uses should report
    invalid. This prevents a classic exhaustion-bypass bug where
    incrementing logic lags behind a busy refresh and the Nth+1 user
    slips through."""
    exhausted = await _make_invite(
        db_session,
        seeded_server.id,
        max_uses=5,
        use_count=5,  # already at the limit
    )

    resp = await client.get(f"/api/invites/validate/{exhausted.token}")
    assert resp.status_code == 200
    assert resp.json()["valid"] is False


async def test_validate_permanent_token_bypasses_use_count(client, seeded_server, db_session):
    """A permanent token should remain valid regardless of use_count
    OR expiry. This is a behavioural carve-out documented in the
    `InviteToken.is_valid` property (models.py:65-66).

    Guards against a refactor that accidentally removes the
    `if self.permanent: return True` short-circuit — a bug that
    would only surface when a permanent invite's use_count happened
    to drift past max_uses (very rare, very embarrassing).
    """
    permanent = await _make_invite(
        db_session,
        seeded_server.id,
        permanent=True,
        max_uses=1,
        use_count=999,  # would be "exhausted" if it weren't permanent
        expires_at=datetime.now(timezone.utc) - timedelta(days=365),  # already "expired"
    )

    resp = await client.get(f"/api/invites/validate/{permanent.token}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["valid"] is True
    assert body["server_name"] == "Test Server"


# ---------------------------------------------------------------------
# InviteToken.is_valid property — unit tests bypassing HTTP
# ---------------------------------------------------------------------

async def test_is_valid_handles_naive_datetimes():
    """`is_valid` contains a subtle branch for naive datetimes at
    models.py:68. SQLite + SQLAlchemy can return DateTime columns as
    tzinfo-less even though we wrote them as UTC-aware, depending on
    dialect config. This test exercises the naive branch directly.

    Constructs the naive datetime by dropping tzinfo from an aware
    UTC datetime — cleaner than `datetime.utcnow()` (which is
    deprecated in Py3.12+) and makes intent explicit.
    """
    now_naive_future = (datetime.now(timezone.utc) + timedelta(days=1)).replace(tzinfo=None)
    now_naive_past = (datetime.now(timezone.utc) - timedelta(days=1)).replace(tzinfo=None)

    invite = InviteToken(
        token="t",
        server_id="s",
        created_by="@u:x",
        max_uses=10,
        use_count=0,
        permanent=False,
        expires_at=now_naive_future,
    )
    assert invite.is_valid is True

    invite.expires_at = now_naive_past
    assert invite.is_valid is False
