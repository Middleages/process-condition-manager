"""
Tests for comment service CRUD operations.
"""
import pytest
from fastapi import HTTPException

from app.models import Project, ProjectLayer
from app.services.project import service as project_service
from app.services.comment_service import (
    create_comment, list_comments, update_comment, delete_comment, get_unresolved_count
)
from app.schemas.comment import CommentCreate, CommentUpdate


@pytest.mark.asyncio
async def test_create_cell_level_comment(db_session, seed_test_data):
    """Test creating a comment for a specific cell (layer + column)."""
    user = seed_test_data["user"]
    target = seed_test_data["target"]
    backbone = seed_test_data["backbone"]

    # Create project
    project = await project_service.create_project(
        db_session, target.id, backbone.id, user.id
    )

    # Get first project layer
    from sqlalchemy import select
    result = await db_session.execute(
        select(ProjectLayer).where(ProjectLayer.project_id == project.id).limit(1)
    )
    project_layer = result.scalar_one()

    # Create cell-level comment
    comment_data = CommentCreate(
        user_id=user.id,
        project_layer_id=project_layer.id,
        column_name="SP_SPIN1_SPEED_rpm",
        content="This value seems too high",
        comment_type="general",
    )
    result = await create_comment(db_session, project.id, comment_data)

    assert result["id"] is not None
    assert result["project_id"] == project.id
    assert result["project_layer_id"] == project_layer.id
    assert result["column_name"] == "SP_SPIN1_SPEED_rpm"
    assert result["content"] == "This value seems too high"
    assert result["creator_name"] == user.display_name
    assert result["is_resolved"] is False


@pytest.mark.asyncio
async def test_create_project_level_comment(db_session, seed_test_data):
    """Test creating a project-level comment (no layer, no column)."""
    user = seed_test_data["user"]
    target = seed_test_data["target"]
    backbone = seed_test_data["backbone"]

    # Create project
    project = await project_service.create_project(
        db_session, target.id, backbone.id, user.id
    )

    # Create project-level comment
    comment_data = CommentCreate(
        user_id=user.id,
        project_layer_id=None,
        column_name=None,
        content="Overall project needs review",
        comment_type="general",
    )
    result = await create_comment(db_session, project.id, comment_data)

    assert result["id"] is not None
    assert result["project_layer_id"] is None
    assert result["column_name"] is None
    assert result["content"] == "Overall project needs review"


@pytest.mark.asyncio
async def test_create_comment_invalid_targeting(db_session, seed_test_data):
    """Test that column_name without project_layer_id is rejected."""
    user = seed_test_data["user"]
    target = seed_test_data["target"]
    backbone = seed_test_data["backbone"]

    # Create project
    project = await project_service.create_project(
        db_session, target.id, backbone.id, user.id
    )

    # Attempt to create comment with column but no layer (should fail)
    comment_data = CommentCreate(
        user_id=user.id,
        project_layer_id=None,
        column_name="SP_SPIN1_SPEED_rpm",
        content="Invalid comment",
    )

    with pytest.raises(HTTPException) as exc_info:
        await create_comment(db_session, project.id, comment_data)

    assert exc_info.value.status_code == 400
    assert "column_name requires project_layer_id" in exc_info.value.detail


@pytest.mark.asyncio
async def test_create_comment_on_archived_project(db_session, seed_test_data):
    """Test that comments cannot be added to archived projects."""
    user = seed_test_data["user"]
    reviewer = seed_test_data["reviewer_user"]
    target = seed_test_data["target"]
    backbone = seed_test_data["backbone"]

    # Create project and archive it
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

    # Attempt to add comment (should fail)
    comment_data = CommentCreate(
        user_id=user.id,
        content="This should fail",
    )

    with pytest.raises(HTTPException) as exc_info:
        await create_comment(db_session, project.id, comment_data)

    assert exc_info.value.status_code == 403
    assert "archived" in exc_info.value.detail


