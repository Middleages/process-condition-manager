import io
import logging
import zipfile

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import (
    ExportSystem, ExportColumnMapping, Project, ProjectLayer,
    EquipmentAssignment,
)
from app.services import export_builders
from app.services.export_builders import sanitize_filename

logger = logging.getLogger(__name__)


class ExportService:
    """Generates Excel exports for approved project condition tables."""

    # --- Public API ---

    async def get_systems(self, db: AsyncSession) -> list[dict]:
        """Return all active export systems with column mapping counts."""
        query = (
            select(ExportSystem)
            .where(ExportSystem.is_active.is_(True))
            .options(selectinload(ExportSystem.column_mappings))
            .order_by(ExportSystem.system_name)
        )
        result = await db.execute(query)
        systems = result.scalars().all()
        return [
            {
                "id": s.id,
                "system_name": s.system_name,
                "format_type": s.format_type,
                "description": s.description,
                "column_count": len(s.column_mappings),
                "is_active": s.is_active,
            }
            for s in systems
        ]

    async def generate(
        self, db: AsyncSession, project_id: int, system_id: int
    ) -> tuple[bytes, str]:
        """Generate Excel bytes for a single system export.
        Returns (excel_bytes, filename).
        """
        project = await self._get_project(db, project_id)
        system = await self._get_export_system(db, system_id)
        mappings = await self._get_column_mappings(db, system_id)
        layers_data = await self._get_project_layers(db, project_id)
        product_name = project.product.product_name

        if system.format_type == "TYPE_A":
            excel_bytes = export_builders.generate_type_a(product_name, layers_data, mappings)
        elif system.format_type == "TYPE_B":
            equipment = await self._get_equipment_assignments(db, [pl.id for pl in layers_data])
            excel_bytes = export_builders.generate_type_b(product_name, layers_data, mappings, equipment)
        elif system.format_type == "TYPE_C":
            unit_mappings = (system.additional_config or {}).get("unit_mappings", {})
            excel_bytes = export_builders.generate_type_c(product_name, layers_data, mappings, unit_mappings)
        else:
            raise ValueError(f"Unknown format type: {system.format_type}")

        filename = f"{sanitize_filename(product_name)}_{sanitize_filename(system.system_name)}.xlsx"
        return excel_bytes, filename

    async def generate_preview(
        self, db: AsyncSession, project_id: int, system_id: int, limit: int = 5
    ) -> dict:
        """Generate preview data (first N rows) as JSON."""
        project = await self._get_project(db, project_id)
        system = await self._get_export_system(db, system_id)
        mappings = await self._get_column_mappings(db, system_id)
        layers_data = await self._get_project_layers(db, project_id)
        product_name = project.product.product_name

        if system.format_type == "TYPE_A":
            headers, all_rows = export_builders.build_type_a_data(product_name, layers_data, mappings)
        elif system.format_type == "TYPE_B":
            equipment = await self._get_equipment_assignments(db, [pl.id for pl in layers_data])
            headers, all_rows = export_builders.build_type_b_data(product_name, layers_data, mappings, equipment)
        elif system.format_type == "TYPE_C":
            unit_mappings = (system.additional_config or {}).get("unit_mappings", {})
            headers, all_rows = export_builders.build_type_c_data(product_name, layers_data, mappings, unit_mappings)
        else:
            raise ValueError(f"Unknown format type: {system.format_type}")

        return {
            "system_name": system.system_name,
            "format_type": system.format_type,
            "headers": headers,
            "rows": all_rows[:limit],
            "total_rows": len(all_rows),
        }

    async def generate_bulk(
        self, db: AsyncSession, project_id: int, system_ids: list[int]
    ) -> tuple[bytes, str]:
        """Generate ZIP file containing Excel files for multiple systems.
        Returns (zip_bytes, filename).
        """
        project = await self._get_project(db, project_id)
        product_name = project.product.product_name

        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            for sid in system_ids:
                excel_bytes, fname = await self.generate(db, project_id, sid)
                zf.writestr(fname, excel_bytes)

        from datetime import datetime
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        zip_filename = f"{sanitize_filename(product_name)}_export_{timestamp}.zip"
        return zip_buffer.getvalue(), zip_filename

    # --- Data Retrieval Helpers ---

    async def _get_project(self, db: AsyncSession, project_id: int) -> Project:
        """Fetch project with product info."""
        query = (
            select(Project)
            .where(Project.id == project_id)
            .options(selectinload(Project.product))
        )
        result = await db.execute(query)
        project = result.scalar_one_or_none()
        if not project:
            raise ValueError(f"Project {project_id} not found")
        return project

    async def _get_export_system(self, db: AsyncSession, system_id: int) -> ExportSystem:
        """Fetch export system by ID."""
        query = select(ExportSystem).where(ExportSystem.id == system_id)
        result = await db.execute(query)
        system = result.scalar_one_or_none()
        if not system:
            raise ValueError(f"Export system {system_id} not found")
        return system

    async def _get_column_mappings(
        self, db: AsyncSession, system_id: int
    ) -> list[ExportColumnMapping]:
        """Fetch column mappings for a system, eagerly loading column_definition."""
        query = (
            select(ExportColumnMapping)
            .where(ExportColumnMapping.export_system_id == system_id)
            .options(selectinload(ExportColumnMapping.column_definition))
            .order_by(ExportColumnMapping.sort_order)
        )
        result = await db.execute(query)
        return list(result.scalars().all())

    async def _get_project_layers(
        self, db: AsyncSession, project_id: int
    ) -> list[ProjectLayer]:
        """Fetch project layers with layer info, ordered by sort_order."""
        query = (
            select(ProjectLayer)
            .where(ProjectLayer.project_id == project_id)
            .options(selectinload(ProjectLayer.layer))
            .order_by(ProjectLayer.sort_order)
        )
        result = await db.execute(query)
        return list(result.scalars().all())

    async def _get_equipment_assignments(
        self, db: AsyncSession, project_layer_ids: list[int]
    ) -> dict[int, list[EquipmentAssignment]]:
        """Fetch equipment assignments grouped by project_layer_id."""
        if not project_layer_ids:
            return {}
        query = (
            select(EquipmentAssignment)
            .where(EquipmentAssignment.project_layer_id.in_(project_layer_ids))
            .order_by(EquipmentAssignment.project_layer_id, EquipmentAssignment.sort_order)
        )
        result = await db.execute(query)
        assignments = result.scalars().all()

        grouped: dict[int, list[EquipmentAssignment]] = {}
        for a in assignments:
            grouped.setdefault(a.project_layer_id, []).append(a)
        return grouped

    # --- Type A/B/C wrappers (delegate to export_builders) ---

    def _build_type_a_data(
        self, product_name: str, layers: list[ProjectLayer],
        mappings: list[ExportColumnMapping]
    ) -> tuple[list[str], list[dict]]:
        return export_builders.build_type_a_data(product_name, layers, mappings)

    def _generate_type_a(
        self, product_name: str, layers: list[ProjectLayer],
        mappings: list[ExportColumnMapping]
    ) -> bytes:
        return export_builders.generate_type_a(product_name, layers, mappings)

    def _build_type_b_data(
        self, product_name: str, layers: list[ProjectLayer],
        mappings: list[ExportColumnMapping],
        equipment: dict[int, list[EquipmentAssignment]]
    ) -> tuple[list[str], list[dict]]:
        return export_builders.build_type_b_data(product_name, layers, mappings, equipment)

    def _generate_type_b(
        self, product_name: str, layers: list[ProjectLayer],
        mappings: list[ExportColumnMapping],
        equipment: dict[int, list[EquipmentAssignment]]
    ) -> bytes:
        return export_builders.generate_type_b(product_name, layers, mappings, equipment)

    def _build_type_c_data(
        self, product_name: str, layers: list[ProjectLayer],
        mappings: list[ExportColumnMapping],
        unit_mappings: dict[str, str]
    ) -> tuple[list[str], list[dict]]:
        return export_builders.build_type_c_data(product_name, layers, mappings, unit_mappings)

    def _generate_type_c(
        self, product_name: str, layers: list[ProjectLayer],
        mappings: list[ExportColumnMapping],
        unit_mappings: dict[str, str]
    ) -> bytes:
        return export_builders.generate_type_c(product_name, layers, mappings, unit_mappings)

    def _write_excel(self, headers: list[str], rows: list[dict]) -> bytes:
        return export_builders.write_excel(headers, rows)
