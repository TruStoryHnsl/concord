"""User-initiated instance update for the single-image deployment.

This is the *manual* counterpart to an auto-updater: nothing here polls or
updates on its own. An admin explicitly calls ``check_for_update`` to compare
the running image against the configured registry ref, then explicitly calls
``apply_update`` to pull the newer image and recreate the container.

Why a detached sibling does the swap
------------------------------------
``concord-api`` runs *inside* the very container that must be recreated, so it
cannot run ``docker compose up -d`` itself — the recreate would kill the
process mid-command. Instead ``apply_update`` asks the Docker daemon (over the
mounted unix socket) to start a throwaway ``docker:cli`` container that, after a
short delay, runs ``docker compose pull && docker compose up -d`` against the
deployment compose file. That sibling lives outside ``concord``, so it survives
the recreate and finishes the swap. The named ``/data`` volume (accounts,
rooms, media, secrets) is preserved because compose reuses it.

Everything degrades gracefully: with no socket mounted, ``apply`` returns a
clear error; with the registry unreachable, ``check`` reports ``registry_ok:
false`` rather than throwing.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re

import httpx

logger = logging.getLogger(__name__)

# Human-facing version baked into the image at build time (see infra/single/
# Dockerfile ARG/ENV CONCORD_VERSION). "dev" when running an unversioned local
# build.
CONCORD_VERSION = os.getenv("CONCORD_VERSION", "dev")
CONCORD_BUILD_DIGEST = os.getenv("CONCORD_BUILD_DIGEST", "")  # optional, baked

# The registry ref the operator updates toward. Defaults to the public package
# the docs reference; override per-deployment via env.
IMAGE_REF = os.getenv("CONCORD_IMAGE_REF", "ghcr.io/trustoryhnsl/concord:latest")

# Host path of the directory holding the deployment docker-compose.yml. The
# update sibling bind-mounts this and runs compose inside it.
COMPOSE_DIR = os.getenv("CONCORD_COMPOSE_DIR", "/docker/stacks/concord-single")

# The container name compose manages (must match the compose service container).
CONTAINER_NAME = os.getenv("CONCORD_CONTAINER_NAME", "concord")

DOCKER_SOCK = os.getenv("DOCKER_SOCKET_PATH", "/var/run/docker.sock")
# Small CLI image that ships docker + the compose plugin for the sibling.
UPDATER_IMAGE = os.getenv("CONCORD_UPDATER_IMAGE", "docker:cli")


def _docker_available() -> bool:
    return os.path.exists(DOCKER_SOCK)


def _docker_client() -> httpx.AsyncClient:
    """httpx client speaking the Docker Engine API over the unix socket."""
    transport = httpx.AsyncHTTPTransport(uds=DOCKER_SOCK)
    return httpx.AsyncClient(transport=transport, base_url="http://docker", timeout=30.0)


def _parse_ref(ref: str) -> tuple[str, str, str]:
    """Split ``[registry/]repo:tag`` → (registry, repo_path, tag).

    Defaults registry to ghcr.io and tag to ``latest``. Only the registry-v2
    hosts we care about (ghcr.io) are exercised; other registries simply fail
    the manifest fetch and surface as ``registry_ok: false``.
    """
    tag = "latest"
    name = ref
    if ":" in ref.rsplit("/", 1)[-1]:
        name, tag = ref.rsplit(":", 1)
    if "/" in name and "." in name.split("/", 1)[0]:
        registry, repo = name.split("/", 1)
    else:
        registry, repo = "ghcr.io", name
    return registry, repo, tag


async def _local_image_digest(client: httpx.AsyncClient, ref: str) -> str | None:
    """RepoDigest of the locally-present image for ``ref``, if any."""
    try:
        r = await client.get(f"/images/{ref}/json")
        if r.status_code != 200:
            return None
        digests = r.json().get("RepoDigests") or []
        for d in digests:
            if "@" in d:
                return d.split("@", 1)[1]
    except Exception as exc:  # pragma: no cover - best-effort
        logger.debug("local image digest lookup failed: %s", exc)
    return None


async def _registry_digest(registry: str, repo: str, tag: str) -> str | None:
    """Latest manifest digest for ``registry/repo:tag`` via the v2 API.

    Uses anonymous auth (works for public ghcr packages). The digest is read
    from the ``Docker-Content-Digest`` response header on a HEAD/GET of the
    manifest. Returns None on any failure (private/unpublished/unreachable).
    """
    accept = ", ".join([
        "application/vnd.oci.image.index.v1+json",
        "application/vnd.docker.distribution.manifest.list.v2+json",
        "application/vnd.oci.image.manifest.v1+json",
        "application/vnd.docker.distribution.manifest.v2+json",
    ])
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as c:
            token = None
            if registry == "ghcr.io":
                tr = await c.get(
                    "https://ghcr.io/token",
                    params={"scope": f"repository:{repo}:pull", "service": "ghcr.io"},
                )
                if tr.status_code == 200:
                    token = tr.json().get("token")
            headers = {"Accept": accept}
            if token:
                headers["Authorization"] = f"Bearer {token}"
            mr = await c.get(
                f"https://{registry}/v2/{repo}/manifests/{tag}", headers=headers
            )
            if mr.status_code != 200:
                logger.info("registry manifest fetch %s:%s -> %s", repo, tag, mr.status_code)
                return None
            return mr.headers.get("Docker-Content-Digest")
    except Exception as exc:
        logger.info("registry digest lookup failed: %s", exc)
        return None


def current_status() -> dict:
    """Static, no-IO snapshot of what is running."""
    return {
        "version": CONCORD_VERSION,
        "image_ref": IMAGE_REF,
        "build_digest": CONCORD_BUILD_DIGEST or None,
        "update_supported": _docker_available(),
    }


async def check_for_update() -> dict:
    """Compare the running image against the registry. Never raises."""
    status = current_status()
    registry, repo, tag = _parse_ref(IMAGE_REF)
    remote = await _registry_digest(registry, repo, tag)
    if remote is None:
        return {
            **status,
            "registry_ok": False,
            "update_available": False,
            "latest_digest": None,
            "message": "Could not reach the image registry (it may be unpublished or private).",
        }
    local = None
    if _docker_available():
        async with _docker_client() as client:
            local = await _local_image_digest(client, IMAGE_REF)
    local = local or CONCORD_BUILD_DIGEST or None
    available = bool(local) and local != remote
    # If we can't determine the local digest at all, fall back to "offer it":
    # the operator can still choose to pull. Flagged via unknown_local.
    if not local:
        available = True
    return {
        **status,
        "registry_ok": True,
        "update_available": available,
        "latest_digest": remote,
        "local_digest": local,
        "unknown_local": not local,
        "message": "Update available." if available else "Up to date.",
    }


async def apply_update() -> dict:
    """Launch the detached sibling that pulls + recreates the container.

    Returns immediately; the swap completes out-of-band. Raises RuntimeError
    with an actionable message when the prerequisites are missing.
    """
    if not _docker_available():
        raise RuntimeError(
            "Docker socket is not mounted into this container. Recreate the "
            "instance with the deployment compose file (which mounts "
            f"{DOCKER_SOCK}) to enable in-app updates."
        )
    compose_file = os.path.join(COMPOSE_DIR, "docker-compose.yml")
    # The sibling runs in COMPOSE_DIR (mounted from the host) so `docker
    # compose` finds the deployment file + its .env. `--pull always` /
    # explicit pull picks up the new image; `up -d` recreates only what
    # changed. A short sleep lets this HTTP response flush before the parent
    # container is torn down.
    # `pull` is best-effort: a real registry update fetches the new image, but
    # a local/unpublished image (or a transient registry hiccup) must not abort
    # the recreate — `up -d` then applies whatever image the tag now resolves to.
    script = (
        "sleep 2; "
        "docker compose pull || echo 'pull skipped'; "
        "docker compose up -d; "
        "echo concord-update-complete"
    )
    create_body = {
        "Image": UPDATER_IMAGE,
        "Cmd": ["sh", "-c", script],
        "WorkingDir": "/work",
        "Labels": {"com.concord.role": "instance-updater"},
        "HostConfig": {
            "AutoRemove": True,
            "Binds": [
                f"{DOCKER_SOCK}:/var/run/docker.sock",
                f"{COMPOSE_DIR}:/work",
            ],
            "NetworkMode": "host",
        },
    }
    async with _docker_client() as client:
        # Best-effort ensure the updater image is present (pull if missing).
        img = await client.get(f"/images/{UPDATER_IMAGE}/json")
        if img.status_code != 200:
            await client.post(
                "/images/create",
                params={"fromImage": UPDATER_IMAGE.split(":")[0],
                        "tag": (UPDATER_IMAGE.split(":")[1] if ":" in UPDATER_IMAGE else "latest")},
                timeout=120.0,
            )
        cr = await client.post("/containers/create", json=create_body)
        if cr.status_code not in (200, 201):
            raise RuntimeError(f"could not create updater container: {cr.status_code} {cr.text}")
        cid = cr.json().get("Id")
        sr = await client.post(f"/containers/{cid}/start")
        if sr.status_code not in (204, 200):
            raise RuntimeError(f"could not start updater container: {sr.status_code} {sr.text}")
    logger.info("instance update started via sibling %s (compose=%s)", cid[:12], compose_file)
    return {"started": True, "updater_container": cid[:12], "compose_file": compose_file}
