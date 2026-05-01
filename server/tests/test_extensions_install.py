"""End-to-end tests for the runtime extension install pipeline (INS-066 W8).

Uses the real orrdia-bridge bundle (committed under
``server/tests/fixtures/``) as the .zip under test. The fixture is
self-contained — no network during this test.

Coverage:
  * POST /api/extensions/install (admin-authed) returns 201 + manifest
    and persists a DB row + unpacks the bundle.
  * GET /ext/<id>/index.html serves the bundle's HTML.
  * GET /api/extensions includes the newly-installed extension.
  * The installed manifest's permissions array is preserved on the DB row.
  * Bad manifests (unknown permission, missing field) reject with 422.
  * Path-traversal attempts in the zip are rejected with 400.
  * DELETE /api/extensions/<id> removes both the row AND the directory.
  * Non-admin auth → 403 on install/uninstall.

Same-session-author note: these tests were written in the same session
as the install pipeline (INS-066 W2/W3/W7). A cold-reader test pass is
required before declaring the feature production-ready (per the
Testing & Verification "WRITTEN IN BLOOD" rule). They cover the happy
path well enough to catch regressions but should be re-reviewed by a
fresh context.
"""

from __future__ import annotations

import io
import json
import shutil
import zipfile
from pathlib import Path

import pytest

from .conftest import login_as

FIXTURE_PATH = (
    Path(__file__).parent / "fixtures" / "com.concord.orrdia-bridge@0.1.0.zip"
)
EXT_ID = "com.concord.orrdia-bridge"
ADMIN_USER = "@test_admin:test.local"
NON_ADMIN_USER = "@bob:test.local"


def _file_url(p: Path) -> str:
    """``Path -> file:// URL`` so the install endpoint reads from disk
    without making a network request during tests."""
    return f"file://{p.resolve()}"


def _make_zip(files: dict[str, bytes]) -> bytes:
    """Build an in-memory zip with the given path -> bytes mapping."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in files.items():
            zf.writestr(name, data)
    return buf.getvalue()


@pytest.fixture
def fixture_url() -> str:
    """Lazy assertion that the orrdia-bridge fixture exists. If it
    doesn't, the rest of the suite is meaningless — fail loudly."""
    assert FIXTURE_PATH.is_file(), (
        f"missing fixture: {FIXTURE_PATH}. "
        "Re-copy from concord-extensions/packages/orrdia-bridge/."
    )
    return _file_url(FIXTURE_PATH)


@pytest.fixture
def app_with_mounts():
    """Ensure the FastAPI app's extension StaticFiles mount registry has
    the live `app` reference. Tests that exercise the install endpoint
    need register_mount() to be a no-op-or-mount, not a "called before
    mount_installed" warning.
    """
    import routers.extensions as ext_mod
    from main import app

    ext_mod.mount_installed(app)
    yield app


@pytest.fixture
def clean_extensions_dir(app_with_mounts):
    """Clean up the on-disk extensions directory + DB rows for EXT_ID
    before AND after each test, so installs don't leak across tests in
    the session-shared DATA_DIR.
    """
    from config import EXTENSIONS_DIR
    import routers.extensions as ext_mod

    target = EXTENSIONS_DIR / EXT_ID
    if target.exists():
        shutil.rmtree(target)
    # Remove any prior mount of EXT_ID so re-install registers fresh.
    ext_mod.unregister_mount(EXT_ID)
    yield
    if target.exists():
        shutil.rmtree(target)
    ext_mod.unregister_mount(EXT_ID)


# ---------------------------------------------------------------------
# Happy path — install / list / serve / uninstall
# ---------------------------------------------------------------------


