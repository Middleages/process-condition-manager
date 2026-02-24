"""EQP 카테고리 컬럼 추가 및 equipment_assignments 테이블 제거.

equipment_assignments 테이블을 삭제하고, 설비 할당 정보를
conditions/backbone_conditions JSONB 내의 EQP_xx 컬럼으로 이관한다.

변경 내용:
1. column_categories에 EQP 카테고리 삽입
2. column_definitions에 EQP_01~EQP_20 (name/ET/FOCUS) 60개 컬럼 삽입
3. equipment_assignments 데이터를 읽어 project_layers.conditions에 EQP 컬럼으로 병합
4. EQP-SCANNER export_system의 additional_config 업데이트
5. equipment_assignments 테이블 삭제

Revision ID: 015_eqp_columns_replace_equipment_assignments
Revises: 014_drop_is_backbone_column
Create Date: 2026-02-24
"""
import json

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "015_eqp_columns_replace_equipment_assignments"
down_revision = "014_drop_is_backbone_column"
branch_labels = None
depends_on = None

# 스캐너 장비 선택 옵션 (columns.py의 SCANNER_TOOL_OPTIONS와 동일해야 함)
_SCANNER_TOOL_OPTIONS = [
    "NSR-S322F-01", "NSR-S322F-02", "NSR-S322F-03",
    "NSR-S631E-01", "XT-1400E-01",
    "XT-1900Gi-01", "XT-1900Gi-02", "NXT-2000-01",
    "EUV-3400-01", "EUV-3400-02",
]

# EQP 컬럼 정의: (column_name, display_name, data_type, unit, sort_order, select_options)
# sort_order: (slot-1)*3 + 1 for name, +2 for ET, +3 for FOCUS
def _build_eqp_column_defs() -> list[dict]:
    """EQP 카테고리 60개 컬럼 정의를 생성."""
    cols = []
    for slot in range(1, 21):
        base_sort = (slot - 1) * 3
        slot_str = f"{slot:02d}"
        # 스캐너 장비명 컬럼 (select)
        cols.append({
            "column_name": f"EQP_{slot_str}",
            "display_name": f"Scanner #{slot_str}",
            "data_type": "select",
            "unit": None,
            "sort_order": base_sort + 1,
            "select_options": json.dumps(_SCANNER_TOOL_OPTIONS),
            "is_required": False,
        })
        # 노광 에너지 컬럼 (float, mJ)
        cols.append({
            "column_name": f"EQP_{slot_str}_ET",
            "display_name": f"Scanner #{slot_str} Energy",
            "data_type": "float",
            "unit": "mJ",
            "sort_order": base_sort + 2,
            "select_options": None,
            "is_required": False,
        })
        # 포커스 오프셋 컬럼 (float, um)
        cols.append({
            "column_name": f"EQP_{slot_str}_FOCUS",
            "display_name": f"Scanner #{slot_str} Focus",
            "data_type": "float",
            "unit": "um",
            "sort_order": base_sort + 3,
            "select_options": None,
            "is_required": False,
        })
    return cols


