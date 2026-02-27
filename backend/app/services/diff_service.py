"""버전 Diff 서비스 - 두 프로젝트 버전 간의 JSONB 조건 데이터 비교."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from fastapi import HTTPException

from app.models import Project, ProjectLayer
from app.utils.comparison import values_differ


# Helper to parse layer_id (str like "1.0", "17.31") for numeric sorting
def _layer_sort_key(layer_id: str) -> float:
    try:
        return float(layer_id)
    except (ValueError, TypeError):
        return float("inf")


async def get_version_diff(
    db: AsyncSession,
    project_id: int,
    compare_project_id: int,
) -> dict:
    """두 프로젝트 버전의 조건 데이터를 비교하여 diff 결과를 반환한다.

    Args:
        db: 비동기 DB 세션
        project_id: 기준(base) 프로젝트 ID
        compare_project_id: 비교 대상 프로젝트 ID

    Returns:
        VersionDiffResponse 스키마에 맞는 dict

    Raises:
        HTTPException 404: 프로젝트가 존재하지 않을 경우
        HTTPException 400: 두 프로젝트의 product_id가 다를 경우
    """
    # 1. 두 프로젝트를 project_layers와 함께 eager load
    base_result = await db.execute(
        select(Project)
        .options(
            selectinload(Project.layers),
        )
        .where(Project.id == project_id)
    )
    base_project = base_result.scalars().first()

    if not base_project:
        raise HTTPException(status_code=404, detail=f"프로젝트 {project_id}를 찾을 수 없습니다.")

    compare_result = await db.execute(
        select(Project)
        .options(
            selectinload(Project.layers),
        )
        .where(Project.id == compare_project_id)
    )
    compare_project = compare_result.scalars().first()

    if not compare_project:
        raise HTTPException(status_code=404, detail=f"프로젝트 {compare_project_id}를 찾을 수 없습니다.")

    # 2. 동일 product 여부 검증
    if base_project.product_id != compare_project.product_id:
        raise HTTPException(
            status_code=400,
            detail="두 프로젝트가 서로 다른 제품(product)에 속해 있어 비교할 수 없습니다.",
        )

    # 3. layer_id 기준으로 레이어 조회 딕셔너리 구성
    base_layers: dict[str, ProjectLayer] = {pl.layer_id: pl for pl in base_project.layers}
    compare_layers: dict[str, ProjectLayer] = {pl.layer_id: pl for pl in compare_project.layers}

    # 4. 두 프로젝트에 존재하는 모든 layer_id 합집합
    all_layer_ids = set(base_layers.keys()) | set(compare_layers.keys())

    layer_diffs = []
    total_cells_changed = 0

    for layer_id in sorted(all_layer_ids, key=_layer_sort_key):
        base_pl = base_layers.get(layer_id)
        compare_pl = compare_layers.get(layer_id)

        if base_pl is None:
            # 비교 버전에만 존재 → "added" (base 기준으로 새로 추가된 레이어)
            layer_name = compare_pl.layer_name or f"Layer {layer_id}"
            conditions = compare_pl.conditions or {}
            changes = [
                {
                    "column_name": col,
                    "old_value": None,
                    "new_value": str(val) if val is not None else None,
                }
                for col, val in conditions.items()
                if val is not None and str(val).strip() != ""
            ]
            if changes:
                layer_diffs.append({
                    "layer_id": layer_id,
                    "layer_name": layer_name,
                    "change_type": "added",
                    "changes": changes,
                })
                total_cells_changed += len(changes)

        elif compare_pl is None:
            # 기준 버전에만 존재 → "removed" (compare 버전에서 제거된 레이어)
            layer_name = base_pl.layer_name or f"Layer {layer_id}"
            conditions = base_pl.conditions or {}
            changes = [
                {
                    "column_name": col,
                    "old_value": str(val) if val is not None else None,
                    "new_value": None,
                }
                for col, val in conditions.items()
                if val is not None and str(val).strip() != ""
            ]
            if changes:
                layer_diffs.append({
                    "layer_id": layer_id,
                    "layer_name": layer_name,
                    "change_type": "removed",
                    "changes": changes,
                })
                total_cells_changed += len(changes)

        else:
            # 양쪽 모두 존재 → 컬럼별 값 비교
            layer_name = base_pl.layer_name or f"Layer {layer_id}"
            base_conditions = base_pl.conditions or {}
            compare_conditions = compare_pl.conditions or {}

            # 두 conditions dict 키 합집합
            all_columns = set(base_conditions.keys()) | set(compare_conditions.keys())

            changes = []
            for col in sorted(all_columns):
                old_val = base_conditions.get(col)
                new_val = compare_conditions.get(col)
                if values_differ(old_val, new_val):
                    changes.append({
                        "column_name": col,
                        "old_value": str(old_val) if old_val is not None else None,
                        "new_value": str(new_val) if new_val is not None else None,
                    })

            if changes:
                layer_diffs.append({
                    "layer_id": layer_id,
                    "layer_name": layer_name,
                    "change_type": "modified",
                    "changes": changes,
                })
                total_cells_changed += len(changes)

    # 5. 최종 결과 구성
    return {
        "base_project_id": project_id,
        "compare_project_id": compare_project_id,
        "base_revision": base_project.revision,
        "compare_revision": compare_project.revision,
        "summary": {
            "total_layers_changed": len(layer_diffs),
            "total_cells_changed": total_cells_changed,
        },
        "layers": layer_diffs,
    }
