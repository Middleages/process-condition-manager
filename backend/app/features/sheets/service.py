"""시트 조회 서비스 (도메인 조합).

컬럼 정의 공급과 본문 매트릭스 변환을 조합한다. 프로젝트 상태에 따라
승인된 스냅샷(Approved/Archived) 또는 live 정규화 경로를 선택한다.
"""

from decimal import Decimal

from app.core.config import settings
from app.core.errors import DomainValidationError, NotFoundError
from app.core.locks import as_utc, is_expired, utcnow
from app.domain.decimal_values import normalize_decimal
from app.domain.parameters.definition_view import DefinitionView
from app.domain.parameters.types import ValueType
from app.domain.workflow import ProjectStatus
from app.features.sheets.repository import SheetRepository
from app.features.sheets.schema import (
    FrozenChoiceSetOptionOut,
    FrozenChoiceSetOut,
    SheetColumnOut,
    SheetCommentCountOut,
    SheetLockSummaryOut,
    SheetOut,
    SheetRowOut,
    SheetValidationRuleOut,
)
from app.features.validation.project_service import CanonicalValidationBasisLoader
from app.models.parameter import Parameter
from app.models.project import EditLock, Project


class SheetService:
    """프로젝트 하나를 조건표(그리드) 응답으로 조립한다."""

    def __init__(self, repo: SheetRepository) -> None:
        self.repo = repo
        self.basis_loader = CanonicalValidationBasisLoader(repo)

    async def get_sheet(self, project_id: int, *, user_id: str) -> SheetOut:
        project = await self.repo.load_project_tree(project_id)
        if project is None:
            raise NotFoundError(f"프로젝트를 찾을 수 없다: {project_id}")

        lock = _lock_summary(await self.repo.load_edit_lock(project_id), user_id=user_id)
        comment_counts = [
            SheetCommentCountOut(
                condition_id=condition_id,
                parameter_code=parameter_code,
                count=count,
            )
            for condition_id, parameter_code, count in await self.repo.list_open_comment_counts(
                project_id
            )
        ]

        if project.status in (ProjectStatus.APPROVED, ProjectStatus.ARCHIVED):
            return self._build_frozen_sheet(project, lock, comment_counts)

        basis = await self.basis_loader.load(project_id)
        columns = _build_live_columns(
            list(basis.parameters),
            basis.category_code_by_id,
        )
        rows = _build_rows(project)
        return SheetOut(
            columns=columns,
            rows=rows,
            lock=lock,
            validation_rules=[
                SheetValidationRuleOut(
                    code=rule.definition.code,
                    name=rule.definition.name,
                    severity=rule.definition.severity,
                    version=rule.definition.version,
                    scope=rule.scope,
                    spec=rule.spec,
                )
                for rule in basis.rules
            ],
            validation_basis_hash=basis.basis_hash,
            frozen_choice_sets=[],
            comment_counts=comment_counts,
        )

    def _build_frozen_sheet(
        self,
        project: Project,
        lock: SheetLockSummaryOut,
        comment_counts: list[SheetCommentCountOut],
    ) -> SheetOut:
        try:
            definition = DefinitionView.from_snapshot(project.parameter_snapshot)
            raw_columns = definition.columns()
            columns = _build_frozen_columns(raw_columns)
            allowed_parameter_codes = {column["code"] for column in raw_columns}
            rows = _build_rows(project, allowed_parameter_codes=allowed_parameter_codes)
            rules = _build_frozen_rules(definition.rules())
            frozen_choice_sets = [
                FrozenChoiceSetOut(
                    set_code=choice_set["code"],
                    version=int(choice_set["version"]),
                    is_active=bool(choice_set.get("is_active", True)),
                    items=[
                        FrozenChoiceSetOptionOut(**option)
                        for option in choice_set.get("options", [])
                    ],
                )
                for choice_set in definition.frozen_choice_sets()
            ]
        except Exception as exc:
            if isinstance(exc, DomainValidationError):
                raise
            raise DomainValidationError(
                "요청된 프로젝트의 snapshot이 손상되어 있습니다",
                code="snapshot_invalid",
            ) from exc

        return SheetOut(
            columns=columns,
            rows=rows,
            lock=lock,
            validation_rules=rules,
            validation_basis_hash=definition.validation_basis_hash,
            frozen_choice_sets=frozen_choice_sets,
            comment_counts=comment_counts,
        )


