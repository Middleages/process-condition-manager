"""Service layer for EquipmentAssignment CRUD operations."""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException

from app.models.export import EquipmentAssignment
from app.models.project import Project, ProjectLayer
from app.schemas.equipment import EquipmentCreate, EquipmentUpdate


class EquipmentService:
    """Handles CRUD and reordering of EquipmentAssignment records."""

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    async def _check_project_editable(db: AsyncSession, project_id: int) -> Project:
        """Return the Project if it exists and is in an editable state.

        Raises:
            HTTPException 404: Project not found.
            HTTPException 403: Project is approved or archived.
        """
        project = await db.get(Project, project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        if project.status in ("approved", "archived"):
            raise HTTPException(
                status_code=403,
                detail="Cannot modify equipment for approved/archived projects",
            )
        return project

    @staticmethod
    async def _get_project_layer(
        db: AsyncSession, project_id: int, layer_id: int
    ) -> ProjectLayer:
        """Return the ProjectLayer linking *project_id* and *layer_id*.

        Raises:
            HTTPException 404: No matching project_layer found.
        """
        stmt = select(ProjectLayer).where(
            ProjectLayer.project_id == project_id,
            ProjectLayer.layer_id == layer_id,
        )
        project_layer = (await db.execute(stmt)).scalar_one_or_none()
        if not project_layer:
            raise HTTPException(
                status_code=404,
                detail=f"Layer {layer_id} not found in project {project_id}",
            )
        return project_layer

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------

    @staticmethod
    async def list_equipment(
        db: AsyncSession, project_id: int, layer_id: int
    ) -> list[EquipmentAssignment]:
        """Return all equipment assignments for a project-layer, ordered by sort_order."""
        stmt = select(ProjectLayer).where(
            ProjectLayer.project_id == project_id,
            ProjectLayer.layer_id == layer_id,
        )
        project_layer = (await db.execute(stmt)).scalar_one_or_none()
        if not project_layer:
            raise HTTPException(
                status_code=404,
                detail=f"Layer {layer_id} not found in project {project_id}",
            )

        eq_stmt = (
            select(EquipmentAssignment)
            .where(EquipmentAssignment.project_layer_id == project_layer.id)
            .order_by(EquipmentAssignment.sort_order)
        )
        result = await db.execute(eq_stmt)
        return list(result.scalars().all())

    @staticmethod
    async def create_equipment(
        db: AsyncSession,
        project_id: int,
        layer_id: int,
        data: EquipmentCreate,
    ) -> EquipmentAssignment:
        """Create a new equipment assignment for a project-layer.

        Auto-assigns sort_order as max(current) + 1, or 0 if none exist.
        """
        await EquipmentService._check_project_editable(db, project_id)
        project_layer = await EquipmentService._get_project_layer(db, project_id, layer_id)

        # Determine next sort_order
        max_order_result = await db.execute(
            select(func.max(EquipmentAssignment.sort_order)).where(
                EquipmentAssignment.project_layer_id == project_layer.id
            )
        )
        current_max = max_order_result.scalar()
        next_order = (current_max + 1) if current_max is not None else 0

        equipment = EquipmentAssignment(
            project_layer_id=project_layer.id,
            equipment_id=data.equipment_id,
            equipment_params=data.equipment_params,
            sort_order=next_order,
        )
        db.add(equipment)
        await db.commit()
        await db.refresh(equipment)
        return equipment

    @staticmethod
    async def update_equipment(
        db: AsyncSession,
        project_id: int,
        layer_id: int,
        eq_id: int,
        data: EquipmentUpdate,
    ) -> EquipmentAssignment:
        """Update an existing equipment assignment.

        Only non-None fields in *data* are applied.

        Raises:
            HTTPException 404: Equipment not found or does not belong to this project-layer.
        """
        await EquipmentService._check_project_editable(db, project_id)
        project_layer = await EquipmentService._get_project_layer(db, project_id, layer_id)

        equipment = (
            await db.execute(
                select(EquipmentAssignment).where(
                    EquipmentAssignment.id == eq_id,
                    EquipmentAssignment.project_layer_id == project_layer.id,
                )
            )
        ).scalar_one_or_none()
        if not equipment:
            raise HTTPException(
                status_code=404,
                detail=f"Equipment assignment {eq_id} not found",
            )

        if data.equipment_id is not None:
            equipment.equipment_id = data.equipment_id
        if data.equipment_params is not None:
            equipment.equipment_params = data.equipment_params

        await db.commit()
        await db.refresh(equipment)
        return equipment

    @staticmethod
    async def delete_equipment(
        db: AsyncSession,
        project_id: int,
        layer_id: int,
        eq_id: int,
    ) -> None:
        """Delete an equipment assignment.

        Raises:
            HTTPException 404: Equipment not found.
        """
        await EquipmentService._check_project_editable(db, project_id)
        project_layer = await EquipmentService._get_project_layer(db, project_id, layer_id)

        equipment = (
            await db.execute(
                select(EquipmentAssignment).where(
                    EquipmentAssignment.id == eq_id,
                    EquipmentAssignment.project_layer_id == project_layer.id,
                )
            )
        ).scalar_one_or_none()
        if not equipment:
            raise HTTPException(
                status_code=404,
                detail=f"Equipment assignment {eq_id} not found",
            )

        await db.delete(equipment)
        await db.commit()

    @staticmethod
    async def reorder_equipment(
        db: AsyncSession,
        project_id: int,
        layer_id: int,
        ordered_ids: list[int],
    ) -> list[EquipmentAssignment]:
        """Reassign sort_order based on the position of each id in *ordered_ids*.

        Returns the updated list in the new order.

        Raises:
            HTTPException 404: Any of the provided ids not found in this project-layer.
        """
        await EquipmentService._check_project_editable(db, project_id)
        project_layer = await EquipmentService._get_project_layer(db, project_id, layer_id)

        # Fetch all referenced assignments in one query
        stmt = select(EquipmentAssignment).where(
            EquipmentAssignment.id.in_(ordered_ids),
            EquipmentAssignment.project_layer_id == project_layer.id,
        )
        result = await db.execute(stmt)
        assignments = {eq.id: eq for eq in result.scalars().all()}

        # Validate all ids were found
        missing = [eid for eid in ordered_ids if eid not in assignments]
        if missing:
            raise HTTPException(
                status_code=404,
                detail=f"Equipment assignment(s) not found: {missing}",
            )

        # Update sort_order according to position
        for position, eq_id in enumerate(ordered_ids):
            assignments[eq_id].sort_order = position

        await db.commit()

        # Return in new order
        for eq in assignments.values():
            await db.refresh(eq)

        return [assignments[eid] for eid in ordered_ids]
