"""셀 편집 저장 서비스 (도메인 조합).

더티 셀 배치를 단일 트랜잭션으로 UPSERT하고, 실제 변경분만 셀 단위
change_event(cell_update)로 남긴다 (P2-D7 구조화 컬럼 사용). 값 정규화, 조건 행
소속 검증, 변경 여부 판정을 여기서 조합한다.
"""

import uuid

from app.core.errors import DomainValidationError, NotFoundError
from app.features.cells.repository import CellRepository
from app.features.cells.schema import CellOut, CellsPatchIn, CellsPatchOut
from app.models.project import CellValue, ChangeEvent, ChangeEventType


def _normalize(value: str | None) -> str | None:
    """저장 직전 값 정규화.

    문자열이면 trim, 결과가 빈 문자열이면 None(셀 비우기)으로 본다. 원본이 이미
    None이면 그대로 None. 즉 ""·"   "·None은 모두 "값 없음"으로 수렴한다.
    """
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


class CellService:
    """셀 배치 저장 오케스트레이션."""

    def __init__(self, repo: CellRepository) -> None:
        self.repo = repo

    async def patch_cells(
        self, project_id: int, data: CellsPatchIn, *, actor: str
    ) -> CellsPatchOut:
        # batch_id는 요청당 1개 — 변경이 0건이어도 응답으로 돌려준다(프론트 더티 해제).
        batch_id = uuid.uuid4().hex
        if not data.cells:
            return CellsPatchOut(cells=[], batch_id=batch_id)

        if not await self.repo.project_exists(project_id):
            raise NotFoundError(f"프로젝트를 찾을 수 없다: {project_id}")

        requested_ids = {cell.condition_id for cell in data.cells}
        valid_ids = await self.repo.condition_ids_in_project(project_id, requested_ids)
        invalid_ids = requested_ids - valid_ids
        if invalid_ids:
            # 하나라도 소속이 아니면 전체 요청을 거부한다 (부분 저장 없음).
            # 검증을 모든 쓰기보다 앞에 두어, 예외 전파 시 세션이 그대로 롤백된다.
            raise DomainValidationError(
                "이 프로젝트 소속이 아닌 조건 행이 요청에 있다",
                details={"invalid_condition_ids": sorted(invalid_ids)},
            )

        # 대상 조건 행들의 기존 셀을 한 번에 로드해 (condition_id, code)로 인덱싱한다.
        cell_by_key: dict[tuple[int, str], CellValue] = {
            (cell.condition_id, cell.parameter_code): cell
            for cell in await self.repo.load_cell_values(requested_ids)
        }

        out_cells: list[CellOut] = []
        for update in data.cells:
            key = (update.condition_id, update.parameter_code)
            new_value = _normalize(update.value)
            existing = cell_by_key.get(key)
            old_value = existing.value_text if existing is not None else None

            if old_value != new_value:
                self._apply_change(cell_by_key, key, existing, new_value)
                self.repo.add_event(
                    ChangeEvent(
                        project_id=project_id,
                        event_type=ChangeEventType.CELL_UPDATE,
                        actor=actor,
                        condition_id=update.condition_id,
                        parameter_code=update.parameter_code,
                        old_value=old_value,
                        new_value=new_value,
                        payload={"batch_id": batch_id, "origin": data.origin},
                    )
                )
            out_cells.append(
                CellOut(
                    condition_id=update.condition_id,
                    parameter_code=update.parameter_code,
                    value=new_value,
                )
            )

        await self.repo.flush()
        return CellsPatchOut(cells=out_cells, batch_id=batch_id)

    def _apply_change(
        self,
        cell_by_key: dict[tuple[int, str], CellValue],
        key: tuple[int, str],
        existing: CellValue | None,
        new_value: str | None,
    ) -> None:
        """변경분을 cell_value에 반영한다.

        기존 행이 있으면 값만 갱신한다 — 비우기(new_value=None)도 행을 지우지 않고
        value_text=None으로 두어 UNIQUE 제약과 이력 일관성을 유지한다. 기존 행이
        없으면 새로 insert한다. 이때 new_value는 항상 not None이다(빈 값 신규는
        old==new==None으로 앞의 변경 판정에서 걸러진다). 배치 안에서 같은 셀이
        중복 등장하면 두 번째부터 첫 반영을 보도록 cell_by_key를 갱신한다.
        """
        if existing is not None:
            existing.value_text = new_value
            return
        created = CellValue(
            condition_id=key[0],
            parameter_code=key[1],
            value_text=new_value,
        )
        self.repo.add_cell_value(created)
        cell_by_key[key] = created
