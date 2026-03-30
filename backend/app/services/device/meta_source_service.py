"""DeviceMetaSource CRUD 서비스.

디바이스 enrichment용 외부 메타 소스 설정의 CRUD 및 테이블 존재 검증을 담당한다.
"""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.device_master import DeviceMetaSource
from app.schemas.device_master import (
    DeviceMetaSourceCreate,
    DeviceMetaSourceResponse,
    DeviceMetaSourceUpdate,
)


class DeviceMetaSourceService:
    """DeviceMetaSource CRUD + 테이블 검증 서비스."""

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    async def _validate_table_exists(
        db: AsyncSession,
        table_name: str,
        schema_name: str,
    ) -> None:
        """information_schema에서 테이블 존재 여부를 확인한다.

        Raises:
            HTTPException 400: 테이블이 존재하지 않을 때.
        """
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
    def _to_response(source: DeviceMetaSource) -> DeviceMetaSourceResponse:
        """ORM 인스턴스를 응답 스키마로 변환한다."""
        return DeviceMetaSourceResponse(
            id=source.id,
            source_name=source.source_name,
            table_name=source.table_name,
            schema_name=source.schema_name,
            join_keys=source.join_keys or [],
            column_mappings=source.column_mappings or [],
            description=source.description,
            is_active=source.is_active,
            created_at=source.created_at,
            updated_at=source.updated_at,
        )

    # ------------------------------------------------------------------
    # List
    # ------------------------------------------------------------------

    @staticmethod
    async def list_sources(db: AsyncSession) -> list[DeviceMetaSourceResponse]:
        """메타 소스 목록 조회 (id 순)."""
        result = await db.execute(
            select(DeviceMetaSource).order_by(DeviceMetaSource.id)
        )
        sources = result.scalars().all()
        return [DeviceMetaSourceService._to_response(s) for s in sources]

    # ------------------------------------------------------------------
    # Create
    # ------------------------------------------------------------------

    @staticmethod
    async def create_source(
        db: AsyncSession,
        data: DeviceMetaSourceCreate,
    ) -> DeviceMetaSourceResponse:
        """메타 소스 생성.

        Raises:
            HTTPException 409: source_name 중복.
            HTTPException 400: 참조 테이블 미존재.
        """
        existing = await db.execute(
            select(DeviceMetaSource).where(
                DeviceMetaSource.source_name == data.source_name,
            )
        )
        if existing.scalar_one_or_none():
            raise HTTPException(
                status_code=409,
                detail=f"Device meta source '{data.source_name}' already exists",
            )

        await DeviceMetaSourceService._validate_table_exists(
            db, data.table_name, data.schema_name,
        )

        source = DeviceMetaSource(
            source_name=data.source_name,
            table_name=data.table_name,
            schema_name=data.schema_name,
            join_keys=data.join_keys,
            column_mappings=data.column_mappings,
            description=data.description,
            is_active=data.is_active,
        )
        db.add(source)
        await db.commit()
        await db.refresh(source)
        return DeviceMetaSourceService._to_response(source)

    # ------------------------------------------------------------------
    # Update
    # ------------------------------------------------------------------

    @staticmethod
    async def update_source(
        db: AsyncSession,
        meta_source_id: int,
        data: DeviceMetaSourceUpdate,
    ) -> DeviceMetaSourceResponse:
        """메타 소스 수정.

        Raises:
            HTTPException 404: 미발견.
            HTTPException 409: source_name 충돌.
            HTTPException 400: 테이블 미존재.
        """
        source = await db.get(DeviceMetaSource, meta_source_id)
        if not source:
            raise HTTPException(status_code=404, detail="Device meta source not found")

        if data.source_name is not None and data.source_name != source.source_name:
            conflict = await db.execute(
                select(DeviceMetaSource).where(
                    DeviceMetaSource.source_name == data.source_name,
                )
            )
            if conflict.scalar_one_or_none():
                raise HTTPException(
                    status_code=409,
                    detail=f"Device meta source '{data.source_name}' already exists",
                )

        new_table = data.table_name if data.table_name is not None else source.table_name
        new_schema = data.schema_name if data.schema_name is not None else source.schema_name
        table_changed = (
            (data.table_name is not None and data.table_name != source.table_name)
            or (data.schema_name is not None and data.schema_name != source.schema_name)
        )
        if table_changed:
            await DeviceMetaSourceService._validate_table_exists(db, new_table, new_schema)

        if data.source_name is not None:
            source.source_name = data.source_name
        if data.table_name is not None:
            source.table_name = data.table_name
        if data.schema_name is not None:
            source.schema_name = data.schema_name
        if data.join_keys is not None:
            source.join_keys = data.join_keys
        if data.column_mappings is not None:
            source.column_mappings = data.column_mappings
        if data.description is not None:
            source.description = data.description
        if data.is_active is not None:
            source.is_active = data.is_active

        await db.commit()
        await db.refresh(source)
        return DeviceMetaSourceService._to_response(source)

    # ------------------------------------------------------------------
    # Delete
    # ------------------------------------------------------------------

    @staticmethod
    async def delete_source(
        db: AsyncSession,
        meta_source_id: int,
    ) -> dict[str, str]:
        """메타 소스 삭제 (hard delete).

        Raises:
            HTTPException 404: 미발견.
        """
        source = await db.get(DeviceMetaSource, meta_source_id)
        if not source:
            raise HTTPException(status_code=404, detail="Device meta source not found")

        await db.delete(source)
        await db.commit()
        return {"action": "deleted", "id": str(meta_source_id)}

