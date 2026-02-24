"""
Tests for approval workflow state transitions.
"""
import pytest
from fastapi import HTTPException

from app.models import Project, ProjectLayer, ReviewComment, ProjectStatusLog
from app.services import project_service
from app.services.comment_service import create_comment
from app.schemas.comment import CommentCreate


@pytest.mark.asyncio
async def test_draft_to_review_valid(db_session, seed_test_data):
    """Test valid draft to review transition with no validation errors."""
    user = seed_test_data["user"]
    target = seed_test_data["target"]
    backbone = seed_test_data["backbone"]

    # Create project
    project = await project_service.create_project(
        db_session, target.id, backbone.id, user.id
    )

    # Transition to review (should succeed with no validation errors)
    result = await project_service.update_project_status(
        db_session, project.id, "review", user, "Ready for review"
    )

    assert result["status"] == "review"
    assert result["previous_status"] == "draft"


@pytest.mark.asyncio
async def test_draft_to_review_with_validation_errors(db_session, seed_test_data):
    """Test draft to review transition blocked by validation errors."""
    user = seed_test_data["user"]
    target = seed_test_data["target"]
    backbone = seed_test_data["backbone"]

    # Create project
    project = await project_service.create_project(
        db_session, target.id, backbone.id, user.id
    )

    # Modify conditions to create validation error (speed out of range)
    from sqlalchemy import select, update
    await db_session.execute(
        update(ProjectLayer)
        .where(ProjectLayer.project_id == project.id)
        .values(conditions={"SP_SPIN1_SPEED_rpm": 10000})  # exceeds max 8000
    )
    await db_session.commit()

    # Attempt transition to review (should fail due to validation errors)
    with pytest.raises(HTTPException) as exc_info:
        await project_service.update_project_status(
            db_session, project.id, "review", user
        )

    assert exc_info.value.status_code == 400
    assert "validation errors found" in exc_info.value.detail


@pytest.mark.asyncio
async def test_review_to_approved_by_reviewer(db_session, seed_test_data):
    """Test review to approved transition by reviewer role."""
    user = seed_test_data["user"]
    reviewer = seed_test_data["reviewer_user"]
    target = seed_test_data["target"]
    backbone = seed_test_data["backbone"]

    # Create project and move to review
    project = await project_service.create_project(
        db_session, target.id, backbone.id, user.id
    )
    await project_service.update_project_status(
        db_session, project.id, "review", user
    )

    # Transition to approved by reviewer
    result = await project_service.update_project_status(
        db_session, project.id, "approved", reviewer, "Looks good"
    )

    assert result["status"] == "approved"
    assert result["previous_status"] == "review"


@pytest.mark.asyncio
async def test_review_to_approved_by_editor_forbidden(db_session, seed_test_data):
    """Test review to approved transition forbidden for editor role."""
    user = seed_test_data["user"]
    target = seed_test_data["target"]
    backbone = seed_test_data["backbone"]

    # Create project and move to review
    project = await project_service.create_project(
        db_session, target.id, backbone.id, user.id
    )
    await project_service.update_project_status(
        db_session, project.id, "review", user
    )

    # Attempt to approve as editor (should fail)
    with pytest.raises(HTTPException) as exc_info:
        await project_service.update_project_status(
            db_session, project.id, "approved", user
        )

    assert exc_info.value.status_code == 403
    assert "Only reviewers" in exc_info.value.detail


@pytest.mark.asyncio
async def test_review_to_rejected_with_comments(db_session, seed_test_data):
    """Test review to rejected transition with comments (valid)."""
    user = seed_test_data["user"]
    reviewer = seed_test_data["reviewer_user"]
    target = seed_test_data["target"]
    backbone = seed_test_data["backbone"]

    # Create project and move to review
    project = await project_service.create_project(
        db_session, target.id, backbone.id, user.id
    )
    await project_service.update_project_status(
        db_session, project.id, "review", user
    )

    # Add a comment
    comment_data = CommentCreate(
        user_id=reviewer.id,
        content="Please fix this issue",
        comment_type="rejection",
    )
    await create_comment(db_session, project.id, comment_data)

    # Transition to rejected
    result = await project_service.update_project_status(
        db_session, project.id, "rejected", reviewer, "Issues found"
    )

    # Should transition to draft, not stay as rejected
    assert result["status"] == "draft"
    assert result["previous_status"] == "review"


