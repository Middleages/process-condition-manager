"""Export column target name mapping functions for seed data."""
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
