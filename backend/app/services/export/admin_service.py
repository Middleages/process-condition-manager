"""Admin service for ExportSystem and ExportColumnMapping CRUD operations."""

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from fastapi import HTTPException

from app.models.export import ExportSystem, ExportColumnMapping
from app.models.column import ColumnDefinition
from app.models.export_data_source import ExportDataSource
from app.schemas.export_admin import (
    ExportSystemCreate,
    ExportSystemUpdate,
    ExportMappingCreate,
    ExportMappingUpdate,
    ExportSystemAdminResponse,
    ExportMappingResponse,
)


class ExportAdminService:
    """CRUD service for export system and mapping administration."""

    # ---------------------------------------------------------------------------
    # Internal helpers
    # ---------------------------------------------------------------------------

    @staticmethod
    async def _validate_external_source(
        db: AsyncSession,
        data_source_id: int,
        source_column_name: str,
    ) -> ExportDataSource:
        """Validate that the data source is active and the column exists in its table.

        Raises:
            HTTPException 404: If data source not found.
            HTTPException 400: If data source is inactive.
            HTTPException 400: If source_column_name does not exist in the external table.
        """
        source = await db.get(ExportDataSource, data_source_id)
        if not source:
            raise HTTPException(status_code=404, detail="Data source not found")
        if not source.is_active:
            raise HTTPException(
                status_code=400,
                detail=f"Data source '{source.source_name}' is not active",
            )

        # Validate that source_column_name exists in the external table via information_schema
        result = await db.execute(
            text(
                "SELECT 1 FROM information_schema.columns "
                "WHERE table_schema = :schema AND table_name = :table "
                "AND column_name = :column"
            ),
            {
                "schema": source.schema_name,
                "table": source.table_name,
                "column": source_column_name,
            },
        )
        if result.fetchone() is None:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Column '{source_column_name}' does not exist in "
                    f"'{source.schema_name}.{source.table_name}'"
                ),
            )

        return source

    @staticmethod
    def _build_mapping_response(m: ExportColumnMapping) -> ExportMappingResponse:
        """Build ExportMappingResponse from an ORM instance with loaded relationships."""
        if m.source_type == "condition":
            column_name = m.column_definition.column_name if m.column_definition else None
            category_code = (
                m.column_definition.category.category_code
                if m.column_definition and m.column_definition.category
                else None
            )
            return ExportMappingResponse(
                id=m.id,
                source_type=m.source_type,
                column_id=m.column_id,
                column_name=column_name,
                category_code=category_code,
                data_source_id=None,
                data_source_name=None,
                source_column_name=None,
                target_column_name=m.target_column_name,
                sort_order=m.sort_order,
                is_required=m.is_required,
            )
        else:
            # source_type == 'external'
            data_source_name = m.data_source.source_name if m.data_source else None
            return ExportMappingResponse(
                id=m.id,
                source_type=m.source_type,
                column_id=None,
                column_name=None,
                category_code=None,
                data_source_id=m.data_source_id,
                data_source_name=data_source_name,
                source_column_name=m.source_column_name,
                target_column_name=m.target_column_name,
                sort_order=m.sort_order,
                is_required=m.is_required,
            )

    # ---------------------------------------------------------------------------
    # System CRUD
    # ---------------------------------------------------------------------------

    @staticmethod
    async def list_systems(db: AsyncSession) -> list[ExportSystemAdminResponse]:
        """Return all export systems (including inactive) ordered by id with column_count."""
        stmt = (
            select(ExportSystem)
            .options(selectinload(ExportSystem.column_mappings))
            .order_by(ExportSystem.id)
        )
        result = await db.execute(stmt)
        systems = result.scalars().all()

        return [
            ExportSystemAdminResponse(
                id=s.id,
                system_name=s.system_name,
                format_type=s.format_type,
                description=s.description,
                additional_config=s.additional_config,
                is_active=s.is_active,
                created_at=s.created_at,
                column_count=len(s.column_mappings),
            )
            for s in systems
        ]

    @staticmethod
    async def create_system(
        db: AsyncSession,
        data: ExportSystemCreate,
    ) -> ExportSystem:
        """Create a new export system, raising 409 if system_name already exists."""
        existing = await db.execute(
            select(ExportSystem).where(ExportSystem.system_name == data.system_name)
        )
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="System name already exists")

        system = ExportSystem(
            system_name=data.system_name,
            format_type=data.format_type,
            description=data.description,
            additional_config=data.additional_config,
            is_active=data.is_active,
        )
        db.add(system)
        await db.commit()
        await db.refresh(system)
        return system

    @staticmethod
    async def update_system(
        db: AsyncSession,
        system_id: int,
        data: ExportSystemUpdate,
    ) -> ExportSystem:
        """Update an existing export system. Raises 404 if not found, 409 on name conflict."""
        system = await db.get(ExportSystem, system_id)
        if not system:
            raise HTTPException(status_code=404, detail="Export system not found")

        # Check system_name uniqueness only when name is being changed
        if data.system_name is not None and data.system_name != system.system_name:
            existing = await db.execute(
                select(ExportSystem).where(ExportSystem.system_name == data.system_name)
            )
            if existing.scalar_one_or_none():
                raise HTTPException(status_code=409, detail="System name already exists")

        # Apply only provided (non-None) fields
        if data.system_name is not None:
            system.system_name = data.system_name
        if data.format_type is not None:
            system.format_type = data.format_type
        if data.description is not None:
            system.description = data.description
        if data.additional_config is not None:
            system.additional_config = data.additional_config
        if data.is_active is not None:
            system.is_active = data.is_active

        await db.commit()
        await db.refresh(system)
        return system

    @staticmethod
    async def delete_system(db: AsyncSession, system_id: int) -> None:
        """Delete an export system. Raises 404 if not found. CASCADE removes mappings."""
        system = await db.get(ExportSystem, system_id)
        if not system:
            raise HTTPException(status_code=404, detail="Export system not found")

        await db.delete(system)
        await db.commit()

    # ---------------------------------------------------------------------------
    # Mapping CRUD
    # ---------------------------------------------------------------------------

    @staticmethod
    async def list_mappings(
        db: AsyncSession,
        system_id: int,
    ) -> list[ExportMappingResponse]:
        """Return mappings for a system ordered by sort_order.

        Joins with column_definition (for condition mappings) and data_source
        (for external mappings) to populate response fields.
        """
        system = await db.get(ExportSystem, system_id)
        if not system:
            raise HTTPException(status_code=404, detail="Export system not found")

        stmt = (
            select(ExportColumnMapping)
            .where(ExportColumnMapping.export_system_id == system_id)
            .options(
                selectinload(ExportColumnMapping.column_definition).selectinload(
                    ColumnDefinition.category
                ),
                selectinload(ExportColumnMapping.data_source),
            )
            .order_by(ExportColumnMapping.sort_order)
        )
        result = await db.execute(stmt)
        mappings = result.scalars().all()

        return [
            ExportAdminService._build_mapping_response(m)
            for m in mappings
        ]

    @staticmethod
    async def create_mapping(
        db: AsyncSession,
        system_id: int,
        data: ExportMappingCreate,
    ) -> ExportColumnMapping:
        """Create a new column mapping for the given system.

        Supports two source types:
        - 'condition': maps a PCM condition column (requires column_id).
        - 'external': maps a column from an external data source (requires
          data_source_id + source_column_name, validated via information_schema).

        Auto-assigns sort_order as max existing + 1 (or 0 if first).
        """
        system = await db.get(ExportSystem, system_id)
        if not system:
            raise HTTPException(status_code=404, detail="Export system not found")

        # Auto-assign sort_order as max existing + 1 (or 0 if first)
        max_result = await db.execute(
            select(func.max(ExportColumnMapping.sort_order)).where(
                ExportColumnMapping.export_system_id == system_id
            )
        )
        max_order = max_result.scalar_one_or_none()
        next_order = (max_order + 1) if max_order is not None else 0

        if data.source_type == "condition":
            # Validate that the column_definition exists
            col = await db.get(ColumnDefinition, data.column_id)
            if not col:
                raise HTTPException(
                    status_code=404,
                    detail=f"Column definition {data.column_id} not found",
                )
            mapping = ExportColumnMapping(
                export_system_id=system_id,
                source_type="condition",
                column_id=data.column_id,
                data_source_id=None,
                source_column_name=None,
                target_column_name=data.target_column_name,
                sort_order=next_order,
                is_required=data.is_required,
            )
        else:
            # source_type == 'external'
            await ExportAdminService._validate_external_source(
                db, data.data_source_id, data.source_column_name
            )
            mapping = ExportColumnMapping(
                export_system_id=system_id,
                source_type="external",
                column_id=None,
                data_source_id=data.data_source_id,
                source_column_name=data.source_column_name,
                target_column_name=data.target_column_name,
                sort_order=next_order,
                is_required=data.is_required,
            )

        db.add(mapping)
        await db.commit()
        await db.refresh(mapping)
        return mapping

    @staticmethod
    async def update_mapping(
        db: AsyncSession,
        system_id: int,
        mapping_id: int,
        data: ExportMappingUpdate,
    ) -> ExportColumnMapping:
        """Update a column mapping. Raises 404 if system or mapping not found.

        When source_type changes, re-validates the new source fields.
        """
        system = await db.get(ExportSystem, system_id)
        if not system:
            raise HTTPException(status_code=404, detail="Export system not found")

        mapping = await db.get(ExportColumnMapping, mapping_id)
        if not mapping or mapping.export_system_id != system_id:
            raise HTTPException(status_code=404, detail="Export mapping not found")

        # Apply common fields
        if data.target_column_name is not None:
            mapping.target_column_name = data.target_column_name
        if data.is_required is not None:
            mapping.is_required = data.is_required

        # Handle source_type change or external field updates
        if data.source_type is not None and data.source_type != mapping.source_type:
            # Source type is changing — validate and switch
            if data.source_type == "condition":
                # Switching to condition: column_id must already be set or provided
                # Since ExportMappingUpdate does not carry column_id, this path
                # would leave column_id NULL; caller should use create_mapping instead.
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Cannot switch source_type to 'condition' via update. "
                        "Delete and recreate the mapping with the correct source_type."
                    ),
                )
            elif data.source_type == "external":
                # Switching to external: data_source_id + source_column_name required
                if data.data_source_id is None or not data.source_column_name:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            "data_source_id and source_column_name are required "
                            "when switching source_type to 'external'"
                        ),
                    )
                await ExportAdminService._validate_external_source(
                    db, data.data_source_id, data.source_column_name
                )
                mapping.source_type = "external"
                mapping.column_id = None
                mapping.data_source_id = data.data_source_id
                mapping.source_column_name = data.source_column_name
            else:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid source_type: '{data.source_type}'",
                )
        elif mapping.source_type == "external":
            # Same source type = 'external'; allow updating data_source_id / source_column_name
            new_ds_id = data.data_source_id if data.data_source_id is not None else mapping.data_source_id
            new_col_name = data.source_column_name if data.source_column_name is not None else mapping.source_column_name
            if data.data_source_id is not None or data.source_column_name is not None:
                await ExportAdminService._validate_external_source(
                    db, new_ds_id, new_col_name
                )
                mapping.data_source_id = new_ds_id
                mapping.source_column_name = new_col_name

        await db.commit()
        await db.refresh(mapping)
        return mapping

    @staticmethod
    async def delete_mapping(
        db: AsyncSession,
        system_id: int,
        mapping_id: int,
    ) -> None:
        """Delete a column mapping. Raises 404 if system or mapping not found."""
        system = await db.get(ExportSystem, system_id)
        if not system:
            raise HTTPException(status_code=404, detail="Export system not found")

        mapping = await db.get(ExportColumnMapping, mapping_id)
        if not mapping or mapping.export_system_id != system_id:
            raise HTTPException(status_code=404, detail="Export mapping not found")

        await db.delete(mapping)
        await db.commit()

    @staticmethod
    async def reorder_mappings(
        db: AsyncSession,
        system_id: int,
        ordered_ids: list[int],
    ) -> list[ExportMappingResponse]:
        """Reorder mappings by updating sort_order based on position in ordered_ids list."""
        system = await db.get(ExportSystem, system_id)
        if not system:
            raise HTTPException(status_code=404, detail="Export system not found")

        # Fetch all mappings for this system at once
        stmt = (
            select(ExportColumnMapping)
            .where(ExportColumnMapping.export_system_id == system_id)
            .options(
                selectinload(ExportColumnMapping.column_definition).selectinload(
                    ColumnDefinition.category
                ),
                selectinload(ExportColumnMapping.data_source),
            )
        )
        result = await db.execute(stmt)
        mappings = result.scalars().all()
        mapping_by_id = {m.id: m for m in mappings}

        # Update sort_order for each mapping based on position in ordered_ids
        for position, mapping_id in enumerate(ordered_ids):
            mapping = mapping_by_id.get(mapping_id)
            if mapping:
                mapping.sort_order = position

        await db.commit()

        # Return in new order
        updated = sorted(
            [mapping_by_id[mid] for mid in ordered_ids if mid in mapping_by_id],
            key=lambda m: m.sort_order,
        )

        return [
            ExportAdminService._build_mapping_response(m)
            for m in updated
        ]
