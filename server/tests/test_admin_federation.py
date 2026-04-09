"""Tests for the admin federation allowlist pillar.

Scope:
1. Pure helpers from `services.tuwunel_config` — `is_valid_server_name`
   and `server_names_to_regex_patterns`. These are the backbone of
   correctness for the allowlist and are trivial to unit-test.
2. The `PUT /api/admin/federation/allowlist` endpoint — auth gating,
   validation, and that the written TOML file contains the expected
   anchored regex patterns.

Scope exclusions:
- `POST /api/admin/federation/apply` is NOT covered here — it restarts
  the conduwuit container via the Docker socket proxy, which is a real
  external dependency. Covered in a future integration-marked test.

Security anchor: the comment in `admin.py:518-520` documents that an
earlier version only anchored `$` at the end of each regex, which
allowed substring bypasses (allowlisting `friend.example.com` would
also permit `evil-friend.example.com`). That exact bug gets a dedicated
regression test below.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from services.tuwunel_config import (
    is_valid_server_name,
    server_names_to_regex_patterns,
    read_federation,
    write_federation,
    FederationSettings,
)
import services.tuwunel_config as tuwunel_config
from tests.conftest import login_as, logout


# ---------------------------------------------------------------------
# Pure helper: is_valid_server_name
# ---------------------------------------------------------------------

@pytest.mark.parametrize("name", [
    "matrix.org",
    "example.com",
    "sub.domain.example.co.uk",
    "a.b.c.d.e.f.g.example.net",
    "xn--nxasmq6b.example.com",  # IDN-encoded label
    "host-with-dashes.example.com",
    "1numeric.example.com",
])
def test_is_valid_server_name_accepts_real_hostnames(name):
    """RFC-1123 hostnames the function is documented to accept."""
    assert is_valid_server_name(name) is True, f"should accept {name!r}"


@pytest.mark.parametrize("name", [
    "",                               # empty
    "nodot",                          # no TLD
    ".leadingdot.com",                # leading dot
    "trailingdot.com.",               # trailing dot (SHOULD be invalid per our regex)
    "-leadinghyphen.com",             # leading hyphen in label
    "trailinghyphen-.com",            # trailing hyphen in label
    "UPPERCASE.COM",                  # we lowercase in the router, but the validator itself is lowercase-only
    "space in.host.com",              # spaces
    "inv@lid.com",                    # special chars
    "a" * 300 + ".com",               # exceeds 253 char total length
    "..",                             # just dots
    "localhost",                      # no dot — not valid per RFC 1123 (we require a TLD)
])
def test_is_valid_server_name_rejects_invalid(name):
    """Everything outside the RFC-1123 shape must be rejected."""
    assert is_valid_server_name(name) is False, f"should reject {name!r}"


# ---------------------------------------------------------------------
# Pure helper: server_names_to_regex_patterns
# ---------------------------------------------------------------------

def test_server_names_to_regex_patterns_anchors_both_ends():
    """Every pattern must start with `^` and end with `$`. No partial
    matches ever."""
    patterns = server_names_to_regex_patterns(["matrix.org"])
    assert len(patterns) == 1
    assert patterns[0].startswith("^")
    assert patterns[0].endswith("$")


def test_server_names_to_regex_patterns_escapes_dots():
    """A dot in the input must become `\\.` in the regex, otherwise
    `matrix.org` would also match `matrixxorg` or similar.

    This is a correctness property, not a security one (we validate
    inputs are valid hostnames first), but it's cheap to assert."""
    (pattern,) = server_names_to_regex_patterns(["matrix.org"])
    # `re.escape("matrix.org")` produces "matrix\\.org" (literal dot).
    assert pattern == r"^matrix\.org$"


def test_server_names_to_regex_patterns_prevents_substring_bypass():
    """The single most important allowlist regression test.

    Scenario: admin allowlists `friend.example.com`. Attacker spins up
    a homeserver at `evil-friend.example.com`. If our pattern only
    anchored the end (`friend\\.example\\.com$`), the attacker's server
    would match and federation would be granted — a silent security
    hole.

    This test asserts that with both `^` and `$` anchors, the attacker's
    hostname does NOT match the allowlisted pattern.
    """
    (pattern,) = server_names_to_regex_patterns(["friend.example.com"])
    regex = re.compile(pattern)

    assert regex.fullmatch("friend.example.com") is not None
    assert regex.fullmatch("evil-friend.example.com") is None
    assert regex.fullmatch("afriend.example.com") is None
    assert regex.fullmatch("friend.example.com.evil.com") is None


def test_server_names_to_regex_patterns_lowercases_and_strips():
    """Inputs with whitespace or mixed case should be normalised.
    Prevents an admin typo from creating two allowlist entries that
    look the same but one has trailing whitespace."""
    patterns = server_names_to_regex_patterns(["  Matrix.ORG  "])
    assert patterns == [r"^matrix\.org$"]


