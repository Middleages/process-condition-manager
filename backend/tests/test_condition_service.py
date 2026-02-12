from datetime import datetime, timezone, timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models import ChangeLog, Project
from app.services.project_service import create_project
from app.services.condition_service import bulk_save_conditions
from app.schemas.project import BulkSaveRequest, LayerConditions


@pytest.mark.asyncio
class TestBulkSave:

    async def _create_test_project(self, db_session, seed_test_data):
        """Helper to create a project for testing."""
        data = seed_test_data
        project = await create_project(
            db_session, data["target"].id, data["backbone"].id, data["user"].id,
        )
        return project, data

    async def test_bulk_save_creates_change_logs(self, db_session, seed_test_data):
        """Changing one value should create exactly one change_log entry."""
        project, data = await self._create_test_project(db_session, seed_test_data)
        first_layer = sorted(project.layers, key=lambda pl: pl.sort_order)[0]

        # Modify one condition
        new_conditions = dict(first_layer.conditions)
        new_conditions["SP_SPIN1_SPEED_rpm"] = 3000  # was 2000

        request = BulkSaveRequest(
            layers=[LayerConditions(
                project_layer_id=first_layer.id,
                conditions=new_conditions,
            )],
            updated_by=data["user"].id,
            expected_updated_at=project.updated_at,
        )

        result = await bulk_save_conditions(db_session, project.id, request)
        assert result.success is True
        assert result.change_log_count == 1

        # Verify the change_log record
        logs = await db_session.execute(
            select(ChangeLog).where(ChangeLog.project_layer_id == first_layer.id)
        )
        change_logs = logs.scalars().all()
        speed_log = [cl for cl in change_logs if cl.column_name == "SP_SPIN1_SPEED_rpm"]
        assert len(speed_log) == 1
        assert speed_log[0].old_value == "2000"
        assert speed_log[0].new_value == "3000"
        assert speed_log[0].change_type == "manual"

    async def test_bulk_save_detects_conflict(self, db_session, seed_test_data):
        """Stale expected_updated_at should return 409."""
        project, data = await self._create_test_project(db_session, seed_test_data)
        first_layer = sorted(project.layers, key=lambda pl: pl.sort_order)[0]

        # Use a timestamp before the project was created
        stale_time = project.updated_at - timedelta(hours=1)

        request = BulkSaveRequest(
            layers=[LayerConditions(
                project_layer_id=first_layer.id,
                conditions=first_layer.conditions,
            )],
            updated_by=data["user"].id,
            expected_updated_at=stale_time,
        )

        with pytest.raises(HTTPException) as exc_info:
            await bulk_save_conditions(db_session, project.id, request)
        assert exc_info.value.status_code == 409

    async def test_bulk_save_rejects_non_draft_project(self, db_session, seed_test_data):
        """Saving to a non-draft project should return 400."""
        project, data = await self._create_test_project(db_session, seed_test_data)
        project.status = "review"
        await db_session.flush()

        first_layer = sorted(project.layers, key=lambda pl: pl.sort_order)[0]
        request = BulkSaveRequest(
            layers=[LayerConditions(
                project_layer_id=first_layer.id,
                conditions=first_layer.conditions,
            )],
            updated_by=data["user"].id,
            expected_updated_at=project.updated_at,
        )

        with pytest.raises(HTTPException) as exc_info:
            await bulk_save_conditions(db_session, project.id, request)
        assert exc_info.value.status_code == 400

    async def test_bulk_save_logs_deleted_keys(self, db_session, seed_test_data):
        """Removing a key from conditions should log old_value -> None."""
        project, data = await self._create_test_project(db_session, seed_test_data)
        first_layer = sorted(project.layers, key=lambda pl: pl.sort_order)[0]

        # Remove SP_ADHESION_TYPE from conditions
        new_conditions = dict(first_layer.conditions)
        del new_conditions["SP_ADHESION_TYPE"]

        request = BulkSaveRequest(
            layers=[LayerConditions(
                project_layer_id=first_layer.id,
                conditions=new_conditions,
            )],
            updated_by=data["user"].id,
            expected_updated_at=project.updated_at,
        )

        result = await bulk_save_conditions(db_session, project.id, request)
        assert result.success is True

        logs = await db_session.execute(
            select(ChangeLog).where(
                ChangeLog.project_layer_id == first_layer.id,
                ChangeLog.column_name == "SP_ADHESION_TYPE",
            )
        )
        log = logs.scalars().first()
        assert log is not None
        assert log.old_value == "HMDS"
        assert log.new_value is None

    async def test_bulk_save_no_changes_produces_zero_logs(self, db_session, seed_test_data):
        """Saving identical conditions should produce zero change_logs."""
        project, data = await self._create_test_project(db_session, seed_test_data)
        first_layer = sorted(project.layers, key=lambda pl: pl.sort_order)[0]

        request = BulkSaveRequest(
            layers=[LayerConditions(
                project_layer_id=first_layer.id,
                conditions=dict(first_layer.conditions),
            )],
            updated_by=data["user"].id,
            expected_updated_at=project.updated_at,
        )

        result = await bulk_save_conditions(db_session, project.id, request)
        assert result.change_log_count == 0
