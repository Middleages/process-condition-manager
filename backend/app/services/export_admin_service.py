"""Admin service for ExportSystem and ExportColumnMapping CRUD operations."""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from fastapi import HTTPException

from app.models.export import ExportSystem, ExportColumnMapping
from app.models.column import ColumnDefinition
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
        """Return mappings for a system ordered by sort_order, joined with column info."""
        system = await db.get(ExportSystem, system_id)
        if not system:
            raise HTTPException(status_code=404, detail="Export system not found")

        stmt = (
            select(ExportColumnMapping)
            .where(ExportColumnMapping.export_system_id == system_id)
            .options(
                selectinload(ExportColumnMapping.column_definition).selectinload(
                    ColumnDefinition.category
                )
            )
            .order_by(ExportColumnMapping.sort_order)
        )
        result = await db.execute(stmt)
        mappings = result.scalars().all()

        return [
            ExportMappingResponse(
                id=m.id,
                column_id=m.column_id,
                column_name=m.column_definition.column_name,
                category_code=(
                    m.column_definition.category.category_code
                    if m.column_definition.category
                    else None
                ),
                target_column_name=m.target_column_name,
                sort_order=m.sort_order,
                is_required=m.is_required,
            )
            for m in mappings
        ]

    @staticmethod
    async def create_mapping(
        db: AsyncSession,
        system_id: int,
        data: ExportMappingCreate,
    ) -> ExportColumnMapping:
        """Create a new column mapping for the given system. Auto-assigns sort_order."""
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

        mapping = ExportColumnMapping(
            export_system_id=system_id,
            column_id=data.column_id,
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
        """Update a column mapping. Raises 404 if system or mapping not found."""
        system = await db.get(ExportSystem, system_id)
        if not system:
            raise HTTPException(status_code=404, detail="Export system not found")

        mapping = await db.get(ExportColumnMapping, mapping_id)
        if not mapping or mapping.export_system_id != system_id:
            raise HTTPException(status_code=404, detail="Export mapping not found")

        if data.target_column_name is not None:
            mapping.target_column_name = data.target_column_name
        if data.is_required is not None:
            mapping.is_required = data.is_required

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
                )
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
            ExportMappingResponse(
                id=m.id,
                column_id=m.column_id,
                column_name=m.column_definition.column_name,
                category_code=(
                    m.column_definition.category.category_code
                    if m.column_definition.category
                    else None
                ),
                target_column_name=m.target_column_name,
                sort_order=m.sort_order,
                is_required=m.is_required,
            )
            for m in updated
        ]
