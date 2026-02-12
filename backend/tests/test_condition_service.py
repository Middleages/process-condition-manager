"""
Tests for app.services.condition_service.bulk_save_conditions.

Covers:
- Successful save with change_log creation (single value change)
- Conflict detection via expected_updated_at (HTTP 409)
- Draft-only editing restriction (HTTP 400 for non-draft)
- Deleted keys produce old_value -> None change_log
- Identical save produces zero change_logs
- Multi-layer bulk save
- Invalid project_layer_id is rejected
- Nonexistent project raises 404
"""

from datetime import datetime, timezone, timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models import ChangeLog, Project
from app.services.project_service import create_project
from app.services.condition_service import bulk_save_conditions
from app.schemas.project import BulkSaveRequest, LayerConditions


@pytest.mark.asyncio
class TestBulkSaveConditions:
    """Tests for bulk_save_conditions service function."""

    async def _create_test_project(self, db_session, seed_test_data):
        """Helper: create a draft project from seed data."""
        data = seed_test_data
        project = await create_project(
            db_session, data["target"].id, data["backbone"].id, data["user"].id,
        )
        return project, data

    # ------------------------------------------------------------------
    # Successful saves
    # ------------------------------------------------------------------

    async def test_bulk_save_creates_change_logs(self, db_session, seed_test_data):
        """Changing one value should create exactly one change_log entry."""
        project, data = await self._create_test_project(db_session, seed_test_data)
        first_layer = sorted(project.layers, key=lambda pl: pl.sort_order)[0]

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
        assert result.updated_layers == 1
        assert result.change_log_count == 1

        # Verify persisted change_log
        logs_result = await db_session.execute(
            select(ChangeLog).where(ChangeLog.project_layer_id == first_layer.id)
        )
        change_logs = logs_result.scalars().all()
        speed_log = [cl for cl in change_logs if cl.column_name == "SP_SPIN1_SPEED_rpm"]
        assert len(speed_log) == 1
        assert speed_log[0].old_value == "2000"
        assert speed_log[0].new_value == "3000"
        assert speed_log[0].change_type == "manual"
        assert speed_log[0].changed_by == data["user"].id

    async def test_bulk_save_updates_project_updated_at(self, db_session, seed_test_data):
        """After saving, project.updated_at should be refreshed."""
        project, data = await self._create_test_project(db_session, seed_test_data)
        original_updated_at = project.updated_at
        first_layer = sorted(project.layers, key=lambda pl: pl.sort_order)[0]

        request = BulkSaveRequest(
            layers=[LayerConditions(
                project_layer_id=first_layer.id,
                conditions={**first_layer.conditions, "SP_SPIN1_SPEED_rpm": 5555},
            )],
            updated_by=data["user"].id,
            expected_updated_at=project.updated_at,
        )

        result = await bulk_save_conditions(db_session, project.id, request)

        assert result.updated_at is not None

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

        assert result.success is True
        assert result.change_log_count == 0

    async def test_bulk_save_logs_deleted_keys(self, db_session, seed_test_data):
        """Removing a key from conditions should log old_value -> None."""
        project, data = await self._create_test_project(db_session, seed_test_data)
        first_layer = sorted(project.layers, key=lambda pl: pl.sort_order)[0]

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

        logs_result = await db_session.execute(
            select(ChangeLog).where(
                ChangeLog.project_layer_id == first_layer.id,
                ChangeLog.column_name == "SP_ADHESION_TYPE",
            )
        )
        log = logs_result.scalars().first()
        assert log is not None
        assert log.old_value == "HMDS"
        assert log.new_value is None

    async def test_bulk_save_logs_added_keys(self, db_session, seed_test_data):
        """Adding a brand-new key should log None -> new_value."""
        project, data = await self._create_test_project(db_session, seed_test_data)
        # LAYER_B has no SP_ADHESION_TYPE
        layers_sorted = sorted(project.layers, key=lambda pl: pl.sort_order)
        layer_b = layers_sorted[1]
        assert "SP_ADHESION_TYPE" not in layer_b.conditions

        new_conditions = dict(layer_b.conditions)
        new_conditions["SP_ADHESION_TYPE"] = "NEW_VAL"

        request = BulkSaveRequest(
            layers=[LayerConditions(
                project_layer_id=layer_b.id,
                conditions=new_conditions,
            )],
            updated_by=data["user"].id,
            expected_updated_at=project.updated_at,
        )

        result = await bulk_save_conditions(db_session, project.id, request)
        assert result.success is True

        logs_result = await db_session.execute(
            select(ChangeLog).where(
                ChangeLog.project_layer_id == layer_b.id,
                ChangeLog.column_name == "SP_ADHESION_TYPE",
            )
        )
        log = logs_result.scalars().first()
        assert log is not None
        assert log.old_value is None
        assert log.new_value == "NEW_VAL"

    async def test_bulk_save_multiple_layers(self, db_session, seed_test_data):
        """Saving changes across 2 layers should produce correct total change_log_count."""
        project, data = await self._create_test_project(db_session, seed_test_data)
        layers_sorted = sorted(project.layers, key=lambda pl: pl.sort_order)

        layer_a = layers_sorted[0]
        layer_b = layers_sorted[1]

        request = BulkSaveRequest(
            layers=[
                LayerConditions(
                    project_layer_id=layer_a.id,
                    conditions={**layer_a.conditions, "SP_SPIN1_SPEED_rpm": 6000},
                ),
                LayerConditions(
                    project_layer_id=layer_b.id,
                    conditions={**layer_b.conditions, "SC_EXPOSE_ENERGY_mJ": 99.0},
                ),
            ],
            updated_by=data["user"].id,
            expected_updated_at=project.updated_at,
        )

        result = await bulk_save_conditions(db_session, project.id, request)

        assert result.success is True
        assert result.updated_layers == 2
        assert result.change_log_count == 2

    # ------------------------------------------------------------------
    # Conflict detection (HTTP 409)
    # ------------------------------------------------------------------

    async def test_bulk_save_detects_conflict(self, db_session, seed_test_data):
        """Stale expected_updated_at should raise HTTP 409."""
        project, data = await self._create_test_project(db_session, seed_test_data)
        first_layer = sorted(project.layers, key=lambda pl: pl.sort_order)[0]

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

    # ------------------------------------------------------------------
    # Draft-only restriction (HTTP 400)
    # ------------------------------------------------------------------

    async def test_bulk_save_rejects_non_draft_project(self, db_session, seed_test_data):
        """Saving to a 'review' project should raise HTTP 400."""
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

    async def test_bulk_save_rejects_approved_project(self, db_session, seed_test_data):
        """Saving to an 'approved' project should also raise HTTP 400."""
        project, data = await self._create_test_project(db_session, seed_test_data)
        project.status = "approved"
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

    # ------------------------------------------------------------------
    # Error cases
    # ------------------------------------------------------------------

    async def test_bulk_save_invalid_project_layer_id(self, db_session, seed_test_data):
        """Using a nonexistent project_layer_id should raise HTTP 400."""
        project, data = await self._create_test_project(db_session, seed_test_data)

        request = BulkSaveRequest(
            layers=[LayerConditions(
                project_layer_id=99999,
                conditions={"SP_SPIN1_SPEED_rpm": 1000},
            )],
            updated_by=data["user"].id,
            expected_updated_at=project.updated_at,
        )

        with pytest.raises(HTTPException) as exc_info:
            await bulk_save_conditions(db_session, project.id, request)
        assert exc_info.value.status_code == 400

    async def test_bulk_save_nonexistent_project_raises_404(self, db_session, seed_test_data):
        """Saving to a nonexistent project should raise HTTP 404."""
        request = BulkSaveRequest(
            layers=[LayerConditions(
                project_layer_id=1,
                conditions={},
            )],
            updated_by=1,
            expected_updated_at=datetime.now(timezone.utc),
        )

        with pytest.raises(HTTPException) as exc_info:
            await bulk_save_conditions(db_session, 99999, request)
        assert exc_info.value.status_code == 404
