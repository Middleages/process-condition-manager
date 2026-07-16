"""조건 행 관리 서비스 (도메인 조합).

조건 행 추가/복제, 하드 삭제(스냅샷 이벤트 동반), POR 이양을 단일 트랜잭션으로
오케스트레이션한다. 라벨 자동 부여·복제 원본 소속 검증·최소 1행 유지 같은 규칙을
여기서 조합하고, 실제 영속화는 repository에 위임한다.
"""

from app.core.errors import DomainValidationError, NotFoundError
from app.features.conditions.repository import ConditionRepository
from app.features.conditions.schema import ConditionCreateIn, ConditionOut
from app.models.project import (
    CellValue,
    ChangeEvent,
    ChangeEventType,
    LayerCondition,
    SheetLayer,
)


def _next_label(existing_labels: set[str]) -> str:
    """해당 layer에서 충돌하지 않는 가장 작은 "C{n}" 라벨을 고른다.

    n=1부터 올려가며 비어 있는 첫 번호를 쓴다 — 중간 라벨(예: C2)이 삭제로 비면
    그 자리를 다시 채워 라벨을 촘촘하게 유지한다. "base" 같은 비-C 라벨은 번호
    공간과 무관하므로 건너뛸 필요가 없다(C{n} 형태만 비교하면 자연히 무시된다).
    """
    n = 1
    while f"C{n}" in existing_labels:
        n += 1
    return f"C{n}"


def _condition_snapshot(
    condition: LayerCondition, *, cells: list[tuple[str, str | None]] | None = None
) -> dict[str, object]:
    return {
        "label": condition.label,
        "is_por": condition.is_por,
        "condition_index": condition.condition_index,
        "cells": {
            code: value
            for code, value in (
                cells
                if cells is not None
                else ((cell.parameter_code, cell.value_text) for cell in condition.cell_values)
            )
        },
    }


