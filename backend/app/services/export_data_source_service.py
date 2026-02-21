"""Service for ExportDataSource CRUD and external table introspection."""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.export_data_source import ExportDataSource
from app.schemas.export_data_source import (
    ColumnInfo,
    ExportDataSourceCreate,
    ExportDataSourceResponse,
    ExportDataSourceUpdate,
)


class ExportDataSourceService:
    """CRUD + table-introspection service for external data source registration."""

    # ---------------------------------------------------------------------------
    # Internal helpers
    # ---------------------------------------------------------------------------

    @staticmethod
    async def _validate_table_exists(
        db: AsyncSession,
        table_name: str,
        schema_name: str,
    ) -> None:
        """Raise 400 if the specified table does not exist in information_schema."""
        result = await db.execute(
            text(
                "SELECT 1 FROM information_schema.tables "
                "WHERE table_schema = :schema AND table_name = :table"
            ),
            {"schema": schema_name, "table": table_name},
        )
        if result.fetchone() is None:
            raise HTTPException(
                status_code=400,
                detail=f"Table '{schema_name}.{table_name}' does not exist in the database",
            )

    @staticmethod
    def _to_response(source: ExportDataSource) -> ExportDataSourceResponse:
        """Convert ORM instance to response schema."""
        mappings = source.join_key_mappings or []
        return ExportDataSourceResponse(
            id=source.id,
            source_name=source.source_name,
            table_name=source.table_name,
            schema_name=source.schema_name,
            description=source.description,
            join_key_mappings=mappings,
            is_active=source.is_active,
            created_at=source.created_at,
            updated_at=source.updated_at,
            mapping_count=len(mappings),
        )

    # ---------------------------------------------------------------------------
    # List
    # ---------------------------------------------------------------------------

    @staticmethod
    async def list_sources(db: AsyncSession) -> list[ExportDataSourceResponse]:
        """Return all data sources ordered by id."""
        result = await db.execute(
            select(ExportDataSource).order_by(ExportDataSource.id)
        )
        sources = result.scalars().all()
        return [ExportDataSourceService._to_response(s) for s in sources]

    # ---------------------------------------------------------------------------
    # Create
    # ---------------------------------------------------------------------------

    @staticmethod
    async def create_source(
        db: AsyncSession,
        data: ExportDataSourceCreate,
    ) -> ExportDataSourceResponse:
        """Create a new external data source entry.

        Raises:
            HTTPException 409: If source_name already exists.
            HTTPException 400: If the referenced table does not exist.
        """
        # Duplicate name check
        existing = await db.execute(
            select(ExportDataSource).where(ExportDataSource.source_name == data.source_name)
        )
        if existing.scalar_one_or_none():
            raise HTTPException(
                status_code=409,
                detail=f"Data source name '{data.source_name}' already exists",
            )

        # Table existence validation
        await ExportDataSourceService._validate_table_exists(
            db, data.table_name, data.schema_name
        )

        source = ExportDataSource(
            source_name=data.source_name,
            table_name=data.table_name,
            schema_name=data.schema_name,
            description=data.description,
            join_key_mappings=[m.model_dump() for m in data.join_key_mappings],
            is_active=data.is_active,
        )
        db.add(source)
        await db.commit()
        await db.refresh(source)
        return ExportDataSourceService._to_response(source)

    # ---------------------------------------------------------------------------
    # Update
    # ---------------------------------------------------------------------------

    @staticmethod
    async def update_source(
        db: AsyncSession,
        source_id: int,
        data: ExportDataSourceUpdate,
    ) -> ExportDataSourceResponse:
        """Update an existing data source.

        Raises:
            HTTPException 404: If source not found.
            HTTPException 409: If new source_name already belongs to another record.
            HTTPException 400: If the new table does not exist.
        """
        source = await db.get(ExportDataSource, source_id)
        if not source:
            raise HTTPException(status_code=404, detail="Data source not found")

        # Unique name check only when name is actually changing
        if data.source_name is not None and data.source_name != source.source_name:
            conflict = await db.execute(
                select(ExportDataSource).where(
                    ExportDataSource.source_name == data.source_name
                )
            )
            if conflict.scalar_one_or_none():
                raise HTTPException(
                    status_code=409,
                    detail=f"Data source name '{data.source_name}' already exists",
                )

        # Determine effective table/schema for validation
        new_table = data.table_name if data.table_name is not None else source.table_name
        new_schema = data.schema_name if data.schema_name is not None else source.schema_name
        table_changed = (
            (data.table_name is not None and data.table_name != source.table_name)
            or (data.schema_name is not None and data.schema_name != source.schema_name)
        )
        if table_changed:
            await ExportDataSourceService._validate_table_exists(db, new_table, new_schema)

        # Apply updates
        if data.source_name is not None:
            source.source_name = data.source_name
        if data.table_name is not None:
            source.table_name = data.table_name
        if data.schema_name is not None:
            source.schema_name = data.schema_name
        if data.description is not None:
            source.description = data.description
        if data.join_key_mappings is not None:
            source.join_key_mappings = [m.model_dump() for m in data.join_key_mappings]
        if data.is_active is not None:
            source.is_active = data.is_active

        await db.commit()
        await db.refresh(source)
        return ExportDataSourceService._to_response(source)

    # ---------------------------------------------------------------------------
    # Delete (soft / hard)
    # ---------------------------------------------------------------------------

    @staticmethod
    async def delete_source(db: AsyncSession, source_id: int) -> dict[str, str]:
        """Delete or soft-delete a data source.

        Performs hard delete when no export_column_mappings reference this source.
        Falls back to soft delete (is_active=False) when mappings exist.

        Raises:
            HTTPException 404: If source not found.
        """
        source = await db.get(ExportDataSource, source_id)
        if not source:
            raise HTTPException(status_code=404, detail="Data source not found")

        # Check whether any export column mappings reference this data source.
        # M2 will add data_source_id FK to ExportColumnMapping; until then,
        # check for the FK column if it exists, otherwise hard delete is safe.
        has_references = False
        try:
            ref_result = await db.execute(
                text(
                    "SELECT 1 FROM export_column_mappings "
                    "WHERE data_source_id = :sid LIMIT 1"
                ),
                {"sid": source_id},
            )
            has_references = ref_result.fetchone() is not None
        except Exception:
            # Column doesn't exist yet (pre-M2 migration) → no references
            pass

        if has_references:
            # Soft delete: mark inactive to preserve referential integrity
            source.is_active = False
            await db.commit()
            return {"action": "soft_deleted", "id": str(source_id)}

        # Hard delete
        await db.delete(source)
        await db.commit()
        return {"action": "deleted", "id": str(source_id)}

    # ---------------------------------------------------------------------------
    # Column discovery
    # ---------------------------------------------------------------------------

    @staticmethod
    async def discover_columns(
        db: AsyncSession,
        source_id: int,
    ) -> list[ColumnInfo]:
        """Query information_schema.columns for columns of the registered table.

        Raises:
            HTTPException 404: If source not found.
            HTTPException 400: If the table no longer exists.
        """
        source = await db.get(ExportDataSource, source_id)
        if not source:
            raise HTTPException(status_code=404, detail="Data source not found")

        # Verify table still exists before querying columns
        await ExportDataSourceService._validate_table_exists(
            db, source.table_name, source.schema_name
        )

        result = await db.execute(
            text(
                "SELECT column_name, data_type "
                "FROM information_schema.columns "
                "WHERE table_schema = :schema AND table_name = :table "
                "ORDER BY ordinal_position"
            ),
            {"schema": source.schema_name, "table": source.table_name},
        )
        rows = result.fetchall()
        return [ColumnInfo(column_name=row[0], data_type=row[1]) for row in rows]
