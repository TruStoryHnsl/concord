"""Admin-only, user-initiated instance update endpoints.

No polling, no automatic updates: the admin drives every step from the UI.

Single-image deploy (pull + recreate the one container):
- GET  /api/instance/update/status       — what's running + whether updates are wired
- POST /api/instance/update/check        — compare running image vs registry
- POST /api/instance/update/apply        — pull newer image + recreate container

Multi-container compose deploy (full rebuild + relaunch of ALL services,
health-gated, with rollback — SECURITY-SENSITIVE, see
docs/architecture/docker-self-update-threat-model.md):
- POST /api/instance/update/full-stack        — start the background update job
- GET  /api/instance/update/full-stack/status — poll job progress / outcome
"""
import logging

from fastapi import APIRouter, Depends, HTTPException

from config import ADMIN_USER_IDS
from dependencies import get_user_id
from services import instance_update, docker_control

# Reuse the same admin gate that already authorizes container restarts through
# the socket-proxy (federation-apply). It accepts ADMIN_USER_IDS env admins AND
# dynamically-assigned first-boot admins from instance.json.
from routers.admin import require_admin

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/instance/update", tags=["instance-update"])


def _require_instance_admin(user_id: str) -> None:
    if user_id not in ADMIN_USER_IDS:
        raise HTTPException(403, "Instance admin access required")


@router.get("/status")
async def update_status(user_id: str = Depends(get_user_id)):
    _require_instance_admin(user_id)
    return instance_update.current_status()


@router.post("/check")
async def update_check(user_id: str = Depends(get_user_id)):
    _require_instance_admin(user_id)
    return await instance_update.check_for_update()


@router.post("/apply")
async def update_apply(user_id: str = Depends(get_user_id)):
    _require_instance_admin(user_id)
    try:
        return await instance_update.apply_update()
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))


# ---------------------------------------------------------------------------
# Full-stack update (multi-container compose): rebuild + relaunch ALL services.
# SECURITY-SENSITIVE — admin-gated, drives docker through the socket-proxy.
# See docs/architecture/docker-self-update-threat-model.md.
# ---------------------------------------------------------------------------


@router.post("/full-stack")
async def update_full_stack(user_id: str = Depends(get_user_id)):
    """Trigger a project-wide rebuild + relaunch of ALL containers/images.

    By default (and only mode) this is a full ``compose pull && build --pull &&
    up -d`` of every service — never a selective rebuild — followed by a health
    gate and rollback-on-failure. Long-running: returns immediately with a
    ``job_id``; the work runs in a detached sibling and the outcome is polled
    via ``GET /full-stack/status``.
    """
    require_admin(user_id)
    logger.warning("full-stack instance update triggered by %s", user_id)
    try:
        return await docker_control.full_stack_update()
    except docker_control.DockerControlError as exc:
        # Prerequisite missing (proxy unreachable, socket not exposed, etc.).
        raise HTTPException(409, str(exc))


@router.get("/full-stack/status")
async def update_full_stack_status(user_id: str = Depends(get_user_id)):
    """Poll the last-known full-stack update job status. Never raises on I/O."""
    require_admin(user_id)
    return docker_control.read_update_status()
