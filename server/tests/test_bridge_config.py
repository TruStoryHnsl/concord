"""Unit tests for ``server.services.bridge_config`` (INS-024 Wave 2).

Covers the token generation, atomic write, idempotent TOML injection,
and log-redaction primitives that underpin the Discord bridge admin
flow in ``routers/admin_bridges.py``. None of the tests in this file
need docker or a live bridge — they're pure filesystem + string
assertions against a tmp_path.
"""
from __future__ import annotations

import os
import stat
import tomllib
from pathlib import Path

import pytest
import yaml

from services import bridge_config
from services.bridge_config import (
    DISCORD_BRIDGE_APPSERVICE_ID,
    DISCORD_BRIDGE_SENDER_LOCALPART,
    DiscordBridgeRegistration,
    RegistrationWriteError,
    TuwunelTomlInjectionError,
    delete_registration_file,
    ensure_appservice_entry,
    generate_registration,
    read_registration_file,
    redact_for_logging,
    remove_appservice_entry,
    write_registration_file,
)


# ---------------------------------------------------------------------
# Fixture: isolated tmp dir for the config path
# ---------------------------------------------------------------------


@pytest.fixture
def bridge_tmp_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Point ``bridge_config`` at a scratch dir for the duration of a test.

    Sets ``CONCORD_BRIDGE_CONFIG_DIR`` to a fresh tmp_path subdir so
    every test exercises the real :func:`bridge_config_dir` code path
    without touching the repo's committed ``config/`` tree.
    """
    cfg = tmp_path / "config"
    (cfg / "mautrix-discord").mkdir(parents=True)
    monkeypatch.setenv("CONCORD_BRIDGE_CONFIG_DIR", str(cfg))
    return cfg


@pytest.fixture
def tuwunel_toml_path(tmp_path: Path) -> Path:
    """A throwaway tuwunel.toml path for the injection tests."""
    return tmp_path / "tuwunel.toml"


# ---------------------------------------------------------------------
# Token generation
# ---------------------------------------------------------------------


def test_generate_registration_produces_fresh_tokens() -> None:
    """Every call to generate_registration must produce distinct tokens.

    Reusing tokens between bridge instances would silently grant one
    bridge the authority of another — the regression gate we want is:
    generate twice, assert every secret field differs.
    """
    a = generate_registration()
    b = generate_registration()
    assert a.as_token != b.as_token
    assert a.hs_token != b.hs_token
    # Non-secret stable fields should match so the admin UI doesn't
    # think two rotations changed the bridge identity.
    assert a.id == b.id == DISCORD_BRIDGE_APPSERVICE_ID
    assert a.sender_localpart == b.sender_localpart == DISCORD_BRIDGE_SENDER_LOCALPART


def test_generate_registration_token_length() -> None:
    """Tokens must have at least 256 bits of entropy.

    ``secrets.token_urlsafe(32)`` outputs at least 43 base64url
    characters from 32 random bytes. We check the effective length of
    the underlying random string (stripping the `as_` / `hs_` prefix)
    so a future refactor that adds a longer prefix doesn't trick the
    naive ``len(token) >= 43`` check into passing on weak randomness.
    """
    reg = generate_registration()
    assert reg.as_token.startswith("as_")
    assert reg.hs_token.startswith("hs_")
    as_body = reg.as_token[len("as_") :]
    hs_body = reg.hs_token[len("hs_") :]
    assert len(as_body) >= 43, f"as_token body too short: {len(as_body)}"
    assert len(hs_body) >= 43, f"hs_token body too short: {len(hs_body)}"


# ---------------------------------------------------------------------
# write_registration_file atomicity + mode
# ---------------------------------------------------------------------


def test_write_registration_yaml_round_trips(bridge_tmp_dir: Path) -> None:
    """A freshly written registration round-trips through read_registration_file.

    Tests the end-to-end pipeline: generate → write → read. Anything
    that gets dropped by the serialiser would fail here.
    """
    reg = generate_registration()
    written = write_registration_file(reg)
    assert written.exists()
    reloaded = read_registration_file()
    assert reloaded is not None
    assert reloaded.as_token == reg.as_token
    assert reloaded.hs_token == reg.hs_token
    assert reloaded.sender_localpart == reg.sender_localpart
    assert reloaded.user_namespace_regex == reg.user_namespace_regex
    assert reloaded.rate_limited is False


def test_write_registration_is_atomic_no_tmp_left_behind(
    bridge_tmp_dir: Path,
) -> None:
    """After a successful write, no ``.registration-*.yaml.tmp`` files remain.

    The tmp-file-then-rename pattern leaks artefacts if the caller
    forgets to unlink on the happy path. We enumerate the config
    directory after a clean write and make sure only ``registration.yaml``
    is present.
    """
    reg = generate_registration()
    write_registration_file(reg)
    children = list((bridge_tmp_dir / "mautrix-discord").iterdir())
    names = {p.name for p in children}
    assert names == {"registration.yaml"}, f"Unexpected files: {names}"


@pytest.mark.skipif(
    os.name != "posix", reason="File-mode assertions are POSIX-only"
)
def test_registration_file_mode_0640(bridge_tmp_dir: Path) -> None:
    """The registration file must be mode 0640 (rw-r-----).

    The docker image running mautrix-discord needs group-read to load
    the file, but world-read would expose tokens to every user on the
    host. 0640 is the narrowest mode that satisfies both constraints.
    """
    reg = generate_registration()
    path = write_registration_file(reg)
    mode = stat.S_IMODE(path.stat().st_mode)
    assert mode == 0o640, f"Expected 0640, got {oct(mode)}"


def test_write_registration_overwrites_existing_cleanly(
    bridge_tmp_dir: Path,
) -> None:
    """Writing a new registration over an existing file leaves no stale content.

    The atomic-replace semantics mean the file either has the old
    contents or the new contents — no concatenation, no leftover
    bytes from the previous version.
    """
    first = generate_registration()
    write_registration_file(first)
    second = generate_registration()
    write_registration_file(second)
    reloaded = read_registration_file()
    assert reloaded is not None
    assert reloaded.as_token == second.as_token
    assert reloaded.hs_token == second.hs_token


def test_write_registration_raises_registration_write_error_on_bad_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Writing into a non-writable dir should raise the typed error.

    We simulate this by pointing the config dir at a readonly parent
    (via an intentionally missing subdir) and catching the raised
    :class:`RegistrationWriteError`.
    """
    # Point at a dir that exists but is read-only.
    ro = tmp_path / "readonly"
    ro.mkdir()
    ro.chmod(0o500)
    monkeypatch.setenv("CONCORD_BRIDGE_CONFIG_DIR", str(ro))
    reg = generate_registration()
    try:
        with pytest.raises(RegistrationWriteError):
            write_registration_file(reg)
    finally:
        ro.chmod(0o700)  # Restore so pytest can clean up.