async def test_install_orrdia_bridge_unpacks_files_and_persists_row(
    client, fixture_url, clean_extensions_dir
):
    from config import EXTENSIONS_DIR

    login_as(ADMIN_USER)
    resp = await client.post(
        "/api/extensions/install", json={"remote_url": fixture_url}
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["id"] == EXT_ID
    assert body["version"] == "0.1.0"
    assert body["pricing"] == "free"
    assert body["enabled"] is True
    assert body["remote_url"] == fixture_url
    # Manifest permissions persisted intact (W7).
    assert "state_events" in body["manifest"]["permissions"]
    assert "fetch:external" in body["manifest"]["permissions"]

    # Files unpacked to the canonical path.
    assert (EXTENSIONS_DIR / EXT_ID / "manifest.json").is_file()
    assert (EXTENSIONS_DIR / EXT_ID / "index.html").is_file()


async def test_static_route_serves_index_html(
    client, fixture_url, clean_extensions_dir
):
    login_as(ADMIN_USER)
    install_resp = await client.post(
        "/api/extensions/install", json={"remote_url": fixture_url}
    )
    assert install_resp.status_code == 201, install_resp.text

    resp = await client.get(f"/ext/{EXT_ID}/index.html")
    assert resp.status_code == 200, resp.text
    assert "text/html" in resp.headers.get("content-type", "")
    assert b"<html" in resp.content.lower() or b"<!doctype" in resp.content.lower()


async def test_list_extensions_includes_installed(
    client, fixture_url, clean_extensions_dir
):
    login_as(ADMIN_USER)
    install_resp = await client.post(
        "/api/extensions/install", json={"remote_url": fixture_url}
    )
    assert install_resp.status_code == 201, install_resp.text

    listing = await client.get("/api/extensions")
    assert listing.status_code == 200
    items = listing.json()
    ids = [it["id"] for it in items]
    assert EXT_ID in ids
    matching = next(it for it in items if it["id"] == EXT_ID)
    assert matching["url"] == f"/ext/{EXT_ID}/index.html"


async def test_uninstall_removes_row_and_files(
    client, fixture_url, clean_extensions_dir
):
    from config import EXTENSIONS_DIR

    login_as(ADMIN_USER)
    install_resp = await client.post(
        "/api/extensions/install", json={"remote_url": fixture_url}
    )
    assert install_resp.status_code == 201, install_resp.text
    assert (EXTENSIONS_DIR / EXT_ID).is_dir()

    del_resp = await client.delete(f"/api/extensions/{EXT_ID}")
    assert del_resp.status_code == 204
    assert not (EXTENSIONS_DIR / EXT_ID).exists()

    listing = await client.get("/api/extensions")
    ids = [it["id"] for it in listing.json()]
    assert EXT_ID not in ids


# ---------------------------------------------------------------------
# Permission enforcement (W7)
# ---------------------------------------------------------------------


async def test_install_rejects_unknown_permission(
    client, tmp_path, clean_extensions_dir
):
    bad_zip = _make_zip(
        {
            "manifest.json": json.dumps(
                {
                    "id": "com.example.bad",
                    "version": "0.1.0",
                    "entry": "index.html",
                    "permissions": ["state_events", "filesystem.write"],
                }
            ).encode(),
            "index.html": b"<html></html>",
        }
    )
    bad_path = tmp_path / "bad.zip"
    bad_path.write_bytes(bad_zip)

    login_as(ADMIN_USER)
    resp = await client.post(
        "/api/extensions/install", json={"remote_url": _file_url(bad_path)}
    )
    assert resp.status_code == 422, resp.text
    detail = resp.json()["detail"]
    assert detail["error"] == "unknown_permissions"
    assert "filesystem.write" in detail["permissions"]
    assert "state_events" in detail["allowed"]


async def test_install_rejects_missing_required_manifest_field(
    client, tmp_path, clean_extensions_dir
):
    bad_zip = _make_zip(
        {
            "manifest.json": json.dumps(
                {"id": "com.example.x", "version": "0.1.0"}
            ).encode(),
            "index.html": b"x",
        }
    )
    bad_path = tmp_path / "bad.zip"
    bad_path.write_bytes(bad_zip)

    login_as(ADMIN_USER)
    resp = await client.post(
        "/api/extensions/install", json={"remote_url": _file_url(bad_path)}
    )
    assert resp.status_code == 422, resp.text
    assert "entry" in str(resp.json())


async def test_install_rejects_zip_traversal(
    client, tmp_path, clean_extensions_dir
):
    bad_zip = _make_zip(
        {
            "manifest.json": json.dumps(
                {
                    "id": "com.example.evil",
                    "version": "0.1.0",
                    "entry": "index.html",
                    "permissions": [],
                }
            ).encode(),
            "../../../etc/passwd": b"pwned",
        }
    )
    bad_path = tmp_path / "evil.zip"
    bad_path.write_bytes(bad_zip)

    login_as(ADMIN_USER)
    resp = await client.post(
        "/api/extensions/install", json={"remote_url": _file_url(bad_path)}
    )
    assert resp.status_code == 400, resp.text


# ---------------------------------------------------------------------
# Auth — non-admins are rejected
# ---------------------------------------------------------------------


async def test_non_admin_cannot_install(
    client, fixture_url, clean_extensions_dir
):
    login_as(NON_ADMIN_USER)
    resp = await client.post(
        "/api/extensions/install", json={"remote_url": fixture_url}
    )
    assert resp.status_code == 403, resp.text


async def test_non_admin_cannot_uninstall(
    client, fixture_url, clean_extensions_dir
):
    # Install as admin first.
    login_as(ADMIN_USER)
    inst = await client.post(
        "/api/extensions/install", json={"remote_url": fixture_url}
    )
    assert inst.status_code == 201, inst.text

    # Uninstall as non-admin → 403.
    login_as(NON_ADMIN_USER)
    resp = await client.delete(f"/api/extensions/{EXT_ID}")
    assert resp.status_code == 403, resp.text
