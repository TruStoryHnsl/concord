"""Service control backend for the single-image (s6-overlay) deployment.

Replaces the former docker-socket-proxy HTTP client. The single image runs
each Concord service as an s6 longrun under /run/service/<name>; we control
them with s6-svc and read state with s6-svstat. Public function signatures
are unchanged so callers in routers/admin.py and routers/hosting.py need no
edits. The s6 service names intentionally match the legacy compose service
names (conduwuit, concord-api, livekit, coturn, caddy, sslh).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid

import httpx

logger = logging.getLogger(__name__)

# s6 publishes the live supervision dir here under s6-overlay v3.
_S6_SERVICE_DIR = os.getenv("S6_SERVICE_DIR", "/run/service")
_S6_SVC = "s6-svc"
_S6_SVSTAT = "s6-svstat"
_RESTART_TIMEOUT = 60.0


class DockerControlError(RuntimeError):
    """Raised when an s6 control command fails. Name kept for caller compat."""


async def _run_s6(cmd: list[str], *, timeout: float = 10.0):
    """Run an s6 command, returning a completed-process-like object."""
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError as exc:
        proc.kill()
        raise DockerControlError(f"s6 command timed out: {' '.join(cmd)}") from exc

    class _R:
        returncode = proc.returncode
        stdout = (out or b"").decode()
        stderr = (err or b"").decode()
    return _R()


def _svc_path(service_name: str) -> str:
    return f"{_S6_SERVICE_DIR}/{service_name}"


async def is_service_running(service_name: str) -> bool:
    """True when s6-svstat reports the service is up. Swallows errors to False."""
    try:
        r = await _run_s6([_S6_SVSTAT, _svc_path(service_name)])
    except DockerControlError:
        return False
    if r.returncode != 0:
        return False
    return r.stdout.lstrip().startswith("up")


async def restart_compose_service(service_name: str) -> dict:
    """Restart a service via `s6-svc -r`. Returns {restarted, elapsed_seconds}."""
    start = time.monotonic()
    r = await _run_s6([_S6_SVC, "-r", _svc_path(service_name)], timeout=_RESTART_TIMEOUT)
    if r.returncode != 0:
        raise DockerControlError(
            f"s6-svc -r {service_name} failed (rc={r.returncode}): {r.stderr.strip()}"
        )
    elapsed = round(time.monotonic() - start, 2)
    logger.info("restart_compose_service(%s) ok in %.2fs", service_name, elapsed)
    return {"restarted": [service_name], "elapsed_seconds": elapsed}


async def start_compose_service(service_name: str) -> dict:
    """Bring a service up via `s6-svc -u` (idempotent)."""
    start = time.monotonic()
    if await is_service_running(service_name):
        return {
            "started": [],
            "already_running": [service_name],
            "elapsed_seconds": round(time.monotonic() - start, 2),
        }
    r = await _run_s6([_S6_SVC, "-u", _svc_path(service_name)])
    if r.returncode != 0:
        raise DockerControlError(
            f"s6-svc -u {service_name} failed (rc={r.returncode}): {r.stderr.strip()}"
        )
    return {
        "started": [service_name],
        "already_running": [],
        "elapsed_seconds": round(time.monotonic() - start, 2),
    }


# =====================================================================
# Full-stack self-update (multi-container docker-compose deployment)
# =====================================================================
#
# SECURITY-SENSITIVE. Read docs/architecture/docker-self-update-threat-model.md
# before changing anything below OR the docker-socket-proxy allowlist in
# docker-compose.yml. This path drives a project-wide `docker compose
# pull && build --pull && up -d` of ALL services (never selective), with a
# health gate and rollback, entirely through the docker-socket-proxy — no
# container ever touches the raw /var/run/docker.sock.
#
# Why a detached sibling: `concord-api` is itself one of the containers that
# `up -d` recreates, so it cannot run the sequence in-process (the recreate
# kills it mid-command). Instead we ask the Docker daemon (via the proxy) to
# start a throwaway `docker:cli` container that drives compose and, crucially,
# points its OWN DOCKER_HOST at the same proxy — so the raw socket stays
# unmounted everywhere. The sibling writes phase-by-phase JSON status to a
# host path that is also concord-api's data dir, so the record survives the
# recreate and concord-api can read the outcome afterward.
#
# RUNTIME STATUS: the full pull/build/up/health/rollback path is UNVERIFIED at
# runtime — it needs a live deployment test (see the threat-model checklist).

# Engine API endpoint exposed by the docker-socket-proxy sidecar. concord-api
# reaches it by service name over the compose `concord` network.
DOCKER_PROXY_URL = os.getenv("DOCKER_PROXY_URL", "http://docker-socket-proxy:2375")

# Host directory that holds the multi-container deployment's docker-compose.yml
# (+ its .env). The updater sibling bind-mounts this at /work and runs compose
# there. Distinct from the single-image updater's CONCORD_COMPOSE_DIR so the two
# deployment models never collide.
FULLSTACK_COMPOSE_DIR = os.getenv(
    "CONCORD_FULLSTACK_COMPOSE_DIR", "/docker/stacks/concord"
)

# Host path that is ALSO concord-api's data dir (the compose service mounts
# <compose_dir>/data/concord:/data). The sibling bind-mounts this at /status and
# writes the update-status JSON there; concord-api reads it back from CONCORD_DATA_DIR.
FULLSTACK_HOST_DATA_DIR = os.getenv(
    "CONCORD_FULLSTACK_HOST_DATA_DIR",
    os.path.join(FULLSTACK_COMPOSE_DIR, "data", "concord"),
)

# concord-api's own view of its data dir (inside the container). We read the
# status file from here.
_CONCORD_DATA_DIR = os.getenv("CONCORD_DATA_DIR", "/data")

# The docker network the sibling must join so it can resolve `docker-socket-proxy`
# by name. compose derives this from the project name + the `concord` network.
# UNVERIFIED default — confirm against `docker network ls` on the live host.
FULLSTACK_UPDATER_NETWORK = os.getenv("CONCORD_UPDATER_NETWORK", "concord_concord")

# Small image that ships docker + the compose plugin for the sibling driver.
FULLSTACK_UPDATER_IMAGE = os.getenv("CONCORD_UPDATER_IMAGE", "docker:cli")

# How long the health gate waits for every service to report healthy/running
# before it declares failure and rolls back.
FULLSTACK_HEALTH_TIMEOUT = int(os.getenv("CONCORD_UPDATE_HEALTH_TIMEOUT", "180"))

_STATUS_FILENAME = "fullstack_update.json"


def _status_file_path() -> str:
    return os.path.join(_CONCORD_DATA_DIR, _STATUS_FILENAME)


def _proxy_client() -> httpx.AsyncClient:
    """httpx client speaking the Docker Engine API through the socket-proxy."""
    return httpx.AsyncClient(base_url=DOCKER_PROXY_URL, timeout=30.0)


def _write_status(status: dict) -> None:
    """concord-api writes the initial 'starting' record atomically. Best-effort."""
    status = {**status, "updated_at": time.time()}
    path = _status_file_path()
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = f"{path}.tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(status, fh)
        os.replace(tmp, path)
    except OSError as exc:  # pragma: no cover - best-effort disk write
        logger.warning("could not write update status file: %s", exc)


def read_update_status() -> dict:
    """Return the last-known full-stack update status, or an idle sentinel.

    Reads the JSON the detached sibling (or the initial concord-api write) left
    on the shared data volume. Never raises — a missing/corrupt file reports
    ``phase: idle`` so the UI degrades cleanly.
    """
    path = _status_file_path()
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, dict):
            return data
    except FileNotFoundError:
        pass
    except (OSError, json.JSONDecodeError) as exc:
        logger.info("update status unreadable (%s): %s", path, exc)
    return {"phase": "idle", "ok": None, "message": "No update has been run."}


def _updater_script() -> str:
    """The POSIX-sh program the detached sibling runs.

    Drives the project-wide compose update, health-gates every service, and
    rolls back to the snapshotted image tags on failure. Writes a JSON status
    document to /status/<file> at every phase. No jq dependency — JSON is
    emitted with printf and the only interpolated strings are constants we
    control (no user input crosses this boundary).

    UNVERIFIED at runtime — see the threat-model deployment checklist.
    """
    timeout = FULLSTACK_HEALTH_TIMEOUT
    fname = _STATUS_FILENAME
    return f"""set -u