def test_delete_registration_file_is_idempotent(bridge_tmp_dir: Path) -> None:
    """Delete on a missing file returns False; delete on a present file True."""
    assert delete_registration_file() is False
    reg = generate_registration()
    write_registration_file(reg)
    assert delete_registration_file() is True
    assert delete_registration_file() is False


def test_read_registration_file_returns_none_when_absent(
    bridge_tmp_dir: Path,
) -> None:
    """Missing registration file is a legitimate state, not an error."""
    assert read_registration_file() is None


def test_read_registration_file_raises_on_corrupt_yaml(
    bridge_tmp_dir: Path,
) -> None:
    """A hand-corrupted YAML file should produce a typed error.

    Catches the case where an operator tried to hand-edit the file
    and broke the parser. Silent fall-through to "looks like no
    registration" would cause the admin UI to think the bridge is
    disabled when it is actually in a broken half-state.
    """
    path = bridge_tmp_dir / "mautrix-discord" / "registration.yaml"
    path.write_text("not: [valid: yaml\n", encoding="utf-8")
    with pytest.raises(RegistrationWriteError):
        read_registration_file()


# ---------------------------------------------------------------------
# ensure_appservice_entry idempotency + preservation
# ---------------------------------------------------------------------


def test_ensure_appservice_entry_creates_file_when_missing(
    tuwunel_toml_path: Path,
) -> None:
    """Calling ensure on a missing tuwunel.toml creates it with just the bridge.

    First-run flow — the file may not exist yet if federation has
    never been configured. We should NOT error, we should create a
    file with our bridge table and an empty [global] header.
    """
    assert not tuwunel_toml_path.exists()
    reg = generate_registration()
    ensure_appservice_entry(reg, tuwunel_toml_path=tuwunel_toml_path)
    assert tuwunel_toml_path.exists()
    loaded = tomllib.loads(tuwunel_toml_path.read_text(encoding="utf-8"))
    assert "global" in loaded
    assert "appservice" in loaded["global"]
    assert DISCORD_BRIDGE_APPSERVICE_ID in loaded["global"]["appservice"]
    entry = loaded["global"]["appservice"][DISCORD_BRIDGE_APPSERVICE_ID]
    assert entry["as_token"] == reg.as_token
    assert entry["hs_token"] == reg.hs_token
    assert entry["rate_limited"] is False


def test_ensure_appservice_entry_is_idempotent(
    tuwunel_toml_path: Path,
) -> None:
    """Calling ensure twice with the same registration is byte-identical."""
    reg = generate_registration()
    ensure_appservice_entry(reg, tuwunel_toml_path=tuwunel_toml_path)
    first = tuwunel_toml_path.read_bytes()
    ensure_appservice_entry(reg, tuwunel_toml_path=tuwunel_toml_path)
    second = tuwunel_toml_path.read_bytes()
    assert first == second, "Second ensure call produced a different file"


