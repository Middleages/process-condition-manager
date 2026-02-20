"""
Integration tests for the export API endpoints.

Coverage:
- TC-050: GET /api/export/systems returns 200 with system list
- TC-052: POST /api/projects/{id}/export with non-approved project returns 400
- TC-053: GET /api/projects/{id}/export/preview/{system_id} returns preview data
- TC-056: POST /api/projects/{id}/export with non-existent system_id returns 404
- TC-057: POST /api/projects/{id}/export with inactive system_id returns 400
- TC-055: POST /api/projects/{id}/export with single system returns Excel (not ZIP)
- TC-081: Only mapped columns appear in output (via preview endpoint)

REQ coverage: REQ-050, REQ-051, REQ-052, REQ-053, REQ-054, REQ-055, REQ-056, REQ-057, REQ-080, REQ-083
"""

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    User, Line, Product, Layer, ProductLayer,
    ColumnCategory, ColumnDefinition, ExportSystem, ExportColumnMapping, Project, ProjectLayer,
)
from app.services.auth_service import get_password_hash


# ---------------------------------------------------------------------------
# Export-specific seed fixture
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def export_seed(db_session: AsyncSession):
    """
    Seed minimal data needed for export API tests.

    Creates:
    - 1 user
    - 1 line
    - 2 layers
    - 1 backbone product
    - 1 target product
    - 2 column definitions
    - 1 active export system (TYPE_A) with 1 column mapping
    - 1 inactive export system
    - 1 approved project
    - 1 draft project
    """
    # Users
    _hash = get_password_hash("changeme123!")
    user = User(
        username="exp_tester", display_name="Export Tester", role="editor",
        password_hash=_hash, email="exp_tester@test.local",
    )
    db_session.add(user)
    await db_session.flush()

    # Line
    line = Line(line_code="EXP-LINE", line_name="Export Test Line")
    db_session.add(line)
    await db_session.flush()

    # Layers
    layer_a = Layer(layer_name="EXP_LAYER_A", step_seq="ex100000", layer_number="1.0", sort_order=10)
    layer_b = Layer(layer_name="EXP_LAYER_B", step_seq="ex200000", layer_number="2.0", sort_order=20)
    db_session.add_all([layer_a, layer_b])
    await db_session.flush()

    # Backbone product
    backbone = Product(
        product_name="EXP-BB", description="Export backbone",
        is_backbone=True, line_id=line.id, part_id="EXP-BB",
    )
    db_session.add(backbone)
    await db_session.flush()

    bb_cond = {"SP_SPEED_rpm": 2000, "SC_ENERGY_mJ": 35.0}
    for layer in [layer_a, layer_b]:
        db_session.add(ProductLayer(product_id=backbone.id, layer_id=layer.id, conditions=bb_cond))

    # Column category and definitions
    cat = ColumnCategory(category_code="SP", category_name="Spin/PR", sort_order=1)
    db_session.add(cat)
    await db_session.flush()

    col_speed = ColumnDefinition(
        column_name="SP_SPEED_rpm", display_name="Spin Speed",
        category_id=cat.id, data_type="integer", sort_order=1, is_required=True,
    )
    col_energy = ColumnDefinition(
        column_name="SC_ENERGY_mJ", display_name="Expose Energy",
        category_id=cat.id, data_type="float", sort_order=2, is_required=True,
    )
    db_session.add_all([col_speed, col_energy])
    await db_session.flush()

    # Active export system with one column mapping
    active_system = ExportSystem(
        system_name="TEST_SYSTEM_A",
        format_type="TYPE_A",
        description="Test export system A",
        is_active=True,
    )
    db_session.add(active_system)
    await db_session.flush()

    mapping = ExportColumnMapping(
        export_system_id=active_system.id,
        column_id=col_speed.id,
        target_column_name="SPIN_SPEED",
        sort_order=1,
        is_required=True,
    )
    db_session.add(mapping)

    # Inactive export system
    inactive_system = ExportSystem(
        system_name="TEST_SYSTEM_INACTIVE",
        format_type="TYPE_A",
        description="Inactive system",
        is_active=False,
    )
    db_session.add(inactive_system)
    await db_session.flush()

    # Target product
    target = Product(
        product_name="EXP-TARGET", description="Export target",
        is_backbone=False, line_id=line.id, part_id="EXP-TARGET",
    )
    db_session.add(target)
    await db_session.flush()

    # Approved project with conditions
    approved_project = Project(
        product_id=target.id,
        main_backbone_id=backbone.id,
        revision=1,
        status="approved",
        created_by=user.id,
    )
    db_session.add(approved_project)
    await db_session.flush()

    conditions = {"SP_SPEED_rpm": 2500, "SC_ENERGY_mJ": 40.0}
    for layer in [layer_a, layer_b]:
        db_session.add(ProjectLayer(
            project_id=approved_project.id,
            layer_id=layer.id,
            sort_order=layer.sort_order,
            conditions=conditions,
        ))

    # Draft project (not approved)
    draft_project = Project(
        product_id=target.id,
        main_backbone_id=backbone.id,
        revision=2,
        status="draft",
        created_by=user.id,
    )
    db_session.add(draft_project)
    await db_session.flush()

    await db_session.commit()

    return {
        "user": user,
        "active_system": active_system,
        "inactive_system": inactive_system,
        "approved_project": approved_project,
        "draft_project": draft_project,
        "col_speed": col_speed,
    }


