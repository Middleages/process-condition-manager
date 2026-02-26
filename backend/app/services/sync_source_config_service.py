"""SyncSourceConfig CRUD 서비스.

동기화 소스 테이블 설정의 CRUD 및 테이블 존재 검증을 담당한다.
ExportDataSourceService 패턴을 따른다.
"""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.device_master import SyncSourceConfig
from app.schemas.device_master import (
    SyncSourceConfigCreate,
    SyncSourceConfigResponse,
    SyncSourceConfigUpdate,
)


class SyncSourceConfigService:
    """동기화 소스 설정 CRUD + 테이블 검증 서비스."""

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
    def _to_response(config: SyncSourceConfig) -> SyncSourceConfigResponse:
        """ORM 인스턴스를 응답 스키마로 변환한다."""
        return SyncSourceConfigResponse(
            id=config.id,
            source_type=config.source_type,
            source_name=config.source_name,
            table_name=config.table_name,
            schema_name=config.schema_name,
            column_mappings=config.column_mappings or [],
            description=config.description,
            is_active=config.is_active,
            created_at=config.created_at,
            updated_at=config.updated_at,
        )

    # ------------------------------------------------------------------
    # List
    # ------------------------------------------------------------------

    @staticmethod
    async def list_configs(
        db: AsyncSession,
        source_type: str | None = None,
    ) -> list[SyncSourceConfigResponse]:
        """동기화 소스 설정 목록 조회. source_type으로 선택적 필터링."""
        stmt = select(SyncSourceConfig).order_by(SyncSourceConfig.id)
        if source_type is not None:
            stmt = stmt.where(SyncSourceConfig.source_type == source_type)
        result = await db.execute(stmt)
        configs = result.scalars().all()
        return [SyncSourceConfigService._to_response(c) for c in configs]

    # ------------------------------------------------------------------
    # Create
    # ------------------------------------------------------------------

    @staticmethod
    async def create_config(
        db: AsyncSession,
        data: SyncSourceConfigCreate,
    ) -> SyncSourceConfigResponse:
        """동기화 소스 설정 생성.

        Raises:
            HTTPException 409: (source_type, source_name) 중복.
            HTTPException 400: 참조 테이블 미존재.
        """
        # 중복 검사
        existing = await db.execute(
            select(SyncSourceConfig).where(
                SyncSourceConfig.source_type == data.source_type,
                SyncSourceConfig.source_name == data.source_name,
            )
        )
        if existing.scalar_one_or_none():
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Sync source config with type '{data.source_type}' "
                    f"and name '{data.source_name}' already exists"
                ),
            )

        # 테이블 존재 검증
        await SyncSourceConfigService._validate_table_exists(
            db, data.table_name, data.schema_name,
        )

        config = SyncSourceConfig(
            source_type=data.source_type,
            source_name=data.source_name,
            table_name=data.table_name,
            schema_name=data.schema_name,
            column_mappings=data.column_mappings,
            description=data.description,
            is_active=data.is_active,
        )
        db.add(config)
        await db.commit()
        await db.refresh(config)
        return SyncSourceConfigService._to_response(config)

    # ------------------------------------------------------------------
    # Update
    # ------------------------------------------------------------------

    @staticmethod
    async def update_config(
        db: AsyncSession,
        config_id: int,
        data: SyncSourceConfigUpdate,
    ) -> SyncSourceConfigResponse:
        """동기화 소스 설정 수정.

        Raises:
            HTTPException 404: 설정 미발견.
            HTTPException 409: 변경된 source_name이 기존 레코드와 충돌.
            HTTPException 400: 변경된 테이블 미존재.
        """
        config = await db.get(SyncSourceConfig, config_id)
        if not config:
            raise HTTPException(status_code=404, detail="Sync source config not found")

        # source_name 변경 시 중복 검사
        if data.source_name is not None and data.source_name != config.source_name:
            conflict = await db.execute(
                select(SyncSourceConfig).where(
                    SyncSourceConfig.source_type == config.source_type,
                    SyncSourceConfig.source_name == data.source_name,
                )
            )
            if conflict.scalar_one_or_none():
                raise HTTPException(
                    status_code=409,
                    detail=f"Sync source config name '{data.source_name}' already exists for type '{config.source_type}'",
                )

        # 테이블 변경 시 존재 검증
        new_table = data.table_name if data.table_name is not None else config.table_name
        new_schema = data.schema_name if data.schema_name is not None else config.schema_name
        table_changed = (
            (data.table_name is not None and data.table_name != config.table_name)
            or (data.schema_name is not None and data.schema_name != config.schema_name)
        )
        if table_changed:
            await SyncSourceConfigService._validate_table_exists(db, new_table, new_schema)

        # 필드 업데이트
        if data.source_name is not None:
            config.source_name = data.source_name
        if data.table_name is not None:
            config.table_name = data.table_name
        if data.schema_name is not None:
            config.schema_name = data.schema_name
        if data.column_mappings is not None:
            config.column_mappings = data.column_mappings
        if data.description is not None:
            config.description = data.description
        if data.is_active is not None:
            config.is_active = data.is_active

        await db.commit()
        await db.refresh(config)
        return SyncSourceConfigService._to_response(config)

    # ------------------------------------------------------------------
    # Delete
    # ------------------------------------------------------------------

    @staticmethod
    async def delete_config(
        db: AsyncSession,
        config_id: int,
    ) -> dict[str, str]:
        """동기화 소스 설정 삭제 (hard delete).

        Raises:
            HTTPException 404: 설정 미발견.
        """
        config = await db.get(SyncSourceConfig, config_id)
        if not config:
            raise HTTPException(status_code=404, detail="Sync source config not found")

        await db.delete(config)
        await db.commit()
        return {"action": "deleted", "id": str(config_id)}