def test_ensure_appservice_entry_preserves_federation_keys(
    tuwunel_toml_path: Path,
) -> None:
    """Federation allowlist + allow_federation flag must survive the injection.

    Regression check for the original bug the plan file warned about:
    a naive rewrite could clobber the keys owned by
    ``services/tuwunel_config.py``.
    """
    # Pre-seed the file with a federation config shape. TOML basic
    # strings require double-backslash for literal '\' characters, so
    # the regex for "friend.example.com" is spelled '^friend\\\\.example\\\\.com$'
    # in the Python source (4 backslashes → 2 backslashes in the file →
    # 1 backslash escape in the TOML parser → 1 literal backslash in
    # the decoded Python value).
    tuwunel_toml_path.write_text(
        '[global]\n'
        'allow_federation = true\n'
        'forbidden_remote_server_names = []\n'
        'allowed_remote_server_names = ["^friend\\\\.example\\\\.com$"]\n',
        encoding="utf-8",
    )
    reg = generate_registration()
    ensure_appservice_entry(reg, tuwunel_toml_path=tuwunel_toml_path)

    loaded = tomllib.loads(tuwunel_toml_path.read_text(encoding="utf-8"))
    g = loaded["global"]
    assert g["allow_federation"] is True
    assert g["allowed_remote_server_names"] == ["^friend\\.example\\.com$"]
    assert DISCORD_BRIDGE_APPSERVICE_ID in g["appservice"]


def test_ensure_appservice_entry_survives_rotation(
    tuwunel_toml_path: Path,
) -> None:
    """Rotating tokens updates the entry without corrupting the file.

    Rotate = generate new registration with same id → call ensure.
    Expectation: federation keys still present, new tokens stored,
    no duplicate tables.
    """
    tuwunel_toml_path.write_text(
        '\n'.join([
            "[global]",
            'allow_federation = true',
            "",
        ]),
        encoding="utf-8",
    )
    first = generate_registration()
    ensure_appservice_entry(first, tuwunel_toml_path=tuwunel_toml_path)
    second = generate_registration()
    ensure_appservice_entry(second, tuwunel_toml_path=tuwunel_toml_path)

    loaded = tomllib.loads(tuwunel_toml_path.read_text(encoding="utf-8"))
    g = loaded["global"]
    entry = g["appservice"][DISCORD_BRIDGE_APPSERVICE_ID]
    assert entry["as_token"] == second.as_token
    assert entry["hs_token"] == second.hs_token
    assert g["allow_federation"] is True
    # Exactly one entry for our bridge id — not a list of
    # concatenated tables.
    assert list(g["appservice"].keys()) == [DISCORD_BRIDGE_APPSERVICE_ID]


def test_remove_appservice_entry_idempotent(tuwunel_toml_path: Path) -> None:
    """Remove on missing file and on missing entry are both no-ops."""
    # File missing.
    assert remove_appservice_entry(tuwunel_toml_path=tuwunel_toml_path) is False

    # File present, entry missing.
    tuwunel_toml_path.write_text(
        '\n'.join(["[global]", "allow_federation = true", ""]),
        encoding="utf-8",
    )
    assert remove_appservice_entry(tuwunel_toml_path=tuwunel_toml_path) is False

    # File present with the entry we want to remove.
    reg = generate_registration()
    ensure_appservice_entry(reg, tuwunel_toml_path=tuwunel_toml_path)
    assert remove_appservice_entry(tuwunel_toml_path=tuwunel_toml_path) is True

    loaded = tomllib.loads(tuwunel_toml_path.read_text(encoding="utf-8"))
    g = loaded.get("global", {})
    assert "appservice" not in g, "appservice key not removed on empty table"
    assert g.get("allow_federation") is True


def test_ensure_appservice_entry_raises_on_corrupt_existing_file(
    tuwunel_toml_path: Path,
) -> None:
    """A hand-broken tuwunel.toml should fail loudly, not silently overwrite."""
    tuwunel_toml_path.write_text(
        "[global]\nallow_federation = not_valid_toml = 5\n",
        encoding="utf-8",
    )
    reg = generate_registration()
    with pytest.raises(TuwunelTomlInjectionError):
        ensure_appservice_entry(reg, tuwunel_toml_path=tuwunel_toml_path)


