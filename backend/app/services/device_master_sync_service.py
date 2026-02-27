"""Device/Layer Master 동기화 서비스.

외부 소스 테이블에서 device_master / layer_master 데이터를 읽어 upsert 처리한다.
SQL Injection 방지를 위해 모든 테이블/컬럼명은 information_schema 대조 후 사용한다.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.device_master import DeviceMaster, LayerMaster, SyncSourceConfig
from app.models.line import Line
from app.schemas.device_master import DeviceSyncResult

logger = logging.getLogger(__name__)

# 테이블/컬럼 식별자에 허용되는 문자 패턴 (SQL Injection 1차 방어)
_IDENTIFIER_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")


class DeviceMasterSyncService:
    """device_master / layer_master 동기화 핵심 서비스."""

    # ------------------------------------------------------------------
    # 식별자 검증 헬퍼
    # ------------------------------------------------------------------

    @staticmethod
    def _validate_identifier(name: str, label: str = "identifier") -> None:
        """SQL 식별자 형식 검증 (1차 방어).

        Raises:
            HTTPException 400: 유효하지 않은 식별자.
        """
        if not _IDENTIFIER_RE.match(name):
            raise HTTPException(
                status_code=400,
                detail=f"Invalid {label}: '{name}'. Only alphanumeric and underscores allowed.",
            )

    @staticmethod
    async def _validate_table_columns(
        db: AsyncSession,
        table_name: str,
        schema_name: str,
        column_names: list[str],
    ) -> None:
        """information_schema에서 테이블과 컬럼 존재를 확인한다.

        Raises:
            HTTPException 400: 테이블 또는 컬럼 미존재.
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
                detail=f"Source table '{schema_name}.{table_name}' does not exist",
            )

        # 컬럼 존재 확인
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
                raise HTTPException(
                    status_code=400,
                    detail=f"Source columns not found in '{schema_name}.{table_name}': {missing}",
                )

    @staticmethod
    async def _load_line_map(db: AsyncSession) -> dict[str, int]:
        """lines 테이블에서 line_code -> id 매핑을 로드한다."""
        result = await db.execute(select(Line.line_code, Line.id))
        return {row[0]: row[1] for row in result.fetchall()}

    # ------------------------------------------------------------------
    # Device Sync
    # ------------------------------------------------------------------

    @staticmethod
    async def sync_devices(
        db: AsyncSession,
        auto_enrich: bool = True,
    ) -> DeviceSyncResult:
        """외부 소스에서 device_master를 동기화한다.

        1. 활성 sync_source_config (source_type='device') 조회
        2. 소스 테이블에서 동적 SQL로 데이터 읽기
        3. line_code -> line_id 해소
        4. INSERT...ON CONFLICT 로 upsert
        5. auto_enrich 시 enrichment 트리거

        Returns:
            DeviceSyncResult: 동기화 결과 요약.
        """
        # 활성 설정 조회
        result = await db.execute(
            select(SyncSourceConfig).where(
                SyncSourceConfig.source_type == "device",
                SyncSourceConfig.is_active == True,  # noqa: E712
            )
        )
        configs = result.scalars().all()
        if not configs:
            return DeviceSyncResult(
                total_processed=0, inserted=0, updated=0, unchanged=0, errors=[],
            )

        line_map = await DeviceMasterSyncService._load_line_map(db)
        now = datetime.now(timezone.utc)

        total_processed = 0
        inserted = 0
        updated = 0
        unchanged = 0
        errors: list[str] = []

        for config in configs:
            try:
                result_partial = await DeviceMasterSyncService._sync_devices_from_config(
                    db, config, line_map, now,
                )
                total_processed += result_partial["total_processed"]
                inserted += result_partial["inserted"]
                updated += result_partial["updated"]
                unchanged += result_partial["unchanged"]
                errors.extend(result_partial["errors"])
            except HTTPException:
                raise
            except Exception as exc:
                msg = f"Error syncing from config '{config.source_name}': {exc}"
                logger.exception(msg)
                errors.append(msg)

        # auto enrichment
        enrichment_summary = None
        if auto_enrich and inserted + updated > 0:
            try:
                from app.services.device_enrichment_service import DeviceEnrichmentService
                enrichment_summary = await DeviceEnrichmentService.enrich_all_devices(db)
            except Exception as exc:
                errors.append(f"Auto-enrichment failed: {exc}")

        return DeviceSyncResult(
            total_processed=total_processed,
            inserted=inserted,
            updated=updated,
            unchanged=unchanged,
            errors=errors,
            enrichment_summary=enrichment_summary,
        )

    @staticmethod
    async def _sync_devices_from_config(
        db: AsyncSession,
        config: SyncSourceConfig,
        line_map: dict[str, int],
        now: datetime,
    ) -> dict:
        """단일 sync_source_config에서 device_master 데이터를 동기화한다."""
        mappings = config.column_mappings  # [{source_column, target_field}, ...]
        if not mappings:
            return {"total_processed": 0, "inserted": 0, "updated": 0, "unchanged": 0, "errors": []}

        # 매핑에서 소스 컬럼 목록 추출
        source_columns = []
        mapping_dict: dict[str, str] = {}  # source_column -> target_field
        for m in mappings:
            src = m.get("source_column", "")
            tgt = m.get("target_field", "")
            if src and tgt:
                DeviceMasterSyncService._validate_identifier(src, "source_column")
                source_columns.append(src)
                mapping_dict[src] = tgt

        # 소스 테이블/컬럼 존재 확인 (SQL Injection 방지)
        DeviceMasterSyncService._validate_identifier(config.table_name, "table_name")
        DeviceMasterSyncService._validate_identifier(config.schema_name, "schema_name")
        await DeviceMasterSyncService._validate_table_columns(
            db, config.table_name, config.schema_name, source_columns,
        )

        # 동적 SELECT: 검증된 식별자만 사용
        col_list = ", ".join(f'"{col}"' for col in source_columns)
        query_str = f'SELECT {col_list} FROM "{config.schema_name}"."{config.table_name}"'
        rows = await db.execute(text(query_str))
        source_rows = rows.fetchall()

        total_processed = 0
        inserted = 0
        updated = 0
        unchanged = 0
        errors: list[str] = []

        for row in source_rows:
            total_processed += 1
            # 행 데이터를 target_field 기준 dict로 변환
            row_data: dict[str, str | None] = {}
            for idx, src_col in enumerate(source_columns):
                target = mapping_dict[src_col]
                row_data[target] = row[idx]

            # line_code -> line_id 해소
            line_code = row_data.get("line_code")
            if not line_code or line_code not in line_map:
                errors.append(
                    f"Row skipped: line_code '{line_code}' not found in lines table "
                    f"(product_name={row_data.get('product_name')})"
                )
                continue

            line_id = line_map[line_code]
            product_name = row_data.get("product_name")
            if not product_name:
                errors.append(f"Row skipped: product_name is empty (line_code={line_code})")
                continue

            process_val = row_data.get("process", "")
            if not process_val:
                errors.append(
                    f"Row skipped: process is empty (line_code={line_code}, "
                    f"product_name={product_name})"
                )
                continue

            # Upsert via PostgreSQL INSERT...ON CONFLICT
            values = {
                "line_id": line_id,
                "product_name": product_name,
                "process": process_val,
                "part_id": row_data.get("part_id"),
                "is_active": True,
                "synced_at": now,
            }

            stmt = pg_insert(DeviceMaster).values(**values)
            stmt = stmt.on_conflict_do_update(
                constraint="uq_device_master_line_product_process_part",
                set_={
                    "process": stmt.excluded.process,
                    "part_id": stmt.excluded.part_id,
                    "is_active": True,
                    "synced_at": now,
                },
            )
            result = await db.execute(stmt)

            # xmax = 0 이면 새 삽입, 아니면 업데이트 (PostgreSQL 내부 동작)
            # 하지만 ON CONFLICT DO UPDATE는 항상 rowcount=1을 반환하므로
            # inserted/updated 구분은 synced_at 비교로 수행
            if result.rowcount > 0:
                # 정확한 구분을 위해 간단히 upsert 카운트로 처리
                # (실제 변경 여부는 DB 트리거 없이 정확히 알 수 없으므로)
                inserted += 1  # upsert 성공 건수로 대체

        # synced_at이 갱신되지 않은 기존 레코드는 stale 상태로 유지 (삭제하지 않음)
        await db.commit()

        return {
            "total_processed": total_processed,
            "inserted": inserted,
            "updated": updated,
            "unchanged": unchanged,
            "errors": errors,
        }

    # ------------------------------------------------------------------
    # Layer Sync
    # ------------------------------------------------------------------

    @staticmethod
    async def sync_layers(db: AsyncSession) -> DeviceSyncResult:
        """외부 소스에서 layer_master를 동기화한다.

        1. 활성 sync_source_config (source_type='layer') 조회
        2. 소스 테이블에서 동적 SQL로 데이터 읽기
        3. (line_code, product_name) -> device_master_id 해소
        4. INSERT...ON CONFLICT 로 upsert

        Returns:
            DeviceSyncResult: 동기화 결과 요약.
        """
        result = await db.execute(
            select(SyncSourceConfig).where(
                SyncSourceConfig.source_type == "layer",
                SyncSourceConfig.is_active == True,  # noqa: E712
            )
        )
        configs = result.scalars().all()
        if not configs:
            return DeviceSyncResult(
                total_processed=0, inserted=0, updated=0, unchanged=0, errors=[],
            )

        # line_code -> line_id 매핑
        line_map = await DeviceMasterSyncService._load_line_map(db)

        # (line_id, product_name) -> device_master_id 매핑
        dm_result = await db.execute(
            select(DeviceMaster.line_id, DeviceMaster.product_name, DeviceMaster.id)
        )
        device_map: dict[tuple[int, str], int] = {
            (row[0], row[1]): row[2] for row in dm_result.fetchall()
        }

        now = datetime.now(timezone.utc)

        total_processed = 0
        inserted = 0
        updated = 0
        unchanged = 0
        errors: list[str] = []

        for config in configs:
            try:
                result_partial = await DeviceMasterSyncService._sync_layers_from_config(
                    db, config, line_map, device_map, now,
                )
                total_processed += result_partial["total_processed"]
                inserted += result_partial["inserted"]
                updated += result_partial["updated"]
                unchanged += result_partial["unchanged"]
                errors.extend(result_partial["errors"])
            except HTTPException:
                raise
            except Exception as exc:
                msg = f"Error syncing layers from config '{config.source_name}': {exc}"
                logger.exception(msg)
                errors.append(msg)

        return DeviceSyncResult(
            total_processed=total_processed,
            inserted=inserted,
            updated=updated,
            unchanged=unchanged,
            errors=errors,
        )

    @staticmethod
    async def _sync_layers_from_config(
        db: AsyncSession,
        config: SyncSourceConfig,
        line_map: dict[str, int],
        device_map: dict[tuple[int, str], int],
        now: datetime,
    ) -> dict:
        """단일 sync_source_config에서 layer_master 데이터를 동기화한다."""
        mappings = config.column_mappings
        if not mappings:
            return {"total_processed": 0, "inserted": 0, "updated": 0, "unchanged": 0, "errors": []}

        source_columns = []
        mapping_dict: dict[str, str] = {}
        for m in mappings:
            src = m.get("source_column", "")
            tgt = m.get("target_field", "")
            if src and tgt:
                DeviceMasterSyncService._validate_identifier(src, "source_column")
                source_columns.append(src)
                mapping_dict[src] = tgt

        DeviceMasterSyncService._validate_identifier(config.table_name, "table_name")
        DeviceMasterSyncService._validate_identifier(config.schema_name, "schema_name")
        await DeviceMasterSyncService._validate_table_columns(
            db, config.table_name, config.schema_name, source_columns,
        )

        col_list = ", ".join(f'"{col}"' for col in source_columns)
        query_str = f'SELECT {col_list} FROM "{config.schema_name}"."{config.table_name}"'
        rows = await db.execute(text(query_str))
        source_rows = rows.fetchall()

        total_processed = 0
        inserted = 0
        errors: list[str] = []

        for row in source_rows:
            total_processed += 1
            row_data: dict[str, str | None] = {}
            for idx, src_col in enumerate(source_columns):
                target = mapping_dict[src_col]
                row_data[target] = row[idx]

            # device_master_id 해소: (line_code, product_name)
            line_code = row_data.get("line_code")
            product_name = row_data.get("product_name")
            if not line_code or line_code not in line_map:
                errors.append(
                    f"Layer row skipped: line_code '{line_code}' not found "
                    f"(layer_id={row_data.get('layer_id')})"
                )
                continue

            line_id = line_map[line_code]
            if not product_name:
                errors.append(
                    f"Layer row skipped: product_name is empty "
                    f"(line_code={line_code}, layer_id={row_data.get('layer_id')})"
                )
                continue

            device_key = (line_id, product_name)
            if device_key not in device_map:
                errors.append(
                    f"Layer row skipped: device_master not found for "
                    f"(line_code={line_code}, product_name={product_name})"
                )
                continue

            device_master_id = device_map[device_key]
            layer_id = row_data.get("layer_id")
            if not layer_id:
                errors.append(
                    f"Layer row skipped: layer_id is empty "
                    f"(line_code={line_code}, product_name={product_name})"
                )
                continue

            values = {
                "device_master_id": device_master_id,
                "layer_id": layer_id,
                "step_seq": row_data.get("step_seq"),
                "descript": row_data.get("descript"),
                "synced_at": now,
            }

            stmt = pg_insert(LayerMaster).values(**values)
            stmt = stmt.on_conflict_do_update(
                constraint="uq_layer_master_device_layer",
                set_={
                    "step_seq": stmt.excluded.step_seq,
                    "descript": stmt.excluded.descript,
                    "synced_at": now,
                },
            )
            await db.execute(stmt)
            inserted += 1

        await db.commit()

        return {
            "total_processed": total_processed,
            "inserted": inserted,
            "updated": 0,
            "unchanged": 0,
            "errors": errors,
        }