def _build_frozen_columns(columns: list[dict]) -> list[SheetColumnOut]:
    rows: list[SheetColumnOut] = []
    for column in columns:
        rows.append(
            SheetColumnOut(
                parameter_code=column["code"],
                display_name=column["display_name"],
                value_type=column["value_type"],
                category_code=column.get("category_code"),
                unit=column.get("unit"),
                min_value=_decimal_out(column.get("min_value")),
                max_value=_decimal_out(column.get("max_value")),
                required=bool(column.get("required", False)),
                pattern=column.get("pattern"),
                pattern_hint=column.get("pattern_hint"),
                description=column.get("description"),
                choice_set_code=column.get("choice_set_code"),
                choice_set_version=_choice_set_version(column),
                sort_order=int(column["sort_order"]),
            )
        )
    return rows


def _choice_set_version(column: dict) -> int | None:
    if column.get("value_type") in (ValueType.CHOICE, "choice"):
        value = column.get("choice_set_version")
        return None if value is None else int(value)
    return None


def _build_frozen_rules(rules: list[dict]) -> list[SheetValidationRuleOut]:
    return [
        SheetValidationRuleOut(
            code=rule["code"],
            name=rule["name"],
            severity=rule["severity"],
            version=int(rule["version"]),
            scope=rule["scope"],
            spec=rule["spec"],
        )
        for rule in rules
    ]


def _build_live_columns(
    parameters: list[Parameter], category_code_by_id: dict[int, str]
) -> list[SheetColumnOut]:
    """live 파라미터 레지스트리에서 컬럼 정의를 만든다."""
    columns: list[SheetColumnOut] = []
    for parameter in parameters:
        if parameter.value_type is ValueType.CHOICE and parameter.choice_set is None:
            raise DomainValidationError(
                "choice 파라미터에 ChoiceSet 연결이 없다",
                details={"parameter_code": parameter.code},
            )
        columns.append(
            SheetColumnOut(
                parameter_code=parameter.code,
                display_name=parameter.display_name,
                value_type=parameter.value_type,
                category_code=(
                    category_code_by_id.get(parameter.category_id)
                    if parameter.category_id is not None
                    else None
                ),
                unit=parameter.unit if parameter.value_type is ValueType.NUMBER else None,
                min_value=(
                    _decimal_out(parameter.min_value)
                    if parameter.value_type is ValueType.NUMBER
                    else None
                ),
                max_value=(
                    _decimal_out(parameter.max_value)
                    if parameter.value_type is ValueType.NUMBER
                    else None
                ),
                required=parameter.required,
                pattern=(
                    parameter.pattern if parameter.value_type is ValueType.TEXT else None
                ),
                pattern_hint=(
                    parameter.pattern_hint
                    if parameter.value_type is ValueType.TEXT
                    else None
                ),
                description=parameter.description,
                choice_set_code=(
                    parameter.choice_set.code
                    if parameter.value_type is ValueType.CHOICE
                    and parameter.choice_set is not None
                    else None
                ),
                choice_set_version=(
                    parameter.choice_set.version
                    if parameter.value_type is ValueType.CHOICE
                    and parameter.choice_set is not None
                    else None
                ),
                sort_order=parameter.sort_order,
            )
        )
    return columns


def _decimal_out(value: Decimal | str | None) -> Decimal | None:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return Decimal(normalize_decimal(format(value, "f")))
    if isinstance(value, str):
        return Decimal(normalize_decimal(value))
    return Decimal(value)


def _build_rows(
    project: Project,
    *,
    allowed_parameter_codes: set[str] | None = None,
) -> list[SheetRowOut]:
    """프로젝트 트리를 조건 행 × 파라미터 매트릭스로 편다."""
    rows: list[SheetRowOut] = []
    for layer in project.layers:
        layer_label = f"{layer.layer_id} ({layer.step_seq})"
        for condition in layer.conditions:
            cells: dict[str, str | None] = {}
            for cell in condition.cell_values:
                if cell.value_text is None:
                    continue
                if (
                    allowed_parameter_codes is not None
                    and cell.parameter_code not in allowed_parameter_codes
                ):
                    continue
                cells[cell.parameter_code] = cell.value_text
            rows.append(
                SheetRowOut(
                    condition_id=condition.id,
                    layer_key=layer.layer_key,
                    layer_label=layer_label,
                    condition_label=condition.label,
                    is_por=condition.is_por,
                    layer_sort_order=layer.sort_order,
                    condition_index=condition.condition_index,
                    cells=cells,
                )
            )
    return rows


def _lock_summary(lock: EditLock | None, *, user_id: str) -> SheetLockSummaryOut:
    """edit_lock 행을 시트 잠금 요약으로 변환한다 (T5)."""
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
