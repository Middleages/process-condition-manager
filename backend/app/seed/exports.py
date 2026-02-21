"""Export column target name mapping functions and external data source seed data."""
import json

from sqlalchemy.orm import Session
from sqlalchemy import text

from app.seed.columns import COLUMN_DEFS


# ---------------------------------------------------------------------------
# 11. Export column target names (derived programmatically)
# ---------------------------------------------------------------------------

def _make_export_target_name(col_name: str) -> str:
    """Strip category prefix and unit suffix to create target column name."""
    # Known explicit overrides for original 67 columns
    _OVERRIDES = {
        "SP_PR_TYPE": "RESIST_CODE",
        "SP_PR_VENDOR": "RESIST_VENDOR",
        "SP_PR_VISCOSITY_cP": "RESIST_VISCOSITY",
        "SP_DISPENSE_VOL_ml": "DISPENSE_VOL",
        "SP_EBR_SPEED_rpm": "EBR_SPEED",
        "SP_PR_THICKNESS_nm": "PR_THICKNESS",
        "SC_TOOL_ID": "SCANNER_TOOL",
        "SC_EXPOSE_ENERGY_mJ": "EXPOSE_ENERGY",
        "SC_EXPOSE_FOCUS_um": "EXPOSE_FOCUS",
        "SC_ILLUM_SIGMA_IN": "SIGMA_INNER",
        "SC_ILLUM_SIGMA_OUT": "SIGMA_OUTER",
        "SC_DOSE_TOLERANCE_PCT": "DOSE_TOLERANCE",
        "SC_ALIGN_MARK_TYPE": "ALIGN_MARK_TYPE",
        "SC_SLIT_WIDTH_mm": "SLIT_WIDTH",
        "SC_RETICLE_CORR_X_nm": "RETICLE_CORR_X",
        "SC_RETICLE_CORR_Y_nm": "RETICLE_CORR_Y",
        "OVL_SPEC_X_nm": "OVL_SPEC_X",
        "OVL_SPEC_Y_nm": "OVL_SPEC_Y",
        "OVL_REF_LAYER": "REF_LAYER",
        "OVL_CORRECT_X_nm": "CORRECT_X",
        "OVL_CORRECT_Y_nm": "CORRECT_Y",
        "OVL_MEAS_POINT_COUNT": "MEAS_POINTS",
        "DEV_TYPE": "DEVELOPER_TYPE",
        "DEV_PUDDLE_TIME_sec": "PUDDLE_TIME",
        "DEV_PUDDLE_COUNT": "PUDDLE_COUNT",
        "DEV_RINSE_TIME_sec": "RINSE_TIME",
        "DEV_POSTBAKE_TEMP_C": "POSTBAKE_TEMP",
        "DEV_POSTBAKE_TIME_sec": "POSTBAKE_TIME",
        "DEV_CD_TARGET_nm": "CD_TARGET",
        "DEV_CD_SPEC_LOW_nm": "CD_SPEC_LOW",
        "DEV_CD_SPEC_HIGH_nm": "CD_SPEC_HIGH",
        "DEV_CD_MEAS_POINTS": "CD_MEAS_POINTS",
    }
    if col_name in _OVERRIDES:
        return _OVERRIDES[col_name]
    # Strip category prefix (SP_, SC_, OVL_, DEV_)
    for prefix in ("SP_", "SC_", "OVL_", "DEV_"):
        if col_name.startswith(prefix):
            body = col_name[len(prefix):]
            break
    else:
        body = col_name
    # Strip common unit suffixes
    unit_suffixes = [
        "_rpm", "_sec", "_nm", "_um", "_mm", "_pct", "_PCT", "_mJ",
        "_C", "_Pa", "_Hz", "_W", "_L_min", "_ml", "_ml_s", "_deg",
        "_urad", "_mrad", "_ppm", "_Mohm", "_s", "_cP",
    ]
    for suf in unit_suffixes:
        if body.endswith(suf):
            body = body[: -len(suf)]
            break
    return body


def _build_export_target_names() -> tuple[dict, dict, dict, dict]:
    """Build export target name dicts for all 350 columns."""
    sp_targets, sc_targets, ovl_targets, dev_targets = {}, {}, {}, {}
    for col_def in COLUMN_DEFS:
        col_name, _, cat_code, *_ = col_def
        target = _make_export_target_name(col_name)
        if cat_code == "SP":
            sp_targets[col_name] = target
        elif cat_code == "SC":
            sc_targets[col_name] = target
        elif cat_code == "OVL":
            ovl_targets[col_name] = target
        elif cat_code == "DEV":
            dev_targets[col_name] = target
    return sp_targets, sc_targets, ovl_targets, dev_targets


# ---------------------------------------------------------------------------
# External data source seed: mock tables + ExportDataSource records
# ---------------------------------------------------------------------------

