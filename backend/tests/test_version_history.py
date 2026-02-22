"""
Tests for list_version_history() service (TDD - new function).
Covers: single version, multiple versions, is_current flag, creator name, 404.
"""
import pytest
from fastapi import HTTPException

from app.services.project_service import create_project, update_project_status, revise_project
from app.services.project_analytics_service import list_version_history


@pytest.mark.asyncio
class TestVersionHistory:
    async def test_single_version_project(self, db_session, seed_test_data):
        """Single-version project returns one VersionItem with is_current=True and is_latest=True."""
        data = seed_test_data
        project = await create_project(
            db_session, data["target"].id, data["backbone"].id, data["user"].id,
        )

        result = await list_version_history(db_session, project.id)

        assert result.product_id == data["target"].id
        assert result.product_name == data["target"].product_name
        assert result.current_project_id == project.id
        assert len(result.versions) == 1

        v = result.versions[0]
        assert v.project_id == project.id
        assert v.revision == 1
        assert v.is_current is True
        assert v.is_latest is True

    async def test_multi_version_project_returns_all_revisions_ordered_desc(self, db_session, seed_test_data):
        """Multi-version project returns all revisions ordered by revision DESC."""
        data = seed_test_data

        # Create initial project
        project_v1 = await create_project(
            db_session, data["target"].id, data["backbone"].id, data["user"].id,
        )

        # Transition to approved state to allow revision
        await update_project_status(db_session, project_v1.id, "review", data["user"])
        await update_project_status(db_session, project_v1.id, "approved", data["admin_user"])

        # Create a new revision
        project_v2 = await revise_project(db_session, project_v1.id, revision_reason=None)

        result = await list_version_history(db_session, project_v2.id)

        assert len(result.versions) == 2
        # Should be ordered by revision DESC
        revisions = [v.revision for v in result.versions]
        assert revisions == sorted(revisions, reverse=True)
        assert revisions[0] > revisions[1]

    async def test_is_current_flag_correctly_set(self, db_session, seed_test_data):
        """is_current is True only for the requested project_id."""
        data = seed_test_data

        project_v1 = await create_project(
            db_session, data["target"].id, data["backbone"].id, data["user"].id,
        )
        await update_project_status(db_session, project_v1.id, "review", data["user"])
        await update_project_status(db_session, project_v1.id, "approved", data["admin_user"])
        project_v2 = await revise_project(db_session, project_v1.id, revision_reason=None)

        # View history from v1's perspective
        result_from_v1 = await list_version_history(db_session, project_v1.id)
        current_versions_v1 = [v for v in result_from_v1.versions if v.is_current]
        assert len(current_versions_v1) == 1
        assert current_versions_v1[0].project_id == project_v1.id

        # View history from v2's perspective
        result_from_v2 = await list_version_history(db_session, project_v2.id)
        current_versions_v2 = [v for v in result_from_v2.versions if v.is_current]
        assert len(current_versions_v2) == 1
        assert current_versions_v2[0].project_id == project_v2.id

    async def test_creator_display_name_resolved(self, db_session, seed_test_data):
        """VersionItem includes creator display name."""
        data = seed_test_data
        project = await create_project(
            db_session, data["target"].id, data["backbone"].id, data["user"].id,
        )

        result = await list_version_history(db_session, project.id)

        assert len(result.versions) == 1
        v = result.versions[0]
        assert v.created_by_name is not None
        assert v.created_by_name == data["user"].display_name

    async def test_project_not_found_raises_404(self, db_session, seed_test_data):
        """Non-existent project_id raises HTTPException 404."""
        with pytest.raises(HTTPException) as exc_info:
            await list_version_history(db_session, 999999)
        assert exc_info.value.status_code == 404

    async def test_versions_include_correct_status(self, db_session, seed_test_data):
        """Versions include their status field correctly."""
        data = seed_test_data

        project_v1 = await create_project(
            db_session, data["target"].id, data["backbone"].id, data["user"].id,
        )
        await update_project_status(db_session, project_v1.id, "review", data["user"])
        await update_project_status(db_session, project_v1.id, "approved", data["admin_user"])
        project_v2 = await revise_project(db_session, project_v1.id, revision_reason=None)

        result = await list_version_history(db_session, project_v2.id)

        statuses = {v.project_id: v.status for v in result.versions}
        assert statuses[project_v2.id] == "draft"
        assert statuses[project_v1.id] == "archived"

    async def test_is_latest_flag_on_versions(self, db_session, seed_test_data):
        """After revision, old version is_latest=False and new version is_latest=True."""
        data = seed_test_data

        project_v1 = await create_project(
            db_session, data["target"].id, data["backbone"].id, data["user"].id,
        )
        await update_project_status(db_session, project_v1.id, "review", data["user"])
        await update_project_status(db_session, project_v1.id, "approved", data["admin_user"])
        project_v2 = await revise_project(db_session, project_v1.id, revision_reason=None)

        result = await list_version_history(db_session, project_v2.id)

        latest_versions = [v for v in result.versions if v.is_latest]
        assert len(latest_versions) == 1
        assert latest_versions[0].project_id == project_v2.id