def test_ensure_appservice_entry_emits_parseable_toml(
    tuwunel_toml_path: Path,
) -> None:
    """Output must round-trip through tomllib without errors.

    Catches bugs in the hand-rolled emitter (e.g. unquoted strings,
    unescaped backslashes, duplicated headers).
    """
    reg = generate_registration()
    ensure_appservice_entry(reg, tuwunel_toml_path=tuwunel_toml_path)
    body = tuwunel_toml_path.read_text(encoding="utf-8")
    loaded = tomllib.loads(body)
    entry = loaded["global"]["appservice"][DISCORD_BRIDGE_APPSERVICE_ID]
    # Exclusive namespace arrays should appear in the output.
    assert entry["users"][0]["exclusive"] is True
    assert entry["aliases"][0]["exclusive"] is True
    # Regex fields must be preserved literally (including backslashes).
    assert entry["users"][0]["regex"] == reg.user_namespace_regex


# ---------------------------------------------------------------------
# redact_for_logging
# ---------------------------------------------------------------------


def test_redact_for_logging_never_echoes_tokens() -> None:
    """Secrets in recognised keys must be replaced with ``<redacted>``."""
    payload = {
        "enabled": True,
        "as_token": "as_super_secret",
        "hs_token": "hs_super_secret",
        "bot_token": "MTIzNDU.ABC.xyz",
        "mautrix_discord_bot_token": "MTIzNDU.ABC.xyz",
        "sender": "@_discord_bot:localhost",
        "nested": {
            "secret": "deep",
            "visible_key": "visible",
        },
    }
    redacted = redact_for_logging(payload)
    assert redacted["enabled"] is True
    assert redacted["sender"] == "@_discord_bot:localhost"
    assert redacted["as_token"] == "<redacted>"
    assert redacted["hs_token"] == "<redacted>"
    assert redacted["bot_token"] == "<redacted>"
    assert redacted["mautrix_discord_bot_token"] == "<redacted>"
    assert redacted["nested"]["secret"] == "<redacted>"
    assert redacted["nested"]["visible_key"] == "visible"


def test_redact_for_logging_handles_lists_and_tuples() -> None:
    """Nested containers must be recursed into."""
    payload = [
        {"as_token": "secret"},
        ("hs_token", "secret"),  # tuples preserved as tuples
        [{"sender": "ok", "password": "hidden"}],
    ]
    redacted = redact_for_logging(payload)
    assert isinstance(redacted, list)
    assert redacted[0]["as_token"] == "<redacted>"
    assert isinstance(redacted[1], tuple)
    # The key is inside the tuple, not a dict — tuples are not
    # key-value, so redaction doesn't apply to individual items here.
    # This documents behavior: structured secrets go in dicts.
    assert redacted[2][0]["password"] == "<redacted>"
    assert redacted[2][0]["sender"] == "ok"


def test_redact_for_logging_passes_through_primitives() -> None:
    """Non-container primitives are returned unchanged."""
    assert redact_for_logging(42) == 42
    assert redact_for_logging("hello") == "hello"
    assert redact_for_logging(None) is None
    assert redact_for_logging(True) is True


def test_redact_for_logging_does_not_mutate_input() -> None:
    """The original dict must stay intact — redaction produces a clone."""
    payload = {"as_token": "secret"}
    _ = redact_for_logging(payload)
    assert payload == {"as_token": "secret"}


def test_redact_for_logging_is_case_insensitive() -> None:
    """Key matching must be case-insensitive."""
    payload = {"AS_TOKEN": "x", "Bot_Token": "y"}
    redacted = redact_for_logging(payload)
    assert redacted["AS_TOKEN"] == "<redacted>"
    assert redacted["Bot_Token"] == "<redacted>"


def test_redact_for_logging_dataclass_to_dict_not_supported_by_default() -> None:
    """Dataclasses without explicit conversion are returned unchanged.

    Documents that callers must pass already-dict form (via
    ``dataclasses.asdict`` or equivalent) to get redaction. This
    catches a common misuse and the test file exists to pin the
    behaviour so a future change is noticed.
    """
    reg = generate_registration()
    # Passing the dataclass itself — no redaction applies because we
    # don't walk into it.
    result = redact_for_logging(reg)
    assert result is reg  # Unchanged identity.


# ---------------------------------------------------------------------
# bridge_config_dir creation
# ---------------------------------------------------------------------


def test_bridge_config_dir_creates_with_750_mode(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """First call to bridge_config_dir must create the dir with mode 0750."""
    cfg = tmp_path / "brand-new"
    monkeypatch.setenv("CONCORD_BRIDGE_CONFIG_DIR", str(cfg))
    # Initial state: neither parent nor child dir exists.
    assert not cfg.exists()
    d = bridge_config.bridge_config_dir()
    assert d.exists()
    assert d.is_dir()
    # We don't care about the parent dir's mode (pytest's tmp_path is
    # wide open), just the one we created.
    mode = stat.S_IMODE(d.stat().st_mode)
    assert mode == 0o750, f"Expected 0750, got {oct(mode)}"