# ---------------------------------------------------------------------------
# TC-050: GET /api/export/systems
# ---------------------------------------------------------------------------


class TestListExportSystems:
    """TC-050: REQ-050 - List active export systems with column counts."""

    @pytest.mark.asyncio
    async def test_returns_200_with_system_list(self, client, export_seed, auth_headers):
        headers = auth_headers(export_seed["user"])
        response = await client.get("/api/export/systems", headers=headers)
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_returns_only_active_systems(self, client, export_seed, auth_headers):
        headers = auth_headers(export_seed["user"])
        response = await client.get("/api/export/systems", headers=headers)
        data = response.json()
        # Only active systems should be returned
        assert all(s["is_active"] for s in data)

    @pytest.mark.asyncio
    async def test_response_contains_expected_fields(self, client, export_seed, auth_headers):
        headers = auth_headers(export_seed["user"])
        response = await client.get("/api/export/systems", headers=headers)
        data = response.json()
        assert len(data) >= 1
        system = data[0]
        assert "id" in system
        assert "system_name" in system
        assert "format_type" in system
        assert "column_count" in system
        assert "is_active" in system

    @pytest.mark.asyncio
    async def test_column_count_reflects_mappings(self, client, export_seed, auth_headers):
        headers = auth_headers(export_seed["user"])
        response = await client.get("/api/export/systems", headers=headers)
        data = response.json()
        active_sys = export_seed["active_system"]
        matching = [s for s in data if s["id"] == active_sys.id]
        assert len(matching) == 1
        # Active system has 1 mapping
        assert matching[0]["column_count"] == 1

    @pytest.mark.asyncio
    async def test_inactive_system_not_in_list(self, client, export_seed, auth_headers):
        headers = auth_headers(export_seed["user"])
        response = await client.get("/api/export/systems", headers=headers)
        data = response.json()
        inactive_id = export_seed["inactive_system"].id
        assert not any(s["id"] == inactive_id for s in data)


# ---------------------------------------------------------------------------
# TC-052 / REQ-052 / REQ-080: Export requires approved status
# ---------------------------------------------------------------------------


class TestExportProjectStatusValidation:
    """TC-052: REQ-052, REQ-080 - Non-approved project returns 400."""

    @pytest.mark.asyncio
    async def test_draft_project_returns_400(self, client, export_seed, auth_headers):
        headers = auth_headers(export_seed["user"])
        project_id = export_seed["draft_project"].id
        system_id = export_seed["active_system"].id
        response = await client.post(
            f"/api/projects/{project_id}/export",
            json={"system_ids": [system_id]},
            headers=headers,
        )
        assert response.status_code == 400
        assert "approved" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_nonexistent_project_returns_404(self, client, export_seed, auth_headers):
        headers = auth_headers(export_seed["user"])
        response = await client.post(
            "/api/projects/999999/export",
            json={"system_ids": [export_seed["active_system"].id]},
            headers=headers,
        )
        assert response.status_code == 404


# ---------------------------------------------------------------------------
# TC-055 / REQ-055: Single system returns Excel (not ZIP)
# ---------------------------------------------------------------------------


class TestExportSingleSystem:
    """TC-055: REQ-055 - Single system export returns Excel file."""

    @pytest.mark.asyncio
    async def test_single_system_returns_excel_content_type(self, client, export_seed, auth_headers):
        headers = auth_headers(export_seed["user"])
        project_id = export_seed["approved_project"].id
        system_id = export_seed["active_system"].id
        response = await client.post(
            f"/api/projects/{project_id}/export",
            json={"system_ids": [system_id]},
            headers=headers,
        )
        assert response.status_code == 200
        content_type = response.headers.get("content-type", "")
        assert "spreadsheetml" in content_type

    @pytest.mark.asyncio
    async def test_single_system_returns_non_empty_bytes(self, client, export_seed, auth_headers):
        headers = auth_headers(export_seed["user"])
        project_id = export_seed["approved_project"].id
        system_id = export_seed["active_system"].id
        response = await client.post(
            f"/api/projects/{project_id}/export",
            json={"system_ids": [system_id]},
            headers=headers,
        )
        assert response.status_code == 200
        assert len(response.content) > 0

    @pytest.mark.asyncio
    async def test_single_system_content_disposition_has_xlsx_filename(self, client, export_seed, auth_headers):
        headers = auth_headers(export_seed["user"])
        project_id = export_seed["approved_project"].id
        system_id = export_seed["active_system"].id
        response = await client.post(
            f"/api/projects/{project_id}/export",
            json={"system_ids": [system_id]},
            headers=headers,
        )
        assert response.status_code == 200
        disposition = response.headers.get("content-disposition", "")
        assert ".xlsx" in disposition


