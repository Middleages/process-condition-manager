"""
Tests for app.services.export_validation_service.ExportValidationService

Integration tests using SQLite in-memory DB via conftest fixtures.

Coverage:
- Required column empty -> ERROR
- Non-existent column reference -> ERROR
- Numeric column with non-numeric value -> WARNING
- Data missing rate > 50% -> WARNING
- Clean data -> no issues
- Unknown system -> error result
"""

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    ColumnCategory, ColumnDefinition, ExportColumnMapping, ExportSystem,
    Layer, Line, Product, Project, ProjectLayer, User,
)
from app.services.auth_service import get_password_hash
from app.services.export_validation_service import ExportValidationService


# ---------------------------------------------------------------------------
# Fixture: seed export validation test data
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def export_data(db_session: AsyncSession):
    """Seed data for export validation tests.

    Creates:
    - 1 user, 1 line, 1 backbone product, 1 layer
    - 1 project with 1 project_layer
    - 1 export system with column mappings
    - Column definitions: 1 integer (required), 1 float (optional), 1 text (required)
    """
    _hash = get_password_hash("test123!")

    user = User(
        username="exporter", display_name="Exporter",
        roles=["editor"], password_hash=_hash, email="exporter@test.local",
    )
    db_session.add(user)
    await db_session.flush()

    line = Line(line_code="EXP-LINE", line_name="Export Line")
    db_session.add(line)
    await db_session.flush()

    layer = Layer(layer_name="EXP_L1", step_seq="exp100", layer_number="1.0", sort_order=10)
    db_session.add(layer)
    await db_session.flush()

    bb = Product(
        product_name="EXP-BB", description="Backbone",
        line_id=line.id, part_id="EXP-BB",
    )
    db_session.add(bb)
    await db_session.flush()

    prod = Product(
        product_name="EXP-PROD", description="Product",
        line_id=line.id, part_id="EXP-PROD",
    )
    db_session.add(prod)
    await db_session.flush()

    project = Project(
        product_id=prod.id, main_backbone_id=bb.id,
        status="approved", revision=1, is_latest=True,
        created_by=user.id,
    )
    db_session.add(project)
    await db_session.flush()

    # Column definitions
    cat = ColumnCategory(category_code="EXP", category_name="Export", sort_order=1)
    db_session.add(cat)
    await db_session.flush()

    col_int = ColumnDefinition(
        column_name="NUM_COL", display_name="Numeric Col",
        category_id=cat.id, data_type="integer", sort_order=1, is_required=True,
    )
    col_float = ColumnDefinition(
        column_name="FLOAT_COL", display_name="Float Col",
        category_id=cat.id, data_type="float", sort_order=2, is_required=False,
    )
    col_text = ColumnDefinition(
        column_name="TEXT_COL", display_name="Text Col",
        category_id=cat.id, data_type="string", sort_order=3, is_required=True,
    )
    db_session.add_all([col_int, col_float, col_text])
    await db_session.flush()

    # Export system
    system = ExportSystem(
        system_name="Test Export", format_type="type_a",
        description="Test system", is_active=True,
    )
    db_session.add(system)
    await db_session.flush()

    # Column mappings
    map_int = ExportColumnMapping(
        export_system_id=system.id, column_id=col_int.id,
        target_column_name="OUT_NUM", sort_order=1, is_required=True,
    )
    map_float = ExportColumnMapping(
        export_system_id=system.id, column_id=col_float.id,
        target_column_name="OUT_FLOAT", sort_order=2, is_required=False,
    )
    map_text = ExportColumnMapping(
        export_system_id=system.id, column_id=col_text.id,
        target_column_name="OUT_TEXT", sort_order=3, is_required=True,
    )
    db_session.add_all([map_int, map_float, map_text])
    await db_session.flush()

    # ProjectLayer with conditions (will be updated per test)
    pl = ProjectLayer(
        project_id=project.id, layer_id=layer.layer_number,
        layer_name=layer.layer_name, step_seq=layer.step_seq,
        conditions={"NUM_COL": "100", "FLOAT_COL": "3.14", "TEXT_COL": "hello"},
        sort_order=0,
    )
    db_session.add(pl)
    await db_session.commit()

    return {
        "project": project,
        "project_layer": pl,
        "system": system,
        "col_int": col_int,
        "col_float": col_float,
        "col_text": col_text,
    }


