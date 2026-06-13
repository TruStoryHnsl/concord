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
import logging
import os
import time

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