def upgrade() -> None:
    conn = op.get_bind()

    # -----------------------------------------------------------------------
    # 1. EQP 카테고리 삽입 (이미 존재하면 스킵)
    # -----------------------------------------------------------------------
    result = conn.execute(
        sa.text("SELECT id FROM column_categories WHERE category_code = 'EQP'")
    )
    existing_cat = result.fetchone()
    if existing_cat is None:
        conn.execute(
            sa.text(
                "INSERT INTO column_categories (category_code, category_name, sort_order) "
                "VALUES ('EQP', 'Equipment', 5)"
            )
        )

    # EQP 카테고리 ID 조회
    result = conn.execute(
        sa.text("SELECT id FROM column_categories WHERE category_code = 'EQP'")
    )
    eqp_cat_id = result.scalar()

    # -----------------------------------------------------------------------
    # 2. EQP 컬럼 정의 60개 삽입 (이미 존재하면 스킵)
    # -----------------------------------------------------------------------
    for col_def in _build_eqp_column_defs():
        existing = conn.execute(
            sa.text(
                "SELECT id FROM column_definitions WHERE column_name = :name"
            ),
            {"name": col_def["column_name"]},
        ).fetchone()
        if existing is not None:
            continue

        conn.execute(
            sa.text(
                "INSERT INTO column_definitions "
                "(column_name, display_name, category_id, data_type, unit, sort_order, "
                "is_required, select_options) "
                "VALUES (:name, :display, :cat_id, :dtype, :unit, :sort, :req, "
                "CAST(:sel AS jsonb))"
            ),
            {
                "name": col_def["column_name"],
                "display": col_def["display_name"],
                "cat_id": eqp_cat_id,
                "dtype": col_def["data_type"],
                "unit": col_def["unit"],
                "sort": col_def["sort_order"],
                "req": col_def["is_required"],
                "sel": col_def["select_options"],
            },
        )

    # -----------------------------------------------------------------------
    # 3. equipment_assignments 데이터를 conditions JSONB에 이관
    #    배치 처리: 메모리 부담을 줄이기 위해 project_layer_id 단위로 처리
    # -----------------------------------------------------------------------

    # equipment_assignments 테이블이 존재하는지 확인
    table_exists = conn.execute(
        sa.text(
            "SELECT EXISTS ("
            "  SELECT 1 FROM information_schema.tables "
            "  WHERE table_schema = 'public' AND table_name = 'equipment_assignments'"
            ")"
        )
    ).scalar()

    if table_exists:
        # equipment_assignments에 데이터가 있는 project_layer_id 목록 조회
        pl_ids_result = conn.execute(
            sa.text(
                "SELECT DISTINCT project_layer_id FROM equipment_assignments "
                "ORDER BY project_layer_id"
            )
        )
        pl_ids = [row[0] for row in pl_ids_result]

        # 각 project_layer_id에 대해 EQP 컬럼을 생성하여 conditions에 병합
        for pl_id in pl_ids:
            # 해당 레이어의 설비 할당 목록 조회 (sort_order 순)
            assignments = conn.execute(
                sa.text(
                    "SELECT equipment_id, equipment_params, sort_order "
                    "FROM equipment_assignments "
                    "WHERE project_layer_id = :plid "
                    "ORDER BY sort_order"
                ),
                {"plid": pl_id},
            ).fetchall()

            # EQP 컬럼 딕셔너리 생성
            eqp_patch: dict = {}
            for idx, (equip_id, equip_params_raw, _sort) in enumerate(assignments, start=1):
                slot = f"{idx:02d}"
                eqp_patch[f"EQP_{slot}"] = equip_id

                # equipment_params는 JSONB (dict 또는 None)
                if equip_params_raw is not None:
                    if isinstance(equip_params_raw, str):
                        params = json.loads(equip_params_raw)
                    else:
                        params = equip_params_raw

                    energy = params.get("SC_EXPOSE_ENERGY_mJ")
                    focus = params.get("SC_EXPOSE_FOCUS_um")
                    if energy is not None:
                        try:
                            eqp_patch[f"EQP_{slot}_ET"] = float(energy)
                        except (ValueError, TypeError):
                            pass
                    if focus is not None:
                        try:
                            eqp_patch[f"EQP_{slot}_FOCUS"] = float(focus)
                        except (ValueError, TypeError):
                            pass

            if not eqp_patch:
                continue

            # conditions 및 backbone_conditions에 EQP 컬럼 병합 (PostgreSQL || 연산자)
            conn.execute(
                sa.text(
                    "UPDATE project_layers "
                    "SET "
                    "  conditions = conditions || CAST(:patch AS jsonb), "
                    "  backbone_conditions = COALESCE(backbone_conditions, '{}'::jsonb) "
                    "                        || CAST(:patch AS jsonb) "
                    "WHERE id = :plid"
                ),
                {"patch": json.dumps(eqp_patch), "plid": pl_id},
            )

        # -----------------------------------------------------------------------
        # 4. EQP-SCANNER export_system additional_config 업데이트
        # -----------------------------------------------------------------------
        conn.execute(
            sa.text(
                "UPDATE export_systems "
                "SET additional_config = additional_config "
                "  || jsonb_build_object("
                "       'equip_source', 'conditions_eqp_columns',"
                "       'equip_vary_mapping', "
                "         jsonb_build_object("
                "           'SC_EXPOSE_ENERGY_mJ', '_ET',"
                "           'SC_EXPOSE_FOCUS_um', '_FOCUS'"
                "         )"
                "     ) "
                "  - 'equip_vary_columns' "
                "WHERE system_name = 'EQP-SCANNER'"
            )
        )

        # -----------------------------------------------------------------------
        # 5. equipment_assignments 테이블 삭제
        # -----------------------------------------------------------------------
        op.drop_table("equipment_assignments")
    else:
        # 테이블이 이미 없으면 export_system config만 업데이트
        conn.execute(
            sa.text(
                "UPDATE export_systems "
                "SET additional_config = additional_config "
                "  || jsonb_build_object("
                "       'equip_source', 'conditions_eqp_columns',"
                "       'equip_vary_mapping', "
                "         jsonb_build_object("
                "           'SC_EXPOSE_ENERGY_mJ', '_ET',"
                "           'SC_EXPOSE_FOCUS_um', '_FOCUS'"
                "         )"
                "     ) "
                "  - 'equip_vary_columns' "
                "WHERE system_name = 'EQP-SCANNER'"
            )
        )