def seed_external_data_sources(session: Session) -> None:
    """Create mock external PostgreSQL tables and register them as ExportDataSource records.

    Tables created:
    - ext_mes_data  : MES measurement data linked by product_id + step_seq
    - ext_eqp_status: Equipment status data linked by product_id + layer_name

    Idempotent: skips if export_data_sources already has rows.
    """
    existing = session.execute(text("SELECT count(*) FROM export_data_sources")).scalar()
    if existing and existing > 0:
        print("  External data sources already seeded. Skipping.")
        return

    # --- Create ext_mes_data table ---
    session.execute(text("""
        CREATE TABLE IF NOT EXISTS ext_mes_data (
            id          SERIAL PRIMARY KEY,
            product_id  INTEGER NOT NULL,
            step_seq    VARCHAR(30) NOT NULL,
            ppid        VARCHAR(100),
            measure_value NUMERIC(12, 4),
            status      VARCHAR(20) DEFAULT 'OK'
        )
    """))

    # Insert ~10 rows of sample MES data (step_seq matches Layer.step_seq format: ac100000, ac105000, ...)
    mes_rows = [
        (1, "ac100000", "PPID-SP-001", 245.3, "OK"),
        (1, "ac105000", "PPID-SC-001", 38.5, "OK"),
        (1, "ac110000", "PPID-DEV-001", 120.1, "WARNING"),
        (1, "ac115000", "PPID-OVL-001", 5.2, "OK"),
        (2, "ac100000", "PPID-SP-001", 248.7, "OK"),
        (2, "ac105000", "PPID-SC-002", 37.9, "OK"),
        (2, "ac110000", "PPID-DEV-001", 118.4, "OK"),
        (3, "ac100000", "PPID-SP-002", 241.0, "OK"),
        (3, "ac105000", "PPID-SC-001", 39.1, "FAIL"),
        (3, "ac120000", "PPID-DEV-002", 125.6, "OK"),
    ]
    for row in mes_rows:
        session.execute(
            text(
                "INSERT INTO ext_mes_data (product_id, step_seq, ppid, measure_value, status) "
                "VALUES (:pid, :seq, :ppid, :val, :status)"
            ),
            {"pid": row[0], "seq": row[1], "ppid": row[2], "val": row[3], "status": row[4]},
        )

    # --- Create ext_eqp_status table ---
    session.execute(text("""
        CREATE TABLE IF NOT EXISTS ext_eqp_status (
            id              SERIAL PRIMARY KEY,
            product_id      INTEGER NOT NULL,
            layer_name      VARCHAR(100) NOT NULL,
            equipment_id    VARCHAR(50),
            run_count       INTEGER DEFAULT 0,
            last_pm_date    DATE
        )
    """))

    # Insert ~10 rows of sample equipment status data
    eqp_rows = [
        (1, "LAYER-01-PRE", "NSR-S322F-01", 1520, "2026-01-15"),
        (1, "LAYER-02-CORE", "NSR-S322F-01", 1520, "2026-01-15"),
        (1, "LAYER-03-CUT", "NSR-S631E-01", 830, "2026-01-20"),
        (2, "LAYER-01-PRE", "NSR-S322F-02", 980, "2026-01-18"),
        (2, "LAYER-02-CORE", "XT-1400E-01", 2100, "2025-12-30"),
        (2, "LAYER-04-VIA", "NXT-2000-01", 450, "2026-02-01"),
        (3, "LAYER-01-PRE", "NSR-S322F-01", 1521, "2026-01-15"),
        (3, "LAYER-05-MET", "XT-1400E-01", 2101, "2025-12-30"),
        (1, "LAYER-06-CAP", "NSR-S631E-01", 831, "2026-01-20"),
        (3, "LAYER-03-CUT", "NXT-2000-01", 451, "2026-02-01"),
    ]
    for row in eqp_rows:
        session.execute(
            text(
                "INSERT INTO ext_eqp_status "
                "(product_id, layer_name, equipment_id, run_count, last_pm_date) "
                "VALUES (:pid, :lname, :eid, :rc, CAST(:pm AS date))"
            ),
            {
                "pid": row[0], "lname": row[1], "eid": row[2],
                "rc": row[3], "pm": row[4],
            },
        )

    # --- Register ExportDataSource records ---
    data_sources = [
        {
            "source_name": "MES-Measurement-Data",
            "table_name": "ext_mes_data",
            "schema_name": "public",
            "description": "MES measurement data linked by product and process step",
            "join_key_mappings": json.dumps([
                {"external_column": "product_id", "pcm_field": "project.product_id"},
                {"external_column": "step_seq", "pcm_field": "layer.step_seq"},
            ]),
            "is_active": True,
        },
        {
            "source_name": "Equipment-Status-Data",
            "table_name": "ext_eqp_status",
            "schema_name": "public",
            "description": "Equipment status and PM history linked by product and layer name",
            "join_key_mappings": json.dumps([
                {"external_column": "product_id", "pcm_field": "project.product_id"},
                {"external_column": "layer_name", "pcm_field": "layer.layer_name"},
            ]),
            "is_active": True,
        },
    ]
    for ds in data_sources:
        session.execute(
            text(
                "INSERT INTO export_data_sources "
                "(source_name, table_name, schema_name, description, join_key_mappings, is_active) "
                "VALUES (:sname, :tname, :schema, :desc, CAST(:jkm AS jsonb), :active)"
            ),
            {
                "sname": ds["source_name"],
                "tname": ds["table_name"],
                "schema": ds["schema_name"],
                "desc": ds["description"],
                "jkm": ds["join_key_mappings"],
                "active": ds["is_active"],
            },
        )
    print(f"  External Data Sources: {len(data_sources)} (+ mock tables ext_mes_data, ext_eqp_status)")
