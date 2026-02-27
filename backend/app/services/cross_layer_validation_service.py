"""크로스 레이어 검증 서비스.

동일 프로젝트 내 여러 레이어 간의 조건 일관성 검증을 담당한다.
validate_project()에서 기존 단일 레이어 검증 완료 후 호출된다.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.column import ColumnDefinition, ColumnValidation
from app.schemas.project import ValidationErrorItem


# 허용되는 cross_layer check_type 목록
ALLOWED_CHECK_TYPES = ("reference_exists", "compare_layers", "equipment_compatibility")

# 허용되는 비교 연산자 목록
ALLOWED_OPERATORS = ("<=", ">=", "<", ">", "==", "!=")

# 허용되는 equipment_compatibility 호환성 타입 목록
ALLOWED_COMPATIBILITY_TYPES = ("same_value", "within_range")


def _validate_reference_exists(
    rule: ColumnValidation,
    project_layer,
    layer_name: str,
    step_seqs: set,
    layer_names: set,
    col_by_name: dict,
    errors: list,
) -> None:
    """참조 레이어 존재 여부 검증.

    source_column 값이 프로젝트 내 레이어의 step_seq(또는 layer_name)로 존재하는지 확인한다.
    rule_config의 target 필드에 따라 검증 대상을 결정한다:
    - "step_seq" (기본값): step_seq 집합에서 검색
    - "layer_names": layer_name 집합에서 검색
    """
    config = rule.rule_config
    source_column = config.get("source_column")
    if not source_column:
        return

    conditions = project_layer.conditions or {}
    value = conditions.get(source_column)

    # 값이 없거나 빈 문자열이면 건너뜀 (required 검증에서 별도 처리)
    if value is None or (isinstance(value, str) and value.strip() == ""):
        return

    # target에 따라 검증 대상 집합 선택 (기본값: step_seq)
    target = config.get("target", "step_seq")
    lookup_set = step_seqs if target == "step_seq" else layer_names

    # 참조 레이어가 프로젝트에 존재하지 않으면 에러 추가
    if str(value) not in lookup_set:
        column_name = source_column
        errors.append(ValidationErrorItem(
            layer_id=project_layer.layer_id,
            layer_name=layer_name,
            column_name=column_name,
            display_name=col_by_name.get(column_name, {}).get("display_name", column_name),
            rule_type="cross_layer",
            message=(
                f"{layer_name}의 {column_name} 값 '{value}'에 해당하는 "
                f"레이어가 프로젝트에 존재하지 않습니다"
            ),
            metadata={
                "check_type": "reference_exists",
                "referenced_layer": str(value),
            },
        ))


def _apply_operator(current_value: float, operator: str, threshold: float) -> bool:
    """비교 연산자를 적용해 검증 통과 여부를 반환한다."""
    if operator == "<=":
        return current_value <= threshold
    elif operator == ">=":
        return current_value >= threshold
    elif operator == "<":
        return current_value < threshold
    elif operator == ">":
        return current_value > threshold
    elif operator == "==":
        return current_value == threshold
    elif operator == "!=":
        return current_value != threshold
    return True


def _validate_compare_layers(
    rule: ColumnValidation,
    project_layer,
    layer_name: str,
    step_seq_to_pl: dict,
    layer_name_to_pl: dict,
    col_by_name: dict,
    errors: list,
) -> None:
    """레이어 간 값 비교 검증.

    reference_layer_column이 가리키는 참조 레이어의 column 값과
    현재 레이어의 column 값을 operator로 비교한다.
    threshold_ratio가 설정되어 있으면 참조값에 비율을 곱한 값과 비교한다.

    참조 레이어 식별: reference_layer_column 값(OVL_REF_LAYER 등)은 step_seq를 저장하므로
    step_seq_to_pl에서 먼저 검색하고, 없으면 layer_name_to_pl에서 fallback 검색한다.
    """
    config = rule.rule_config
    column = config.get("column")
    operator = config.get("operator")
    reference_layer_column = config.get("reference_layer_column")
    threshold_ratio = config.get("threshold_ratio")

    if not column or not operator or not reference_layer_column:
        return

    conditions = project_layer.conditions or {}

    # 현재 레이어에서 참조 레이어 식별자를 가져옴 (일반적으로 step_seq)
    ref_identifier = conditions.get(reference_layer_column)
    if ref_identifier is None or (isinstance(ref_identifier, str) and ref_identifier.strip() == ""):
        return

    # step_seq로 먼저 검색, 없으면 layer_name으로 fallback
    ref_pl = step_seq_to_pl.get(str(ref_identifier))
    if ref_pl is None:
        ref_pl = layer_name_to_pl.get(str(ref_identifier))
    if ref_pl is None:
        return

    current_raw = conditions.get(column)
    ref_conditions = ref_pl.conditions or {}
    ref_raw = ref_conditions.get(column)

    # 값이 없으면 건너뜀
    if current_raw is None or ref_raw is None:
        return

    # 숫자 변환 시도
    try:
        current_value = float(current_raw)
        ref_value = float(ref_raw)
    except (TypeError, ValueError):
        return

    # threshold_ratio 적용
    if threshold_ratio is not None:
        threshold = ref_value * float(threshold_ratio)
    else:
        threshold = ref_value

    # 비교 검증: 실패 시 에러 추가
    if not _apply_operator(current_value, operator, threshold):
        column_name = column
        # 참조 레이어의 이름을 에러 메시지에 표시 (step_seq가 아닌 사람이 읽기 쉬운 이름)
        ref_layer_display = ref_pl.layer_name or str(ref_identifier)
        errors.append(ValidationErrorItem(
            layer_id=project_layer.layer_id,
            layer_name=layer_name,
            column_name=column_name,
            display_name=col_by_name.get(column_name, {}).get("display_name", column_name),
            rule_type="cross_layer",
            message=(
                f"{layer_name}의 {column_name} 값({current_value})이 "
                f"참조 레이어 {ref_layer_display}의 값({ref_value}) "
                f"대비 기준({operator} {threshold})을 초과합니다"
            ),
            metadata={
                "check_type": "compare_layers",
                "referenced_layer": ref_layer_display,
                "referenced_value": str(ref_value),
            },
        ))


def _validate_equipment_compatibility(
    rule: ColumnValidation,
    equipment_groups: dict,
    col_by_name: dict,
    errors: list,
) -> None:
    """설비 배정 레이어 간 값 호환성 검증.

    동일 equipment_id에 배정된 레이어들의 특정 컬럼 값이
    compatibility 기준(same_value 또는 within_range)을 만족하는지 확인한다.
    """
    config = rule.rule_config
    column = config.get("column")
    compatibility = config.get("compatibility")
    range_tolerance = config.get("range_tolerance")

    if not column or not compatibility:
        return

    # 각 설비 그룹별 검증
    for equipment_id, group_layers in equipment_groups.items():
        # 해당 컬럼의 값 수집 (레이어별)
        layer_values = []
        for pl, lname in group_layers:
            conds = pl.conditions or {}
            raw = conds.get(column)
            if raw is None:
                continue
            try:
                val = float(raw)
                layer_values.append((lname, val))
            except (TypeError, ValueError):
                continue

        # 2개 미만이면 비교 불필요
        if len(layer_values) < 2:
            continue

        column_name = column
        display_name = col_by_name.get(column_name, {}).get("display_name", column_name)
        values_only = [v for _, v in layer_values]

        if compatibility == "same_value":
            # 모든 값이 동일해야 함
            if len(set(values_only)) > 1:
                layer_values_str = ", ".join(
                    f"{lname}={val}" for lname, val in layer_values
                )
                # 대표 레이어(그룹 첫 번째)에 에러 기록
                first_pl, first_lname = group_layers[0]
                first_layer_id = first_pl.layer_id
                errors.append(ValidationErrorItem(
                    layer_id=first_layer_id,
                    layer_name=first_lname,
                    column_name=column_name,
                    display_name=display_name,
                    rule_type="cross_layer",
                    message=(
                        f"설비 {equipment_id}에 배정된 레이어들의 "
                        f"{column_name} 값이 일치하지 않습니다: {layer_values_str}"
                    ),
                    metadata={
                        "check_type": "equipment_compatibility",
                    },
                ))

        elif compatibility == "within_range" and range_tolerance is not None:
            # 모든 값이 mean 기준 range_tolerance 이내여야 함
            mean_val = sum(values_only) / len(values_only)

            # mean이 0이고 모든 값이 0이면 통과
            if mean_val == 0:
                continue

            violations = []
            for lname, val in layer_values:
                deviation = abs(val - mean_val) / abs(mean_val)
                if deviation > float(range_tolerance):
                    violations.append((lname, val))

            if violations:
                layer_values_str = ", ".join(
                    f"{lname}={val}" for lname, val in layer_values
                )
                first_pl, first_lname = group_layers[0]
                first_layer_id = first_pl.layer_id
                errors.append(ValidationErrorItem(
                    layer_id=first_layer_id,
                    layer_name=first_lname,
                    column_name=column_name,
                    display_name=display_name,
                    rule_type="cross_layer",
                    message=(
                        f"설비 {equipment_id}에 배정된 레이어들의 "
                        f"{column_name} 값이 일치하지 않습니다: {layer_values_str}"
                    ),
                    metadata={
                        "check_type": "equipment_compatibility",
                    },
                ))


async def validate_cross_layer_rules(
    db: AsyncSession,
    project_layers: list,
    errors: list,
) -> None:
    """크로스 레이어 검증 규칙 실행.

    cross_layer rule_type 규칙들을 필터링하여 각 check_type별 핸들러를 호출한다.
    결과 에러는 errors 리스트에 직접 추가(append)한다.
    """
    # cross_layer 규칙이 있는 컬럼 정의를 모두 로드
    result = await db.execute(
        select(ColumnDefinition, ColumnValidation)
        .join(ColumnValidation, ColumnValidation.column_id == ColumnDefinition.id)
        .where(
            ColumnValidation.rule_type == "cross_layer",
            ColumnValidation.is_active.is_(True),
        )
    )
    rows = result.all()

    # cross_layer 규칙이 없으면 조기 반환
    if not rows:
        return

    # col_by_name: column_name -> {"display_name": ..., "col_def": ...} 딕셔너리 구축
    col_by_name: dict[str, dict] = {}
    cross_layer_rules: list[ColumnValidation] = []

    for col_def, rule in rows:
        col_by_name[col_def.column_name] = {
            "display_name": col_def.display_name,
        }
        cross_layer_rules.append(rule)

    # step_seq → project_layer 및 layer_name → project_layer 매핑 구축 (한 번만 수행)
    # OVL_REF_LAYER 등 layer_ref 컬럼은 step_seq를 저장하므로 step_seq 기반 매핑이 주요 검색 경로
    step_seq_to_pl: dict[str, object] = {}
    layer_name_to_pl: dict[str, object] = {}
    step_seqs: set[str] = set()
    layer_names: set[str] = set()

    for pl in project_layers:
        if pl.layer_name:
            layer_name_to_pl[pl.layer_name] = pl
            layer_names.add(pl.layer_name)
        if pl.step_seq:
            step_seq_to_pl[pl.step_seq] = pl
            step_seqs.add(pl.step_seq)

    # equipment_compatibility 규칙 존재 여부 확인 (lazy loading)
    has_equipment_rules = any(
        r.rule_config.get("check_type") == "equipment_compatibility"
        for r in cross_layer_rules
    )

    # equipment_groups: equipment_id -> [(project_layer, layer_name), ...]
    equipment_groups: dict[str, list] = {}
    if has_equipment_rules:
        # EQP 컬럼(EQP_01~EQP_20)에서 설비 정보를 읽어 그룹핑
        # EquipmentAssignment 테이블 대신 conditions JSONB의 EQP 슬롯을 직접 사용
        for pl in project_layers:
            lname = pl.layer_name
            if not lname:
                continue
            conditions = pl.conditions or {}
            for slot in range(1, 21):
                nn = f"{slot:02d}"
                eq_id = conditions.get(f"EQP_{nn}", "")
                if not eq_id:
                    continue
                if eq_id not in equipment_groups:
                    equipment_groups[eq_id] = []
                equipment_groups[eq_id].append((pl, lname))

    # 각 규칙 및 레이어에 대해 검증 수행
    for rule in cross_layer_rules:
        check_type = rule.rule_config.get("check_type")

        if check_type == "reference_exists":
            # 모든 레이어에 대해 참조 존재 여부 검증
            for pl in project_layers:
                lname = pl.layer_name
                if not lname:
                    continue
                _validate_reference_exists(
                    rule, pl, lname, step_seqs, layer_names, col_by_name, errors
                )

        elif check_type == "compare_layers":
            # 모든 레이어에 대해 레이어 간 값 비교 검증
            for pl in project_layers:
                lname = pl.layer_name
                if not lname:
                    continue
                _validate_compare_layers(
                    rule, pl, lname, step_seq_to_pl, layer_name_to_pl,
                    col_by_name, errors,
                )

        elif check_type == "equipment_compatibility":
            # 설비 그룹 단위로 호환성 검증
            _validate_equipment_compatibility(
                rule, equipment_groups, col_by_name, errors
            )