def downgrade() -> None:
    conn = op.get_bind()

    # -----------------------------------------------------------------------
    # 1. equipment_assignments 테이블 재생성
    # -----------------------------------------------------------------------
    op.create_table(
        "equipment_assignments",
        sa.Column("id", sa.Integer(), nullable=False, primary_key=True),
        sa.Column(
            "project_layer_id",
            sa.Integer(),
            sa.ForeignKey("project_layers.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("equipment_id", sa.String(50), nullable=False),
        sa.Column(
            "equipment_params",
            JSONB(),
            nullable=True,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )

    # -----------------------------------------------------------------------
    # 2. conditions JSONB의 EQP 컬럼 데이터를 equipment_assignments에 복원
    # -----------------------------------------------------------------------
    # EQP_01~EQP_20이 있는 project_layer 목록 조회
    pl_result = conn.execute(
        sa.text(
            "SELECT id, conditions FROM project_layers "
            "WHERE conditions ? 'EQP_01' "
            "ORDER BY id"
        )
    )
    rows = pl_result.fetchall()

    for pl_id, conditions_raw in rows:
        if conditions_raw is None:
            continue
        if isinstance(conditions_raw, str):
            conditions = json.loads(conditions_raw)
        else:
            conditions = conditions_raw

        # EQP_01~EQP_20 순서로 equipment_assignments 복원
        for slot in range(1, 21):
            slot_str = f"{slot:02d}"
            equip_id = conditions.get(f"EQP_{slot_str}")
            if not equip_id:
                continue

            params: dict = {}
            et_val = conditions.get(f"EQP_{slot_str}_ET")
            focus_val = conditions.get(f"EQP_{slot_str}_FOCUS")
            if et_val is not None:
                params["SC_EXPOSE_ENERGY_mJ"] = str(et_val)
            if focus_val is not None:
                params["SC_EXPOSE_FOCUS_um"] = str(focus_val)

            conn.execute(
                sa.text(
                    "INSERT INTO equipment_assignments "
                    "(project_layer_id, equipment_id, equipment_params, sort_order) "
                    "VALUES (:plid, :eid, CAST(:params AS jsonb), :sort)"
                ),
                {
                    "plid": pl_id,
                    "eid": equip_id,
                    "params": json.dumps(params),
                    "sort": slot,
                },
            )

    # -----------------------------------------------------------------------
    # 3. conditions 및 backbone_conditions에서 EQP 키 제거
    #    PostgreSQL 배열 집계로 EQP 키 목록 생성 후 일괄 제거
    # -----------------------------------------------------------------------
    eqp_keys = []
    for slot in range(1, 21):
        slot_str = f"{slot:02d}"
        eqp_keys.extend([
            f"EQP_{slot_str}",
            f"EQP_{slot_str}_ET",
            f"EQP_{slot_str}_FOCUS",
        ])

    # PostgreSQL: jsonb - text[] 연산자로 여러 키를 한번에 제거
    keys_array = "{" + ",".join(eqp_keys) + "}"
    conn.execute(
        sa.text(
            "UPDATE project_layers "
            "SET "
            "  conditions = conditions - CAST(:keys AS text[]), "
            "  backbone_conditions = COALESCE(backbone_conditions, '{}'::jsonb) "
            "                        - CAST(:keys AS text[]) "
            "WHERE conditions ?| CAST(:keys AS text[])"
        ),
        {"keys": keys_array},
    )

    # -----------------------------------------------------------------------
    # 4. EQP 컬럼 정의 및 카테고리 삭제
    # -----------------------------------------------------------------------
    # EQP 카테고리 ID 조회
    result = conn.execute(
        sa.text("SELECT id FROM column_categories WHERE category_code = 'EQP'")
    )
    eqp_cat = result.fetchone()
    if eqp_cat is not None:
        # EQP 카테고리에 속한 컬럼 정의 삭제
        conn.execute(
            sa.text(
                "DELETE FROM column_definitions WHERE category_id = :cat_id"
            ),
            {"cat_id": eqp_cat[0]},
        )
        # EQP 카테고리 삭제
        conn.execute(
            sa.text(
                "DELETE FROM column_categories WHERE category_code = 'EQP'"
            )
        )

    # -----------------------------------------------------------------------
    # 5. EQP-SCANNER export_system additional_config 원복
    # -----------------------------------------------------------------------
    conn.execute(
        sa.text(
            "UPDATE export_systems "
            "SET additional_config = (additional_config - 'equip_source' - 'equip_vary_mapping') "
            "  || jsonb_build_object("
            "       'equip_source', 'equipment_assignments',"
            "       'equip_vary_columns', "
            "         jsonb_build_array('SC_EXPOSE_ENERGY_mJ', 'SC_EXPOSE_FOCUS_um')"
            "     ) "
            "WHERE system_name = 'EQP-SCANNER'"
        )
    )