def test_server_names_to_regex_patterns_skips_empty_entries():
    """Blank strings must not produce a pattern like `^$` which would
    match the empty string — a degenerate pattern that matches
    nothing-real but clutters the config."""
    patterns = server_names_to_regex_patterns(["matrix.org", "", "   ", "example.com"])
    assert len(patterns) == 2
    assert r"^matrix\.org$" in patterns
    assert r"^example\.com$" in patterns


# ---------------------------------------------------------------------
# read_federation / write_federation round-trip
# ---------------------------------------------------------------------

def test_read_federation_returns_defaults_when_file_missing(tmp_path, monkeypatch):
    """A fresh install with no tuwunel.toml should return sensible
    defaults, not blow up. Guards the deploy path where install.sh
    hasn't yet populated the file."""
    fake_path = tmp_path / "does-not-exist.toml"
    monkeypatch.setattr(tuwunel_config, "TUWUNEL_CONFIG_PATH", fake_path)

    settings = read_federation()
    assert settings.allow_federation is True
    assert settings.allowed_remote_server_names == []
    # Default forbidden list is EMPTY. An earlier default of [".*"]
    # tried to implement "deny everything not explicitly allowed", but
    # conduwuit's banned_room_check enforces the forbidden regex without
    # consulting the allowlist, so ".*" also rejects the local server's
    # own rooms. Populate allowed_remote_server_names to gate federation.
    assert settings.forbidden_remote_server_names == []


def test_write_and_read_federation_round_trip(tmp_path, monkeypatch):
    """What we wrote is what we read back."""
    fake_path = tmp_path / "tuwunel.toml"
    monkeypatch.setattr(tuwunel_config, "TUWUNEL_CONFIG_PATH", fake_path)

    settings = FederationSettings(
        allow_federation=True,
        allowed_remote_server_names=[r"^matrix\.org$", r"^friend\.example\.com$"],
        forbidden_remote_server_names=[".*"],
    )
    write_federation(settings)

    round_tripped = read_federation()
    assert round_tripped.allow_federation is True
    assert round_tripped.allowed_remote_server_names == [
        r"^matrix\.org$",
        r"^friend\.example\.com$",
    ]
    assert round_tripped.forbidden_remote_server_names == [".*"]


# ---------------------------------------------------------------------
# PUT /api/admin/federation/allowlist (HTTP layer)
# ---------------------------------------------------------------------

async def test_put_allowlist_rejects_non_admin(client):
    """A logged-in NON-admin user must get 403, not partial success,
    not 401.

    The fixture env sets ADMIN_USER_IDS=@test_admin:test.local, so
    logging in as anyone else should be rejected.
    """
    login_as("@random_user:test.local")
    try:
        resp = await client.put(
            "/api/admin/federation/allowlist",
            json={"allowed_servers": ["matrix.org"]},
        )
        assert resp.status_code == 403
    finally:
        logout()


async def test_put_allowlist_rejects_invalid_hostnames(client, tmp_path, monkeypatch):
    """Invalid hostnames must produce a 400 with the rejected entries
    listed. Silent drops would hide typos from the admin."""
    monkeypatch.setattr(tuwunel_config, "TUWUNEL_CONFIG_PATH", tmp_path / "tuwunel.toml")

    login_as("@test_admin:test.local")
    try:
        resp = await client.put(
            "/api/admin/federation/allowlist",
            json={"allowed_servers": ["matrix.org", "not a hostname", "example.com"]},
        )
        assert resp.status_code == 400
        body = resp.json()
        # FastAPI wraps HTTPException(detail=dict) in {"detail": dict}
        detail = body.get("detail", body)
        assert "not a hostname" in detail.get("rejected", [])
    finally:
        logout()


async def test_put_allowlist_accepts_valid_and_writes_config(client, tmp_path, monkeypatch):
    """Happy path: admin PUTs a valid list, the response echoes the
    cleaned list + anchored regex patterns, and the TOML file on disk
    contains the expected content."""
    config_path = tmp_path / "tuwunel.toml"
    monkeypatch.setattr(tuwunel_config, "TUWUNEL_CONFIG_PATH", config_path)

    login_as("@test_admin:test.local")
    try:
        resp = await client.put(
            "/api/admin/federation/allowlist",
            json={"allowed_servers": ["matrix.org", "friend.example.com"]},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()

        # The response lists the plain (non-regex) server names back
        # to the admin UI.
        assert sorted(body["allowed_servers"]) == ["friend.example.com", "matrix.org"]

        # And the raw regex patterns, anchored on both sides.
        assert r"^matrix\.org$" in body["raw_allowed_patterns"]
        assert r"^friend\.example\.com$" in body["raw_allowed_patterns"]

        # The response MUST signal that apply-pending is now true — the
        # admin UI uses this to show the "restart required" indicator.
        assert body["pending_apply"] is True

        # And the file on disk must actually have been written.
        assert config_path.exists()
        written = read_federation()
        assert r"^matrix\.org$" in written.allowed_remote_server_names
        assert r"^friend\.example\.com$" in written.allowed_remote_server_names
    finally:
        logout()
