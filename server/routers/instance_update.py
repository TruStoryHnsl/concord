"""Admin-only, user-initiated instance update endpoints (single-image deploy).

No polling, no automatic updates: the admin drives every step from the UI.
- GET  /api/instance/update/status  — what's running + whether updates are wired
- POST /api/instance/update/check   — compare running image vs registry
- POST /api/instance/update/apply   — pull newer image + recreate container
"""
import logging

from fastapi import APIRouter, Depends, HTTPException

from config import ADMIN_USER_IDS
from dependencies import get_user_id
from services import instance_update

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