@pytest.mark.asyncio
async def test_list_comments_filter_resolved(db_session, seed_test_data):
    """Test listing comments filtered by resolution status."""
    user = seed_test_data["user"]
    target = seed_test_data["target"]
    backbone = seed_test_data["backbone"]

    # Create project
    project = await project_service.create_project(
        db_session, target.id, backbone.id, user.id
    )

    # Create two comments
    comment1_data = CommentCreate(user_id=user.id, content="Unresolved comment")
    comment2_data = CommentCreate(user_id=user.id, content="Resolved comment")

    result1 = await create_comment(db_session, project.id, comment1_data)
    result2 = await create_comment(db_session, project.id, comment2_data)

    # Resolve second comment
    update_data = CommentUpdate(is_resolved=True)
    await update_comment(db_session, project.id, result2["id"], update_data, user.id)

    # List unresolved comments
    result = await list_comments(db_session, project.id, is_resolved=False)
    assert result["total"] == 1
    assert result["comments"][0]["id"] == result1["id"]

    # List resolved comments
    result = await list_comments(db_session, project.id, is_resolved=True)
    assert result["total"] == 1
    assert result["comments"][0]["id"] == result2["id"]


@pytest.mark.asyncio
async def test_list_comments_filter_type(db_session, seed_test_data):
    """Test listing comments filtered by comment type."""
    user = seed_test_data["user"]
    target = seed_test_data["target"]
    backbone = seed_test_data["backbone"]

    # Create project
    project = await project_service.create_project(
        db_session, target.id, backbone.id, user.id
    )

    # Create comments of different types
    comment1_data = CommentCreate(
        user_id=user.id, content="General comment", comment_type="general"
    )
    comment2_data = CommentCreate(
        user_id=user.id, content="Rejection comment", comment_type="rejection"
    )

    await create_comment(db_session, project.id, comment1_data)
    await create_comment(db_session, project.id, comment2_data)

    # Filter by type
    result = await list_comments(db_session, project.id, comment_type="rejection")
    assert result["total"] == 1
    assert result["comments"][0]["comment_type"] == "rejection"


@pytest.mark.asyncio
async def test_update_comment_content(db_session, seed_test_data):
    """Test updating comment content."""
    user = seed_test_data["user"]
    target = seed_test_data["target"]
    backbone = seed_test_data["backbone"]

    # Create project and comment
    project = await project_service.create_project(
        db_session, target.id, backbone.id, user.id
    )
    comment_data = CommentCreate(user_id=user.id, content="Original content")
    result = await create_comment(db_session, project.id, comment_data)

    # Update content
    update_data = CommentUpdate(content="Updated content")
    updated = await update_comment(
        db_session, project.id, result["id"], update_data, user.id
    )

    assert updated["content"] == "Updated content"


@pytest.mark.asyncio
async def test_resolve_comment(db_session, seed_test_data):
    """Test resolving a comment."""
    user = seed_test_data["user"]
    target = seed_test_data["target"]
    backbone = seed_test_data["backbone"]

    # Create project and comment
    project = await project_service.create_project(
        db_session, target.id, backbone.id, user.id
    )
    comment_data = CommentCreate(user_id=user.id, content="Needs resolution")
    result = await create_comment(db_session, project.id, comment_data)

    # Resolve comment
    update_data = CommentUpdate(is_resolved=True)
    updated = await update_comment(
        db_session, project.id, result["id"], update_data, user.id
    )

    assert updated["is_resolved"] is True
    assert updated["resolved_by"] == user.id
    assert updated["resolved_at"] is not None


