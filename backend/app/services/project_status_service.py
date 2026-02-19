"""
Project status management service.

Handles status transitions with state machine validation.
"""
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException

from app.constants import VALID_STATUS_TRANSITIONS
from app.models import Project, ProjectStatusLog, User
from app.services import validation_service
from app.services.comment_service import get_unresolved_count


async def update_project_status(
    db: AsyncSession,
    project_id: int,
    new_status: str,
    changed_by: int,
    comment: str | None = None,
) -> dict:
    """
    Update project status with state machine validation.

    State transitions:
    - draft → review (requires validation errors = 0)
    - review → approved (requires reviewer/admin role)
    - review → rejected (requires reviewer/admin role + unresolved comments > 0)
    - approved → archived

    Args:
        db: Database session
        project_id: Project ID
        new_status: Target status
        changed_by: User ID making the change
        comment: Optional comment for the transition

    Returns:
        Dictionary with id, status, previous_status, changed_by, changed_at

    Raises:
        HTTPException: 404 if project not found, 400 for invalid transitions,
                       403 for insufficient permissions
    """
    # Fetch project
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    current_status = project.status

    # Check archived status blocked
    if current_status == "archived":
        raise HTTPException(
            status_code=400,
            detail="Cannot change status of archived project"
        )

    # Check transition validity
    allowed_transitions = VALID_STATUS_TRANSITIONS.get(current_status, [])
    if new_status not in allowed_transitions:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status transition from {current_status} to {new_status}"
        )

    # For Draft → Review: validate no errors
    if current_status == "draft" and new_status == "review":
        validation_result = await validation_service.validate_project(db, project_id)
        if validation_result.error_count > 0:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot submit for review: {validation_result.error_count} validation errors found"
            )

    # For Review → Approved/Rejected: check role
    if current_status == "review" and new_status in ["approved", "rejected"]:
        user = await db.get(User, changed_by)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        if user.role not in ["reviewer", "admin"]:
            raise HTTPException(
                status_code=403,
                detail="Only reviewers can approve or reject projects"
            )

    # For Review → Rejected: check unresolved comments
    if current_status == "review" and new_status == "rejected":
        unresolved_count = await get_unresolved_count(db, project_id)
        if unresolved_count == 0:
            raise HTTPException(
                status_code=400,
                detail="At least one comment is required for rejection"
            )

        # Rejection creates dual log: review→rejected + rejected→draft
        log_rejected = ProjectStatusLog(
            project_id=project_id,
            from_status=current_status,
            to_status="rejected",
            changed_by=changed_by,
            comment=comment,
        )
        db.add(log_rejected)
        await db.flush()

        log_to_draft = ProjectStatusLog(
            project_id=project_id,
            from_status="rejected",
            to_status="draft",
            changed_by=changed_by,
            comment="Automatic transition after rejection",
        )
        db.add(log_to_draft)
        await db.flush()

        project.status = "draft"
        await db.commit()

        return {
            "id": project.id,
            "status": "draft",
            "previous_status": current_status,
            "changed_by": changed_by,
            "changed_at": log_to_draft.changed_at,
        }

    # For all other transitions: create single status log
    status_log = ProjectStatusLog(
        project_id=project_id,
        from_status=current_status,
        to_status=new_status,
        changed_by=changed_by,
        comment=comment,
    )
    db.add(status_log)

    # Update project status
    project.status = new_status
    await db.flush()
    await db.commit()

    return {
        "id": project.id,
        "status": new_status,
        "previous_status": current_status,
        "changed_by": changed_by,
        "changed_at": status_log.changed_at,
    }
