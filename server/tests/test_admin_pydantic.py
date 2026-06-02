"""INS-024 Wave 5: Pydantic input validation audit for admin endpoints.

Confirms that every admin endpoint's request model rejects invalid input
at the Pydantic layer, BEFORE it reaches any database or service call.
This is the commercial-scope ship gate for input validation.
"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from routers.admin import (
    BugReportCreate,
    FederationAllowlistUpdate,
    InstanceUpdate,
    PasswordChangeRequest,
    ReportUpdate,
)


# -------------------------------------------------------------------
# PasswordChangeRequest
# -------------------------------------------------------------------


def test_password_change_rejects_empty_current() -> None:
    with pytest.raises(ValidationError):
        PasswordChangeRequest(current_password="", new_password="newpass123")


def test_password_change_rejects_short_new_password() -> None:
    with pytest.raises(ValidationError):
        PasswordChangeRequest(current_password="current", new_password="short")


def test_password_change_rejects_too_long_new_password() -> None:
    with pytest.raises(ValidationError):
        PasswordChangeRequest(
            current_password="current", new_password="x" * 129
        )


def test_password_change_accepts_valid() -> None:
    req = PasswordChangeRequest(
        current_password="current", new_password="newpass123"
    )
    assert req.new_password == "newpass123"


# -------------------------------------------------------------------
# BugReportCreate
# -------------------------------------------------------------------


def test_bug_report_rejects_empty_title() -> None:
    with pytest.raises(ValidationError):
        BugReportCreate(title="", description="some description")


def test_bug_report_rejects_too_long_title() -> None:
    with pytest.raises(ValidationError):
        BugReportCreate(title="x" * 201, description="some description")


def test_bug_report_rejects_empty_description() -> None:
    with pytest.raises(ValidationError):
        BugReportCreate(title="valid title", description="")


def test_bug_report_rejects_too_long_description() -> None:
    with pytest.raises(ValidationError):
        BugReportCreate(title="valid title", description="x" * 5001)


def test_bug_report_accepts_valid() -> None:
    req = BugReportCreate(title="Bug", description="It broke")
    assert req.title == "Bug"


def test_bug_report_accepts_optional_system_info() -> None:
    req = BugReportCreate(
        title="Bug", description="It broke", system_info='{"ua": "Chrome"}'
    )
    assert req.system_info is not None


# -------------------------------------------------------------------
# InstanceUpdate
# -------------------------------------------------------------------


def test_instance_update_rejects_empty_name() -> None:
    with pytest.raises(ValidationError):
        InstanceUpdate(name="")


def test_instance_update_rejects_too_long_name() -> None:
    with pytest.raises(ValidationError):
        InstanceUpdate(name="x" * 65)


def test_instance_update_accepts_valid_name() -> None:
    req = InstanceUpdate(name="My Instance")
    assert req.name == "My Instance"


def test_instance_update_accepts_none_fields() -> None:
    req = InstanceUpdate()
    assert req.name is None
    assert req.require_totp is None


# -------------------------------------------------------------------
# ReportUpdate
# -------------------------------------------------------------------


def test_report_update_rejects_invalid_status() -> None:
    with pytest.raises(ValidationError):
        ReportUpdate(status="invalid_status")


def test_report_update_accepts_valid_statuses() -> None:
    for status in ("open", "in_progress", "resolved", "closed"):
        req = ReportUpdate(status=status)
        assert req.status == status


def test_report_update_rejects_too_long_admin_notes() -> None:
    with pytest.raises(ValidationError):
        ReportUpdate(admin_notes="x" * 10_001)


def test_report_update_accepts_none() -> None:
    req = ReportUpdate()
    assert req.status is None
    assert req.admin_notes is None


# -------------------------------------------------------------------
# FederationAllowlistUpdate
# -------------------------------------------------------------------


def test_federation_allowlist_accepts_empty_list() -> None:
    req = FederationAllowlistUpdate(allowed_servers=[])
    assert req.allowed_servers == []


def test_federation_allowlist_accepts_valid_servers() -> None:
    req = FederationAllowlistUpdate(
        allowed_servers=["matrix.org", "example.com"]
    )
    assert len(req.allowed_servers) == 2


def test_federation_allowlist_rejects_too_many_servers() -> None:
    with pytest.raises(ValidationError):
        FederationAllowlistUpdate(allowed_servers=["x.com"] * 1001)