class ConditionService:
    """조건 행 추가/삭제/POR 이양 오케스트레이션."""

    def __init__(self, repo: ConditionRepository) -> None:
        self.repo = repo

    async def add_condition(
        self, project_id: int, layer_key: str, data: ConditionCreateIn, *, actor: str
    ) -> ConditionOut:
        layer = await self.repo.get_layer_in_project(project_id, layer_key)
        if layer is None:
            raise NotFoundError(f"layer를 찾을 수 없다: {layer_key}")

        # 복제 원본 검증·셀 스냅샷을 어떤 쓰기보다 앞에 둔다 — 소속 위반이면 여기서
        # 예외가 나고, 아무것도 쓰지 않은 채 트랜잭션이 그대로 롤백된다.
        source_cells = self._source_cells(layer, data.source_condition_id)

        condition = LayerCondition(
            layer_id=layer.id,
            label=_next_label({c.label for c in layer.conditions}),
            # condition_index는 항상 최댓값+1 (라벨과 달리 빈 자리를 채우지 않는다) —
            # 새 행은 언제나 맨 끝에 붙어 기존 행의 순서를 흔들지 않는다.
            condition_index=max((c.condition_index for c in layer.conditions), default=0) + 1,
            # 복제해도 POR은 안 따라온다 (복제로 POR 중복이 생기는 걸 막는 의도적
            # 설계 — 필요하면 복제 후 사용자가 별도로 POR을 이양한다).
            is_por=False,
            source_condition_id=data.source_condition_id,
        )
        condition.cell_values.extend(
            CellValue(parameter_code=code, value_text=value) for code, value in source_cells
        )
        self.repo.add_condition(condition)
        await self.repo.flush()  # condition.id 확보 (이벤트 payload에 싣기 위함).

        self.repo.add_event(
            ChangeEvent(
                project_id=project_id,
                event_type=ChangeEventType.CONDITION_ADD,
                actor=actor,
                condition_id=condition.id,
                layer_key=layer_key,
                origin="manual",
                source_project_id=None,
                source_layer_key=None,
                payload={
                    "layer_key": layer_key,
                    "condition_id": condition.id,
                    "source_condition_id": data.source_condition_id,
                    "snapshot": _condition_snapshot(condition, cells=source_cells),
                },
            )
        )
        await self.repo.flush()
        return _condition_out(condition, layer_key)

    async def delete_condition(
        self, project_id: int, condition_id: int, *, actor: str
    ) -> None:
        condition = await self.repo.get_condition_in_project(project_id, condition_id)
        if condition is None:
            raise NotFoundError(f"조건 행을 찾을 수 없다: {condition_id}")

        # layer당 최소 1행 유지 — 마지막 조건 행 삭제는 막는다 (POR 여부와 무관;
        # POR 행 삭제 자체는 허용이고 Review 게이트는 Phase 5의 몫이다).
        if await self.repo.count_conditions_in_layer(condition.layer_id) <= 1:
            raise DomainValidationError(
                "layer의 마지막 조건 행은 삭제할 수 없다",
                details={
                    "layer_key": condition.layer.layer_key,
                    "condition_id": condition_id,
                },
            )

        # 하드 삭제라 사라질 상태를 이벤트 payload에 스냅샷으로 남긴다(되돌림 근거).
        # 삭제 전에 값을 떠 둔다 — cell_value는 delete 시 cascade로 함께 사라진다.
        layer_key = condition.layer.layer_key
        self.repo.add_event(
            ChangeEvent(
                project_id=project_id,
                event_type=ChangeEventType.CONDITION_REMOVE,
                actor=actor,
                condition_id=condition_id,
                layer_key=layer_key,
                origin="manual",
                source_project_id=None,
                source_layer_key=None,
                payload={
                    "layer_key": layer_key,
                    "condition_id": condition_id,
                    "snapshot": _condition_snapshot(condition),
                },
            )
        )
        await self.repo.delete_condition(condition)
        await self.repo.flush()

    async def set_por(
        self, project_id: int, condition_id: int, *, actor: str
    ) -> ConditionOut:
        condition = await self.repo.get_condition_in_project(project_id, condition_id)
        if condition is None:
            raise NotFoundError(f"조건 행을 찾을 수 없다: {condition_id}")
        layer_key = condition.layer.layer_key

        current_por = await self.repo.find_por_condition(condition.layer_id)
        old_por_id = current_por.id if current_por is not None else None
        if old_por_id == condition_id:
            # 이미 POR — 바꿀 게 없다 (재호출 안전, 실제 변경이 없으니 이벤트도 없다).
            return _condition_out(condition, layer_key)

        # 기존 POR을 먼저 해제하고 flush한 뒤 대상을 POR로 세운다 — 한 트랜잭션 안에서
        # 두 행이 동시에 is_por=True가 되는 순간을 없애 partial unique index 위반을
        # 피한다. index는 동시(다중 요청) 충돌의 최종 방어선으로 남는다.
        if current_por is not None:
            current_por.is_por = False
            await self.repo.flush()
        condition.is_por = True
        await self.repo.flush()

        self.repo.add_event(
            ChangeEvent(
                project_id=project_id,
                event_type=ChangeEventType.POR_CHANGE,
                actor=actor,
                condition_id=condition_id,
                layer_key=layer_key,
                origin="manual",
                source_project_id=None,
                source_layer_key=None,
                payload={
                    "layer_key": layer_key,
                    "old_por_condition_id": old_por_id,
                    "new_por_condition_id": condition_id,
                },
            )
        )
        await self.repo.flush()
        return _condition_out(condition, layer_key)

    def _source_cells(
        self, layer: SheetLayer, source_condition_id: int | None
    ) -> list[tuple[str, str | None]]:
        """복제 원본의 셀 값을 (parameter_code, value_text) 목록으로 뜬다.

        원본이 없으면(빈 조건 행 추가) 빈 목록. 원본이 있으면 반드시 이 layer 소속
        이어야 한다 — layer.conditions(이 layer의 조건 행만 담김)에서 찾지 못하면
        다른 layer/프로젝트 조건이거나 미존재이므로 거부한다. 이 한 번의 소속 확인이
        세 경우(타 layer·타 프로젝트·미존재)를 모두 막는다.
        """
        if source_condition_id is None:
            return []
        source = next(
            (c for c in layer.conditions if c.id == source_condition_id), None
        )
        if source is None:
            raise DomainValidationError(
                "복제 원본 조건 행이 이 layer 소속이 아니다",
                details={"source_condition_id": source_condition_id},
            )
        return [(cell.parameter_code, cell.value_text) for cell in source.cell_values]


def _condition_out(condition: LayerCondition, layer_key: str) -> ConditionOut:
    return ConditionOut(
        id=condition.id,
        layer_key=layer_key,
        label=condition.label,
        condition_index=condition.condition_index,
        is_por=condition.is_por,
    )
