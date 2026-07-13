"""시트 조회 서비스 (도메인 조합).

컬럼 정의 공급과 본문 매트릭스 변환을 조합한다. 컬럼 정의는 `_build_live_columns`
로 분리해 둔다 — 지금은 항상 live 레지스트리를 쓰지만, Phase 5에서 승인된 프로젝트는
동결된 parameter_snapshot을 쓰도록 이 함수 교체만으로 경계가 갈리도록 하기 위함이다.
"""

from app.core.config import settings
from app.core.errors import NotFoundError
from app.core.locks import as_utc, is_expired, utcnow
from app.domain.parameters.types import ValueType
from app.features.sheets.repository import SheetRepository
from app.features.sheets.schema import (
    SheetColumnOut,
    SheetLockSummaryOut,
    SheetOut,
    SheetRowOut,
)
from app.models.parameter import Parameter
from app.models.project import EditLock, Project


class SheetService:
    """프로젝트 하나를 조건표(그리드) 응답으로 조립한다."""

    def __init__(self, repo: SheetRepository) -> None:
        self.repo = repo

    async def get_sheet(self, project_id: int, *, user_id: str) -> SheetOut:
        project = await self.repo.load_project_tree(project_id)
        if project is None:
            raise NotFoundError(f"프로젝트를 찾을 수 없다: {project_id}")

        parameters = await self.repo.list_active_parameters()
        categories = await self.repo.list_active_categories()
        category_code_by_id = {category.id: category.code for category in categories}

        columns = _build_live_columns(parameters, category_code_by_id)
        rows = _build_rows(project)
        lock = _lock_summary(await self.repo.load_edit_lock(project_id), user_id=user_id)
        return SheetOut(columns=columns, rows=rows, lock=lock)


def _build_live_columns(
    parameters: list[Parameter], category_code_by_id: dict[int, str]
) -> list[SheetColumnOut]:
    """live 파라미터 레지스트리에서 컬럼 정의를 만든다.

    "컬럼 정의 공급자" — Phase 5의 스냅샷 분기는 이 함수를 교체(또는 형제 함수
    추가)하는 것으로 끝나야 한다. 여기 바깥에서 파라미터 원본에 의존하지 않는다.
    """
    return [
        SheetColumnOut(
            parameter_code=parameter.code,
            display_name=parameter.display_name,
            value_type=parameter.value_type,
            category_code=(
                category_code_by_id.get(parameter.category_id)
                if parameter.category_id is not None
                else None
            ),
            unit=parameter.unit,
            description=parameter.description,
            choice_options=(
                [option.value for option in parameter.options]
                if parameter.value_type == ValueType.CHOICE
                else []
            ),
            sort_order=parameter.sort_order,
        )
        for parameter in parameters
    ]


def _build_rows(project: Project) -> list[SheetRowOut]:
    """프로젝트 트리를 조건 행 × 파라미터 매트릭스로 편다.

    layer는 sort_order, 조건 행은 condition_index 순으로 이미 로드되어 있다.
    셀은 값이 있는 것만 담는다 (희소 표현 — 없는 셀은 프론트가 null 처리).
    """
    rows: list[SheetRowOut] = []
    for layer in project.layers:
        layer_label = f"{layer.layer_id} ({layer.step_seq})"
        for condition in layer.conditions:
            cells: dict[str, str | None] = {
                cell.parameter_code: cell.value_text
                for cell in condition.cell_values
                if cell.value_text is not None
            }
            rows.append(
                SheetRowOut(
                    condition_id=condition.id,
                    layer_key=layer.layer_key,
                    layer_label=layer_label,
                    condition_label=condition.label,
                    is_por=condition.is_por,
                    cells=cells,
                )
            )
    return rows


def _lock_summary(lock: EditLock | None, *, user_id: str) -> SheetLockSummaryOut:
    """edit_lock 행을 시트 잠금 요약으로 변환한다 (T5).

    잠금이 없거나 만료면 미잠금(모두 None, is_mine=False)으로 본다 — 이때는 누구나
    획득해 편집할 수 있다. 유효 잠금이면 보유자 정보를 채우고, is_mine은 현재 요청
    사용자와 locked_by의 일치 여부다(토큰이 아닌 사용자 기준 — 시트 조회는 토큰을
    싣지 않는 읽기 경로이며, 실제 편집 강제는 require_edit_lock의 토큰 검증이 한다).
    datetime은 as_utc로 통일해 응답 JSON을 일관되게 한다.
    """
    if lock is None or is_expired(lock, utcnow()):
        return SheetLockSummaryOut(
            locked_by=None,
            locked_at=None,
            expires_at=None,
            is_mine=False,
            heartbeat_seconds=settings.edit_lock_heartbeat_seconds,
        )
    return SheetLockSummaryOut(
        locked_by=lock.locked_by,
        locked_at=as_utc(lock.locked_at),
        expires_at=as_utc(lock.expires_at),
        is_mine=lock.locked_by == user_id,
        heartbeat_seconds=settings.edit_lock_heartbeat_seconds,
    )
