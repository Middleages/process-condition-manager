"""실 적재 테이블(PostgreSQL) 판독기 구현.

단일 테이블(1행 = 1 layer, P1-D2 확정 스키마)을 읽어 IngestReader 계약을 만족한다.

- 테이블/스키마 이름은 설정에서 오며(사용자 입력 아님) 식별자 형식을 검증하고
  따옴표로 감싸 사용한다. 값 조건은 항상 바인드 파라미터로만 전달한다.
- 읽기 전용 ingest 세션으로만 접근한다 (PCM은 적재 영역에 절대 쓰지 않는다).
- 상위 코드는 IngestReader 계약만 알며, fixture ↔ pg 구현체는 설정으로 교체된다.
"""

import re

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError
from app.ingest.reader import IngestReader, LayerInfo, ProcessInfo, layer_key, process_key

_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _qualified_ref(table: str, schema: str | None) -> str:
    """스키마/테이블 식별자를 검증하고 따옴표로 감싼 참조를 만든다."""
    for ident in filter(None, (schema, table)):
        if not _IDENT.match(ident):
            raise ValueError(f"허용되지 않는 식별자: {ident!r}")
    return f'"{schema}"."{table}"' if schema else f'"{table}"'


class PgIngestReader(IngestReader):
    """실 적재 테이블을 읽는 판독기."""

    def __init__(
        self, session: AsyncSession, *, table: str, schema: str | None = None
    ) -> None:
        self._session = session
        self._ref = _qualified_ref(table, schema)

    async def list_processes(self) -> list[ProcessInfo]:
        stmt = text(
            f"SELECT DISTINCT line_id, process_id FROM {self._ref} "  # noqa: S608 — 식별자 검증+따옴표
            "ORDER BY line_id, process_id"
        )
        rows = (await self._session.execute(stmt)).all()
        return [
            ProcessInfo(
                key=process_key(row.line_id, row.process_id),
                line_id=row.line_id,
                process_id=row.process_id,
                display_name=f"{row.line_id} / {row.process_id}",
            )
            for row in rows
        ]

    async def get_process(self, line_id: str, process_id: str) -> ProcessInfo:
        stmt = text(
            "SELECT DISTINCT line_id, process_id "
            f"FROM {self._ref} "  # noqa: S608 — 식별자 검증+따옴표
            "WHERE line_id = :line_id AND process_id = :process_id"
        )
        row = (
            await self._session.execute(
                stmt, {"line_id": line_id, "process_id": process_id}
            )
        ).one_or_none()
        if row is None:
            raise NotFoundError(f"process를 찾을 수 없다: {line_id}/{process_id}")
        return ProcessInfo(
            key=process_key(row.line_id, row.process_id),
            line_id=row.line_id,
            process_id=row.process_id,
            display_name=f"{row.line_id} / {row.process_id}",
        )

    async def get_layers(self, line_id: str, process_id: str) -> list[LayerInfo]:
        stmt = text(
            "SELECT step_seq, layer_id, eqp_type, eqp_type_desc, area_name "
            f"FROM {self._ref} "  # noqa: S608 — 식별자 검증+따옴표, 값은 바인드 파라미터
            "WHERE line_id = :line_id AND process_id = :process_id "
            "ORDER BY step_seq, layer_id"
        )
        rows = (
            await self._session.execute(
                stmt, {"line_id": line_id, "process_id": process_id}
            )
        ).all()
        if not rows:
            raise NotFoundError(f"process를 찾을 수 없다: {line_id}/{process_id}")
        return [
            LayerInfo(
                key=layer_key(line_id, process_id, row.step_seq, row.layer_id),
                step_seq=row.step_seq,
                layer_id=row.layer_id,
                eqp_type=row.eqp_type,
                eqp_type_desc=row.eqp_type_desc,
                area_name=row.area_name,
            )
            for row in rows
        ]