STATUS=/status/{fname}
SNAP=/status/prev_images.txt
JOB="$CONCORD_UPDATE_JOB_ID"
START=$(date +%s)

emit() {{
  # emit <phase> <ok:true|false|null> <message>
  NOW=$(date +%s)
  printf '{{"job_id":"%s","phase":"%s","ok":%s,"message":"%s","started_at":%s,"updated_at":%s}}\\n' \
    "$JOB" "$1" "$2" "$3" "$START" "$NOW" > "$STATUS.tmp" && mv "$STATUS.tmp" "$STATUS"
}}

emit starting null "Update job started"

# Give the HTTP response that launched us time to flush, and concord-api a
# moment before we begin tearing containers down.
sleep 2

cd /work || {{ emit failed false "compose dir /work not mounted"; exit 1; }}

# 1. Snapshot current image id + first repo tag per service (rollback anchor).
emit snapshot null "Recording current image tags for rollback"
: > "$SNAP"
for S in $(docker compose config --services 2>/dev/null); do
  CID=$(docker compose ps -q "$S" 2>/dev/null)
  [ -z "$CID" ] && continue
  IMG=$(docker inspect -f '{{{{.Image}}}}' "$CID" 2>/dev/null)
  [ -z "$IMG" ] && continue
  TAG=$(docker inspect -f '{{{{if .RepoTags}}}}{{{{index .RepoTags 0}}}}{{{{end}}}}' "$IMG" 2>/dev/null)
  echo "$S|$IMG|$TAG" >> "$SNAP"
