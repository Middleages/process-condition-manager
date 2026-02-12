import pytest
from fastapi import HTTPException

from app.services.project_service import create_project
from app.services.validation_service import validate_project


@pytest.mark.asyncio
class TestValidation:

    async def _create_test_project(self, db_session, seed_test_data):
        """Helper to create a project with backbone conditions."""
        data = seed_test_data
        project = await create_project(
            db_session, data["target"].id, data["backbone"].id, data["user"].id,
        )
        return project, data

    async def test_valid_project_passes_validation(self, db_session, seed_test_data):
        """Project with all valid backbone conditions should pass."""
        project, data = await self._create_test_project(db_session, seed_test_data)
        result = await validate_project(db_session, project.id)

        assert result.project_id == project.id
        assert result.is_valid is True
        assert result.error_count == 0

    async def test_range_validation_catches_out_of_range(self, db_session, seed_test_data):
        """SP_SPIN1_SPEED_rpm = 9999 should fail range validation (max 8000)."""
        project, data = await self._create_test_project(db_session, seed_test_data)

        # Set out-of-range value
        first_layer = sorted(project.layers, key=lambda pl: pl.sort_order)[0]
        first_layer.conditions = {**first_layer.conditions, "SP_SPIN1_SPEED_rpm": 9999}
        await db_session.flush()

        result = await validate_project(db_session, project.id)
        range_errors = [e for e in result.errors if e.rule_type == "range" and e.column_name == "SP_SPIN1_SPEED_rpm"]
        assert len(range_errors) >= 1
        assert not result.is_valid

    async def test_range_validation_passes_valid_value(self, db_session, seed_test_data):
        """SP_SPIN1_SPEED_rpm = 3000 within 500-8000 should pass."""
        project, data = await self._create_test_project(db_session, seed_test_data)

        # Already has 2000 which is valid — no range error expected
        result = await validate_project(db_session, project.id)
        range_errors = [e for e in result.errors if e.rule_type == "range"]
        assert len(range_errors) == 0

    async def test_required_validation_catches_missing_value(self, db_session, seed_test_data):
        """Missing a required field should produce a required error."""
        project, data = await self._create_test_project(db_session, seed_test_data)

        # Remove a required field (SC_EXPOSE_ENERGY_mJ)
        first_layer = sorted(project.layers, key=lambda pl: pl.sort_order)[0]
        new_conditions = dict(first_layer.conditions)
        del new_conditions["SC_EXPOSE_ENERGY_mJ"]
        first_layer.conditions = new_conditions
        await db_session.flush()

        result = await validate_project(db_session, project.id)
        req_errors = [
            e for e in result.errors
            if e.rule_type == "required" and e.column_name == "SC_EXPOSE_ENERGY_mJ"
            and e.layer_name == first_layer.layer.layer_name
        ]
        assert len(req_errors) == 1

    async def test_conditional_required_triggers_when_condition_met(self, db_session, seed_test_data):
        """SP_ADHESION_USE='Y' + SP_ADHESION_TYPE missing should trigger error."""
        project, data = await self._create_test_project(db_session, seed_test_data)

        # Set adhesion use to Y but remove adhesion type
        first_layer = sorted(project.layers, key=lambda pl: pl.sort_order)[0]
        new_conditions = dict(first_layer.conditions)
        new_conditions["SP_ADHESION_USE"] = "Y"
        if "SP_ADHESION_TYPE" in new_conditions:
            del new_conditions["SP_ADHESION_TYPE"]
        first_layer.conditions = new_conditions
        await db_session.flush()

        result = await validate_project(db_session, project.id)
        cond_errors = [
            e for e in result.errors
            if e.rule_type == "conditional_required" and e.column_name == "SP_ADHESION_TYPE"
            and e.layer_name == first_layer.layer.layer_name
        ]
        assert len(cond_errors) == 1

    async def test_conditional_required_does_not_trigger_when_condition_not_met(self, db_session, seed_test_data):
        """SP_ADHESION_USE='N' + SP_ADHESION_TYPE missing should NOT trigger error."""
        project, data = await self._create_test_project(db_session, seed_test_data)

        # Layer B already has SP_ADHESION_USE='N' without SP_ADHESION_TYPE
        layers_sorted = sorted(project.layers, key=lambda pl: pl.sort_order)
        layer_b = layers_sorted[1]  # LAYER_B has adhesion_use=N
        assert layer_b.conditions.get("SP_ADHESION_USE") == "N"

        result = await validate_project(db_session, project.id)
        cond_errors_b = [
            e for e in result.errors
            if e.rule_type == "conditional_required"
            and e.layer_name == layer_b.layer.layer_name
        ]
        assert len(cond_errors_b) == 0

    async def test_validates_all_layers(self, db_session, seed_test_data):
        """Errors should appear for all 3 layers if all have issues."""
        project, data = await self._create_test_project(db_session, seed_test_data)

        # Remove required field from all layers
        for pl in project.layers:
            new_conditions = dict(pl.conditions)
            del new_conditions["SC_EXPOSE_ENERGY_mJ"]
            pl.conditions = new_conditions
        await db_session.flush()

        result = await validate_project(db_session, project.id)
        req_errors = [
            e for e in result.errors
            if e.rule_type == "required" and e.column_name == "SC_EXPOSE_ENERGY_mJ"
        ]
        # Should have errors for all 3 layers
        assert len(req_errors) == 3
        layer_names_with_errors = {e.layer_name for e in req_errors}
        assert len(layer_names_with_errors) == 3

    async def test_range_validation_skips_none_values(self, db_session, seed_test_data):
        """Range validation should not fire on None — required handles that."""
        project, data = await self._create_test_project(db_session, seed_test_data)

        first_layer = sorted(project.layers, key=lambda pl: pl.sort_order)[0]
        new_conditions = dict(first_layer.conditions)
        del new_conditions["SP_SPIN1_SPEED_rpm"]
        first_layer.conditions = new_conditions
        await db_session.flush()

        result = await validate_project(db_session, project.id)
        range_errors = [
            e for e in result.errors
            if e.rule_type == "range" and e.column_name == "SP_SPIN1_SPEED_rpm"
            and e.layer_name == first_layer.layer.layer_name
        ]
        # Should NOT have a range error for None value
        assert len(range_errors) == 0
        # But should have a required error
        req_errors = [
            e for e in result.errors
            if e.rule_type == "required" and e.column_name == "SP_SPIN1_SPEED_rpm"
            and e.layer_name == first_layer.layer.layer_name
        ]
        assert len(req_errors) == 1
