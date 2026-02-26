"""Device enrichment 서비스.

device_meta_source에 정의된 외부 테이블에서 추가 메타데이터를 조회하여
DeviceMaster.enrichment JSONB 필드에 저장한다.

보안 요구사항:
- 모든 테이블/컬럼명은 information_schema 대조 후 사용
- 파라미터화된 값만 사용 (문자열 보간 금지)
- 소스별 에러 격리 (한 소스 실패 시 다른 소스 계속 처리)
"""

from __future__ import annotations

import logging
import re

from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.device_master import DeviceMaster, DeviceMetaSource
from app.schemas.device_master import (
    ColumnInfo,
    EnrichmentResult,
    EnrichmentSummary,
)

logger = logging.getLogger(__name__)

_IDENTIFIER_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")


class DeviceEnrichmentService:
    """DeviceMaster enrichment 핵심 서비스."""

    # ------------------------------------------------------------------
    # 검증 헬퍼
    # ------------------------------------------------------------------

    @staticmethod
    def _validate_identifier(name: str, label: str = "identifier") -> None:
        """SQL 식별자 형식 검증.

        Raises:
            ValueError: 유효하지 않은 식별자.
        """
        if not _IDENTIFIER_RE.match(name):
            raise ValueError(f"Invalid {label}: '{name}'")

    @staticmethod
    async def _validate_table_columns(
        db: AsyncSession,
        table_name: str,
        schema_name: str,
        column_names: list[str],
    ) -> None:
        """information_schema에서 테이블과 컬럼의 존재를 검증한다.

        Raises:
            ValueError: 테이블 또는 컬럼 미존재.
        """
        tbl_result = await db.execute(
            text(
                "SELECT 1 FROM information_schema.tables "
                "WHERE table_schema = :schema AND table_name = :table"
            ),
            {"schema": schema_name, "table": table_name},
        )
        if tbl_result.fetchone() is None:
            raise ValueError(f"Table '{schema_name}.{table_name}' does not exist")

        if column_names:
            col_result = await db.execute(
                text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_schema = :schema AND table_name = :table"
                ),
                {"schema": schema_name, "table": table_name},
            )
            existing_cols = {row[0] for row in col_result.fetchall()}
            missing = [c for c in column_names if c not in existing_cols]
            if missing:
                raise ValueError(
                    f"Columns not found in '{schema_name}.{table_name}': {missing}"
                )

    # ------------------------------------------------------------------
    # 단일 디바이스 Enrichment
    # ------------------------------------------------------------------

    @staticmethod
    async def enrich_device(
        db: AsyncSession,
        device_id: int,
    ) -> EnrichmentResult:
        """단일 디바이스에 대해 모든 활성 메타 소스로부터 enrichment를 수행한다.

        결과는 device.enrichment[source_name] 에 JSONB로 저장된다.
        각 소스별 에러는 격리되어 다른 소스 처리에 영향을 주지 않는다.

        Raises:
            HTTPException 404: 디바이스 미발견.
        """
        device = await db.get(DeviceMaster, device_id)
        if not device:
            raise HTTPException(status_code=404, detail="Device master not found")

        # 활성 메타 소스 조회
        result = await db.execute(
            select(DeviceMetaSource).where(
                DeviceMetaSource.is_active == True,  # noqa: E712
            ).order_by(DeviceMetaSource.id)
        )
        meta_sources = result.scalars().all()

        sources_processed = 0
        fields_enriched: list[str] = []
        errors: list[str] = []

        # 기존 enrichment를 복사 (불변 조작)
        current_enrichment = dict(device.enrichment) if device.enrichment else {}

        for meta_src in meta_sources:
            try:
                enriched_data = await DeviceEnrichmentService._enrich_from_source(
                    db, device, meta_src,
                )
                if enriched_data is not None:
                    current_enrichment[meta_src.source_name] = enriched_data
                    fields_enriched.extend(enriched_data.keys())
                sources_processed += 1
            except Exception as exc:
                msg = f"Enrichment failed for source '{meta_src.source_name}': {exc}"
                logger.warning(msg)
                errors.append(msg)

        # enrichment JSONB 업데이트
        device.enrichment = current_enrichment
        await db.commit()

        return EnrichmentResult(
            device_id=device.id,
            product_name=device.product_name,
            sources_processed=sources_processed,
            fields_enriched=fields_enriched,
            errors=errors,
        )

    @staticmethod
    async def _enrich_from_source(
        db: AsyncSession,
        device: DeviceMaster,
        meta_src: DeviceMetaSource,
    ) -> dict | None:
        """단일 메타 소스로부터 디바이스 enrichment 데이터를 조회한다.

        Returns:
            dict: 조회된 메타데이터 ({target_field: value}), 결과 없으면 None.
        """
        # join_keys: [{device_field, source_column}, ...]
        # column_mappings: [{source_column, target_field}, ...]
        join_keys = meta_src.join_keys or []
        col_mappings = meta_src.column_mappings or []

        if not join_keys or not col_mappings:
            return None

        # 식별자 검증
        DeviceEnrichmentService._validate_identifier(meta_src.table_name, "table_name")
        DeviceEnrichmentService._validate_identifier(meta_src.schema_name, "schema_name")

        # 조회 대상 컬럼
        select_columns: list[str] = []
        target_fields: list[str] = []
        for cm in col_mappings:
            src_col = cm.get("source_column", "")
            tgt_field = cm.get("target_field", "")
            if src_col and tgt_field:
                DeviceEnrichmentService._validate_identifier(src_col, "source_column")
                select_columns.append(src_col)
                target_fields.append(tgt_field)

        # JOIN 키 컬럼
        join_source_columns: list[str] = []
        join_device_fields: list[str] = []
        for jk in join_keys:
            src_col = jk.get("source_column", "")
            dev_field = jk.get("device_field", "")
            if src_col and dev_field:
                DeviceEnrichmentService._validate_identifier(src_col, "join source_column")
                join_source_columns.append(src_col)
                join_device_fields.append(dev_field)

        all_source_cols = select_columns + join_source_columns
        await DeviceEnrichmentService._validate_table_columns(
            db, meta_src.table_name, meta_src.schema_name, all_source_cols,
        )

        # SELECT 쿼리 빌드
        col_list = ", ".join(f'"{c}"' for c in select_columns)
        where_parts: list[str] = []
        params: dict = {}
        for idx, (src_col, dev_field) in enumerate(
            zip(join_source_columns, join_device_fields)
        ):
            param_name = f"jv_{idx}"
            where_parts.append(f'"{src_col}" = :{param_name}')
            # 디바이스 필드 값 해소
            device_value = DeviceEnrichmentService._resolve_device_field(
                device, dev_field,
            )
            params[param_name] = device_value

        where_clause = " AND ".join(where_parts)
        query_str = (
            f'SELECT {col_list} FROM "{meta_src.schema_name}"."{meta_src.table_name}" '
            f"WHERE {where_clause} LIMIT 1"
        )

        result = await db.execute(text(query_str), params)
        row = result.fetchone()
        if row is None:
            return None

        return {
            tgt: row[idx] for idx, tgt in enumerate(target_fields)
            if row[idx] is not None
        }

    @staticmethod
    def _resolve_device_field(device: DeviceMaster, field_name: str) -> str | int | None:
        """디바이스 ORM 인스턴스에서 필드 값을 해소한다.

        허용 필드: product_name, process, part_id, line_id
        """
        allowed_fields = {"product_name", "process", "part_id", "line_id"}
        if field_name not in allowed_fields:
            raise ValueError(
                f"Unsupported device field '{field_name}'. "
                f"Allowed: {allowed_fields}"
            )
        return getattr(device, field_name, None)

    # ------------------------------------------------------------------
    # 전체 디바이스 Enrichment
    # ------------------------------------------------------------------

    @staticmethod
    async def enrich_all_devices(
        db: AsyncSession,
    ) -> EnrichmentSummary:
        """모든 활성 디바이스에 대해 enrichment를 수행한다."""
        result = await db.execute(
            select(DeviceMaster).where(
                DeviceMaster.is_active == True,  # noqa: E712
            ).order_by(DeviceMaster.id)
        )
        devices = result.scalars().all()

        details: list[EnrichmentResult] = []
        total_errors = 0

        for device in devices:
            try:
                er = await DeviceEnrichmentService.enrich_device(db, device.id)
                details.append(er)
                total_errors += len(er.errors)
            except Exception as exc:
                logger.warning(
                    "Enrichment failed for device %d (%s): %s",
                    device.id, device.product_name, exc,
                )
                details.append(
                    EnrichmentResult(
                        device_id=device.id,
                        product_name=device.product_name,
                        sources_processed=0,
                        fields_enriched=[],
                        errors=[str(exc)],
                    )
                )
                total_errors += 1

        return EnrichmentSummary(
            devices_enriched=len([d for d in details if d.sources_processed > 0]),
            total_errors=total_errors,
            details=details,
        )

    # ------------------------------------------------------------------
    # Column Discovery
    # ------------------------------------------------------------------

    @staticmethod
    async def discover_columns(
        db: AsyncSession,
        table_name: str,
        schema_name: str = "public",
    ) -> list[ColumnInfo]:
        """information_schema에서 지정 테이블의 컬럼 목록을 조회한다.

        Raises:
            HTTPException 400: 테이블 미존재.
        """
        # 테이블 존재 확인
        tbl_result = await db.execute(
            text(
                "SELECT 1 FROM information_schema.tables "
                "WHERE table_schema = :schema AND table_name = :table"
            ),
            {"schema": schema_name, "table": table_name},
        )
        if tbl_result.fetchone() is None:
            raise HTTPException(
                status_code=400,
                detail=f"Table '{schema_name}.{table_name}' does not exist",
            )

        result = await db.execute(
            text(
                "SELECT column_name, data_type "
                "FROM information_schema.columns "
                "WHERE table_schema = :schema AND table_name = :table "
                "ORDER BY ordinal_position"
            ),
            {"schema": schema_name, "table": table_name},
        )
        rows = result.fetchall()
        return [ColumnInfo(column_name=row[0], data_type=row[1]) for row in rows]