done

# 2. Pull registry-sourced images (build-only services have nothing to pull).
emit pulling null "Pulling updated images"
docker compose pull 2>&1 || echo "pull: some services not pullable (built from source) — continuing"

# 3. Rebuild ALL build-from-source services against fresh base layers.
emit building null "Rebuilding all services"
if ! docker compose build --pull 2>&1; then
  emit failed false "Build failed; no containers were recreated"
  exit 1
fi

# 4. Recreate ALL containers (never selective).
emit recreating null "Recreating all containers"
docker compose up -d --remove-orphans 2>&1 || true

# 5. Health gate: every service must be healthy (or running if no healthcheck)
#    within the timeout.
emit health_check null "Waiting for all services to become healthy"
DEADLINE=$(( $(date +%s) + {timeout} ))
HEALTHY=0
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  ALL_OK=1
  for S in $(docker compose config --services 2>/dev/null); do
    CID=$(docker compose ps -q "$S" 2>/dev/null)
    if [ -z "$CID" ]; then ALL_OK=0; break; fi
    ST=$(docker inspect -f '{{{{if .State.Health}}}}{{{{.State.Health.Status}}}}{{{{else}}}}{{{{.State.Status}}}}{{{{end}}}}' "$CID" 2>/dev/null)
    case "$ST" in
      healthy|running) : ;;
      *) ALL_OK=0; break ;;
    esac
  done
  if [ "$ALL_OK" -eq 1 ]; then HEALTHY=1; break; fi
  sleep 5
done

if [ "$HEALTHY" -eq 1 ]; then
  emit success true "All services healthy after update"
  exit 0
fi

# 6. Rollback: restore snapshotted image tags and recreate on the old images.
emit rolling_back false "Health gate failed; rolling back to previous images"
while IFS='|' read -r S IMG TAG; do
  [ -n "$TAG" ] && [ -n "$IMG" ] && docker tag "$IMG" "$TAG" 2>/dev/null || true
done < "$SNAP"
docker compose up -d --no-build --remove-orphans 2>&1 || true

# brief re-check
sleep 10
RB_OK=1
for S in $(docker compose config --services 2>/dev/null); do
  CID=$(docker compose ps -q "$S" 2>/dev/null)
  if [ -z "$CID" ]; then RB_OK=0; break; fi
  ST=$(docker inspect -f '{{{{if .State.Health}}}}{{{{.State.Health.Status}}}}{{{{else}}}}{{{{.State.Status}}}}{{{{end}}}}' "$CID" 2>/dev/null)
  case "$ST" in healthy|running) : ;; *) RB_OK=0; break ;; esac
