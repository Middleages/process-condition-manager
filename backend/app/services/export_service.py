import io
import logging
import zipfile
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import (
    ExportSystem, ExportColumnMapping, Project, ProjectLayer,
)
from app.services import export_builders
from app.services.export_builders import sanitize_filename

logger = logging.getLogger(__name__)


class ExportService:
    """Generates Excel exports for approved project condition tables."""

    # --- Public API ---

    async def list_systems(self, db: AsyncSession) -> list[dict]:
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
        product_name = self._resolve_product_name(project)

        # Fetch external data if any external-type mappings exist
        external_data: dict[int, dict[str, dict[str, Any]]] = {}
        if any(m.source_type == "external" for m in mappings):
            external_data = await self._get_external_data(db, project, layers_data, mappings)

        if system.format_type == "TYPE_A":
            excel_bytes = export_builders.generate_type_a(
                product_name, layers_data, mappings, external_data
            )
        elif system.format_type == "TYPE_B":
            # EQP 컬럼 기반 설비 분할: additional_config에서 equip_vary_mapping 읽음
            excel_bytes = export_builders.generate_type_b(
                product_name, layers_data, mappings, system.additional_config, external_data
            )
        elif system.format_type == "TYPE_C":
            unit_mappings = (system.additional_config or {}).get("unit_mappings", {})
            excel_bytes = export_builders.generate_type_c(
                product_name, layers_data, mappings, unit_mappings, external_data
            )
        else:
            raise HTTPException(status_code=422, detail=f"Unknown format type: {system.format_type}")

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
        product_name = self._resolve_product_name(project)

        # Fetch external data if any external-type mappings exist
        external_data: dict[int, dict[str, dict[str, Any]]] = {}
        if any(m.source_type == "external" for m in mappings):
            external_data = await self._get_external_data(db, project, layers_data, mappings)

        if system.format_type == "TYPE_A":
            headers, all_rows = export_builders.build_type_a_data(
                product_name, layers_data, mappings, external_data
            )
        elif system.format_type == "TYPE_B":
            # EQP 컬럼 기반 설비 분할: additional_config에서 equip_vary_mapping 읽음
            headers, all_rows = export_builders.build_type_b_data(
                product_name, layers_data, mappings, system.additional_config, external_data
            )
        elif system.format_type == "TYPE_C":
            unit_mappings = (system.additional_config or {}).get("unit_mappings", {})
            headers, all_rows = export_builders.build_type_c_data(
                product_name, layers_data, mappings, unit_mappings, external_data
            )
        else:
            raise HTTPException(status_code=422, detail=f"Unknown format type: {system.format_type}")

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
        product_name = self._resolve_product_name(project)

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
            raise HTTPException(status_code=404, detail=f"Project {project_id} not found")
        return project

    @staticmethod
    def _resolve_product_name(project: Project) -> str:
        """Resolve product name for both V1 (product FK) and V2 (device-ref) projects."""
        if project.product_name:
            return project.product_name
        if project.product:
            return project.product.product_name
        return "Unknown"

    async def _get_export_system(self, db: AsyncSession, system_id: int) -> ExportSystem:
        """Fetch export system by ID."""
        query = select(ExportSystem).where(ExportSystem.id == system_id)
        result = await db.execute(query)
        system = result.scalar_one_or_none()
        if not system:
            raise HTTPException(status_code=404, detail=f"Export system {system_id} not found")
        return system

    async def _get_column_mappings(
        self, db: AsyncSession, system_id: int
    ) -> list[ExportColumnMapping]:
        """Fetch column mappings for a system, eagerly loading column_definition and data_source."""
        query = (
            select(ExportColumnMapping)
            .where(ExportColumnMapping.export_system_id == system_id)
            .options(
                selectinload(ExportColumnMapping.column_definition),
                selectinload(ExportColumnMapping.data_source),
            )
            .order_by(ExportColumnMapping.sort_order)
        )
        result = await db.execute(query)
        return list(result.scalars().all())

    async def _get_project_layers(
        self, db: AsyncSession, project_id: int
    ) -> list[ProjectLayer]:
        """Fetch project layers ordered by sort_order."""
        query = (
            select(ProjectLayer)
            .where(ProjectLayer.project_id == project_id)
            .order_by(ProjectLayer.sort_order)
        )
        result = await db.execute(query)
        return list(result.scalars().all())

    async def _get_external_data(
        self,
        db: AsyncSession,
        project: Project,
        layers: list[ProjectLayer],
        mappings: list[ExportColumnMapping],
    ) -> dict[int, dict[str, dict[str, Any]]]:
        """Fetch external data for all external-type mappings.

        Returns: {data_source_id: {layer_id_str: {column_name: value}}}
        where layer_id_str is str(ProjectLayer.id).

        Strategy: Group external mappings by data_source_id, then for each
        data source execute a single batch query using an IN clause.
        Error resilience: if a source fails to fetch, log a warning and continue.
        """
        # Group mappings by data_source_id
        source_to_columns: dict[int, set[str]] = {}
        for m in mappings:
            if m.source_type != "external" or m.data_source is None:
                continue
            ds_id = m.data_source_id
            if ds_id is None:
                continue
            if ds_id not in source_to_columns:
                source_to_columns[ds_id] = set()
            if m.source_column_name:
                source_to_columns[ds_id].add(m.source_column_name)

        result: dict[int, dict[str, dict[str, Any]]] = {}

        for ds_id, needed_col_names in source_to_columns.items():
            # Retrieve the data source object from the first matching mapping
            ds = next(
                (m.data_source for m in mappings if m.data_source_id == ds_id and m.data_source is not None),
                None,
            )
            if ds is None:
                logger.warning("External data source id=%s not found in loaded mappings, skipping", ds_id)
                continue

            table_name = ds.table_name
            schema_name = ds.schema_name or "public"
            join_key_mappings = ds.join_key_mappings or []

            try:
                # Validate table exists via information_schema (SQL injection prevention)
                table_check = await db.execute(
                    text(
                        "SELECT 1 FROM information_schema.tables "
                        "WHERE table_schema = :s AND table_name = :t"
                    ),
                    {"s": schema_name, "t": table_name},
                )
                if not table_check.fetchone():
                    logger.warning(
                        "External table %s.%s does not exist, skipping data source id=%s",
                        schema_name, table_name, ds_id,
                    )
                    continue

                # Validate columns exist
                valid_cols_result = await db.execute(
                    text(
                        "SELECT column_name FROM information_schema.columns "
                        "WHERE table_schema = :s AND table_name = :t"
                    ),
                    {"s": schema_name, "t": table_name},
                )
                valid_columns: set[str] = {r[0] for r in valid_cols_result.fetchall()}

                # Collect all column names we need: join key columns + data columns
                join_key_ext_cols: list[str] = [
                    jk["external_column"] for jk in join_key_mappings if "external_column" in jk
                ]
                needed_cols = [c for c in needed_col_names if c in valid_columns]
                # Include join key columns (needed for result mapping back to layers)
                select_cols = list(
                    {c for c in join_key_ext_cols + needed_cols if c in valid_columns}
                )
                if not select_cols:
                    logger.warning(
                        "No valid columns to select from %s.%s, skipping data source id=%s",
                        schema_name, table_name, ds_id,
                    )
                    continue

                # Build safe column list using double-quoted identifiers
                quoted_select = ", ".join(f'"{c}"' for c in select_cols)

                # Build WHERE clause using join keys with IN for batch fetch
                # We need to handle multi-column join keys.
                # Strategy: fetch rows that match ANY of the layers and filter in Python.
                # For each join key, collect the set of values across all layers.
                bind_params: dict[str, Any] = {}
                where_parts: list[str] = []

                for jk in join_key_mappings:
                    ext_col = jk.get("external_column")
                    pcm_field = jk.get("pcm_field")
                    if not ext_col or not pcm_field or ext_col not in valid_columns:
                        continue

                    # Resolve pcm_field values across all layers
                    values: list[Any] = []
                    for pl in layers:
                        val = self._resolve_pcm_field(pcm_field, project, pl)
                        if val is not None:
                            values.append(val)

                    if not values:
                        continue

                    unique_values = list(set(values))
                    param_key = f"vals_{ext_col}"
                    bind_params[param_key] = tuple(unique_values)
                    where_parts.append(f'"{ext_col}" = ANY(:{param_key})')

                if not where_parts:
                    logger.warning(
                        "No valid join key conditions for %s.%s, skipping data source id=%s",
                        schema_name, table_name, ds_id,
                    )
                    continue

                where_clause = " AND ".join(where_parts)
                sql = text(
                    f'SELECT {quoted_select} FROM "{schema_name}"."{table_name}" WHERE {where_clause}'
                )

                rows_result = await db.execute(sql, bind_params)
                fetched_rows = rows_result.mappings().fetchall()

                # Map fetched rows back to layer IDs
                ds_layer_map: dict[str, dict[str, Any]] = {}
                for pl in layers:
                    # Try to find the matching row for this layer
                    for fetched_row in fetched_rows:
                        match = True
                        for jk in join_key_mappings:
                            ext_col = jk.get("external_column")
                            pcm_field = jk.get("pcm_field")
                            if not ext_col or not pcm_field or ext_col not in valid_columns:
                                continue
                            expected = self._resolve_pcm_field(pcm_field, project, pl)
                            actual = fetched_row.get(ext_col)
                            # Compare as strings to handle type mismatches (int vs str)
                            if str(expected) != str(actual):
                                match = False
                                break
                        if match:
                            layer_key = str(pl.id)
                            ds_layer_map[layer_key] = dict(fetched_row)
                            break

                result[ds_id] = ds_layer_map

            except Exception as exc:
                logger.warning(
                    "Failed to fetch external data from %s.%s (data_source_id=%s): %s",
                    schema_name, table_name, ds_id, exc,
                )

        return result

    @staticmethod
    def _resolve_pcm_field(pcm_field: str, project: Project, pl: ProjectLayer) -> Any:
        """Resolve a pcm_field reference to its actual value.

        Supported pcm_field values:
          - 'project.product_id'  -> project.product_id (int)
          - 'layer.step_seq'      -> pl.step_seq
          - 'layer.layer_name'    -> pl.layer_name
          - 'layer.layer_number'  -> pl.layer_id (layer_id IS now layer_number)
        """
        if pcm_field == "project.product_id":
            return project.product_id
        if pcm_field == "layer.step_seq":
            return pl.step_seq
        if pcm_field == "layer.layer_name":
            return pl.layer_name
        if pcm_field == "layer.layer_number":
            return pl.layer_id
        return None

    # --- Type A/B/C wrappers (delegate to export_builders) ---

    def _build_type_a_data(
        self, product_name: str, layers: list[ProjectLayer],
        mappings: list[ExportColumnMapping],
        external_data: dict[int, dict[str, dict[str, Any]]] | None = None,
    ) -> tuple[list[str], list[dict]]:
        return export_builders.build_type_a_data(product_name, layers, mappings, external_data)

    def _generate_type_a(
        self, product_name: str, layers: list[ProjectLayer],
        mappings: list[ExportColumnMapping],
        external_data: dict[int, dict[str, dict[str, Any]]] | None = None,
    ) -> bytes:
        return export_builders.generate_type_a(product_name, layers, mappings, external_data)

    def _build_type_b_data(
        self, product_name: str, layers: list[ProjectLayer],
        mappings: list[ExportColumnMapping],
        system_config: dict | None = None,
        external_data: dict[int, dict[str, dict[str, Any]]] | None = None,
    ) -> tuple[list[str], list[dict]]:
        """Type B 출력 데이터 생성. EQP 컬럼 기반 설비 분할 방식 사용."""
        return export_builders.build_type_b_data(product_name, layers, mappings, system_config, external_data)

    def _generate_type_b(
        self, product_name: str, layers: list[ProjectLayer],
        mappings: list[ExportColumnMapping],
        system_config: dict | None = None,
        external_data: dict[int, dict[str, dict[str, Any]]] | None = None,
    ) -> bytes:
        """Type B Excel 파일 생성. EQP 컬럼 기반 설비 분할 방식 사용."""
        return export_builders.generate_type_b(product_name, layers, mappings, system_config, external_data)

    def _build_type_c_data(
        self, product_name: str, layers: list[ProjectLayer],
        mappings: list[ExportColumnMapping],
        unit_mappings: dict[str, str],
        external_data: dict[int, dict[str, dict[str, Any]]] | None = None,
    ) -> tuple[list[str], list[dict]]:
        return export_builders.build_type_c_data(product_name, layers, mappings, unit_mappings, external_data)

    def _generate_type_c(
        self, product_name: str, layers: list[ProjectLayer],
        mappings: list[ExportColumnMapping],
        unit_mappings: dict[str, str],
        external_data: dict[int, dict[str, dict[str, Any]]] | None = None,
    ) -> bytes:
        return export_builders.generate_type_c(product_name, layers, mappings, unit_mappings, external_data)

    def _write_excel(self, headers: list[str], rows: list[dict]) -> bytes:
        return export_builders.write_excel(headers, rows)
