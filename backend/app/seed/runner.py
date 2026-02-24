"""Main seed orchestration function."""
import json
import random

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.config import settings
from app.services.auth_service import get_password_hash
from app.seed.columns import CATEGORIES, COLUMN_DEFS, VALIDATION_RULES
from app.seed.layers import LAYERS, LAYER_NAMES, LAYER_PROFILES
from app.seed.products import LINES, PRODUCTS, NON_BACKBONE_PRODUCTS, generate_conditions
from app.seed.exports import _build_export_target_names, seed_external_data_sources
from app.seed.users import USERS

engine = create_engine(settings.DATABASE_URL_SYNC)


# ---------------------------------------------------------------------------
# 12. Main seed function
# ---------------------------------------------------------------------------

def seed():
    random.seed(42)  # reproducible

    with Session(engine) as session:
        # Idempotency check
        result = session.execute(text("SELECT count(*) FROM column_categories"))
        if result.scalar() > 0:
            print("Database already seeded. Skipping.")
            return

        print("Seeding database...")

        # --- Categories ---
        cat_ids = {}
        for cat in CATEGORIES:
            session.execute(
                text("INSERT INTO column_categories (category_code, category_name, sort_order) "
                     "VALUES (:code, :name, :order) RETURNING id"),
                {"code": cat["category_code"], "name": cat["category_name"], "order": cat["sort_order"]},
            )
            result = session.execute(
                text("SELECT id FROM column_categories WHERE category_code = :code"),
                {"code": cat["category_code"]},
            )
            cat_ids[cat["category_code"]] = result.scalar()
        print(f"  Categories: {len(cat_ids)}")

        # --- Column Definitions ---
        col_ids = {}
        for i, col_def in enumerate(COLUMN_DEFS):
            col_name, display, cat_code, dtype, unit, is_req, sel_opts = col_def
            session.execute(
                text(
                    "INSERT INTO column_definitions "
                    "(column_name, display_name, category_id, data_type, select_options, unit, sort_order, is_required) "
                    "VALUES (:name, :display, :cat_id, :dtype, CAST(:sel AS jsonb), :unit, :order, :req)"
                ),
                {
                    "name": col_name,
                    "display": display,
                    "cat_id": cat_ids[cat_code],
                    "dtype": dtype,
                    "sel": json.dumps(sel_opts) if sel_opts else None,
                    "unit": unit,
                    "order": i + 1,
                    "req": is_req,
                },
            )
            result = session.execute(
                text("SELECT id FROM column_definitions WHERE column_name = :name"),
                {"name": col_name},
            )
            col_ids[col_name] = result.scalar()
        print(f"  Column Definitions: {len(col_ids)}")

        # --- Validation Rules ---
        val_count = 0
        for rule in VALIDATION_RULES:
            col_name, rule_type, rule_config, err_msg = rule
            if col_name not in col_ids:
                continue
            session.execute(
                text(
                    "INSERT INTO column_validations (column_id, rule_type, rule_config, error_message) "
                    "VALUES (:col_id, :rtype, CAST(:rconfig AS jsonb), :msg)"
                ),
                {
                    "col_id": col_ids[col_name],
                    "rtype": rule_type,
                    "rconfig": json.dumps(rule_config),
                    "msg": err_msg,
                },
            )
            val_count += 1
        print(f"  Validation Rules: {val_count}")

        # --- Users ---
        user_ids = {}
        _default_password_hash = get_password_hash("changeme123!")
        for u in USERS:
            session.execute(
                text(
                    "INSERT INTO users (username, display_name, role, password_hash, email) "
                    "VALUES (:un, :dn, :r, :ph, :email)"
                ),
                {
                    "un": u["username"],
                    "dn": u["display_name"],
                    "r": u["role"],
                    "ph": _default_password_hash,
                    "email": u.get("email"),
                },
            )
            result = session.execute(
                text("SELECT id FROM users WHERE username = :un"),
                {"un": u["username"]},
            )
            user_ids[u["username"]] = result.scalar()
        print(f"  Users: {len(user_ids)}")

        # --- Layers ---
        layer_ids = {}
        for layer_name, step_seq, layer_number, sort_order in LAYERS:
            session.execute(
                text("INSERT INTO layers (layer_name, step_seq, layer_number, sort_order) "
                     "VALUES (:name, :seq, :num, :order)"),
                {"name": layer_name, "seq": step_seq, "num": layer_number, "order": sort_order},
            )
            result = session.execute(
                text("SELECT id FROM layers WHERE layer_name = :name"),
                {"name": layer_name},
            )
            layer_ids[layer_name] = result.scalar()
        print(f"  Layers: {len(layer_ids)}")

        # --- Lines ---
        line_ids = {}
        for line in LINES:
            session.execute(
                text("INSERT INTO lines (line_code, line_name) VALUES (:code, :name)"),
                {"code": line["line_code"], "name": line["line_name"]},
            )
            result = session.execute(
                text("SELECT id FROM lines WHERE line_code = :code"),
                {"code": line["line_code"]},
            )
            line_ids[line["line_code"]] = result.scalar()
        print(f"  Lines: {len(line_ids)}")

        # --- Products (with Approved projects) + ProductLayers ---
        product_ids = {}
        pl_count = 0
        for prod in PRODUCTS:
            session.execute(
                text("INSERT INTO products (product_name, description, line_id, part_id) "
                     "VALUES (:name, :desc, :lid, :pid)"),
                {
                    "name": prod["product_name"], "desc": prod["description"],
                    "lid": line_ids[prod["line_code"]],
                    "pid": prod["part_id"],
                },
            )
            result = session.execute(
                text("SELECT id FROM products WHERE product_name = :name"),
                {"name": prod["product_name"]},
            )
            pid = result.scalar()
            product_ids[prod["product_name"]] = pid

            for layer_name in LAYER_NAMES:
                conditions = generate_conditions(layer_name, prod["product_name"])
                session.execute(
                    text(
                        "INSERT INTO product_layers (product_id, layer_id, conditions) "
                        "VALUES (:pid, :lid, CAST(:cond AS jsonb))"
                    ),
                    {"pid": pid, "lid": layer_ids[layer_name], "cond": json.dumps(conditions)},
                )
                pl_count += 1
        print(f"  Products (approved-backbone): {len(product_ids)}")
        print(f"  Product Layers: {pl_count} ({len(PRODUCTS)} products x {len(LAYER_NAMES)} layers)")

        # --- Non-approved Products (no Approved project) ---
        nb_count = 0
        nb_pl_count = 0
        for prod in NON_BACKBONE_PRODUCTS:
            session.execute(
                text("INSERT INTO products (product_name, description, line_id, part_id) "
                     "VALUES (:name, :desc, :lid, :pid)"),
                {
                    "name": prod["product_name"], "desc": prod["description"],
                    "lid": line_ids[prod["line_code"]],
                    "pid": prod["part_id"],
                },
            )
            result = session.execute(
                text("SELECT id FROM products WHERE product_name = :name"),
                {"name": prod["product_name"]},
            )
            pid = result.scalar()
            product_ids[prod["product_name"]] = pid
            nb_count += 1

            for layer_name in prod["layer_names"]:
                session.execute(
                    text(
                        "INSERT INTO product_layers (product_id, layer_id, conditions) "
                        "VALUES (:pid, :lid, CAST(:cond AS jsonb))"
                    ),
                    {"pid": pid, "lid": layer_ids[layer_name], "cond": json.dumps({})},
                )
                nb_pl_count += 1
        print(f"  Products (non-approved): {nb_count}")
        print(f"  Non-approved Product Layers: {nb_pl_count}")

        # --- Export Systems ---
        EXPORT_SYSTEMS = [
            {
                "system_name": "MES-TRACK",
                "format_type": "TYPE_A",
                "description": "Track equipment control system (SP + DEV categories)",
                "additional_config": {"categories": ["SP", "DEV"]},
                "is_active": True,
            },
            {
                "system_name": "EQP-SCANNER",
                "format_type": "TYPE_B",
                "description": "Scanner equipment parameter management (SC category)",
                "additional_config": {
                    "categories": ["SC"],
                    # equip_source 변경: equipment_assignments 테이블 대신 conditions JSONB의 EQP 컬럼 사용
                    "equip_source": "conditions_eqp_columns",
                    # EQP 컬럼 접미사와 원래 SC 컬럼명의 매핑
                    # EQP_01_ET -> SC_EXPOSE_ENERGY_mJ, EQP_01_FOCUS -> SC_EXPOSE_FOCUS_um
                    "equip_vary_mapping": {
                        "SC_EXPOSE_ENERGY_mJ": "_ET",
                        "SC_EXPOSE_FOCUS_um": "_FOCUS",
                    },
                },
                "is_active": True,
            },
            {
                "system_name": "SPC-OVL",
                "format_type": "TYPE_C",
                "description": "SPC overlay measurement system (OVL category)",
                "additional_config": {
                    "categories": ["OVL"],
                    "unit_mappings": {
                        "OVL_SPEC_X_nm": "nm",
                        "OVL_SPEC_Y_nm": "nm",
                        "OVL_CORRECT_X_nm": "nm",
                        "OVL_CORRECT_Y_nm": "nm",
                        "OVL_REF_LAYER": "",
                        "OVL_MEAS_TOOL": "",
                    },
                },
                "is_active": True,
            },
        ]

        export_system_ids = {}
        for es in EXPORT_SYSTEMS:
            session.execute(
                text(
                    "INSERT INTO export_systems (system_name, format_type, description, additional_config, is_active) "
                    "VALUES (:name, :fmt, :desc, CAST(:cfg AS jsonb), :active)"
                ),
                {
                    "name": es["system_name"],
                    "fmt": es["format_type"],
                    "desc": es["description"],
                    "cfg": json.dumps(es["additional_config"]),
                    "active": es["is_active"],
                },
            )
            result = session.execute(
                text("SELECT id FROM export_systems WHERE system_name = :name"),
                {"name": es["system_name"]},
            )
            export_system_ids[es["system_name"]] = result.scalar()
        print(f"  Export Systems: {len(export_system_ids)}")

        # --- Export Column Mappings ---
        sp_targets, sc_targets, ovl_targets, dev_targets = _build_export_target_names()

        TYPE_A_REQUIRED = {
            "SP_PR_TYPE", "SP_DISPENSE_VOL_ml", "SP_SPIN1_SPEED_rpm",
            "SP_SPIN1_TIME_sec", "SP_PREBAKE_TEMP_C", "SP_PREBAKE_TIME_sec",
            "SP_ADHESION_USE", "DEV_TYPE", "DEV_PUDDLE_TIME_sec",
        }
        TYPE_B_REQUIRED = {
            "SC_TOOL_ID", "SC_RETICLE_ID", "SC_EXPOSE_ENERGY_mJ",
            "SC_EXPOSE_FOCUS_um", "SC_ILLUM_MODE", "SC_NA", "SC_WAVELENGTH_nm",
        }
        TYPE_C_REQUIRED = {
            "OVL_SPEC_X_nm", "OVL_SPEC_Y_nm", "OVL_REF_LAYER",
        }

        ecm_count = 0
        mes_system_id = export_system_ids["MES-TRACK"]
        sc_system_id = export_system_ids["EQP-SCANNER"]
        ovl_system_id = export_system_ids["SPC-OVL"]

        for sort_idx, (col_name, target_name) in enumerate(sp_targets.items(), 1):
            if col_name not in col_ids:
                continue
            session.execute(
                text(
                    "INSERT INTO export_column_mappings "
                    "(export_system_id, column_id, target_column_name, sort_order, is_required) "
                    "VALUES (:esid, :cid, :tname, :sort, :req)"
                ),
                {
                    "esid": mes_system_id, "cid": col_ids[col_name],
                    "tname": target_name, "sort": sort_idx,
                    "req": col_name in TYPE_A_REQUIRED,
                },
            )
            ecm_count += 1

        dev_offset = len(sp_targets) + 1
        for sort_idx, (col_name, target_name) in enumerate(dev_targets.items(), dev_offset):
            if col_name not in col_ids:
                continue
            session.execute(
                text(
                    "INSERT INTO export_column_mappings "
                    "(export_system_id, column_id, target_column_name, sort_order, is_required) "
                    "VALUES (:esid, :cid, :tname, :sort, :req)"
                ),
                {
                    "esid": mes_system_id, "cid": col_ids[col_name],
                    "tname": target_name, "sort": sort_idx,
                    "req": col_name in TYPE_A_REQUIRED,
                },
            )
            ecm_count += 1

        for sort_idx, (col_name, target_name) in enumerate(sc_targets.items(), 1):
            if col_name not in col_ids:
                continue
            session.execute(
                text(
                    "INSERT INTO export_column_mappings "
                    "(export_system_id, column_id, target_column_name, sort_order, is_required) "
                    "VALUES (:esid, :cid, :tname, :sort, :req)"
                ),
                {
                    "esid": sc_system_id, "cid": col_ids[col_name],
                    "tname": target_name, "sort": sort_idx,
                    "req": col_name in TYPE_B_REQUIRED,
                },
            )
            ecm_count += 1

        for sort_idx, (col_name, target_name) in enumerate(ovl_targets.items(), 1):
            if col_name not in col_ids:
                continue
            session.execute(
                text(
                    "INSERT INTO export_column_mappings "
                    "(export_system_id, column_id, target_column_name, sort_order, is_required) "
                    "VALUES (:esid, :cid, :tname, :sort, :req)"
                ),
                {
                    "esid": ovl_system_id, "cid": col_ids[col_name],
                    "tname": target_name, "sort": sort_idx,
                    "req": col_name in TYPE_C_REQUIRED,
                },
            )
            ecm_count += 1
        print(f"  Export Column Mappings: {ecm_count}")

        # --- Approved Projects for products in PRODUCTS list (backbone source of truth) ---
        # Each product in PRODUCTS gets an Approved project (status='approved', is_latest=True, revision=1)
        # with project_layers copied from product_layers. This makes them eligible as backbone sources
        # via BackboneRepository (backbone eligibility is determined dynamically by Approved project existence).
        random.seed(99)
        backbone_project_ids = {}

        # EQP 컬럼에 쓸 스캐너 목록 (slots 1~5 사용)
        SCANNER_POOL = [
            "NSR-S322F-01", "NSR-S322F-02", "NSR-S631E-01", "XT-1400E-01", "NXT-2000-01",
        ]

        for prod in PRODUCTS:
            prod_name = prod["product_name"]
            pid = product_ids[prod_name]

            session.execute(
                text(
                    "INSERT INTO projects (product_id, main_backbone_id, status, revision, is_latest, created_by) "
                    "VALUES (:pid, :bbid, 'approved', 1, TRUE, :uid)"
                ),
                {
                    "pid": pid,
                    "bbid": pid,
                    "uid": user_ids["engineer1"],
                },
            )
            result = session.execute(
                text("SELECT id FROM projects WHERE product_id = :pid AND status = 'approved'"),
                {"pid": pid},
            )
            proj_id = result.scalar()
            backbone_project_ids[prod_name] = proj_id

            # Copy all product_layers -> project_layers for this approved project
            # EQP 컬럼(EQP_01~EQP_05, ET, FOCUS)을 conditions에 포함하여 삽입
            for layer_name in LAYER_NAMES:
                conditions = generate_conditions(layer_name, prod_name)

                # EQP 컬럼 추가: 레이어 프로파일의 기본 에너지/포커스를 기준으로 설비별 변동값 생성
                num_equip = random.choice([3, 4, 5])
                base_energy = LAYER_PROFILES[layer_name][4]
                for i, scanner_id in enumerate(SCANNER_POOL[:num_equip], start=1):
                    slot = f"{i:02d}"
                    # 설비명 저장
                    conditions[f"EQP_{slot}"] = scanner_id
                    # 설비별 에너지 오프셋: 기준값 ± 0.5 * (slot-1)
                    conditions[f"EQP_{slot}_ET"] = round(base_energy + (i - 1) * 0.5, 1)
                    # 설비별 포커스: -0.03 ~ 0.03 um 범위 내 랜덤
                    conditions[f"EQP_{slot}_FOCUS"] = round(random.uniform(-0.03, 0.03), 3)

                session.execute(
                    text(
                        "INSERT INTO project_layers "
                        "(project_id, layer_id, backbone_product_id, conditions, backbone_conditions, sort_order) "
                        "VALUES (:proj_id, :lid, :bbpid, CAST(:cond AS jsonb), CAST(:bcond AS jsonb), :sort)"
                    ),
                    {
                        "proj_id": proj_id,
                        "lid": layer_ids[layer_name],
                        "bbpid": pid,
                        "cond": json.dumps(conditions),
                        "bcond": json.dumps(conditions),
                        "sort": next(
                            sort_order_val
                            for ln, _, _, sort_order_val in LAYERS
                            if ln == layer_name
                        ),
                    },
                )

        test_project_id = backbone_project_ids["PROD-2024X"]
        print(f"  Approved Projects (backbone): {len(backbone_project_ids)}")
        print(f"  Test Project (approved for PROD-2024X): id={test_project_id}")

        # --- Recipe XML Mappings ---
        RECIPE_XML_MAPPINGS = [
            ("//RECIPE_DATA/SPIN/DISPENSE_VOL", "SP_DISPENSE_VOL_ml", "to_float"),
            ("//RECIPE_DATA/SPIN/SPIN1_SPEED", "SP_SPIN1_SPEED_rpm", "to_int"),
            ("//RECIPE_DATA/SPIN/SPIN1_TIME", "SP_SPIN1_TIME_sec", "to_int"),
            ("//RECIPE_DATA/SPIN/SPIN2_SPEED", "SP_SPIN2_SPEED_rpm", "to_int"),
            ("//RECIPE_DATA/SPIN/SPIN2_TIME", "SP_SPIN2_TIME_sec", "to_int"),
            ("//RECIPE_DATA/SPIN/EBR_SPEED", "SP_EBR_SPEED_rpm", "to_int"),
            ("//RECIPE_DATA/BAKE/PREBAKE_TEMP", "SP_PREBAKE_TEMP_C", "to_int"),
            ("//RECIPE_DATA/BAKE/PREBAKE_TIME", "SP_PREBAKE_TIME_sec", "to_int"),
            ("//RECIPE_DATA/SPIN/BARC_THICKNESS", "SP_BARC_THICKNESS_nm", "to_float"),
            ("//RECIPE_DATA/SPIN/BARC_BAKE_TEMP", "SP_BARC_BAKE_TEMP_C", "to_int"),
            ("//RECIPE_DATA/EXPOSE/ENERGY", "SC_EXPOSE_ENERGY_mJ", "to_float"),
            ("//RECIPE_DATA/EXPOSE/FOCUS", "SC_EXPOSE_FOCUS_um", "to_float"),
            ("//RECIPE_DATA/EXPOSE/NA", "SC_NA", "to_float"),
            ("//RECIPE_DATA/EXPOSE/DOSE_TOLERANCE", "SC_DOSE_TOLERANCE_PCT", "to_float"),
            ("//RECIPE_DATA/EXPOSE/EUV_POWER", "SC_EUV_POWER_W", "to_float"),
            ("//RECIPE_DATA/EXPOSE/SCAN_SPEED", "SC_SCAN_SPEED_mm_s", "to_float"),
            ("//RECIPE_DATA/DEVELOP/PUDDLE_TIME", "DEV_PUDDLE_TIME_sec", "to_int"),
            ("//RECIPE_DATA/DEVELOP/PUDDLE_COUNT", "DEV_PUDDLE_COUNT", "to_int"),
            ("//RECIPE_DATA/DEVELOP/RINSE_TIME", "DEV_RINSE_TIME_sec", "to_int"),
            ("//RECIPE_DATA/DEVELOP/POSTBAKE_TEMP", "DEV_POSTBAKE_TEMP_C", "to_int"),
            ("//RECIPE_DATA/DEVELOP/CD_TARGET", "DEV_CD_TARGET_nm", "to_float"),
            ("//RECIPE_DATA/DEVELOP/PEB_TEMP", "DEV_PEB_TEMP_C", "to_int"),
            ("//RECIPE_DATA/DEVELOP/PEB_TIME", "DEV_PEB_TIME_sec", "to_int"),
        ]

        rxm_count = 0
        for xpath, col_name, transform in RECIPE_XML_MAPPINGS:
            if col_name not in col_ids:
                continue
            session.execute(
                text(
                    "INSERT INTO recipe_xml_mappings (xpath, column_id, value_transform, is_active) "
                    "VALUES (:xpath, :col_id, :transform, TRUE)"
                ),
                {"xpath": xpath, "col_id": col_ids[col_name], "transform": transform},
            )
            rxm_count += 1
        print(f"  Recipe XML Mappings: {rxm_count}")

        # --- External Data Sources (mock tables + registration) ---
        seed_external_data_sources(session)

        session.commit()
        print("\nSeed completed successfully!")
        print(f"  Total columns: {len(col_ids)}")
        print(f"  Total layers: {len(layer_ids)}")
        print(f"  Total products: {len(product_ids)}")