done
if [ "$RB_OK" -eq 1 ]; then
  emit rolled_back false "Update failed; rolled back to the previous version"
else
  emit rollback_failed false "Update failed AND rollback did not restore health — operator intervention required"
fi
exit 1
"""


async def full_stack_update() -> dict:
    """Launch the detached sibling that rebuilds + relaunches the whole stack.

    Returns immediately with a job id; the work completes out-of-band and the
    outcome is polled via :func:`read_update_status`. Raises
    :class:`DockerControlError` when prerequisites are missing so the router can
    surface an actionable message.

    SECURITY: requires the docker-socket-proxy allowlist to include
    IMAGES + BUILD + NETWORKS (see the threat model). Everything flows through
    the proxy; the raw socket is never mounted anywhere.
    """
    job_id = uuid.uuid4().hex[:12]

    # Seed the status file so the UI has something to poll even before the
    # sibling writes its first phase (or if the sibling fails to launch).
    _write_status(
        {
            "job_id": job_id,
            "phase": "starting",
            "ok": None,
            "message": "Launching updater",
            "started_at": time.time(),
        }
    )

    script = _updater_script()
    create_body = {
        "Image": FULLSTACK_UPDATER_IMAGE,
        "Cmd": ["sh", "-c", script],
        "Env": [
            f"CONCORD_UPDATE_JOB_ID={job_id}",
            # The sibling drives compose THROUGH THE PROXY (never the raw
            # socket) — this is the property that keeps the socket unmounted.
            f"DOCKER_HOST={DOCKER_PROXY_URL}",
        ],
        "WorkingDir": "/work",
        "Labels": {"com.concord.role": "fullstack-updater", "com.concord.job": job_id},
        "HostConfig": {
            "AutoRemove": True,
            "Binds": [
                f"{FULLSTACK_COMPOSE_DIR}:/work",
                f"{FULLSTACK_HOST_DATA_DIR}:/status",
            ],
            # Join the compose network so `docker-socket-proxy` resolves by name.
            "NetworkMode": FULLSTACK_UPDATER_NETWORK,
        },
    }

    try:
        async with _proxy_client() as client:
            # Best-effort: ensure the updater image is present (pull if missing).
            img = await client.get(f"/images/{FULLSTACK_UPDATER_IMAGE}/json")
            if img.status_code != 200:
                repo = FULLSTACK_UPDATER_IMAGE.split(":")[0]
                tag = (
                    FULLSTACK_UPDATER_IMAGE.split(":")[1]
                    if ":" in FULLSTACK_UPDATER_IMAGE
                    else "latest"
                )
                await client.post(
                    "/images/create",
                    params={"fromImage": repo, "tag": tag},
                    timeout=120.0,
                )
            cr = await client.post("/containers/create", json=create_body)
            if cr.status_code not in (200, 201):
                raise DockerControlError(
                    f"could not create updater container: {cr.status_code} {cr.text}"
                )
            cid = cr.json().get("Id", "")
            sr = await client.post(f"/containers/{cid}/start")
            if sr.status_code not in (200, 204):
                raise DockerControlError(
                    f"could not start updater container: {sr.status_code} {sr.text}"
                )
    except httpx.RequestError as exc:
        _write_status(
            {
                "job_id": job_id,
                "phase": "failed",
                "ok": False,
                "message": "Docker socket-proxy unreachable — cannot start update.",
                "started_at": time.time(),
            }
        )
        raise DockerControlError(
            "Docker socket-proxy is unreachable. Full-stack update requires the "
            "docker-socket-proxy sidecar (with IMAGES/BUILD/NETWORKS enabled) to "
            "be running and reachable from concord-api."
        ) from exc

    logger.info("full_stack_update job %s started via sibling %s", job_id, cid[:12])
    return {
        "started": True,
        "job_id": job_id,
        "updater_container": cid[:12],
        "compose_dir": FULLSTACK_COMPOSE_DIR,
        "message": "Full rebuild & relaunch started. Poll status for progress.",
    }
