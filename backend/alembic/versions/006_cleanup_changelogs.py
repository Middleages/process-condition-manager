"""change_logs 테이블에서 거짓 양성(false positive) 레코드 정리

수치 비교 버그로 인해 실제로 동일한 값임에도 변경 기록이 남은 경우를 삭제한다.
대상:
  - old_value와 new_value가 모두 존재하고 수치적으로 동일한 경우 (예: "490" vs "490.0")
  - old_value가 NULL이고 new_value가 빈 문자열('')인 경우 (또는 반대)

Revision ID: 006_cleanup_changelogs
Revises: 005_equipment_assignments
Create Date: 2026-02-18
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

revision = "006_cleanup_changelogs"
down_revision = "005_equipment_assignments"
branch_labels = None
depends_on = None


_BATCH_SIZE = 1000


def upgrade() -> None:
    conn = op.get_bind()

    total_deleted = 0

    # -------------------------------------------------------------------
    # 1단계: None vs 빈 문자열 동치 정리
    #   old_value IS NULL AND new_value = '' 또는 반대 경우 삭제
    # -------------------------------------------------------------------
    result = conn.execute(
        text(
            "DELETE FROM change_logs "
            "WHERE (old_value IS NULL AND new_value = '') "
            "   OR (old_value = '' AND new_value IS NULL)"
        )
    )
    null_empty_deleted = result.rowcount
    total_deleted += null_empty_deleted
    print(f"[006] None/빈문자열 동치 레코드 삭제: {null_empty_deleted}건")

    # -------------------------------------------------------------------
    # 2단계: 수치 동치 정리 (490 vs 490.0, "490" vs 490 등)
    #   배치 처리로 메모리 효율 확보
    # -------------------------------------------------------------------
    numeric_deleted = 0

    while True:
        # old_value와 new_value가 모두 존재하고 수치 파싱이 가능한 행 조회
        rows = conn.execute(
            text(
                "SELECT id, old_value, new_value "
                "FROM change_logs "
                "WHERE old_value IS NOT NULL "
                "  AND new_value IS NOT NULL "
                "  AND old_value != '' "
                "  AND new_value != '' "
                "LIMIT :batch_size"
            ),
            {"batch_size": _BATCH_SIZE},
        ).fetchall()

        if not rows:
            break

        # Python에서 수치 동치 판별 후 삭제 대상 ID 수집
        ids_to_delete = []
        for row in rows:
            row_id, old_val, new_val = row
            if _are_numerically_equal(old_val, new_val):
                ids_to_delete.append(row_id)

        if ids_to_delete:
            conn.execute(
                text("DELETE FROM change_logs WHERE id = ANY(:ids)"),
                {"ids": ids_to_delete},
            )
            numeric_deleted += len(ids_to_delete)

        # 삭제 대상이 없는 배치가 나오면 종료 (무한 루프 방지)
        if len(ids_to_delete) == 0:
            break

    print(f"[006] 수치 동치 레코드 삭제: {numeric_deleted}건")
    total_deleted += numeric_deleted
    print(f"[006] 전체 삭제 완료: {total_deleted}건")


def downgrade() -> None:
    # 데이터 정리 마이그레이션은 되돌릴 수 없다 (삭제된 데이터 복원 불가)
    pass


# ---------------------------------------------------------------------------
# 내부 헬퍼
# ---------------------------------------------------------------------------

def _are_numerically_equal(old_val: str, new_val: str) -> bool:
    """두 문자열 값이 수치적으로 동일한지 판별한다.

    예: "490" == "490.0", "1.0" == "1", "0.50" == "0.5"
    """
    try:
        a = float(old_val)
        b = float(new_val)
        # NaN은 자기 자신과 같지 않으므로 동치로 간주하지 않음
        if a != a or b != b:
            return False
        return a == b
    except (ValueError, TypeError):
        return False
