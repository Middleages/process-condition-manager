"""시트 조회 API 테스트.

최소 커버리지:
- 컬럼 정의는 live 파라미터만 (비활성 제외), category/ChoiceSet 참조 매핑
- 행이 layer(sort_order)/condition(condition_index) 순으로 정렬
- 셀 희소 표현 (빈 값 생략)
- 존재하지 않는 project_id → 404
- 잠금 요약이 edit_lock 실조회를 반영 (미잠금/내 잠금/타인 잠금/만료)
"""

from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import DomainValidationError
from app.domain.parameters.types import ValueType
from app.features.sheets.service import _build_live_columns
from app.models.parameter import Parameter, ParameterCategory
from app.models.project import (
    CellValue,
    EditLock,
    LayerCondition,
    Project,
    ProjectStatus,
    SheetLayer,
)
from tests.factories import seed_choice_set, seed_parameter


async def _seed_lock(
    session: AsyncSession, project_id: int, *, locked_by: str, minutes: int = 5
) -> None:
    """edit_lock 행을 직접 심는다. minutes<0이면 만료 잠금을 만든다."""
    now = datetime.now(UTC)
    session.add(
        EditLock(
            project_id=project_id,
            locked_by=locked_by,
            lock_token="seed-token",
            locked_at=now,
            expires_at=now + timedelta(minutes=minutes),
        )
    )
    await session.commit()


async def _seed_parameters(session: AsyncSession) -> None:
    """활성 2개(number/choice) + 비활성 1개 파라미터를 카테고리와 함께 심는다."""
    category = ParameterCategory(code="photo", display_name="PHOTO", sort_order=0)
    session.add(category)
    await session.flush()

    number_param = Parameter(
        code="spin_speed",
        display_name="Spin Speed",
        description="회전 속도",
        value_type=ValueType.NUMBER,
        category_id=category.id,
        unit="rpm",
        sort_order=1,
    )
    equipment_mode = await seed_choice_set(
        session,
        code="equipment_mode",
        options=(
            ("A", "A", True),
            ("B", "B", True),
            ("LEGACY", "Legacy", False),
        ),
    )
    choice_param = await seed_parameter(
        session,
        code="pr_type",
        value_type=ValueType.CHOICE,
        choice_set=equipment_mode,
    )
    choice_param.display_name = "PR Type"
    choice_param.sort_order = 2
    choice_param.category = None
    inactive_param = Parameter(
        code="legacy_flag",
        display_name="Legacy",
        value_type=ValueType.TEXT,
        sort_order=3,
        is_active=False,
    )
    session.add_all([number_param, choice_param, inactive_param])
    await session.flush()


async def _seed_project(session: AsyncSession) -> int:
    """2 layer 프로젝트를 심는다.

    - layer 정렬 검증: 삽입 순서와 반대로 sort_order 부여 (B가 먼저 와야 한다)
    - 조건 행 정렬 검증: condition_index 역순으로 삽입
    - 희소 검증: 한 셀은 값 없음(None)으로 심어 응답에서 생략되는지 본다
    """
    project = Project(
        line_id="L1",
        process_id="PROC_X",
        part_id="PART-1",
        name="시트 테스트",
        status=ProjectStatus.DRAFT,
    )

    layer_a = SheetLayer(
        layer_key="L1::PROC_X::020::ACT",
        step_seq="020",
        layer_id="ACT",
        sort_order=2,
    )
    layer_b = SheetLayer(
        layer_key="L1::PROC_X::010::CLN",
        step_seq="010",
        layer_id="CLN",
        sort_order=1,
    )

    # layer_a: 조건 행 2개를 index 역순으로 추가 (정렬로 1→2 재배열되어야 함)
    cond_a2 = LayerCondition(label="C2", condition_index=2, is_por=False)
    cond_a1 = LayerCondition(label="base", condition_index=1, is_por=True)
    cond_a1.cell_values.extend(
        [
            CellValue(parameter_code="spin_speed", value_text="1200"),
            CellValue(parameter_code="pr_type", value_text="A"),
            # 값 없는 셀 — 응답 cells에서 생략되어야 한다.
            CellValue(parameter_code="legacy_flag", value_text=None),
        ]
    )
    layer_a.conditions.extend([cond_a2, cond_a1])

    cond_b1 = LayerCondition(label="base", condition_index=1, is_por=True)
    cond_b1.cell_values.append(CellValue(parameter_code="spin_speed", value_text="900"))
    layer_b.conditions.append(cond_b1)

    # 삽입 순서: A 먼저 (sort_order가 큼) — 정렬이 실제로 동작하는지 확인용
    project.layers.extend([layer_a, layer_b])
    session.add(project)
    await session.flush()
    project_id = project.id
    await session.commit()
    return project_id


