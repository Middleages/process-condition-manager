"""
Tests for app.services.validation_service.validate_project.

Covers:
- Valid project (no errors)
- Missing required field
- Value out of range (min/max)
- Range validation skips None values (defers to required check)
- Conditional required triggers when condition is met
- Conditional required does NOT trigger when condition is not met
- Validation runs across all layers
- Non-numeric value in a range-validated column
"""

import pytest
from fastapi import HTTPException

from app.services.project_service import create_project
from app.services.validation_service import validate_project


@pytest.mark.asyncio
class TestValidateProject:
    """Tests for validate_project service function."""

    async def _create_test_project(self, db_session, seed_test_data):
        """Helper: create a draft project backed by backbone conditions."""
        data = seed_test_data
        project = await create_project(
            db_session, data["target"].id, data["backbone"].id, data["user"].id,
        )
        return project, data

    # ------------------------------------------------------------------
    # Happy path
    # ------------------------------------------------------------------

    async def test_valid_project_no_errors(self, db_session, seed_test_data):
        """A project whose backbone conditions satisfy all rules should pass."""
        project, _ = await self._create_test_project(db_session, seed_test_data)

        result = await validate_project(db_session, project.id)

        assert result.project_id == project.id
        assert result.is_valid is True
        assert result.error_count == 0
        assert result.errors == []

    # ------------------------------------------------------------------
    # Required field validation
    # ------------------------------------------------------------------

    async def test_missing_required_field_produces_error(self, db_session, seed_test_data):
        """Removing a required column from conditions should yield a 'required' error."""
        project, _ = await self._create_test_project(db_session, seed_test_data)

        first_layer = sorted(project.layers, key=lambda pl: pl.sort_order)[0]
        new_conditions = dict(first_layer.conditions)
        del new_conditions["SC_EXPOSE_ENERGY_mJ"]
        first_layer.conditions = new_conditions
        await db_session.flush()

        result = await validate_project(db_session, project.id)

        req_errors = [
            e for e in result.errors
            if e.rule_type == "required"
            and e.column_name == "SC_EXPOSE_ENERGY_mJ"
            and e.layer_name == first_layer.layer.layer_name
        ]
        assert len(req_errors) == 1
        assert result.is_valid is False

    async def test_empty_string_required_field_produces_error(self, db_session, seed_test_data):
        """An empty-string value for a required column should also trigger 'required' error."""
        project, _ = await self._create_test_project(db_session, seed_test_data)

        first_layer = sorted(project.layers, key=lambda pl: pl.sort_order)[0]
        first_layer.conditions = {**first_layer.conditions, "SP_ADHESION_USE": "  "}
        await db_session.flush()

        result = await validate_project(db_session, project.id)

        req_errors = [
            e for e in result.errors
            if e.rule_type == "required"
            and e.column_name == "SP_ADHESION_USE"
            and e.layer_name == first_layer.layer.layer_name
        ]
        assert len(req_errors) == 1

    # ------------------------------------------------------------------
    # Range validation
    # ------------------------------------------------------------------

    async def test_value_above_max_produces_range_error(self, db_session, seed_test_data):
        """SP_SPIN1_SPEED_rpm = 9999 exceeds max(8000) -> range error."""
        project, _ = await self._create_test_project(db_session, seed_test_data)

        first_layer = sorted(project.layers, key=lambda pl: pl.sort_order)[0]
        first_layer.conditions = {**first_layer.conditions, "SP_SPIN1_SPEED_rpm": 9999}
        await db_session.flush()

        result = await validate_project(db_session, project.id)

        range_errors = [
            e for e in result.errors
            if e.rule_type == "range"
            and e.column_name == "SP_SPIN1_SPEED_rpm"
            and e.layer_name == first_layer.layer.layer_name
        ]
        assert len(range_errors) == 1
        assert result.is_valid is False

    async def test_value_below_min_produces_range_error(self, db_session, seed_test_data):
        """SP_SPIN1_SPEED_rpm = 100 below min(500) -> range error."""
        project, _ = await self._create_test_project(db_session, seed_test_data)

        first_layer = sorted(project.layers, key=lambda pl: pl.sort_order)[0]
        first_layer.conditions = {**first_layer.conditions, "SP_SPIN1_SPEED_rpm": 100}
        await db_session.flush()

        result = await validate_project(db_session, project.id)

        range_errors = [
            e for e in result.errors
            if e.rule_type == "range"
            and e.column_name == "SP_SPIN1_SPEED_rpm"
            and e.layer_name == first_layer.layer.layer_name
        ]
        assert len(range_errors) == 1

    async def test_value_within_range_passes(self, db_session, seed_test_data):
        """All backbone values are within valid ranges -> no range errors."""
        project, _ = await self._create_test_project(db_session, seed_test_data)

        result = await validate_project(db_session, project.id)

        range_errors = [e for e in result.errors if e.rule_type == "range"]
        assert len(range_errors) == 0

    async def test_range_validation_skips_none_value(self, db_session, seed_test_data):
        """Range check should NOT fire on None; required check handles missing values."""
        project, _ = await self._create_test_project(db_session, seed_test_data)

        first_layer = sorted(project.layers, key=lambda pl: pl.sort_order)[0]
        new_conditions = dict(first_layer.conditions)
        del new_conditions["SP_SPIN1_SPEED_rpm"]
        first_layer.conditions = new_conditions
        await db_session.flush()

        result = await validate_project(db_session, project.id)

        # No range error for the missing column
        range_errors = [
            e for e in result.errors
            if e.rule_type == "range"
            and e.column_name == "SP_SPIN1_SPEED_rpm"
            and e.layer_name == first_layer.layer.layer_name
        ]
        assert len(range_errors) == 0

        # But a required error should exist instead
        req_errors = [
            e for e in result.errors
            if e.rule_type == "required"
            and e.column_name == "SP_SPIN1_SPEED_rpm"
            and e.layer_name == first_layer.layer.layer_name
        ]
        assert len(req_errors) == 1

    async def test_non_numeric_value_produces_range_error(self, db_session, seed_test_data):
        """A non-numeric string in a range-validated column should produce a range error."""
        project, _ = await self._create_test_project(db_session, seed_test_data)

        first_layer = sorted(project.layers, key=lambda pl: pl.sort_order)[0]
        first_layer.conditions = {**first_layer.conditions, "SP_SPIN1_SPEED_rpm": "abc"}
        await db_session.flush()

        result = await validate_project(db_session, project.id)

        range_errors = [
            e for e in result.errors
            if e.rule_type == "range"
            and e.column_name == "SP_SPIN1_SPEED_rpm"
            and e.layer_name == first_layer.layer.layer_name
        ]
        assert len(range_errors) == 1

    # ------------------------------------------------------------------
    # Conditional required validation
    # ------------------------------------------------------------------

    async def test_conditional_required_triggers_when_condition_met(self, db_session, seed_test_data):
        """SP_ADHESION_USE='Y' without SP_ADHESION_TYPE -> conditional_required error."""
        project, _ = await self._create_test_project(db_session, seed_test_data)

        first_layer = sorted(project.layers, key=lambda pl: pl.sort_order)[0]
        new_conditions = dict(first_layer.conditions)
        new_conditions["SP_ADHESION_USE"] = "Y"
        new_conditions.pop("SP_ADHESION_TYPE", None)
        first_layer.conditions = new_conditions
        await db_session.flush()

        result = await validate_project(db_session, project.id)

        cond_errors = [
            e for e in result.errors
            if e.rule_type == "conditional_required"
            and e.column_name == "SP_ADHESION_TYPE"
            and e.layer_name == first_layer.layer.layer_name
        ]
        assert len(cond_errors) == 1

    async def test_conditional_required_does_not_trigger_when_condition_not_met(
        self, db_session, seed_test_data
    ):
        """SP_ADHESION_USE='N' + no SP_ADHESION_TYPE -> no conditional_required error."""
        project, _ = await self._create_test_project(db_session, seed_test_data)

        # LAYER_B already has SP_ADHESION_USE='N' and no SP_ADHESION_TYPE
        layers_sorted = sorted(project.layers, key=lambda pl: pl.sort_order)
        layer_b = layers_sorted[1]
        assert layer_b.conditions.get("SP_ADHESION_USE") == "N"

        result = await validate_project(db_session, project.id)

        cond_errors = [
            e for e in result.errors
            if e.rule_type == "conditional_required"
            and e.layer_name == layer_b.layer.layer_name
        ]
        assert len(cond_errors) == 0

    # ------------------------------------------------------------------
    # Multi-layer validation
    # ------------------------------------------------------------------

    async def test_validates_all_layers(self, db_session, seed_test_data):
        """Removing a required field from all 3 layers produces 3 errors."""
        project, _ = await self._create_test_project(db_session, seed_test_data)

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
        assert len(req_errors) == 3
        layer_names = {e.layer_name for e in req_errors}
        assert len(layer_names) == 3

    # ------------------------------------------------------------------
    # Conditional required: Extended operators (not_equals, contains)
    # ------------------------------------------------------------------

    async def test_conditional_required_not_equals_triggers_when_values_differ(
        self, db_session, seed_test_data
    ):
        """not_equals operator: condition triggers when values differ."""
        from app.models import ColumnValidation
        from sqlalchemy import select, update

        project, data = await self._create_test_project(db_session, seed_test_data)

        # Find the conditional_required rule for SP_ADHESION_TYPE
        result = await db_session.execute(
            select(ColumnValidation)
            .where(ColumnValidation.rule_type == "conditional_required")
        )
        rule = result.scalars().first()
        assert rule is not None

        # Update rule to use not_equals operator
        rule.rule_config = {
            "condition_column": "SP_ADHESION_USE",
            "condition_value": "N",
            "operator": "not_equals"
        }
        await db_session.flush()

        # Set SP_ADHESION_USE='Y' (not equals 'N'), so condition should trigger
        first_layer = sorted(project.layers, key=lambda pl: pl.sort_order)[0]
        new_conditions = dict(first_layer.conditions)
        new_conditions["SP_ADHESION_USE"] = "Y"
        new_conditions.pop("SP_ADHESION_TYPE", None)
        first_layer.conditions = new_conditions
        await db_session.flush()

        result = await validate_project(db_session, project.id)

        cond_errors = [
            e for e in result.errors
            if e.rule_type == "conditional_required"
            and e.column_name == "SP_ADHESION_TYPE"
            and e.layer_name == first_layer.layer.layer_name
        ]
        assert len(cond_errors) == 1

    async def test_conditional_required_not_equals_does_not_trigger_when_values_equal(
        self, db_session, seed_test_data
    ):
        """not_equals operator: condition does NOT trigger when values equal."""
        from app.models import ColumnValidation
        from sqlalchemy import select

        project, data = await self._create_test_project(db_session, seed_test_data)

        # Find the conditional_required rule
        result = await db_session.execute(
            select(ColumnValidation)
            .where(ColumnValidation.rule_type == "conditional_required")
        )
        rule = result.scalars().first()
        assert rule is not None

        # Update rule to use not_equals operator
        rule.rule_config = {
            "condition_column": "SP_ADHESION_USE",
            "condition_value": "N",
            "operator": "not_equals"
        }
        await db_session.flush()

        # Set SP_ADHESION_USE='N' (equals 'N'), so condition should NOT trigger
        first_layer = sorted(project.layers, key=lambda pl: pl.sort_order)[0]
        new_conditions = dict(first_layer.conditions)
        new_conditions["SP_ADHESION_USE"] = "N"
        new_conditions.pop("SP_ADHESION_TYPE", None)
        first_layer.conditions = new_conditions
        await db_session.flush()

        result = await validate_project(db_session, project.id)

        cond_errors = [
            e for e in result.errors
            if e.rule_type == "conditional_required"
            and e.column_name == "SP_ADHESION_TYPE"
            and e.layer_name == first_layer.layer.layer_name
        ]
        assert len(cond_errors) == 0

    async def test_conditional_required_contains_triggers_when_substring_matches(
        self, db_session, seed_test_data
    ):
        """contains operator: condition triggers when substring matches."""
        from app.models import ColumnValidation
        from sqlalchemy import select

        project, data = await self._create_test_project(db_session, seed_test_data)

        # Find the conditional_required rule
        result = await db_session.execute(
            select(ColumnValidation)
            .where(ColumnValidation.rule_type == "conditional_required")
        )
        rule = result.scalars().first()
        assert rule is not None

        # Update rule to use contains operator
        rule.rule_config = {
            "condition_column": "SP_ADHESION_USE",
            "condition_value": "yes",
            "operator": "contains"
        }
        await db_session.flush()

        # Set SP_ADHESION_USE='YES_ACTIVE' (contains 'yes'), so condition should trigger
        first_layer = sorted(project.layers, key=lambda pl: pl.sort_order)[0]
        new_conditions = dict(first_layer.conditions)
        new_conditions["SP_ADHESION_USE"] = "YES_ACTIVE"
        new_conditions.pop("SP_ADHESION_TYPE", None)
        first_layer.conditions = new_conditions
        await db_session.flush()

        result = await validate_project(db_session, project.id)

        cond_errors = [
            e for e in result.errors
            if e.rule_type == "conditional_required"
            and e.column_name == "SP_ADHESION_TYPE"
            and e.layer_name == first_layer.layer.layer_name
        ]
        assert len(cond_errors) == 1

    async def test_conditional_required_contains_does_not_trigger_when_no_match(
        self, db_session, seed_test_data
    ):
        """contains operator: condition does NOT trigger when substring not found."""
        from app.models import ColumnValidation
        from sqlalchemy import select

        project, data = await self._create_test_project(db_session, seed_test_data)

        # Find the conditional_required rule
        result = await db_session.execute(
            select(ColumnValidation)
            .where(ColumnValidation.rule_type == "conditional_required")
        )
        rule = result.scalars().first()
        assert rule is not None

        # Update rule to use contains operator
        rule.rule_config = {
            "condition_column": "SP_ADHESION_USE",
            "condition_value": "yes",
            "operator": "contains"
        }
        await db_session.flush()

        # Set SP_ADHESION_USE='N' (does NOT contain 'yes'), so condition should NOT trigger
        first_layer = sorted(project.layers, key=lambda pl: pl.sort_order)[0]
        new_conditions = dict(first_layer.conditions)
        new_conditions["SP_ADHESION_USE"] = "N"
        new_conditions.pop("SP_ADHESION_TYPE", None)
        first_layer.conditions = new_conditions
        await db_session.flush()

        result = await validate_project(db_session, project.id)

        cond_errors = [
            e for e in result.errors
            if e.rule_type == "conditional_required"
            and e.column_name == "SP_ADHESION_TYPE"
            and e.layer_name == first_layer.layer.layer_name
        ]
        assert len(cond_errors) == 0

    async def test_conditional_required_defaults_to_equals_when_operator_missing(
        self, db_session, seed_test_data
    ):
        """Missing operator defaults to 'equals' for backward compatibility."""
        from app.models import ColumnValidation
        from sqlalchemy import select

        project, data = await self._create_test_project(db_session, seed_test_data)

        # Find the conditional_required rule
        result = await db_session.execute(
            select(ColumnValidation)
            .where(ColumnValidation.rule_type == "conditional_required")
        )
        rule = result.scalars().first()
        assert rule is not None

        # Update rule WITHOUT operator field (should default to equals)
        rule.rule_config = {
            "condition_column": "SP_ADHESION_USE",
            "condition_value": "Y"
            # No operator field
        }
        await db_session.flush()

        # Set SP_ADHESION_USE='Y' (equals 'Y'), so condition should trigger
        first_layer = sorted(project.layers, key=lambda pl: pl.sort_order)[0]
        new_conditions = dict(first_layer.conditions)
        new_conditions["SP_ADHESION_USE"] = "Y"
        new_conditions.pop("SP_ADHESION_TYPE", None)
        first_layer.conditions = new_conditions
        await db_session.flush()

        result = await validate_project(db_session, project.id)

        cond_errors = [
            e for e in result.errors
            if e.rule_type == "conditional_required"
            and e.column_name == "SP_ADHESION_TYPE"
            and e.layer_name == first_layer.layer.layer_name
        ]
        assert len(cond_errors) == 1

    # ------------------------------------------------------------------
    # Edge cases
    # ------------------------------------------------------------------

    async def test_nonexistent_project_raises_404(self, db_session, seed_test_data):
        """Validating a nonexistent project should raise HTTP 404."""
        with pytest.raises(HTTPException) as exc_info:
            await validate_project(db_session, 99999)
        assert exc_info.value.status_code == 404