# ---------------------------------------------------------------------------
# TC-056 / REQ-056: Non-existent system_id returns 404
# ---------------------------------------------------------------------------


class TestExportNonExistentSystem:
    """TC-056: REQ-056 - Non-existent system_id returns 404."""

    @pytest.mark.asyncio
    async def test_nonexistent_system_id_returns_404(self, client, export_seed, auth_headers):
        headers = auth_headers(export_seed["user"])
        project_id = export_seed["approved_project"].id
        response = await client.post(
            f"/api/projects/{project_id}/export",
            json={"system_ids": [999999]},
            headers=headers,
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_nonexistent_system_id_in_preview_returns_404(self, client, export_seed, auth_headers):
        headers = auth_headers(export_seed["user"])
        project_id = export_seed["approved_project"].id
        response = await client.get(
            f"/api/projects/{project_id}/export/preview/999999",
            headers=headers,
        )
        assert response.status_code == 404


# ---------------------------------------------------------------------------
# TC-057 / REQ-057: Inactive system returns 400
# ---------------------------------------------------------------------------


class TestExportInactiveSystem:
    """TC-057: REQ-057 - Inactive system_id returns 400."""

    @pytest.mark.asyncio
    async def test_inactive_system_returns_400(self, client, export_seed, auth_headers):
        headers = auth_headers(export_seed["user"])
        project_id = export_seed["approved_project"].id
        inactive_id = export_seed["inactive_system"].id
        response = await client.post(
            f"/api/projects/{project_id}/export",
            json={"system_ids": [inactive_id]},
            headers=headers,
        )
        assert response.status_code == 400
        assert "inactive" in response.json()["detail"].lower()


# ---------------------------------------------------------------------------
# TC-053 / REQ-053: Preview endpoint returns first 5 rows as JSON
# ---------------------------------------------------------------------------


class TestExportPreview:
    """TC-053: REQ-053 - Preview returns first 5 rows as JSON."""

    @pytest.mark.asyncio
    async def test_preview_returns_200(self, client, export_seed, auth_headers):
        headers = auth_headers(export_seed["user"])
        project_id = export_seed["approved_project"].id
        system_id = export_seed["active_system"].id
        response = await client.get(
            f"/api/projects/{project_id}/export/preview/{system_id}",
            headers=headers,
        )
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_preview_response_structure(self, client, export_seed, auth_headers):
        headers = auth_headers(export_seed["user"])
        project_id = export_seed["approved_project"].id
        system_id = export_seed["active_system"].id
        response = await client.get(
            f"/api/projects/{project_id}/export/preview/{system_id}",
            headers=headers,
        )
        data = response.json()
        assert "system_name" in data
        assert "format_type" in data
        assert "headers" in data
        assert "rows" in data
        assert "total_rows" in data

    @pytest.mark.asyncio
    async def test_preview_rows_capped_at_5(self, client, export_seed, auth_headers):
        headers = auth_headers(export_seed["user"])
        project_id = export_seed["approved_project"].id
        system_id = export_seed["active_system"].id
        response = await client.get(
            f"/api/projects/{project_id}/export/preview/{system_id}",
            headers=headers,
        )
        data = response.json()
        # The project has 2 layers, so rows should be <= 5
        assert len(data["rows"]) <= 5

    @pytest.mark.asyncio
    async def test_preview_requires_approved_project(self, client, export_seed, auth_headers):
        headers = auth_headers(export_seed["user"])
        draft_id = export_seed["draft_project"].id
        system_id = export_seed["active_system"].id
        response = await client.get(
            f"/api/projects/{draft_id}/export/preview/{system_id}",
            headers=headers,
        )
        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_preview_nonexistent_project_returns_404(self, client, export_seed, auth_headers):
        headers = auth_headers(export_seed["user"])
        system_id = export_seed["active_system"].id
        response = await client.get(
            f"/api/projects/999999/export/preview/{system_id}",
            headers=headers,
        )
        assert response.status_code == 404


# ---------------------------------------------------------------------------
# TC-081 / REQ-081: Only mapped columns appear in output
# ---------------------------------------------------------------------------


class TestExportOnlyMappedColumns:
    """TC-081: Only columns with export mappings appear in the preview/export output."""

    @pytest.mark.asyncio
    async def test_preview_headers_contain_only_mapped_columns(self, client, export_seed, auth_headers):
        """The active system only maps SP_SPEED_rpm -> SPIN_SPEED.
        SC_ENERGY_mJ should NOT appear in headers since it has no mapping.
        """
        headers = auth_headers(export_seed["user"])
        project_id = export_seed["approved_project"].id
        system_id = export_seed["active_system"].id
        response = await client.get(
            f"/api/projects/{project_id}/export/preview/{system_id}",
            headers=headers,
        )
        data = response.json()
        resp_headers = data["headers"]
        # Mapped column should appear
        assert "SPIN_SPEED" in resp_headers
        # Unmapped column should NOT appear
        assert "SC_ENERGY_mJ" not in resp_headers
        assert "SC_ENERGY" not in resp_headers