async def test_sheet_columns_include_only_live_parameters(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    await _seed_parameters(db_session)
    project_id = await _seed_project(db_session)

    resp = await db_client.get(f"/api/projects/{project_id}/sheet")

    assert resp.status_code == 200, resp.text
    columns = resp.json()["columns"]
    codes = [column["parameter_code"] for column in columns]
    # 비활성(legacy_flag) 제외, sort_order 순.
    assert codes == ["spin_speed", "pr_type"]


async def test_sheet_column_metadata_maps_category_and_choices(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    await _seed_parameters(db_session)
    project_id = await _seed_project(db_session)

    resp = await db_client.get(f"/api/projects/{project_id}/sheet")

    columns = {column["parameter_code"]: column for column in resp.json()["columns"]}
    spin = columns["spin_speed"]
    assert spin["value_type"] == "number"
    assert spin["category_code"] == "photo"
    assert spin["unit"] == "rpm"
    assert spin["choice_set_code"] is None
    assert spin["choice_set_version"] is None
    assert "choice_options" not in spin

    pr = columns["pr_type"]
    assert pr["value_type"] == "choice"
    assert pr["category_code"] is None
    assert pr["choice_set_code"] == "equipment_mode"
    assert pr["choice_set_version"] == 1
    assert "choice_options" not in pr


def test_broken_choice_parameter_is_not_projected() -> None:
    parameter = Parameter(
        code="broken_choice",
        display_name="Broken",
        value_type=ValueType.CHOICE,
        choice_set=None,
    )
    with pytest.raises(DomainValidationError):
        _build_live_columns([parameter], {})


async def test_sheet_rows_sorted_by_layer_and_condition_index(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    await _seed_parameters(db_session)
    project_id = await _seed_project(db_session)

    resp = await db_client.get(f"/api/projects/{project_id}/sheet")

    rows = resp.json()["rows"]
    # layer_b(sort_order=1) 먼저, 그 다음 layer_a의 조건 행이 index 1→2 순.
    assert [(row["layer_key"], row["condition_label"]) for row in rows] == [
        ("L1::PROC_X::010::CLN", "base"),
        ("L1::PROC_X::020::ACT", "base"),
        ("L1::PROC_X::020::ACT", "C2"),
    ]
    # P1-D3 병기 라벨.
    assert rows[0]["layer_label"] == "CLN (010)"
    assert rows[0]["is_por"] is True


async def test_sheet_cells_are_sparse(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    await _seed_parameters(db_session)
    project_id = await _seed_project(db_session)

    resp = await db_client.get(f"/api/projects/{project_id}/sheet")

    rows = resp.json()["rows"]
    base_row = next(
        row
        for row in rows
        if row["layer_key"] == "L1::PROC_X::020::ACT" and row["condition_label"] == "base"
    )
    # 값 있는 셀만 포함, 값 없는 legacy_flag는 생략.
    assert base_row["cells"] == {"spin_speed": "1200", "pr_type": "A"}
    assert "legacy_flag" not in base_row["cells"]

    # 조건 행에 셀이 하나도 없으면 빈 dict.
    empty_row = next(row for row in rows if row["condition_label"] == "C2")
    assert empty_row["cells"] == {}


async def test_sheet_lock_summary_unlocked(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    await _seed_parameters(db_session)
    project_id = await _seed_project(db_session)

    resp = await db_client.get(f"/api/projects/{project_id}/sheet")

    # 잠금이 없으면 전부 None + is_mine=False (누구나 획득 가능하다는 의미).
    assert resp.json()["lock"] == {
        "locked_by": None,
        "locked_at": None,
        "expires_at": None,
        "is_mine": False,
        "heartbeat_seconds": 45,
    }


async def test_sheet_lock_summary_locked_by_me(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    await _seed_parameters(db_session)
    project_id = await _seed_project(db_session)
    # 인증 스텁 사용자(dev-admin)가 보유 → is_mine=True.
    await _seed_lock(db_session, project_id, locked_by="dev-admin")

    resp = await db_client.get(f"/api/projects/{project_id}/sheet")

    lock = resp.json()["lock"]
    assert lock["locked_by"] == "dev-admin"
    assert lock["is_mine"] is True
    assert lock["locked_at"] is not None
    assert lock["expires_at"] is not None
    assert lock["heartbeat_seconds"] == 45


async def test_sheet_lock_summary_locked_by_other(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    await _seed_parameters(db_session)
    project_id = await _seed_project(db_session)
    await _seed_lock(db_session, project_id, locked_by="someone-else")

    resp = await db_client.get(f"/api/projects/{project_id}/sheet")

    lock = resp.json()["lock"]
    assert lock["locked_by"] == "someone-else"
    assert lock["is_mine"] is False
    assert lock["expires_at"] is not None


async def test_sheet_lock_summary_expired_reads_as_unlocked(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    await _seed_parameters(db_session)
    project_id = await _seed_project(db_session)
    # 만료 잠금은 미잠금으로 취급된다.
    await _seed_lock(db_session, project_id, locked_by="dev-admin", minutes=-5)

    resp = await db_client.get(f"/api/projects/{project_id}/sheet")

    assert resp.json()["lock"] == {
        "locked_by": None,
        "locked_at": None,
        "expires_at": None,
        "is_mine": False,
        "heartbeat_seconds": 45,
    }


async def test_sheet_unknown_project_returns_404(db_client: AsyncClient) -> None:
    resp = await db_client.get("/api/projects/999999/sheet")

    assert resp.status_code == 404
    assert resp.json()["code"] == "not_found"