@pytest.mark.asyncio
async def test_delete_comment_by_owner(db_session, seed_test_data):
    """Test deleting a comment by its creator."""
    user = seed_test_data["user"]
    target = seed_test_data["target"]
    backbone = seed_test_data["backbone"]

    # Create project and comment
    project = await project_service.create_project(
        db_session, target.id, backbone.id, user.id
    )
    comment_data = CommentCreate(user_id=user.id, content="To be deleted")
    result = await create_comment(db_session, project.id, comment_data)

    # Delete comment
    await delete_comment(db_session, project.id, result["id"], user.id)

    # Verify deletion
    list_result = await list_comments(db_session, project.id)
    assert list_result["total"] == 0


@pytest.mark.asyncio
async def test_delete_comment_by_admin(db_session, seed_test_data):
    """Test deleting a comment by admin (not the creator)."""
    user = seed_test_data["user"]
    admin = seed_test_data["admin_user"]
    target = seed_test_data["target"]
    backbone = seed_test_data["backbone"]

    # Create project and comment as user
    project = await project_service.create_project(
        db_session, target.id, backbone.id, user.id
    )
    comment_data = CommentCreate(user_id=user.id, content="To be deleted by admin")
    result = await create_comment(db_session, project.id, comment_data)

    # Delete comment as admin
    await delete_comment(db_session, project.id, result["id"], admin.id)

    # Verify deletion
    list_result = await list_comments(db_session, project.id)
    assert list_result["total"] == 0


@pytest.mark.asyncio
async def test_delete_comment_by_non_owner_forbidden(db_session, seed_test_data):
    """Test deleting a comment by non-owner (not admin) is forbidden."""
    user = seed_test_data["user"]
    reviewer = seed_test_data["reviewer_user"]
    target = seed_test_data["target"]
    backbone = seed_test_data["backbone"]

    # Create project and comment as user
    project = await project_service.create_project(
        db_session, target.id, backbone.id, user.id
    )
    comment_data = CommentCreate(user_id=user.id, content="Cannot be deleted")
    result = await create_comment(db_session, project.id, comment_data)

    # Attempt to delete as reviewer (should fail)
    with pytest.raises(HTTPException) as exc_info:
        await delete_comment(db_session, project.id, result["id"], reviewer.id)

    assert exc_info.value.status_code == 403
    assert "creator or admin" in exc_info.value.detail


@pytest.mark.asyncio
async def test_list_comments_returns_counts(db_session, seed_test_data):
    """Test that list_comments returns correct total and unresolved_count."""
    user = seed_test_data["user"]
    target = seed_test_data["target"]
    backbone = seed_test_data["backbone"]

    # Create project
    project = await project_service.create_project(
        db_session, target.id, backbone.id, user.id
    )

    # Create 3 comments, resolve 1
    for i in range(3):
        comment_data = CommentCreate(user_id=user.id, content=f"Comment {i}")
        result = await create_comment(db_session, project.id, comment_data)

        if i == 0:
            update_data = CommentUpdate(is_resolved=True)
            await update_comment(db_session, project.id, result["id"], update_data, user.id)

    # List all comments
    result = await list_comments(db_session, project.id)
    assert result["total"] == 3
    assert result["unresolved_count"] == 2


@pytest.mark.asyncio
async def test_get_unresolved_count(db_session, seed_test_data):
    """Test get_unresolved_count function."""
    user = seed_test_data["user"]
    target = seed_test_data["target"]
    backbone = seed_test_data["backbone"]

    # Create project
    project = await project_service.create_project(
        db_session, target.id, backbone.id, user.id
    )

    # Create 2 unresolved comments
    for i in range(2):
        comment_data = CommentCreate(user_id=user.id, content=f"Unresolved {i}")
        await create_comment(db_session, project.id, comment_data)

    # Check count
    count = await get_unresolved_count(db_session, project.id)
    assert count == 2

    # Resolve one
    result = await list_comments(db_session, project.id)
    first_comment_id = result["comments"][0]["id"]
    update_data = CommentUpdate(is_resolved=True)
    await update_comment(db_session, project.id, first_comment_id, update_data, user.id)

    # Check count again
    count = await get_unresolved_count(db_session, project.id)
    assert count == 1
