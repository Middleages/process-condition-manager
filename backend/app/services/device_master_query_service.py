"""Device Master query service for SPEC-PROJECT-002.

Provides search, validation, and layer retrieval from device_master/layer_master.
"""

from __future__ import annotations

from sqlalchemy import select, and_, cast, Float
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.device_master import DeviceMaster, LayerMaster


async def search_devices(
    db: AsyncSession,
    line_id: int | None = None,
    product_name: str | None = None,
    process: str | None = None,
    part_id: str | None = None,
    limit: int = 50,
) -> list[DeviceMaster]:
    """Search device_master with cascading filters. Only active devices."""
    query = select(DeviceMaster).where(DeviceMaster.is_active == True)  # noqa: E712

    if line_id is not None:
        query = query.where(DeviceMaster.line_id == line_id)
    if product_name is not None:
        query = query.where(DeviceMaster.product_name.ilike(f"%{product_name}%"))
    if process is not None:
        query = query.where(DeviceMaster.process.ilike(f"%{process}%"))
    if part_id is not None:
        query = query.where(DeviceMaster.part_id.ilike(f"%{part_id}%"))

    query = query.order_by(DeviceMaster.product_name).limit(limit)
    result = await db.execute(query)
    return list(result.scalars().all())


async def get_device_by_ref(
    db: AsyncSession,
    line_id: int,
    product_name: str,
    process: str,
    part_id: str,
) -> DeviceMaster | None:
    """Get a device by exact device-ref combination."""
    result = await db.execute(
        select(DeviceMaster).where(
            and_(
                DeviceMaster.line_id == line_id,
                DeviceMaster.product_name == product_name,
                DeviceMaster.process == process,
                DeviceMaster.part_id == part_id,
                DeviceMaster.is_active == True,  # noqa: E712
            )
        )
    )
    return result.scalars().first()


async def get_device_layers(
    db: AsyncSession,
    device_master_id: int,
) -> list[LayerMaster]:
    """Get layers from layer_master for a device, sorted numerically by layer_id."""
    result = await db.execute(
        select(LayerMaster)
        .where(LayerMaster.device_master_id == device_master_id)
        .order_by(cast(LayerMaster.layer_id, Float))
    )
    return list(result.scalars().all())


async def get_device_header(
    db: AsyncSession,
    device_master_id: int,
) -> dict | None:
    """Get header metadata (enrichment JSONB) from device_master."""
    device = await db.get(DeviceMaster, device_master_id)
    if device is None:
        return None
    return device.enrichment