# ===========================================================================
# Tests
# ===========================================================================

class TestExportValidation:

    @pytest.mark.asyncio
    async def test_clean_data_no_issues(self, db_session, export_data):
        """All values present and valid -> no errors, no warnings."""
        data = export_data
        result = await ExportValidationService.validate(
            db_session, data["project"].id, [data["system"].id],
        )
        assert result.has_errors is False
        assert result.total_errors == 0
        assert result.total_warnings == 0

    @pytest.mark.asyncio
    async def test_required_column_empty_error(self, db_session, export_data):
        """Required column with empty value -> ERROR."""
        data = export_data
        pl = data["project_layer"]
        pl.conditions = {"NUM_COL": "", "FLOAT_COL": "3.14", "TEXT_COL": "hello"}
        await db_session.commit()

        result = await ExportValidationService.validate(
            db_session, data["project"].id, [data["system"].id],
        )
        assert result.has_errors is True
        assert result.total_errors >= 1
        error_msgs = [
            i.message for r in result.results for i in r.issues if i.level == "error"
        ]
        assert any("Numeric Col" in m for m in error_msgs)

    @pytest.mark.asyncio
    async def test_required_column_none_error(self, db_session, export_data):
        """Required column with None value -> ERROR."""
        data = export_data
        pl = data["project_layer"]
        pl.conditions = {"FLOAT_COL": "3.14", "TEXT_COL": "hello"}
        await db_session.commit()

        result = await ExportValidationService.validate(
            db_session, data["project"].id, [data["system"].id],
        )
        assert result.has_errors is True

    @pytest.mark.asyncio
    async def test_non_numeric_value_warning(self, db_session, export_data):
        """Numeric column with non-numeric value -> WARNING."""
        data = export_data
        pl = data["project_layer"]
        pl.conditions = {"NUM_COL": "abc", "FLOAT_COL": "3.14", "TEXT_COL": "hello"}
        await db_session.commit()

        result = await ExportValidationService.validate(
            db_session, data["project"].id, [data["system"].id],
        )
        warnings = [
            i for r in result.results for i in r.issues if i.level == "warning"
        ]
        assert len(warnings) >= 1
        assert any("abc" in w.message for w in warnings)

    @pytest.mark.asyncio
    async def test_high_missing_rate_warning(self, db_session, export_data):
        """More than 50% columns empty -> WARNING for missing rate."""
        data = export_data
        pl = data["project_layer"]
        # 3 mapped columns, 2 empty = 66% missing
        pl.conditions = {"NUM_COL": "", "FLOAT_COL": "", "TEXT_COL": "hello"}
        await db_session.commit()

        result = await ExportValidationService.validate(
            db_session, data["project"].id, [data["system"].id],
        )
        warnings = [
            i for r in result.results for i in r.issues if i.level == "warning"
        ]
        missing_warnings = [w for w in warnings if "누락률" in w.message]
        assert len(missing_warnings) >= 1

    @pytest.mark.asyncio
    async def test_unknown_system_error(self, db_session, export_data):
        """Non-existent system ID -> error result."""
        data = export_data
        result = await ExportValidationService.validate(
            db_session, data["project"].id, [99999],
        )
        assert result.has_errors is True
        assert result.total_errors == 1
        assert "99999" in result.results[0].issues[0].message

    @pytest.mark.asyncio
    async def test_nonexistent_project_404(self, db_session, export_data):
        """Non-existent project ID -> HTTPException 404."""
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc_info:
            await ExportValidationService.validate(db_session, 99999, [1])
        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_float_column_non_numeric_warning(self, db_session, export_data):
        """Float column with non-numeric value -> WARNING."""
        data = export_data
        pl = data["project_layer"]
        pl.conditions = {"NUM_COL": "100", "FLOAT_COL": "N/A", "TEXT_COL": "hello"}
        await db_session.commit()

        result = await ExportValidationService.validate(
            db_session, data["project"].id, [data["system"].id],
        )
        warnings = [
            i for r in result.results for i in r.issues if i.level == "warning"
        ]
        assert any("N/A" in w.message for w in warnings)