@pytest.mark.asyncio
async def test_review_to_rejected_without_comments(db_session, seed_test_data):
    """Test review to rejected transition blocked without comments."""
    user = seed_test_data["user"]
    reviewer = seed_test_data["reviewer_user"]
    target = seed_test_data["target"]
    backbone = seed_test_data["backbone"]

    # Create project and move to review
    project = await project_service.create_project(
        db_session, target.id, backbone.id, user.id
    )
    await project_service.update_project_status(
        db_session, project.id, "review", user
    )

    # Attempt to reject without comments (should fail)
    with pytest.raises(HTTPException) as exc_info:
        await project_service.update_project_status(
            db_session, project.id, "rejected", reviewer
        )

    assert exc_info.value.status_code == 400
    assert "comment is required" in exc_info.value.detail


@pytest.mark.asyncio
async def test_invalid_transition_draft_to_approved(db_session, seed_test_data):
    """Test invalid transition from draft to approved."""
    user = seed_test_data["user"]
    target = seed_test_data["target"]
    backbone = seed_test_data["backbone"]

    # Create project
    project = await project_service.create_project(
        db_session, target.id, backbone.id, user.id
    )

    # Attempt invalid transition (should fail)
    with pytest.raises(HTTPException) as exc_info:
        await project_service.update_project_status(
            db_session, project.id, "approved", user
        )

    assert exc_info.value.status_code == 400
    assert "Invalid status transition" in exc_info.value.detail


@pytest.mark.asyncio
async def test_archived_status_change_blocked(db_session, seed_test_data):
    """Test that archived projects cannot change status."""
    user = seed_test_data["user"]
    reviewer = seed_test_data["reviewer_user"]
    target = seed_test_data["target"]
    backbone = seed_test_data["backbone"]

    # Create project, move to review, approve, and archive
    project = await project_service.create_project(
        db_session, target.id, backbone.id, user.id
    )
    await project_service.update_project_status(
        db_session, project.id, "review", user
    )
    await project_service.update_project_status(
        db_session, project.id, "approved", reviewer
    )
    await project_service.update_project_status(
        db_session, project.id, "archived", user
    )

    # Attempt to change status (should fail)
    with pytest.raises(HTTPException) as exc_info:
        await project_service.update_project_status(
            db_session, project.id, "draft", user
        )

    assert exc_info.value.status_code == 400
    assert "archived" in exc_info.value.detail


@pytest.mark.asyncio
async def test_status_log_created_on_transition(db_session, seed_test_data):
    """Test that status logs are created for each transition."""
    user = seed_test_data["user"]
    target = seed_test_data["target"]
    backbone = seed_test_data["backbone"]

    # Create project
    project = await project_service.create_project(
        db_session, target.id, backbone.id, user.id
    )

    # Transition to review
    await project_service.update_project_status(
        db_session, project.id, "review", user, "Test comment"
    )

    # Check status log was created
    from sqlalchemy import select
    result = await db_session.execute(
        select(ProjectStatusLog).where(ProjectStatusLog.project_id == project.id)
    )
    logs = result.scalars().all()

    assert len(logs) == 1
    assert logs[0].from_status == "draft"
    assert logs[0].to_status == "review"
    assert logs[0].comment == "Test comment"


@pytest.mark.asyncio
async def test_rejection_creates_dual_log(db_session, seed_test_data):
    """Test that rejection creates two log entries (review→rejected→draft)."""
    user = seed_test_data["user"]
    reviewer = seed_test_data["reviewer_user"]
    target = seed_test_data["target"]
    backbone = seed_test_data["backbone"]

    # Create project and move to review
    project = await project_service.create_project(
        db_session, target.id, backbone.id, user.id
    )
    await project_service.update_project_status(
        db_session, project.id, "review", user
    )

    # Add a comment
    comment_data = CommentCreate(
        user_id=reviewer.id,
        content="Issues found",
        comment_type="rejection",
    )
    await create_comment(db_session, project.id, comment_data)

    # Reject
    await project_service.update_project_status(
        db_session, project.id, "rejected", reviewer, "Needs work"
    )

    # Check dual log entries
    from sqlalchemy import select
    result = await db_session.execute(
        select(ProjectStatusLog)
        .where(ProjectStatusLog.project_id == project.id)
        .order_by(ProjectStatusLog.changed_at)
    )
    logs = result.scalars().all()

    # First transition is draft→review, then review→rejected, then rejected→draft
    assert len(logs) == 3
    assert logs[0].from_status == "draft"
    assert logs[0].to_status == "review"
    assert logs[1].from_status == "review"
    assert logs[1].to_status == "rejected"
    assert logs[2].from_status == "rejected"
    assert logs[2].to_status == "draft"
