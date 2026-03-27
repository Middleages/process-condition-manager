import logging

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import ExportSystem, ExportColumnMapping, Project, ProjectLayer
from app.schemas.export import (
    ExportValidationIssue,
    ExportValidationResponse,
    ExportValidationSystemResult,
)

logger = logging.getLogger(__name__)

NUMERIC_DATA_TYPES = {"integer", "float"}


class ExportValidationService:
    """Validates export readiness for project condition data against export system mappings."""

    @classmethod
    async def validate(
        cls,
        db: AsyncSession,
        project_id: int,
        system_ids: list[int],
    ) -> ExportValidationResponse:
        """Validate project condition data against one or more export systems.

        For each system, runs error checks (required columns, invalid mapping)
        and warning checks (non-numeric values in numeric columns, high null rate).

        Raises HTTPException 404 if the project does not exist.
        """
        # Verify project exists
        project = await db.get(Project, project_id)
        if not project:
            raise HTTPException(status_code=404, detail=f"Project {project_id} not found")

        # Load all project layers once
        layers = await cls._get_project_layers(db, project_id)

        results: list[ExportValidationSystemResult] = []
        for system_id in system_ids:
            result = await cls._validate_system(db, system_id, layers)
            results.append(result)

        total_errors = sum(r.error_count for r in results)
        total_warnings = sum(r.warning_count for r in results)

        return ExportValidationResponse(
            results=results,
            has_errors=total_errors > 0,
            total_errors=total_errors,
            total_warnings=total_warnings,
        )

    # --- Private helpers ---

    @classmethod
    async def _get_project_layers(
        cls, db: AsyncSession, project_id: int
    ) -> list[ProjectLayer]:
        """Fetch all project layers with layer info eagerly loaded."""
        query = (
            select(ProjectLayer)
            .where(ProjectLayer.project_id == project_id)
            .order_by(ProjectLayer.sort_order)
        )
        result = await db.execute(query)
        return list(result.scalars().all())

    @classmethod
    async def _get_export_system(
        cls, db: AsyncSession, system_id: int
    ) -> ExportSystem | None:
        """Fetch export system by ID."""
        query = select(ExportSystem).where(ExportSystem.id == system_id)
        result = await db.execute(query)
        return result.scalar_one_or_none()

    @classmethod
    async def _get_column_mappings(
        cls, db: AsyncSession, system_id: int
    ) -> list[ExportColumnMapping]:
        """Fetch column mappings for a system with column_definition and data_source eagerly loaded."""
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

    @classmethod
    async def _validate_system(
        cls,
        db: AsyncSession,
        system_id: int,
        layers: list[ProjectLayer],
    ) -> ExportValidationSystemResult:
        """Run all validation checks for a single export system."""
        system = await cls._get_export_system(db, system_id)
        if not system:
            # Return an error result when the system itself cannot be found
            return ExportValidationSystemResult(
                system_id=system_id,
                system_name=f"Unknown (id={system_id})",
                error_count=1,
                warning_count=0,
                issues=[
                    ExportValidationIssue(
                        level="error",
                        layer_name="",
                        column_name="",
                        message=f"Export system {system_id} does not exist",
                    )
                ],
            )

        mappings = await cls._get_column_mappings(db, system_id)
        issues: list[ExportValidationIssue] = []

        # --- Validate condition-type mappings ---
        condition_mappings = [m for m in mappings if m.source_type == "condition"]

        for mapping in condition_mappings:
            column_def = mapping.column_definition

            # ERROR: mapping references a column that no longer exists in column_definitions
            if column_def is None:
                issues.append(
                    ExportValidationIssue(
                        level="error",
                        layer_name="",
                        column_name=str(mapping.column_id),
                        message=(
                            f"매핑된 컬럼 ID {mapping.column_id}이 존재하지 않습니다"
                        ),
                    )
                )
                continue

            col_name = column_def.column_name
            display_name = column_def.display_name or col_name
            is_numeric = column_def.data_type in NUMERIC_DATA_TYPES

            for pl in layers:
                layer_name = pl.layer_name or str(pl.id)
                conditions = pl.conditions or {}
                raw_value = conditions.get(col_name)

                # Normalise: treat empty string same as None
                is_empty = raw_value is None or (
                    isinstance(raw_value, str) and raw_value.strip() == ""
                )

                # ERROR: required column is empty
                if mapping.is_required and is_empty:
                    issues.append(
                        ExportValidationIssue(
                            level="error",
                            layer_name=layer_name,
                            column_name=display_name,
                            message=(
                                f"필수 컬럼 '{display_name}' 값이 비어있습니다"
                            ),
                        )
                    )

                # WARNING: numeric column contains a non-numeric value
                if is_numeric and not is_empty:
                    str_value = str(raw_value)
                    try:
                        float(str_value)
                    except (ValueError, TypeError):
                        issues.append(
                            ExportValidationIssue(
                                level="warning",
                                layer_name=layer_name,
                                column_name=display_name,
                                message=(
                                    f"숫자 타입 컬럼 '{display_name}'에 "
                                    f"비숫자 값 '{str_value}'이 있습니다"
                                ),
                            )
                        )

        # --- Validate external-type mappings ---
        external_mappings = [m for m in mappings if m.source_type == "external"]

        for mapping in external_mappings:
            # ERROR: data source is missing entirely
            if mapping.data_source is None:
                issues.append(
                    ExportValidationIssue(
                        level="error",
                        layer_name="",
                        column_name=mapping.source_column_name or "",
                        message=(
                            f"외부 데이터 소스가 존재하지 않습니다 (ID: {mapping.data_source_id})"
                        ),
                    )
                )
                continue

            # WARNING: data source is inactive
            if not mapping.data_source.is_active:
                issues.append(
                    ExportValidationIssue(
                        level="warning",
                        layer_name="",
                        column_name=mapping.source_column_name or "",
                        message=(
                            f"외부 데이터 소스 '{mapping.data_source.source_name}'"
                            f"이 비활성 상태입니다"
                        ),
                    )
                )

        # WARNING: per-layer missing data rate > 50% (condition mappings only)
        if condition_mappings:
            for pl in layers:
                layer_name = pl.layer_name or str(pl.id)
                conditions = pl.conditions or {}
                empty_count = sum(
                    1
                    for m in condition_mappings
                    if m.column_definition is not None
                    and cls._is_empty(conditions.get(m.column_definition.column_name))
                )
                total_mapped = sum(
                    1 for m in condition_mappings if m.column_definition is not None
                )
                if total_mapped > 0:
                    missing_pct = (empty_count / total_mapped) * 100
                    if missing_pct > 50:
                        issues.append(
                            ExportValidationIssue(
                                level="warning",
                                layer_name=layer_name,
                                column_name="",
                                message=(
                                    f"데이터 누락률이 {missing_pct:.0f}%입니다"
                                ),
                            )
                        )

        error_count = sum(1 for i in issues if i.level == "error")
        warning_count = sum(1 for i in issues if i.level == "warning")

        return ExportValidationSystemResult(
            system_id=system_id,
            system_name=system.system_name,
            error_count=error_count,
            warning_count=warning_count,
            issues=issues,
        )

    @staticmethod
    def _is_empty(value: object) -> bool:
        """Return True when a conditions value is considered empty (None or blank string)."""
        if value is None:
            return True
        if isinstance(value, str) and value.strip() == "":
            return True
        return False
