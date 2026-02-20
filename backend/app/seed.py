"""
Seed data for PCM development.

Usage:
    docker-compose exec backend python -m app.seed

Idempotent: checks if data already exists before inserting.
"""
import json
import random
import sys

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.config import settings
from app.services.auth_service import get_password_hash

engine = create_engine(settings.DATABASE_URL_SYNC)


# ---------------------------------------------------------------------------
# 1. Column Categories & Definitions (350 columns)
# ---------------------------------------------------------------------------

CATEGORIES = [
    {"category_code": "SP", "category_name": "Spin / PR", "sort_order": 1},
    {"category_code": "SC", "category_name": "Scanner / Expose", "sort_order": 2},
    {"category_code": "OVL", "category_name": "Overlay", "sort_order": 3},
    {"category_code": "DEV", "category_name": "Develop", "sort_order": 4},
]

SCANNER_TOOL_OPTIONS = [
    "NSR-S322F-01", "NSR-S322F-02", "NSR-S322F-03",
    "NSR-S631E-01", "XT-1400E-01",
    "XT-1900Gi-01", "XT-1900Gi-02", "NXT-2000-01",
    "EUV-3400-01", "EUV-3400-02",
]

# (column_name, display_name, category_code, data_type, unit, is_required, select_options)
COLUMN_DEFS: list[tuple] = [
    # -----------------------------------------------------------------------
    # SP category (~85 columns)
    # -----------------------------------------------------------------------
    # --- existing 20 SP columns (UNCHANGED) ---
    ("SP_PR_TYPE", "PR Type", "SP", "select", None, True,
     ["KrF-A01", "KrF-B02", "ArF-C01", "ArF-D01", "EUV-E01"]),
    ("SP_PR_VENDOR", "PR Vendor", "SP", "select", None, False,
     ["TOK", "JSR", "Shin-Etsu", "Fujifilm", "DuPont"]),
    ("SP_PR_VISCOSITY_cP", "PR Viscosity", "SP", "float", "cP", False, None),
    ("SP_DISPENSE_VOL_ml", "Dispense Vol", "SP", "float", "ml", True, None),
    ("SP_SPIN1_SPEED_rpm", "Spin1 Speed", "SP", "integer", "rpm", True, None),
    ("SP_SPIN1_TIME_sec", "Spin1 Time", "SP", "integer", "s", True, None),
    ("SP_SPIN2_SPEED_rpm", "Spin2 Speed", "SP", "integer", "rpm", False, None),
    ("SP_SPIN2_TIME_sec", "Spin2 Time", "SP", "integer", "s", False, None),
    ("SP_EBR_SPEED_rpm", "EBR Speed", "SP", "integer", "rpm", False, None),
    ("SP_PREBAKE_TEMP_C", "Prebake Temp", "SP", "integer", "\u2103", True, None),
    ("SP_PREBAKE_TIME_sec", "Prebake Time", "SP", "integer", "s", True, None),
    ("SP_PR_THICKNESS_nm", "PR Thickness", "SP", "integer", "nm", False, None),
    ("SP_ADHESION_USE", "Adhesion Use", "SP", "select", None, True, ["Y", "N"]),
    ("SP_ADHESION_TYPE", "Adhesion Type", "SP", "select", None, False,
     ["HMDS", "HMDS-V2", "AP3000", "NONE"]),
    ("SP_ADHESION_TEMP_C", "Adhesion Temp", "SP", "integer", "\u2103", False, None),
    ("SP_COOL_TEMP_C", "Cool Temp", "SP", "integer", "\u2103", False, None),
    ("SP_COOL_TIME_sec", "Cool Time", "SP", "integer", "s", False, None),
    ("SP_COAT_METHOD", "Coat Method", "SP", "select", None, False,
     ["SPIN", "SPRAY", "SLIT"]),
    ("SP_HUMIDITY_PCT", "Humidity", "SP", "float", "%", False, None),
    ("SP_BACKSIDE_RINSE", "Backside Rinse", "SP", "select", None, False, ["Y", "N"]),
    # --- new SP columns (~65) ---
    ("SP_BARC_USE", "BARC Use", "SP", "select", None, False, ["Y", "N"]),
    ("SP_BARC_TYPE", "BARC Type", "SP", "select", None, False,
     ["ARC-29A", "ARC-40A", "ARC-29B", "DBARC-11", "NONE"]),
    ("SP_BARC_THICKNESS_nm", "BARC Thickness", "SP", "float", "nm", False, None),
    ("SP_BARC_BAKE_TEMP_C", "BARC Bake Temp", "SP", "integer", "\u2103", False, None),
    ("SP_BARC_BAKE_TIME_sec", "BARC Bake Time", "SP", "integer", "s", False, None),
    ("SP_TARC_USE", "TARC Use", "SP", "select", None, False, ["Y", "N"]),
    ("SP_TARC_TYPE", "TARC Type", "SP", "select", None, False,
     ["TARC-101", "TARC-S01", "NONE"]),
    ("SP_TARC_THICKNESS_nm", "TARC Thickness", "SP", "float", "nm", False, None),
    ("SP_TARC_BAKE_TEMP_C", "TARC Bake Temp", "SP", "integer", "\u2103", False, None),
    ("SP_TARC_BAKE_TIME_sec", "TARC Bake Time", "SP", "integer", "s", False, None),
    ("SP_DUAL_COAT_USE", "Dual Coat Use", "SP", "select", None, False, ["Y", "N"]),
    ("SP_DUAL_COAT_TYPE", "Dual Coat Type", "SP", "select", None, False,
     ["OVER_COAT", "UNDER_COAT", "NONE"]),
    ("SP_DUAL_PR_TYPE", "Dual PR Type", "SP", "select", None, False,
     ["KrF-A01", "KrF-B02", "ArF-C01", "ArF-D01", "EUV-E01"]),
    ("SP_DUAL_THICKNESS_nm", "Dual PR Thickness", "SP", "float", "nm", False, None),
    ("SP_DUAL_BAKE_TEMP_C", "Dual Bake Temp", "SP", "integer", "\u2103", False, None),
    ("SP_DUAL_BAKE_TIME_sec", "Dual Bake Time", "SP", "integer", "s", False, None),
    ("SP_EDGE_BEAD_WIDTH_mm", "Edge Bead Width", "SP", "float", "mm", False, None),
    ("SP_EDGE_RINSE_WIDTH_mm", "Edge Rinse Width", "SP", "float", "mm", False, None),
    ("SP_EDGE_EXPOSE_WIDTH_mm", "Edge Expose Width", "SP", "float", "mm", False, None),
    ("SP_EDGE_EXCLUDE_mm", "Edge Exclude", "SP", "float", "mm", False, None),
    ("SP_BAKE_RAMP_RATE_C_s", "Bake Ramp Rate", "SP", "float", "\u2103/s", False, None),
    ("SP_BAKE_HOLD_TEMP_C", "Bake Hold Temp", "SP", "integer", "\u2103", False, None),
    ("SP_BAKE_HOLD_TIME_sec", "Bake Hold Time", "SP", "integer", "s", False, None),
    ("SP_COOL_RAMP_RATE_C_s", "Cool Ramp Rate", "SP", "float", "\u2103/s", False, None),
    ("SP_BAKE_UNIFORMITY_C", "Bake Uniformity", "SP", "float", "\u2103", False, None),
    ("SP_DISPENSE_RATE_ml_s", "Dispense Rate", "SP", "float", "ml/s", False, None),
    ("SP_DISPENSE_NOZZLE", "Dispense Nozzle", "SP", "select", None, False,
     ["CENTER", "EDGE", "MULTI", "SCAN"]),
    ("SP_DISPENSE_HEIGHT_mm", "Dispense Height", "SP", "float", "mm", False, None),
    ("SP_DISPENSE_OFFSET_mm", "Dispense Offset", "SP", "float", "mm", False, None),
    ("SP_DISPENSE_ANGLE_deg", "Dispense Angle", "SP", "float", "deg", False, None),
    ("SP_PR_LOT_ID", "PR Lot ID", "SP", "string", None, False, None),
    ("SP_PR_EXPIRY_DAYS", "PR Expiry Days", "SP", "integer", "days", False, None),
    ("SP_PR_FILTER_um", "PR Filter", "SP", "float", "\u03bcm", False, None),
    ("SP_PR_SOLVENT", "PR Solvent", "SP", "select", None, False,
     ["PGMEA", "EL", "PGME", "MAK"]),
    ("SP_PR_SENSITIVITY", "PR Sensitivity", "SP", "select", None, False,
     ["HIGH", "MEDIUM", "LOW"]),
    ("SP_AMBIENT_TEMP_C", "Ambient Temp", "SP", "integer", "\u2103", False, None),
    ("SP_CHUCK_TEMP_C", "Chuck Temp", "SP", "integer", "\u2103", False, None),
    ("SP_EXHAUST_PRESS_Pa", "Exhaust Pressure", "SP", "float", "Pa", False, None),
    ("SP_CDA_FLOW_L_min", "CDA Flow", "SP", "float", "L/min", False, None),
    ("SP_N2_PURGE_USE", "N2 Purge Use", "SP", "select", None, False, ["Y", "N"]),
    ("SP_SPIN3_SPEED_rpm", "Spin3 Speed", "SP", "integer", "rpm", False, None),
    ("SP_SPIN3_TIME_sec", "Spin3 Time", "SP", "integer", "s", False, None),
    ("SP_SPIN3_ACCEL_rpm_s", "Spin3 Accel", "SP", "integer", "rpm/s", False, None),
    ("SP_SPIN1_ACCEL_rpm_s", "Spin1 Accel", "SP", "integer", "rpm/s", False, None),
    ("SP_SPIN2_ACCEL_rpm_s", "Spin2 Accel", "SP", "integer", "rpm/s", False, None),
    ("SP_PR_BATCH_ID", "PR Batch ID", "SP", "string", None, False, None),
    ("SP_COAT_RECIPE_ID", "Coat Recipe ID", "SP", "string", None, False, None),
    ("SP_TRACK_TOOL_ID", "Track Tool ID", "SP", "select", None, False,
     ["TEL-ACT12-01", "TEL-ACT12-02", "LAM-SOLA-01", "SCREEN-SK-01"]),
    ("SP_COAT_PASS_COUNT", "Coat Pass Count", "SP", "integer", None, False, None),
    ("SP_BSR_TIME_sec", "BSR Time", "SP", "integer", "s", False, None),
    ("SP_BSR_SPEED_rpm", "BSR Speed", "SP", "integer", "rpm", False, None),
    ("SP_SOLVENT_TYPE", "Solvent Type", "SP", "select", None, False,
     ["PGMEA", "EL", "PGME", "THINNER"]),
    ("SP_PREWET_USE", "Prewet Use", "SP", "select", None, False, ["Y", "N"]),
    ("SP_PREWET_VOL_ml", "Prewet Volume", "SP", "float", "ml", False, None),
    ("SP_PREWET_TIME_sec", "Prewet Time", "SP", "integer", "s", False, None),
    # --- additional SP columns (10 more → total SP 85) ---
    ("SP_NOZZLE_MATERIAL", "Nozzle Material", "SP", "select", None, False,
     ["PTFE", "PEEK", "SS316", "CERAMIC"]),
    ("SP_SPIN_RAMP_TIME_sec", "Spin Ramp Time", "SP", "integer", "s", False, None),
    ("SP_SPIN_HOLD_TIME_sec", "Spin Hold Time", "SP", "integer", "s", False, None),
    ("SP_PR_BATCH_SIZE", "PR Batch Size", "SP", "integer", None, False, None),
    ("SP_CHILL_PLATE_TEMP_C", "Chill Plate Temp", "SP", "integer", "\u2103", False, None),
    ("SP_CHILL_PLATE_TIME_sec", "Chill Plate Time", "SP", "integer", "s", False, None),
    ("SP_COAT_ARM_SPEED_rpm_s", "Coat Arm Speed", "SP", "float", "rpm/s", False, None),
    ("SP_DISPENSE_TEMP_C", "Dispense Temp", "SP", "float", "\u2103", False, None),
    ("SP_PR_AGED_DAYS", "PR Aged Days", "SP", "integer", "days", False, None),
    ("SP_SPIN_CUP_TYPE", "Spin Cup Type", "SP", "select", None, False,
     ["OPEN", "CLOSED", "EXHAUST"]),

    # -----------------------------------------------------------------------
    # SC category (~90 columns)
    # -----------------------------------------------------------------------
    # --- existing 19 SC columns (UNCHANGED) ---
    ("SC_TOOL_ID", "Scanner Tool", "SC", "select", None, True, SCANNER_TOOL_OPTIONS),
    ("SC_RETICLE_ID", "Reticle ID", "SC", "string", None, True, None),
    ("SC_EXPOSE_ENERGY_mJ", "Expose Energy", "SC", "float", "mJ", True, None),
    ("SC_EXPOSE_FOCUS_um", "Expose Focus", "SC", "float", "\u03bcm", True, None),
    ("SC_ILLUM_MODE", "Illumination Mode", "SC", "select", None, True,
     ["CONVENTIONAL", "ANNULAR", "DIPOLE_X", "DIPOLE_Y", "QUASAR", "CQUAD"]),
    ("SC_ILLUM_SIGMA_IN", "Sigma Inner", "SC", "float", None, False, None),
    ("SC_ILLUM_SIGMA_OUT", "Sigma Outer", "SC", "float", None, False, None),
    ("SC_NA", "NA", "SC", "float", None, True, None),
    ("SC_DOSE_TOLERANCE_PCT", "Dose Tolerance", "SC", "float", "%", False, None),
    ("SC_ALIGN_MARK_TYPE", "Align Mark Type", "SC", "select", None, False,
     ["SSA", "LSA", "ATHENA", "SMASH"]),
    ("SC_ALIGN_TREE", "Align Tree", "SC", "string", None, False, None),
    ("SC_EXPOSE_MODE", "Expose Mode", "SC", "select", None, False,
     ["STEP_SCAN", "STEP_REPEAT"]),
    ("SC_SCAN_DIRECTION", "Scan Direction", "SC", "select", None, False,
     ["IN_SCAN", "OUT_SCAN", "BOTH"]),
    ("SC_SLIT_WIDTH_mm", "Slit Width", "SC", "float", "mm", False, None),
    ("SC_RETICLE_CORR_X_nm", "Reticle Corr X", "SC", "float", "nm", False, None),
    ("SC_RETICLE_CORR_Y_nm", "Reticle Corr Y", "SC", "float", "nm", False, None),
    ("SC_WAVELENGTH_nm", "Wavelength", "SC", "select", "nm", True, [248, 193, 13]),
    ("SC_MASK_TYPE", "Mask Type", "SC", "select", None, False,
     ["BINARY", "PSM", "EAPSM", "ALTPSM"]),
    ("SC_IMMERSION", "Immersion", "SC", "select", None, False, ["Y", "N"]),
    # --- new SC columns (~71) ---
    ("SC_ABER_COMA_X", "Aberration Coma X", "SC", "float", "nm", False, None),
    ("SC_ABER_COMA_Y", "Aberration Coma Y", "SC", "float", "nm", False, None),
    ("SC_ABER_ASTIG_X", "Aberration Astig X", "SC", "float", "nm", False, None),
    ("SC_ABER_ASTIG_Y", "Aberration Astig Y", "SC", "float", "nm", False, None),
    ("SC_ABER_TREFOIL", "Aberration Trefoil", "SC", "float", "nm", False, None),
    ("SC_ABER_SPHERICAL", "Aberration Spherical", "SC", "float", "nm", False, None),
    ("SC_ABER_FIELD_CURV", "Aberration Field Curv", "SC", "float", "nm", False, None),
    ("SC_DOSE_MAP_TYPE", "Dose Map Type", "SC", "select", None, False,
     ["UNIFORM", "GRID", "FIELD", "NONE"]),
    ("SC_DOSE_MAP_POINTS", "Dose Map Points", "SC", "integer", None, False, None),
    ("SC_FOCUS_MAP_TYPE", "Focus Map Type", "SC", "select", None, False,
     ["UNIFORM", "GRID", "FIELD", "NONE"]),
    ("SC_FOCUS_MAP_POINTS", "Focus Map Points", "SC", "integer", None, False, None),
    ("SC_DOSE_CORR_PCT", "Dose Correction", "SC", "float", "%", False, None),
    ("SC_FOCUS_CORR_um", "Focus Correction", "SC", "float", "\u03bcm", False, None),
    ("SC_DOSE_UNIFORMITY_PCT", "Dose Uniformity", "SC", "float", "%", False, None),
    ("SC_SHOT_SIZE_X_mm", "Shot Size X", "SC", "float", "mm", False, None),
    ("SC_SHOT_SIZE_Y_mm", "Shot Size Y", "SC", "float", "mm", False, None),
    ("SC_SHOT_OFFSET_X_mm", "Shot Offset X", "SC", "float", "mm", False, None),
    ("SC_SHOT_OFFSET_Y_mm", "Shot Offset Y", "SC", "float", "mm", False, None),
    ("SC_FIELD_SIZE_X_mm", "Field Size X", "SC", "float", "mm", False, None),
    ("SC_FIELD_SIZE_Y_mm", "Field Size Y", "SC", "float", "mm", False, None),
    ("SC_SHOT_ROTATION_mrad", "Shot Rotation", "SC", "float", "mrad", False, None),
    ("SC_ALIGN_CORR_X_nm", "Align Correction X", "SC", "float", "nm", False, None),
    ("SC_ALIGN_CORR_Y_nm", "Align Correction Y", "SC", "float", "nm", False, None),
    ("SC_ALIGN_ROTATION_urad", "Align Rotation", "SC", "float", "\u03bcrad", False, None),
    ("SC_ALIGN_MAG_PPM", "Align Magnification", "SC", "float", "ppm", False, None),
    ("SC_WAFER_ROTATION_urad", "Wafer Rotation", "SC", "float", "\u03bcrad", False, None),
    ("SC_ALIGN_SEQ", "Align Sequence", "SC", "string", None, False, None),
    ("SC_FOCUS_TILT_X_nm", "Focus Tilt X", "SC", "float", "nm", False, None),
    ("SC_FOCUS_TILT_Y_nm", "Focus Tilt Y", "SC", "float", "nm", False, None),
    ("SC_FOCUS_OFFSET_nm", "Focus Offset", "SC", "float", "nm", False, None),
    ("SC_LEVEL_SENSOR_MODE", "Level Sensor Mode", "SC", "select", None, False,
     ["AUTO", "MANUAL", "FIXED"]),
    ("SC_FOCUS_EXPO_MODE", "Focus Expo Mode", "SC", "select", None, False,
     ["BEST", "FIXED", "MAP"]),
    ("SC_GLOBAL_FOCUS_nm", "Global Focus", "SC", "float", "nm", False, None),
    ("SC_PELLICLE_USE", "Pellicle Use", "SC", "select", None, False, ["Y", "N"]),
    ("SC_PELLICLE_TYPE", "Pellicle Type", "SC", "select", None, False,
     ["FSI", "MFS", "EUV-PELLICLE", "NONE"]),
    ("SC_PELLICLE_TRANS_PCT", "Pellicle Transmission", "SC", "float", "%", False, None),
    ("SC_EUV_POWER_W", "EUV Power", "SC", "float", "W", False, None),
    ("SC_EUV_DOSE_RATE", "EUV Dose Rate", "SC", "float", None, False, None),
    ("SC_EUV_FLARE_PCT", "EUV Flare", "SC", "float", "%", False, None),
    ("SC_EUV_STOCHASTIC_MODE", "EUV Stochastic Mode", "SC", "select", None, False,
     ["STANDARD", "ENHANCED", "NONE"]),
    ("SC_EUV_MASK_3D_CORR", "EUV Mask 3D Correction", "SC", "select", None, False,
     ["Y", "N"]),
    ("SC_RETICLE_QUAL_DATE", "Reticle Qual Date", "SC", "string", None, False, None),
    ("SC_RETICLE_USAGE_COUNT", "Reticle Usage Count", "SC", "integer", None, False, None),
    ("SC_BATCH_ID", "Batch ID", "SC", "string", None, False, None),
    ("SC_RECIPE_ID", "Recipe ID", "SC", "string", None, False, None),
    ("SC_EXPOSE_PASSES", "Expose Passes", "SC", "integer", None, False, None),
    ("SC_MULTI_EXPOSE_USE", "Multi Expose Use", "SC", "select", None, False, ["Y", "N"]),
    ("SC_BASELINE_ENERGY_mJ", "Baseline Energy", "SC", "float", "mJ", False, None),
    ("SC_BASELINE_FOCUS_um", "Baseline Focus", "SC", "float", "\u03bcm", False, None),
    ("SC_SCAN_SPEED_mm_s", "Scan Speed", "SC", "float", "mm/s", False, None),
    ("SC_SLIT_PROFILE", "Slit Profile", "SC", "select", None, False,
     ["UNIFORM", "SHAPED", "CUSTOM"]),
    ("SC_PUPIL_FILL", "Pupil Fill", "SC", "float", "%", False, None),
    ("SC_SOURCE_SHAPE", "Source Shape", "SC", "select", None, False,
     ["CIRCULAR", "ANNULAR", "DIPOLE", "QUADRUPOLE", "FREEFORM"]),
    ("SC_PELLICLE_FRAME_ID", "Pellicle Frame ID", "SC", "string", None, False, None),
    ("SC_RETICLE_CD_nm", "Reticle CD", "SC", "float", "nm", False, None),
    ("SC_DEFOCUS_BUDGET_nm", "Defocus Budget", "SC", "float", "nm", False, None),
    ("SC_DOSE_LATITUDE_PCT", "Dose Latitude", "SC", "float", "%", False, None),
    ("SC_FOCUS_LATITUDE_um", "Focus Latitude", "SC", "float", "\u03bcm", False, None),
    ("SC_NILS", "NILS", "SC", "float", None, False, None),
    ("SC_MEF", "MEF", "SC", "float", None, False, None),
    ("SC_THPUT_WPH", "Throughput", "SC", "float", "wph", False, None),
    ("SC_IMAGE_LOG_SLOPE", "Image Log Slope", "SC", "float", None, False, None),
    # --- additional SC columns (9 more → total SC 90) ---
    ("SC_FOCUS_DRIFT_nm_hr", "Focus Drift", "SC", "float", "nm/hr", False, None),
    ("SC_DOSE_DRIFT_PCT_hr", "Dose Drift", "SC", "float", "%/hr", False, None),
    ("SC_RETICLE_HEAT_CORR", "Reticle Heat Correction", "SC", "select", None, False, ["Y", "N"]),
    ("SC_LENS_HEAT_CORR", "Lens Heat Correction", "SC", "select", None, False, ["Y", "N"]),
    ("SC_WAFER_STAGE_TEMP_C", "Wafer Stage Temp", "SC", "float", "\u2103", False, None),
    ("SC_ILLUM_UNIFORMITY_PCT", "Illumination Uniformity", "SC", "float", "%", False, None),
    ("SC_RETICLE_FLATNESS_nm", "Reticle Flatness", "SC", "float", "nm", False, None),
    ("SC_SHOT_COUNT", "Shot Count", "SC", "integer", None, False, None),
    ("SC_WAFER_COUNT", "Wafer Count", "SC", "integer", None, False, None),

    # -----------------------------------------------------------------------
    # OVL category (~80 columns)
    # -----------------------------------------------------------------------
    # --- existing 14 OVL columns (UNCHANGED) ---
    ("OVL_SPEC_X_nm", "OVL Spec X", "OVL", "float", "nm", True, None),
    ("OVL_SPEC_Y_nm", "OVL Spec Y", "OVL", "float", "nm", True, None),
    ("OVL_REF_LAYER", "Reference Layer", "OVL", "layer_ref", None, True, None),
    ("OVL_CORRECT_X_nm", "Correction X", "OVL", "float", "nm", False, None),
    ("OVL_CORRECT_Y_nm", "Correction Y", "OVL", "float", "nm", False, None),
    ("OVL_APC_USE", "APC Use", "OVL", "select", None, False, ["Y", "N"]),
    ("OVL_APC_TYPE", "APC Type", "OVL", "select", None, False,
     ["LINEAR", "HIGHER_ORDER", "INTRAFIELD"]),
    ("OVL_MEAS_TOOL", "Meas Tool", "OVL", "select", None, False,
     ["ARCHER-500", "ARCHER-600", "YS-350"]),
    ("OVL_MEAS_POINT_COUNT", "Meas Points", "OVL", "integer", None, False, None),
    ("OVL_SAMPLING_MODE", "Sampling Mode", "OVL", "select", None, False,
     ["FULL", "SPARSE", "EDGE"]),
    ("OVL_REG_MODEL", "Reg Model", "OVL", "select", None, False,
     ["6PAR", "10PAR", "HIGHER"]),
    ("OVL_FEEDBACK_USE", "Feedback Use", "OVL", "select", None, False, ["Y", "N"]),
    ("OVL_FEEDFORWARD_USE", "Feedforward Use", "OVL", "select", None, False, ["Y", "N"]),
    ("OVL_TARGET_TYPE", "Target Type", "OVL", "select", None, False,
     ["uDBO", "AIM", "AIMplus"]),
    # --- new OVL columns (~66) ---
    ("OVL_REF_LAYER_2", "Reference Layer 2", "OVL", "layer_ref", None, False, None),
    ("OVL_REF_LAYER_3", "Reference Layer 3", "OVL", "layer_ref", None, False, None),
    ("OVL_REF_WEIGHT_1", "Ref Weight 1", "OVL", "float", None, False, None),
    ("OVL_REF_WEIGHT_2", "Ref Weight 2", "OVL", "float", None, False, None),
    ("OVL_REF_WEIGHT_3", "Ref Weight 3", "OVL", "float", None, False, None),
    ("OVL_CORR_3RD_X", "Correction 3rd X", "OVL", "float", "nm", False, None),
    ("OVL_CORR_3RD_Y", "Correction 3rd Y", "OVL", "float", "nm", False, None),
    ("OVL_CORR_ROTATION_urad", "Correction Rotation", "OVL", "float", "\u03bcrad", False, None),
    ("OVL_CORR_MAG_PPM", "Correction Magnification", "OVL", "float", "ppm", False, None),
    ("OVL_CORR_ASYM_X", "Correction Asymmetry X", "OVL", "float", "nm", False, None),
    ("OVL_CORR_ASYM_Y", "Correction Asymmetry Y", "OVL", "float", "nm", False, None),
    ("OVL_INTRAFIELD_CORR_USE", "Intrafield Correction Use", "OVL", "select", None, False, ["Y", "N"]),
    ("OVL_WAFER_BOW_um", "Wafer Bow", "OVL", "float", "\u03bcm", False, None),
    ("OVL_WAFER_WARP_um", "Wafer Warp", "OVL", "float", "\u03bcm", False, None),
    ("OVL_STRESS_CORR_USE", "Stress Correction Use", "OVL", "select", None, False, ["Y", "N"]),
    ("OVL_THERMAL_CORR_USE", "Thermal Correction Use", "OVL", "select", None, False, ["Y", "N"]),
    ("OVL_CMP_CORR_USE", "CMP Correction Use", "OVL", "select", None, False, ["Y", "N"]),
    ("OVL_ETCH_SHIFT_X_nm", "Etch Shift X", "OVL", "float", "nm", False, None),
    ("OVL_ETCH_SHIFT_Y_nm", "Etch Shift Y", "OVL", "float", "nm", False, None),
    ("OVL_DEP_SHIFT_X_nm", "Dep Shift X", "OVL", "float", "nm", False, None),
    ("OVL_DEP_SHIFT_Y_nm", "Dep Shift Y", "OVL", "float", "nm", False, None),
    ("OVL_CMP_SHIFT_X_nm", "CMP Shift X", "OVL", "float", "nm", False, None),
    ("OVL_CMP_SHIFT_Y_nm", "CMP Shift Y", "OVL", "float", "nm", False, None),
    ("OVL_MEAS_RECIPE_ID", "Meas Recipe ID", "OVL", "string", None, False, None),
    ("OVL_MEAS_WAVELENGTH_nm", "Meas Wavelength", "OVL", "float", "nm", False, None),
    ("OVL_MEAS_ANGLE_deg", "Meas Angle", "OVL", "float", "deg", False, None),
    ("OVL_MEAS_AZIMUTH_deg", "Meas Azimuth", "OVL", "float", "deg", False, None),
    ("OVL_MEAS_FOCUS_um", "Meas Focus", "OVL", "float", "\u03bcm", False, None),
    ("OVL_MEAS_SPOT_SIZE_um", "Meas Spot Size", "OVL", "float", "\u03bcm", False, None),
    ("OVL_SPC_UCL_X_nm", "SPC UCL X", "OVL", "float", "nm", False, None),
    ("OVL_SPC_LCL_X_nm", "SPC LCL X", "OVL", "float", "nm", False, None),
    ("OVL_SPC_UCL_Y_nm", "SPC UCL Y", "OVL", "float", "nm", False, None),
    ("OVL_SPC_LCL_Y_nm", "SPC LCL Y", "OVL", "float", "nm", False, None),
    ("OVL_SPC_MEAN_SHIFT_X", "SPC Mean Shift X", "OVL", "float", "nm", False, None),
    ("OVL_SPC_MEAN_SHIFT_Y", "SPC Mean Shift Y", "OVL", "float", "nm", False, None),
    ("OVL_MARK_LAYER", "Mark Layer", "OVL", "string", None, False, None),
    ("OVL_MARK_DESIGN", "Mark Design", "OVL", "select", None, False,
     ["BOX_IN_BOX", "FRAME_IN_FRAME", "AIM_MARK", "DBO"]),
    ("OVL_MARK_SIZE_um", "Mark Size", "OVL", "float", "\u03bcm", False, None),
    ("OVL_MARK_PITCH_um", "Mark Pitch", "OVL", "float", "\u03bcm", False, None),
    ("OVL_DBO_NUM_PADS", "DBO Num Pads", "OVL", "integer", None, False, None),
    ("OVL_DBO_PAD_SIZE_um", "DBO Pad Size", "OVL", "float", "\u03bcm", False, None),
    ("OVL_CORR_METHOD", "Correction Method", "OVL", "select", None, False,
     ["CPE", "HPE", "FIELD_BY_FIELD"]),
    ("OVL_CORR_MODEL_VER", "Correction Model Ver", "OVL", "string", None, False, None),
    ("OVL_FEEDBACK_GAIN", "Feedback Gain", "OVL", "float", None, False, None),
    ("OVL_FF_GAIN", "Feedforward Gain", "OVL", "float", None, False, None),
    ("OVL_BATCH_ID", "OVL Batch ID", "OVL", "string", None, False, None),
    ("OVL_MEAS_PASS_COUNT", "Meas Pass Count", "OVL", "integer", None, False, None),
    ("OVL_MEAS_SITE_X", "Meas Site X", "OVL", "integer", None, False, None),
    ("OVL_MEAS_SITE_Y", "Meas Site Y", "OVL", "integer", None, False, None),
    ("OVL_TIS_X_nm", "TIS X", "OVL", "float", "nm", False, None),
    ("OVL_TIS_Y_nm", "TIS Y", "OVL", "float", "nm", False, None),
    ("OVL_WIS_X_nm", "WIS X", "OVL", "float", "nm", False, None),
    ("OVL_WIS_Y_nm", "WIS Y", "OVL", "float", "nm", False, None),
    ("OVL_RESI_3SIGMA_X_nm", "Residual 3Sigma X", "OVL", "float", "nm", False, None),
    ("OVL_RESI_3SIGMA_Y_nm", "Residual 3Sigma Y", "OVL", "float", "nm", False, None),
    ("OVL_RESI_MAX_X_nm", "Residual Max X", "OVL", "float", "nm", False, None),
    ("OVL_RESI_MAX_Y_nm", "Residual Max Y", "OVL", "float", "nm", False, None),
    ("OVL_MMO_X_nm", "MMO X", "OVL", "float", "nm", False, None),
    ("OVL_MMO_Y_nm", "MMO Y", "OVL", "float", "nm", False, None),
    ("OVL_SPEC_VECTOR_nm", "Spec Vector", "OVL", "float", "nm", False, None),
    ("OVL_GOLDEN_REF_USE", "Golden Ref Use", "OVL", "select", None, False, ["Y", "N"]),
    # --- additional OVL columns (5 more → total OVL 80) ---
    ("OVL_FIELD_ROTATION_urad", "Field Rotation", "OVL", "float", "\u03bcrad", False, None),
    ("OVL_FIELD_MAG_PPM", "Field Magnification", "OVL", "float", "ppm", False, None),
    ("OVL_CALIB_DATE", "Calibration Date", "OVL", "string", None, False, None),
    ("OVL_TOOL_INDUCED_SHIFT_X", "Tool Induced Shift X", "OVL", "float", "nm", False, None),
    ("OVL_TOOL_INDUCED_SHIFT_Y", "Tool Induced Shift Y", "OVL", "float", "nm", False, None),

    # -----------------------------------------------------------------------
    # DEV category (~95 columns)
    # -----------------------------------------------------------------------
    # --- existing 14 DEV columns (UNCHANGED) ---
    ("DEV_TYPE", "Developer Type", "DEV", "select", None, True,
     ["NMD-3", "TMAH_2.38", "NMD-W", "AZ300MIF"]),
    ("DEV_PUDDLE_TIME_sec", "Puddle Time", "DEV", "integer", "s", True, None),
    ("DEV_PUDDLE_COUNT", "Puddle Count", "DEV", "select", None, False, [1, 2, 3]),
    ("DEV_RINSE_TYPE", "Rinse Type", "DEV", "select", None, False,
     ["DI_WATER", "SURFACTANT", "SOLVENT"]),
    ("DEV_RINSE_TIME_sec", "Rinse Time", "DEV", "integer", "s", False, None),
    ("DEV_POSTBAKE_TEMP_C", "Postbake Temp", "DEV", "integer", "\u2103", False, None),
    ("DEV_POSTBAKE_TIME_sec", "Postbake Time", "DEV", "integer", "s", False, None),
    ("DEV_CD_TARGET_nm", "CD Target", "DEV", "float", "nm", False, None),
    ("DEV_CD_SPEC_LOW_nm", "CD Spec Lower", "DEV", "float", "nm", False, None),
    ("DEV_CD_SPEC_HIGH_nm", "CD Spec Upper", "DEV", "float", "nm", False, None),
    ("DEV_CD_MEAS_TOOL", "CD Meas Tool", "DEV", "select", None, False,
     ["CD-SEM-01", "CD-SEM-02", "OCD-01"]),
    ("DEV_CD_MEAS_POINTS", "CD Meas Points", "DEV", "integer", None, False, None),
    ("DEV_INSPECT_TOOL", "Inspect Tool", "DEV", "select", None, False,
     ["KLA-2810", "KLA-2815", "KLA-Puma"]),
    ("DEV_DEFECT_SPEC", "Defect Spec", "DEV", "integer", None, False, None),
    # --- new DEV columns (~81) ---
    ("DEV_OCD_USE", "OCD Use", "DEV", "select", None, False, ["Y", "N"]),
    ("DEV_OCD_TOOL", "OCD Tool", "DEV", "select", None, False,
     ["OCD-01", "OCD-02", "NOVA-T600", "NONE"]),
    ("DEV_OCD_RECIPE", "OCD Recipe", "DEV", "string", None, False, None),
    ("DEV_OCD_SITE_COUNT", "OCD Site Count", "DEV", "integer", None, False, None),
    ("DEV_OCD_MODEL", "OCD Model", "DEV", "string", None, False, None),
    ("DEV_AFM_USE", "AFM Use", "DEV", "select", None, False, ["Y", "N"]),
    ("DEV_AFM_TOOL", "AFM Tool", "DEV", "select", None, False,
     ["AFM-01", "DIMENSION-3100", "NONE"]),
    ("DEV_AFM_SCAN_SIZE_um", "AFM Scan Size", "DEV", "float", "\u03bcm", False, None),
    ("DEV_AFM_SCAN_RATE_Hz", "AFM Scan Rate", "DEV", "float", "Hz", False, None),
    ("DEV_DEFECT_CLASS_USE", "Defect Class Use", "DEV", "select", None, False, ["Y", "N"]),
    ("DEV_DEFECT_CLASS_RECIPE", "Defect Class Recipe", "DEV", "string", None, False, None),
    ("DEV_DEFECT_REVIEW_TOOL", "Defect Review Tool", "DEV", "select", None, False,
     ["KLA-2810", "KLA-Puma", "REVIEW-SEM-01"]),
    ("DEV_DEFECT_REVIEW_COUNT", "Defect Review Count", "DEV", "integer", None, False, None),
    ("DEV_DEFECT_KILLER_PCT", "Defect Killer Pct", "DEV", "float", "%", False, None),
    ("DEV_DEFECT_NUISANCE_PCT", "Defect Nuisance Pct", "DEV", "float", "%", False, None),
    ("DEV_REWORK_SPEC_USE", "Rework Spec Use", "DEV", "select", None, False, ["Y", "N"]),
    ("DEV_REWORK_CD_LOW_nm", "Rework CD Low", "DEV", "float", "nm", False, None),
    ("DEV_REWORK_CD_HIGH_nm", "Rework CD High", "DEV", "float", "nm", False, None),
    ("DEV_REWORK_OVL_LIMIT_nm", "Rework OVL Limit", "DEV", "float", "nm", False, None),
    ("DEV_REWORK_DEFECT_LIMIT", "Rework Defect Limit", "DEV", "integer", None, False, None),
    ("DEV_REWORK_METHOD", "Rework Method", "DEV", "select", None, False,
     ["STRIP_RECOAT", "FULL_REWORK", "NONE"]),
    ("DEV_POST_ETCH_CD_nm", "Post Etch CD", "DEV", "float", "nm", False, None),
    ("DEV_POST_ETCH_PROFILE_deg", "Post Etch Profile", "DEV", "float", "deg", False, None),
    ("DEV_POST_ETCH_DEPTH_nm", "Post Etch Depth", "DEV", "float", "nm", False, None),
    ("DEV_POST_ETCH_MEAS_TOOL", "Post Etch Meas Tool", "DEV", "select", None, False,
     ["CD-SEM-01", "CD-SEM-02", "OCD-01"]),
    ("DEV_POST_ETCH_SITE_COUNT", "Post Etch Site Count", "DEV", "integer", None, False, None),
    ("DEV_SPC_CD_UCL_nm", "SPC CD UCL", "DEV", "float", "nm", False, None),
    ("DEV_SPC_CD_LCL_nm", "SPC CD LCL", "DEV", "float", "nm", False, None),
    ("DEV_SPC_CD_TARGET_nm", "SPC CD Target", "DEV", "float", "nm", False, None),
    ("DEV_SPC_UNIFORMITY_PCT", "SPC Uniformity", "DEV", "float", "%", False, None),
    ("DEV_SPC_RANGE_nm", "SPC Range", "DEV", "float", "nm", False, None),
    ("DEV_TEMP_C", "Dev Temp", "DEV", "integer", "\u2103", False, None),
    ("DEV_FLOW_RATE_ml_s", "Dev Flow Rate", "DEV", "float", "ml/s", False, None),
    ("DEV_NOZZLE_TYPE", "Dev Nozzle Type", "DEV", "select", None, False,
     ["STANDARD", "SCAN", "PADDLE", "PUDDLE"]),
    ("DEV_NOZZLE_SCAN_SPEED_mm_s", "Nozzle Scan Speed", "DEV", "float", "mm/s", False, None),
    ("DEV_NOZZLE_GAP_mm", "Nozzle Gap", "DEV", "float", "mm", False, None),
    ("DEV_DISPENSE_MODE", "Dev Dispense Mode", "DEV", "select", None, False,
     ["STATIC", "DYNAMIC", "SPRAY"]),
    ("DEV_SPIN_SPEED_rpm", "Dev Spin Speed", "DEV", "integer", "rpm", False, None),
    ("DEV_SPIN_TIME_sec", "Dev Spin Time", "DEV", "integer", "s", False, None),
    ("DEV_PEB_TEMP_C", "PEB Temp", "DEV", "integer", "\u2103", False, None),
    ("DEV_PEB_TIME_sec", "PEB Time", "DEV", "integer", "s", False, None),
    ("DEV_PEB_RAMP_RATE_C_s", "PEB Ramp Rate", "DEV", "float", "\u2103/s", False, None),
    ("DEV_PEB_UNIFORMITY_C", "PEB Uniformity", "DEV", "float", "\u2103", False, None),
    ("DEV_PEB_DELAY_sec", "PEB Delay", "DEV", "integer", "s", False, None),
    ("DEV_PROFILE_ANGLE_deg", "Profile Angle", "DEV", "float", "deg", False, None),
    ("DEV_SIDEWALL_ANGLE_deg", "Sidewall Angle", "DEV", "float", "deg", False, None),
    ("DEV_LWR_nm", "LWR", "DEV", "float", "nm", False, None),
    ("DEV_LER_nm", "LER", "DEV", "float", "nm", False, None),
    ("DEV_RESIST_LOSS_nm", "Resist Loss", "DEV", "float", "nm", False, None),
    ("DEV_PATTERN_COLLAPSE_USE", "Pattern Collapse Check", "DEV", "select", None, False, ["Y", "N"]),
    ("DEV_CD_UNIFORMITY_PCT", "CD Uniformity", "DEV", "float", "%", False, None),
    ("DEV_CD_3SIGMA_nm", "CD 3Sigma", "DEV", "float", "nm", False, None),
    ("DEV_CD_RANGE_nm", "CD Range", "DEV", "float", "nm", False, None),
    ("DEV_BATCH_ID", "Dev Batch ID", "DEV", "string", None, False, None),
    ("DEV_RECIPE_ID", "Dev Recipe ID", "DEV", "string", None, False, None),
    ("DEV_TRACK_TOOL_ID", "Dev Track Tool ID", "DEV", "select", None, False,
     ["TEL-ACT12-01", "TEL-ACT12-02", "LAM-SOLA-01", "SCREEN-SK-01"]),
    ("DEV_STRIP_USE", "Strip Use", "DEV", "select", None, False, ["Y", "N"]),
    ("DEV_STRIP_METHOD", "Strip Method", "DEV", "select", None, False,
     ["WET", "DRY", "ASHING"]),
    ("DEV_STRIP_TEMP_C", "Strip Temp", "DEV", "integer", "\u2103", False, None),
    ("DEV_STRIP_TIME_sec", "Strip Time", "DEV", "integer", "s", False, None),
    ("DEV_HARD_BAKE_TEMP_C", "Hard Bake Temp", "DEV", "integer", "\u2103", False, None),
    ("DEV_HARD_BAKE_TIME_sec", "Hard Bake Time", "DEV", "integer", "s", False, None),
    ("DEV_DI_RESIST_Mohm", "DI Resistance", "DEV", "float", "M\u03a9", False, None),
    ("DEV_RINSE_FLOW_ml_s", "Rinse Flow", "DEV", "float", "ml/s", False, None),
    ("DEV_RINSE_SPIN_rpm", "Rinse Spin Speed", "DEV", "integer", "rpm", False, None),
    ("DEV_DRY_SPIN_rpm", "Dry Spin Speed", "DEV", "integer", "rpm", False, None),
    ("DEV_DRY_TIME_sec", "Dry Time", "DEV", "integer", "s", False, None),
    # --- additional DEV columns (14 more → total DEV 95) ---
    ("DEV_PUDDLE2_TIME_sec", "Puddle2 Time", "DEV", "integer", "s", False, None),
    ("DEV_PUDDLE2_TEMP_C", "Puddle2 Temp", "DEV", "integer", "\u2103", False, None),
    ("DEV_MEGA_SONIC_USE", "Mega Sonic Use", "DEV", "select", None, False, ["Y", "N"]),
    ("DEV_MEGA_SONIC_FREQ_kHz", "Mega Sonic Freq", "DEV", "float", "kHz", False, None),
    ("DEV_MEGA_SONIC_POWER_W", "Mega Sonic Power", "DEV", "float", "W", False, None),
    ("DEV_CD_SEM_MODE", "CD SEM Mode", "DEV", "select", None, False,
     ["AUTO", "MANUAL", "SEMI_AUTO"]),
    ("DEV_CD_SEM_VOLTAGE_kV", "CD SEM Voltage", "DEV", "float", "kV", False, None),
    ("DEV_CD_SEM_CURRENT_pA", "CD SEM Current", "DEV", "float", "pA", False, None),
    ("DEV_CD_SITE_X_COUNT", "CD Site X Count", "DEV", "integer", None, False, None),
    ("DEV_CD_SITE_Y_COUNT", "CD Site Y Count", "DEV", "integer", None, False, None),
    ("DEV_BRIDGE_INSPECT_USE", "Bridge Inspect Use", "DEV", "select", None, False, ["Y", "N"]),
    ("DEV_BRIDGE_SPEC_COUNT", "Bridge Spec Count", "DEV", "integer", None, False, None),
    ("DEV_NECK_INSPECT_USE", "Neck Inspect Use", "DEV", "select", None, False, ["Y", "N"]),
    ("DEV_DEFECT_SCAN_SPEED", "Defect Scan Speed", "DEV", "select", None, False,
     ["HIGH", "MEDIUM", "LOW"]),
]

# ---------------------------------------------------------------------------
# 2. Validation Rules (~80)
# ---------------------------------------------------------------------------

VALIDATION_RULES: list[tuple] = [
    # Range validations - existing
    ("SP_SPIN1_SPEED_rpm", "range", {"min": 500, "max": 8000}, "Spin1 Speed는 500~8000 rpm 범위여야 합니다"),
    ("SP_SPIN2_SPEED_rpm", "range", {"min": 500, "max": 8000}, "Spin2 Speed는 500~8000 rpm 범위여야 합니다"),
    ("SP_PREBAKE_TEMP_C", "range", {"min": 0, "max": 300}, "Prebake 온도는 0~300℃ 범위여야 합니다"),
    ("SP_PREBAKE_TIME_sec", "range", {"min": 1, "max": 600}, "Prebake 시간은 1~600초 범위여야 합니다"),
    ("SP_ADHESION_TEMP_C", "range", {"min": 0, "max": 200}, "Adhesion 온도는 0~200℃ 범위여야 합니다"),
    ("SP_PR_THICKNESS_nm", "range", {"min": 100, "max": 10000}, "PR 두께는 100~10000nm 범위여야 합니다"),
    ("SP_DISPENSE_VOL_ml", "range", {"min": 0.5, "max": 5.0}, "Dispense 량은 0.5~5.0ml 범위여야 합니다"),
    ("SC_EXPOSE_ENERGY_mJ", "range", {"min": 1.0, "max": 200.0}, "노광 에너지는 1~200mJ 범위여야 합니다"),
    ("SC_EXPOSE_FOCUS_um", "range", {"min": -1.0, "max": 1.0}, "포커스는 -1.0~1.0μm 범위여야 합니다"),
    ("SC_NA", "range", {"min": 0.1, "max": 1.5}, "NA는 0.1~1.5 범위여야 합니다"),
    ("OVL_SPEC_X_nm", "range", {"min": 0.1, "max": 50.0}, "OVL Spec X는 0.1~50nm 범위여야 합니다"),
    ("OVL_SPEC_Y_nm", "range", {"min": 0.1, "max": 50.0}, "OVL Spec Y는 0.1~50nm 범위여야 합니다"),
    ("DEV_PUDDLE_TIME_sec", "range", {"min": 5, "max": 300}, "Puddle 시간은 5~300초 범위여야 합니다"),
    ("DEV_POSTBAKE_TEMP_C", "range", {"min": 0, "max": 300}, "Postbake 온도는 0~300℃ 범위여야 합니다"),
    ("DEV_CD_TARGET_nm", "range", {"min": 1.0, "max": 5000.0}, "CD Target은 1~5000nm 범위여야 합니다"),
    ("DEV_DEFECT_SPEC", "range", {"min": 0, "max": 1000}, "Defect Spec은 0~1000 범위여야 합니다"),
    # Conditional required - existing
    ("SP_ADHESION_TYPE", "conditional_required",
     {"condition_column": "SP_ADHESION_USE", "condition_value": "Y", "operator": "equals"},
     "Adhesion Use가 Y일 때 Adhesion Type은 필수입니다"),
    ("SP_ADHESION_TEMP_C", "conditional_required",
     {"condition_column": "SP_ADHESION_USE", "condition_value": "Y", "operator": "equals"},
     "Adhesion Use가 Y일 때 Adhesion Temp는 필수입니다"),
    ("OVL_APC_TYPE", "conditional_required",
     {"condition_column": "OVL_APC_USE", "condition_value": "Y", "operator": "equals"},
     "APC Use가 Y일 때 APC Type은 필수입니다"),
    # Range validations - new SP
    ("SP_BARC_THICKNESS_nm", "range", {"min": 20, "max": 200}, "BARC 두께는 20~200nm 범위여야 합니다"),
    ("SP_TARC_THICKNESS_nm", "range", {"min": 20, "max": 150}, "TARC 두께는 20~150nm 범위여야 합니다"),
    ("SP_BARC_BAKE_TEMP_C", "range", {"min": 150, "max": 300}, "BARC Bake 온도는 150~300℃ 범위여야 합니다"),
    ("SP_TARC_BAKE_TEMP_C", "range", {"min": 100, "max": 250}, "TARC Bake 온도는 100~250℃ 범위여야 합니다"),
    ("SP_EDGE_BEAD_WIDTH_mm", "range", {"min": 0.5, "max": 5.0}, "Edge Bead Width는 0.5~5.0mm 범위여야 합니다"),
    ("SP_EDGE_RINSE_WIDTH_mm", "range", {"min": 0.5, "max": 5.0}, "Edge Rinse Width는 0.5~5.0mm 범위여야 합니다"),
    ("SP_DISPENSE_RATE_ml_s", "range", {"min": 0.1, "max": 5.0}, "Dispense Rate는 0.1~5.0 ml/s 범위여야 합니다"),
    ("SP_PREWET_VOL_ml", "range", {"min": 0.1, "max": 3.0}, "Prewet Vol은 0.1~3.0ml 범위여야 합니다"),
    ("SP_SPIN3_SPEED_rpm", "range", {"min": 500, "max": 8000}, "Spin3 Speed는 500~8000 rpm 범위여야 합니다"),
    ("SP_AMBIENT_TEMP_C", "range", {"min": 20, "max": 30}, "Ambient Temp는 20~30℃ 범위여야 합니다"),
    ("SP_CHUCK_TEMP_C", "range", {"min": 15, "max": 30}, "Chuck Temp는 15~30℃ 범위여야 합니다"),
    # Conditional required - new SP
    ("SP_BARC_TYPE", "conditional_required",
     {"condition_column": "SP_BARC_USE", "condition_value": "Y", "operator": "equals"},
     "BARC Use가 Y일 때 BARC Type은 필수입니다"),
    ("SP_BARC_THICKNESS_nm", "conditional_required",
     {"condition_column": "SP_BARC_USE", "condition_value": "Y", "operator": "equals"},
     "BARC Use가 Y일 때 BARC Thickness는 필수입니다"),
    ("SP_TARC_TYPE", "conditional_required",
     {"condition_column": "SP_TARC_USE", "condition_value": "Y", "operator": "equals"},
     "TARC Use가 Y일 때 TARC Type은 필수입니다"),
    ("SP_PREWET_VOL_ml", "conditional_required",
     {"condition_column": "SP_PREWET_USE", "condition_value": "Y", "operator": "equals"},
     "Prewet Use가 Y일 때 Prewet Vol은 필수입니다"),
    # Range validations - new SC
    ("SC_ABER_COMA_X", "range", {"min": -5.0, "max": 5.0}, "Coma X는 -5~5nm 범위여야 합니다"),
    ("SC_ABER_COMA_Y", "range", {"min": -5.0, "max": 5.0}, "Coma Y는 -5~5nm 범위여야 합니다"),
    ("SC_ABER_ASTIG_X", "range", {"min": -5.0, "max": 5.0}, "Astig X는 -5~5nm 범위여야 합니다"),
    ("SC_DOSE_CORR_PCT", "range", {"min": -10.0, "max": 10.0}, "Dose Correction은 -10~10% 범위여야 합니다"),
    ("SC_FOCUS_CORR_um", "range", {"min": -0.5, "max": 0.5}, "Focus Correction은 -0.5~0.5μm 범위여야 합니다"),
    ("SC_PELLICLE_TRANS_PCT", "range", {"min": 80.0, "max": 100.0}, "Pellicle Transmission은 80~100% 범위여야 합니다"),
    ("SC_EUV_POWER_W", "range", {"min": 10.0, "max": 500.0}, "EUV Power는 10~500W 범위여야 합니다"),
    ("SC_EUV_FLARE_PCT", "range", {"min": 0.0, "max": 10.0}, "EUV Flare는 0~10% 범위여야 합니다"),
    ("SC_SCAN_SPEED_mm_s", "range", {"min": 100.0, "max": 1000.0}, "Scan Speed는 100~1000 mm/s 범위여야 합니다"),
    ("SC_PUPIL_FILL", "range", {"min": 10.0, "max": 100.0}, "Pupil Fill은 10~100% 범위여야 합니다"),
    # Conditional required - new SC
    ("SC_EUV_POWER_W", "conditional_required",
     {"condition_column": "SC_WAVELENGTH_nm", "condition_value": 13, "operator": "equals"},
     "EUV 파장(13nm) 사용 시 EUV Power는 필수입니다"),
    ("SC_PELLICLE_TYPE", "conditional_required",
     {"condition_column": "SC_PELLICLE_USE", "condition_value": "Y", "operator": "equals"},
     "Pellicle Use가 Y일 때 Pellicle Type은 필수입니다"),
    # Range validations - new OVL
    ("OVL_WAFER_BOW_um", "range", {"min": -200.0, "max": 200.0}, "Wafer Bow는 -200~200μm 범위여야 합니다"),
    ("OVL_WAFER_WARP_um", "range", {"min": 0.0, "max": 400.0}, "Wafer Warp는 0~400μm 범위여야 합니다"),
    ("OVL_FEEDBACK_GAIN", "range", {"min": 0.0, "max": 1.0}, "Feedback Gain은 0~1.0 범위여야 합니다"),
    ("OVL_FF_GAIN", "range", {"min": 0.0, "max": 1.0}, "Feedforward Gain은 0~1.0 범위여야 합니다"),
    ("OVL_MEAS_WAVELENGTH_nm", "range", {"min": 400.0, "max": 800.0}, "Meas Wavelength는 400~800nm 범위여야 합니다"),
    ("OVL_MEAS_SPOT_SIZE_um", "range", {"min": 1.0, "max": 50.0}, "Meas Spot Size는 1~50μm 범위여야 합니다"),
    ("OVL_TIS_X_nm", "range", {"min": -5.0, "max": 5.0}, "TIS X는 -5~5nm 범위여야 합니다"),
    ("OVL_TIS_Y_nm", "range", {"min": -5.0, "max": 5.0}, "TIS Y는 -5~5nm 범위여야 합니다"),
    ("OVL_SPEC_VECTOR_nm", "range", {"min": 0.1, "max": 100.0}, "Spec Vector는 0.1~100nm 범위여야 합니다"),
    # Range validations - new DEV
    ("DEV_PEB_TEMP_C", "range", {"min": 80, "max": 200}, "PEB 온도는 80~200℃ 범위여야 합니다"),
    ("DEV_PEB_TIME_sec", "range", {"min": 30, "max": 300}, "PEB 시간은 30~300초 범위여야 합니다"),
    ("DEV_PEB_DELAY_sec", "range", {"min": 0, "max": 600}, "PEB Delay는 0~600초 범위여야 합니다"),
    ("DEV_TEMP_C", "range", {"min": 20, "max": 30}, "Dev 온도는 20~30℃ 범위여야 합니다"),
    ("DEV_FLOW_RATE_ml_s", "range", {"min": 0.1, "max": 5.0}, "Dev Flow Rate는 0.1~5.0 ml/s 범위여야 합니다"),
    ("DEV_SPIN_SPEED_rpm", "range", {"min": 100, "max": 3000}, "Dev Spin Speed는 100~3000 rpm 범위여야 합니다"),
    ("DEV_HARD_BAKE_TEMP_C", "range", {"min": 100, "max": 250}, "Hard Bake 온도는 100~250℃ 범위여야 합니다"),
    ("DEV_LWR_nm", "range", {"min": 0.0, "max": 10.0}, "LWR은 0~10nm 범위여야 합니다"),
    ("DEV_LER_nm", "range", {"min": 0.0, "max": 10.0}, "LER은 0~10nm 범위여야 합니다"),
    ("DEV_CD_UNIFORMITY_PCT", "range", {"min": 0.0, "max": 10.0}, "CD Uniformity는 0~10% 범위여야 합니다"),
    ("DEV_REWORK_CD_LOW_nm", "range", {"min": 1.0, "max": 5000.0}, "Rework CD Low는 1~5000nm 범위여야 합니다"),
    ("DEV_REWORK_OVL_LIMIT_nm", "range", {"min": 1.0, "max": 100.0}, "Rework OVL Limit은 1~100nm 범위여야 합니다"),
    # Conditional required - new DEV
    ("DEV_OCD_RECIPE", "conditional_required",
     {"condition_column": "DEV_OCD_USE", "condition_value": "Y", "operator": "equals"},
     "OCD Use가 Y일 때 OCD Recipe는 필수입니다"),
    ("DEV_REWORK_METHOD", "conditional_required",
     {"condition_column": "DEV_REWORK_SPEC_USE", "condition_value": "Y", "operator": "equals"},
     "Rework Spec Use가 Y일 때 Rework Method는 필수입니다"),
    ("DEV_STRIP_METHOD", "conditional_required",
     {"condition_column": "DEV_STRIP_USE", "condition_value": "Y", "operator": "equals"},
     "Strip Use가 Y일 때 Strip Method는 필수입니다"),
    # Cross-layer validation rules
    ("OVL_REF_LAYER", "cross_layer",
     {"check_type": "reference_exists", "source_column": "OVL_REF_LAYER", "target": "step_seq"},
     "OVL_REF_LAYER 값에 해당하는 레이어가 프로젝트에 존재하지 않습니다"),
    ("SC_EXPOSE_ENERGY_mJ", "cross_layer",
     {
         "check_type": "compare_layers",
         "column": "SC_EXPOSE_ENERGY_mJ",
         "operator": "<=",
         "reference_layer_column": "OVL_REF_LAYER",
         "threshold_ratio": 1.5,
     },
     "노광 에너지가 참조 레이어 대비 기준을 초과합니다"),
    ("SC_ILLUM_MODE", "cross_layer",
     {
         "check_type": "equipment_compatibility",
         "column": "SC_ILLUM_MODE",
         "compatibility": "same_value",
     },
     "동일 설비에 배정된 레이어들의 조명 모드가 일치하지 않습니다"),
]


# ---------------------------------------------------------------------------
# 3. Users
# ---------------------------------------------------------------------------

USERS = [
    {"username": "admin1", "display_name": "관리자", "role": "admin", "email": "admin@pcm.local"},
    {"username": "engineer1", "display_name": "김엔지니어", "role": "editor", "email": "editor@pcm.local"},
    {"username": "engineer2", "display_name": "이엔지니어", "role": "editor", "email": "editor2@pcm.local"},
    {"username": "engineer3", "display_name": "박엔지니어", "role": "editor", "email": "editor3@pcm.local"},
    {"username": "reviewer1", "display_name": "최검토자", "role": "reviewer", "email": "reviewer@pcm.local"},
]


# ---------------------------------------------------------------------------
# 4. Layers (150 Photo process steps) - built programmatically
# ---------------------------------------------------------------------------

def _build_layers() -> list[tuple]:
    """Build 150 layers programmatically.
    Returns list of (layer_name, step_seq, layer_number, sort_order).
    """
    layers = []
    seq = 100000
    sort = 10
    layer_num = 1

    def add(name: str) -> None:
        nonlocal seq, sort, layer_num
        layers.append((name, f"ac{seq:06d}", f"{layer_num}.0", sort))
        seq += 5000
        sort += 10
        layer_num += 1

    # FEOL (~40)
    feol_names = [
        "AA_PHOTO", "STI_PHOTO", "NWELL_PHOTO", "PWELL_PHOTO", "DWELL_PHOTO",
        "TRIPLE_WELL_PHOTO", "POLY_PHOTO", "POLY_CUT_PHOTO", "GATE_PHOTO",
        "GATE_CUT_PHOTO", "HKMG_PHOTO", "SPR0_PHOTO", "SPR1_PHOTO", "SPR2_PHOTO",
        "IMP_N_PHOTO", "IMP_P_PHOTO", "LDD_N_PHOTO", "LDD_P_PHOTO",
        "HALO_N_PHOTO", "HALO_P_PHOTO", "SD_N_PHOTO", "SD_P_PHOTO",
        "CONTACT_PHOTO", "CONTACT_A_PHOTO", "CONTACT_B_PHOTO",
        "SALICIDE_PHOTO", "CAP_PHOTO", "NSD_PHOTO", "PSD_PHOTO",
        "EXT_N_PHOTO", "EXT_P_PHOTO", "WELL_TAP_PHOTO", "NISO_PHOTO",
        "PISO_PHOTO", "NMOS_VT_PHOTO", "PMOS_VT_PHOTO",
        "HVNMOS_PHOTO", "HVPMOS_PHOTO", "BJT_PHOTO", "DIODE_PHOTO",
    ]
    for n in feol_names:
        add(n)

    # MOL (~10)
    mol_names = [
        "VIA0_PHOTO", "VIA0_A_PHOTO", "LI_PHOTO", "LI_CUT_PHOTO",
        "MOL_PLUG_PHOTO", "MOL_CAP_PHOTO", "LI_A_PHOTO", "LI_B_PHOTO",
        "MOL_OPT_PHOTO", "MOL_RES_PHOTO",
    ]
    for n in mol_names:
        add(n)

    # BEOL (~80)
    beol_names = [
        "M1_PHOTO", "M1_A_PHOTO", "M1_B_PHOTO", "M1_CUT_PHOTO",
        "V1_PHOTO", "V1_A_PHOTO",
        "M2_PHOTO", "M2_A_PHOTO", "M2_B_PHOTO", "M2_CUT_PHOTO",
        "V2_PHOTO", "V2_A_PHOTO",
        "M3_PHOTO", "M3_A_PHOTO", "M3_CUT_PHOTO",
        "V3_PHOTO", "V3_A_PHOTO",
        "M4_PHOTO", "M4_CUT_PHOTO",
        "V4_PHOTO",
        "M5_PHOTO", "V5_PHOTO",
        "M6_PHOTO", "V6_PHOTO",
        "M7_PHOTO", "V7_PHOTO",
        "M8_PHOTO", "V8_PHOTO",
        "M9_PHOTO", "V9_PHOTO",
        "M10_PHOTO", "V10_PHOTO",
        "M11_PHOTO", "V11_PHOTO",
        "M12_PHOTO", "V12_PHOTO",
        "M13_PHOTO", "V13_PHOTO",
        "M14_PHOTO", "V14_PHOTO",
        "M15_PHOTO",
        "ULK_PHOTO", "IMD1_PHOTO", "IMD2_PHOTO",
        "ETCH_STOP1_PHOTO", "ETCH_STOP2_PHOTO",
        "CU_BARRIER_PHOTO", "CU_SEED_PHOTO",
        "AL_CU_PHOTO", "TI_PHOTO", "TIN_PHOTO",
        "W_PLUG_PHOTO", "CO_SILICIDE_PHOTO",
        "NI_SILICIDE_PHOTO", "COBALT_CAP_PHOTO",
        "LOW_K_PHOTO", "ULTRA_LOW_K_PHOTO",
        "CAPPING_PHOTO", "HARDMASK_PHOTO",
        "ARC_PHOTO", "SPACER_PHOTO",
        "GATE_SPACER_PHOTO", "FIN_PHOTO",
        "FIN_CUT_PHOTO", "STI_CMP_PHOTO",
        "DUMMY_GATE_PHOTO", "ILD0_PHOTO",
        "POLY_OPEN_PHOTO", "SIT_PHOTO",
        "EPI_BLOCK_PHOTO", "NWELL_DEEP_PHOTO",
        "PWELL_DEEP_PHOTO", "RETROGRADE_PHOTO",
        "PUNCH_THROUGH_PHOTO", "ANTI_PUNCH_PHOTO",
        "THRESHOLD_TRIM_PHOTO",
    ]
    for n in beol_names:
        add(n)

    # Special (~24 → total 150)
    special_names = [
        "PAD_PHOTO", "FUSE_PHOTO", "TRIM_PHOTO", "RDL_PHOTO", "BUMP_PHOTO",
        "PASSIV_PHOTO", "PASSIV2_PHOTO", "BOND_PHOTO", "SEAL_PHOTO",
        "DICING_PHOTO", "TSV_PHOTO", "ESD_PHOTO", "DUMMY_FILL_PHOTO",
        "OPC_TEST_PHOTO", "ALU_PAD_PHOTO", "CU_PAD_PHOTO",
        "SOLDER_PHOTO", "UBM_PHOTO", "RDL2_PHOTO", "BUMP2_PHOTO",
        # extra 4 to reach 150 total
        "GUARD_RING_PHOTO", "SCRIBE_PHOTO", "ALIGN_MARK_PHOTO", "TEST_KEY_PHOTO",
    ]
    for n in special_names:
        add(n)

    return layers


LAYERS = _build_layers()
LAYER_NAMES = [l[0] for l in LAYERS]
_LAYER_STEP_SEQ = {l[0]: l[1] for l in LAYERS}


# ---------------------------------------------------------------------------
# 5. Layer Profiles
# ---------------------------------------------------------------------------

# Critical EUV layers
_EUV_LAYERS = {
    "GATE_PHOTO", "CONTACT_A_PHOTO", "CONTACT_B_PHOTO",
    "M1_PHOTO", "M1_A_PHOTO", "M1_B_PHOTO", "M1_CUT_PHOTO",
    "V1_PHOTO", "V1_A_PHOTO",
    "M2_PHOTO", "M2_A_PHOTO", "M2_B_PHOTO", "M2_CUT_PHOTO",
    "V2_PHOTO", "V2_A_PHOTO",
    "FIN_PHOTO", "FIN_CUT_PHOTO",
    "DUMMY_GATE_PHOTO", "LI_A_PHOTO", "LI_B_PHOTO", "LI_CUT_PHOTO",
}

# Critical ArFi layers
_ARFI_LAYERS = {
    "POLY_PHOTO", "POLY_CUT_PHOTO", "GATE_CUT_PHOTO", "HKMG_PHOTO",
    "CONTACT_PHOTO", "VIA0_PHOTO", "VIA0_A_PHOTO", "LI_PHOTO",
    "M3_PHOTO", "M3_A_PHOTO", "M3_CUT_PHOTO",
    "V3_PHOTO", "V3_A_PHOTO", "M4_PHOTO",
}

# KrF dry layers (coarse)
_KRF_LAYERS = {
    "PAD_PHOTO", "FUSE_PHOTO", "TRIM_PHOTO", "RDL_PHOTO", "BUMP_PHOTO",
    "PASSIV_PHOTO", "PASSIV2_PHOTO", "BOND_PHOTO", "SEAL_PHOTO",
    "DICING_PHOTO", "TSV_PHOTO", "ALU_PAD_PHOTO", "CU_PAD_PHOTO",
    "SOLDER_PHOTO", "UBM_PHOTO", "RDL2_PHOTO", "BUMP2_PHOTO",
    "ESD_PHOTO", "DUMMY_FILL_PHOTO",
}


def _get_layer_profile(layer_name: str) -> tuple:
    """Return (pr_type, wavelength, immersion, mask_type, base_energy, base_cd_target)."""
    if layer_name in _EUV_LAYERS:
        return ("EUV-E01", 13, "N", "EAPSM", 20.0, 18.0)
    elif layer_name in _ARFI_LAYERS:
        return ("ArF-C01", 193, "Y", "EAPSM", 50.0, 75.0)
    elif layer_name in _KRF_LAYERS:
        return ("KrF-A01", 248, "N", "BINARY", 28.0, 500.0)
    # Determine by name patterns
    name_upper = layer_name.upper()
    if any(x in name_upper for x in ["M1_", "M2_", "V1_", "V2_"]):
        return ("EUV-E01", 13, "N", "EAPSM", 22.0, 20.0)
    elif any(x in name_upper for x in ["M3_", "M4_", "M5_", "V3_", "V4_"]):
        return ("ArF-D01", 193, "Y", "ALTPSM", 45.0, 80.0)
    elif any(x in name_upper for x in ["M6_", "M7_", "M8_", "M9_", "M10_",
                                        "V5_", "V6_", "V7_", "V8_", "V9_"]):
        return ("ArF-C01", 193, "N", "EAPSM", 38.0, 120.0)
    elif any(x in name_upper for x in ["M11_", "M12_", "M13_", "M14_", "M15_",
                                        "V10_", "V11_", "V12_", "V13_", "V14_"]):
        return ("ArF-C01", 193, "N", "BINARY", 35.0, 200.0)
    elif any(x in name_upper for x in ["NWELL", "PWELL", "DWELL", "TRIPLE", "DEEP"]):
        return ("KrF-B02", 248, "N", "BINARY", 32.0, 500.0)
    elif any(x in name_upper for x in ["IMP_", "LDD_", "HALO_", "SD_", "EXT_",
                                        "NSD_", "PSD_", "PUNCH_", "ANTI_", "RETRO"]):
        return ("KrF-A01", 248, "N", "BINARY", 30.0, 300.0)
    elif any(x in name_upper for x in ["MOL_", "VIA0", "LI_"]):
        return ("ArF-C01", 193, "Y", "PSM", 52.0, 85.0)
    elif any(x in name_upper for x in ["ULK", "IMD", "ETCH_STOP", "CAPPING",
                                        "HARDMASK", "ARC_", "SPACER", "LOW_K",
                                        "CU_BARRIER", "CU_SEED", "AL_CU"]):
        return ("KrF-B02", 248, "N", "BINARY", 33.0, 350.0)
    elif any(x in name_upper for x in ["WELL_TAP", "NISO", "PISO", "BJT", "DIODE"]):
        return ("KrF-A01", 248, "N", "BINARY", 30.0, 600.0)
    elif any(x in name_upper for x in ["OPC_TEST", "SEAL", "DICING"]):
        return ("KrF-A01", 248, "N", "BINARY", 25.0, 1000.0)
    # Default: ArF dry
    return ("ArF-C01", 193, "N", "EAPSM", 40.0, 130.0)


LAYER_PROFILES = {name: _get_layer_profile(name) for name in LAYER_NAMES}


# ---------------------------------------------------------------------------
# 6. OVL Reference Layers
# ---------------------------------------------------------------------------

def _build_ovl_refs() -> dict:
    """Build OVL reference mapping: each layer references a preceding layer."""
    refs = {}
    zero_align = "za000000"
    # First layer references zero align
    if LAYER_NAMES:
        refs[LAYER_NAMES[0]] = zero_align
    # Each subsequent layer references the previous one's step_seq
    for i in range(1, len(LAYER_NAMES)):
        refs[LAYER_NAMES[i]] = _LAYER_STEP_SEQ[LAYER_NAMES[i - 1]]
    # Override specific layers with more physically meaningful references
    ref_overrides = {
        "STI_PHOTO": _LAYER_STEP_SEQ["AA_PHOTO"],
        "NWELL_PHOTO": _LAYER_STEP_SEQ["AA_PHOTO"],
        "PWELL_PHOTO": _LAYER_STEP_SEQ["AA_PHOTO"],
        "DWELL_PHOTO": _LAYER_STEP_SEQ["AA_PHOTO"],
        "TRIPLE_WELL_PHOTO": _LAYER_STEP_SEQ["AA_PHOTO"],
        "POLY_PHOTO": _LAYER_STEP_SEQ["AA_PHOTO"],
        "LDD_N_PHOTO": _LAYER_STEP_SEQ["POLY_PHOTO"],
        "LDD_P_PHOTO": _LAYER_STEP_SEQ["POLY_PHOTO"],
        "CONTACT_PHOTO": _LAYER_STEP_SEQ["POLY_PHOTO"],
        "M1_PHOTO": _LAYER_STEP_SEQ["CONTACT_PHOTO"],
        "V1_PHOTO": _LAYER_STEP_SEQ["M1_PHOTO"],
        "M2_PHOTO": _LAYER_STEP_SEQ["V1_PHOTO"],
        "V2_PHOTO": _LAYER_STEP_SEQ["M2_PHOTO"],
        "M3_PHOTO": _LAYER_STEP_SEQ["V2_PHOTO"],
        "V3_PHOTO": _LAYER_STEP_SEQ["M3_PHOTO"],
        "M4_PHOTO": _LAYER_STEP_SEQ["V3_PHOTO"],
        "V4_PHOTO": _LAYER_STEP_SEQ["M4_PHOTO"],
        "PAD_PHOTO": _LAYER_STEP_SEQ["M3_PHOTO"],
    }
    # Apply overrides only for existing layer names
    for k, v in ref_overrides.items():
        if k in refs:
            refs[k] = v
    return refs


OVL_REFS_STEP_SEQ = _build_ovl_refs()


# ---------------------------------------------------------------------------
# 7. Lines
# ---------------------------------------------------------------------------

LINES = [
    {"line_code": "LINE-A", "line_name": "A라인 (KrF/ArF)"},
    {"line_code": "LINE-B", "line_name": "B라인 (ArF/EUV)"},
    {"line_code": "LINE-C", "line_name": "C라인 (EUV전용)"},
]


# ---------------------------------------------------------------------------
# 8. Products (8 backbone + 4 non-backbone = 12 total)
# ---------------------------------------------------------------------------

PRODUCTS = [
    {"product_name": "PROD-2024X", "description": "주력 양산제품 (KrF/ArF 혼합)", "is_backbone": True,
     "line_code": "LINE-A", "part_id": "PROD-2024X"},
    {"product_name": "PROD-2024Y", "description": "차세대 파일럿 (ArF 중심)", "is_backbone": True,
     "line_code": "LINE-B", "part_id": "PROD-2024Y"},
    {"product_name": "PROD-2024Z", "description": "저전력 변형 제품", "is_backbone": True,
     "line_code": "LINE-A", "part_id": "PROD-2024Z"},
    {"product_name": "HBM-3E-MEM", "description": "HBM3E 고대역폭 메모리", "is_backbone": True,
     "line_code": "LINE-B", "part_id": "HBM-3E-MEM"},
    {"product_name": "AP-5G-MOB", "description": "5G 모바일 AP (EUV+ArF)", "is_backbone": True,
     "line_code": "LINE-C", "part_id": "AP-5G-MOB"},
    {"product_name": "MCU-AUTO-V2", "description": "자동차 MCU (28nm KrF)", "is_backbone": True,
     "line_code": "LINE-A", "part_id": "MCU-AUTO-V2"},
    {"product_name": "HPC-SERVER-X", "description": "서버 HPC 프로세서 (7nm EUV)", "is_backbone": True,
     "line_code": "LINE-C", "part_id": "HPC-SERVER-X"},
    {"product_name": "IOT-LP-V1", "description": "IoT 저전력 칩 (40nm)", "is_backbone": True,
     "line_code": "LINE-A", "part_id": "IOT-LP-V1"},
]

NON_BACKBONE_PRODUCTS = [
    {"product_name": "DEV-2025A", "description": "개발 제품 A (조건 미설정)",
     "is_backbone": False, "line_code": "LINE-A", "part_id": "DEV-2025A",
     "layer_names": LAYER_NAMES},
    {"product_name": "DEV-2025B", "description": "개발 제품 B (일부 레이어)",
     "is_backbone": False, "line_code": "LINE-B", "part_id": "DEV-2025B",
     "layer_names": LAYER_NAMES[:80]},
    {"product_name": "DEV-2025C", "description": "개발 제품 C (풀스택 테스트)",
     "is_backbone": False, "line_code": "LINE-A", "part_id": "DEV-2025C",
     "layer_names": LAYER_NAMES},
    {"product_name": "DEV-2025D", "description": "개발 제품 D (BEOL 축소)",
     "is_backbone": False, "line_code": "LINE-B", "part_id": "DEV-2025D",
     "layer_names": LAYER_NAMES[:80]},
]


# ---------------------------------------------------------------------------
# 9. Scanners per product
# ---------------------------------------------------------------------------

SCANNERS: dict[str, list] = {
    "PROD-2024X": ["NSR-S322F-01", "NSR-S322F-02", "NSR-S631E-01"],
    "PROD-2024Y": ["XT-1900Gi-01", "XT-1900Gi-02", "NXT-2000-01"],
    "PROD-2024Z": ["NSR-S322F-03", "XT-1400E-01"],
    "HBM-3E-MEM": ["XT-1900Gi-01", "NXT-2000-01", "EUV-3400-01"],
    "AP-5G-MOB": ["NXT-2000-01", "EUV-3400-01", "EUV-3400-02"],
    "MCU-AUTO-V2": ["NSR-S322F-01", "NSR-S322F-02", "NSR-S631E-01"],
    "HPC-SERVER-X": ["EUV-3400-01", "EUV-3400-02", "NXT-2000-01"],
    "IOT-LP-V1": ["NSR-S322F-03", "XT-1400E-01"],
}

# For products without explicit scanner list, fall back to PROD-2024X scanners
def _get_scanners(product_name: str) -> list:
    return SCANNERS.get(product_name, SCANNERS["PROD-2024X"])


# ---------------------------------------------------------------------------
# 10. Conditions Generator
# ---------------------------------------------------------------------------

def _jitter(base: float, pct: float = 0.05) -> float:
    return round(base * (1 + random.uniform(-pct, pct)), 2)


def _jitter_int(base: int, pct: float = 0.05) -> int:
    return int(round(base * (1 + random.uniform(-pct, pct))))


def generate_conditions(layer_name: str, product_name: str) -> dict:
    """Generate realistic conditions for a given layer + product (all 350 columns)."""
    prof = LAYER_PROFILES[layer_name]
    pr_type, wavelength, immersion, mask_type, base_energy, base_cd = prof

    offsets = {
        "PROD-2024X": 0, "PROD-2024Y": 1, "PROD-2024Z": -1,
        "HBM-3E-MEM": 1, "AP-5G-MOB": 2, "MCU-AUTO-V2": -1,
        "HPC-SERVER-X": 2, "IOT-LP-V1": -2,
    }
    off = offsets.get(product_name, 0)
    scanners = _get_scanners(product_name)
    scanner = random.choice(scanners)

    is_euv = wavelength == 13
    is_arf = wavelength == 193
    is_adhesion = layer_name not in ("PAD_PHOTO", "FUSE_PHOTO", "BUMP_PHOTO", "BUMP2_PHOTO")
    is_critical = layer_name in _EUV_LAYERS | _ARFI_LAYERS
    use_barc = is_arf and not is_euv and random.random() > 0.4

    # ---- SP section ----
    sp = {
        "SP_PR_TYPE": pr_type,
        "SP_PR_VENDOR": "TOK" if "KrF" in pr_type else ("JSR" if is_euv else "Shin-Etsu"),
        "SP_PR_VISCOSITY_cP": round(random.uniform(5.0, 25.0), 1),
        "SP_DISPENSE_VOL_ml": round(random.uniform(1.5, 2.5), 2),
        "SP_SPIN1_SPEED_rpm": _jitter_int(2000 if is_arf else (1800 if is_euv else 1500)),
        "SP_SPIN1_TIME_sec": random.choice([5, 7, 10]),
        "SP_SPIN2_SPEED_rpm": _jitter_int(4000 if is_arf else (4500 if is_euv else 3500)),
        "SP_SPIN2_TIME_sec": random.choice([20, 25, 30]),
        "SP_EBR_SPEED_rpm": _jitter_int(2500 + off * 100),
        "SP_PREBAKE_TEMP_C": 110 + off * 5 + (10 if is_arf else 0) + (5 if is_euv else 0),
        "SP_PREBAKE_TIME_sec": random.choice([60, 90, 120]),
        "SP_PR_THICKNESS_nm": _jitter_int(1200 if is_arf else (800 if is_euv else 900)),
        "SP_ADHESION_USE": "Y" if is_adhesion else "N",
        "SP_ADHESION_TYPE": "HMDS" if is_adhesion else "NONE",
        "SP_ADHESION_TEMP_C": 100 + off * 5 if is_adhesion else None,
        "SP_COOL_TEMP_C": 23,
        "SP_COOL_TIME_sec": random.choice([30, 40, 60]),
        "SP_COAT_METHOD": "SPIN",
        "SP_HUMIDITY_PCT": round(random.uniform(40.0, 50.0), 1),
        "SP_BACKSIDE_RINSE": "Y",
        # new SP
        "SP_BARC_USE": "Y" if use_barc else "N",
        "SP_BARC_TYPE": random.choice(["ARC-29A", "ARC-40A"]) if use_barc else None,
        "SP_BARC_THICKNESS_nm": round(random.uniform(30.0, 80.0), 1) if use_barc else None,
        "SP_BARC_BAKE_TEMP_C": random.choice([175, 185, 205]) if use_barc else None,
        "SP_BARC_BAKE_TIME_sec": random.choice([60, 90]) if use_barc else None,
        "SP_TARC_USE": "Y" if (is_euv and random.random() > 0.5) else "N",
        "SP_TARC_TYPE": "TARC-101" if is_euv else None,
        "SP_TARC_THICKNESS_nm": round(random.uniform(30.0, 60.0), 1) if is_euv else None,
        "SP_TARC_BAKE_TEMP_C": 110 if is_euv else None,
        "SP_TARC_BAKE_TIME_sec": 60 if is_euv else None,
        "SP_DUAL_COAT_USE": "N",
        "SP_DUAL_COAT_TYPE": None,
        "SP_DUAL_PR_TYPE": None,
        "SP_DUAL_THICKNESS_nm": None,
        "SP_DUAL_BAKE_TEMP_C": None,
        "SP_DUAL_BAKE_TIME_sec": None,
        "SP_EDGE_BEAD_WIDTH_mm": round(random.uniform(1.5, 3.0), 1),
        "SP_EDGE_RINSE_WIDTH_mm": round(random.uniform(1.5, 3.0), 1),
        "SP_EDGE_EXPOSE_WIDTH_mm": round(random.uniform(2.0, 4.0), 1) if is_arf else None,
        "SP_EDGE_EXCLUDE_mm": round(random.uniform(1.0, 3.0), 1),
        "SP_BAKE_RAMP_RATE_C_s": round(random.uniform(1.0, 5.0), 1),
        "SP_BAKE_HOLD_TEMP_C": 110 + off * 5,
        "SP_BAKE_HOLD_TIME_sec": random.choice([30, 60]),
        "SP_COOL_RAMP_RATE_C_s": round(random.uniform(0.5, 2.0), 1),
        "SP_BAKE_UNIFORMITY_C": round(random.uniform(0.1, 0.5), 2),
        "SP_DISPENSE_RATE_ml_s": round(random.uniform(0.5, 1.5), 2),
        "SP_DISPENSE_NOZZLE": random.choice(["CENTER", "SCAN"]),
        "SP_DISPENSE_HEIGHT_mm": round(random.uniform(0.5, 2.0), 2),
        "SP_DISPENSE_OFFSET_mm": round(random.uniform(-1.0, 1.0), 2),
        "SP_DISPENSE_ANGLE_deg": round(random.uniform(0.0, 5.0), 1),
        "SP_PR_LOT_ID": f"LOT-{random.randint(10000, 99999)}",
        "SP_PR_EXPIRY_DAYS": random.choice([30, 60, 90]),
        "SP_PR_FILTER_um": random.choice([0.05, 0.1, 0.2]),
        "SP_PR_SOLVENT": "PGMEA" if not is_euv else "EL",
        "SP_PR_SENSITIVITY": "HIGH" if is_euv else ("MEDIUM" if is_arf else "LOW"),
        "SP_AMBIENT_TEMP_C": random.choice([23, 24]),
        "SP_CHUCK_TEMP_C": random.choice([22, 23]),
        "SP_EXHAUST_PRESS_Pa": round(random.uniform(-5.0, -1.0), 1),
        "SP_CDA_FLOW_L_min": round(random.uniform(20.0, 50.0), 1),
        "SP_N2_PURGE_USE": "Y" if is_euv else "N",
        "SP_SPIN3_SPEED_rpm": _jitter_int(1500) if is_arf else None,
        "SP_SPIN3_TIME_sec": random.choice([5, 10]) if is_arf else None,
        "SP_SPIN3_ACCEL_rpm_s": _jitter_int(3000) if is_arf else None,
        "SP_SPIN1_ACCEL_rpm_s": _jitter_int(5000),
        "SP_SPIN2_ACCEL_rpm_s": _jitter_int(5000),
        "SP_PR_BATCH_ID": f"BATCH-{random.randint(1000, 9999)}",
        "SP_COAT_RECIPE_ID": f"COAT-{layer_name.replace('_PHOTO', '')}-R{off + 1:02d}",
        "SP_TRACK_TOOL_ID": random.choice(["TEL-ACT12-01", "TEL-ACT12-02"]),
        "SP_COAT_PASS_COUNT": 1,
        "SP_BSR_TIME_sec": random.choice([5, 10, 15]) if is_adhesion else None,
        "SP_BSR_SPEED_rpm": _jitter_int(1000) if is_adhesion else None,
        "SP_SOLVENT_TYPE": "PGMEA",
        "SP_PREWET_USE": "Y" if is_euv else "N",
        "SP_PREWET_VOL_ml": round(random.uniform(0.5, 1.5), 2) if is_euv else None,
        "SP_PREWET_TIME_sec": random.choice([3, 5]) if is_euv else None,
        # additional SP columns
        "SP_NOZZLE_MATERIAL": random.choice(["PTFE", "PEEK"]),
        "SP_SPIN_RAMP_TIME_sec": random.choice([2, 3, 5]),
        "SP_SPIN_HOLD_TIME_sec": random.choice([5, 10, 15]),
        "SP_PR_BATCH_SIZE": random.choice([25, 50, 100]),
        "SP_CHILL_PLATE_TEMP_C": random.choice([23, 24]),
        "SP_CHILL_PLATE_TIME_sec": random.choice([30, 60]),
        "SP_COAT_ARM_SPEED_rpm_s": round(random.uniform(500.0, 2000.0), 0),
        "SP_DISPENSE_TEMP_C": round(random.uniform(21.0, 25.0), 1),
        "SP_PR_AGED_DAYS": random.randint(0, 30),
        "SP_SPIN_CUP_TYPE": random.choice(["OPEN", "CLOSED"]),
    }

    # ---- SC section ----
    sc = {
        "SC_TOOL_ID": scanner,
        "SC_RETICLE_ID": f"RTL-{layer_name.replace('_PHOTO', '')}-{str(off + 1).zfill(3)}",
        "SC_EXPOSE_ENERGY_mJ": round(base_energy + off * 1.5 + random.uniform(-0.5, 0.5), 1),
        "SC_EXPOSE_FOCUS_um": round(random.uniform(-0.05, 0.05) + off * 0.005, 3),
        "SC_ILLUM_MODE": "ANNULAR" if is_arf else ("CQUAD" if is_euv else "CONVENTIONAL"),
        "SC_ILLUM_SIGMA_IN": round(random.uniform(0.4, 0.6), 2) if (is_arf or is_euv) else round(random.uniform(0.3, 0.5), 2),
        "SC_ILLUM_SIGMA_OUT": round(random.uniform(0.7, 0.9), 2),
        "SC_NA": 1.35 if immersion == "Y" else (0.85 if is_arf else (0.33 if is_euv else 0.68)),
        "SC_DOSE_TOLERANCE_PCT": round(random.uniform(2.0, 5.0), 1),
        "SC_ALIGN_MARK_TYPE": "ATHENA" if is_arf else ("SMASH" if is_euv else "SSA"),
        "SC_ALIGN_TREE": f"TREE_{layer_name.replace('_PHOTO', '')}",
        "SC_EXPOSE_MODE": "STEP_SCAN",
        "SC_SCAN_DIRECTION": random.choice(["IN_SCAN", "OUT_SCAN"]),
        "SC_SLIT_WIDTH_mm": round(random.uniform(8.0, 14.0), 1),
        "SC_RETICLE_CORR_X_nm": round(random.uniform(-5.0, 5.0), 2),
        "SC_RETICLE_CORR_Y_nm": round(random.uniform(-5.0, 5.0), 2),
        "SC_WAVELENGTH_nm": wavelength,
        "SC_MASK_TYPE": mask_type,
        "SC_IMMERSION": immersion,
        # new SC
        "SC_ABER_COMA_X": round(random.uniform(-0.5, 0.5), 3) if is_critical else None,
        "SC_ABER_COMA_Y": round(random.uniform(-0.5, 0.5), 3) if is_critical else None,
        "SC_ABER_ASTIG_X": round(random.uniform(-0.3, 0.3), 3) if is_critical else None,
        "SC_ABER_ASTIG_Y": round(random.uniform(-0.3, 0.3), 3) if is_critical else None,
        "SC_ABER_TREFOIL": round(random.uniform(-0.2, 0.2), 3) if is_critical else None,
        "SC_ABER_SPHERICAL": round(random.uniform(-0.5, 0.5), 3) if is_critical else None,
        "SC_ABER_FIELD_CURV": round(random.uniform(-1.0, 1.0), 3) if is_critical else None,
        "SC_DOSE_MAP_TYPE": "GRID" if is_critical else "UNIFORM",
        "SC_DOSE_MAP_POINTS": random.choice([25, 49, 81]) if is_critical else None,
        "SC_FOCUS_MAP_TYPE": "GRID" if is_critical else "UNIFORM",
        "SC_FOCUS_MAP_POINTS": random.choice([25, 49]) if is_critical else None,
        "SC_DOSE_CORR_PCT": round(random.uniform(-2.0, 2.0), 2),
        "SC_FOCUS_CORR_um": round(random.uniform(-0.05, 0.05), 3),
        "SC_DOSE_UNIFORMITY_PCT": round(random.uniform(0.3, 1.0), 2),
        "SC_SHOT_SIZE_X_mm": round(random.uniform(25.0, 33.0), 1),
        "SC_SHOT_SIZE_Y_mm": round(random.uniform(25.0, 33.0), 1),
        "SC_SHOT_OFFSET_X_mm": round(random.uniform(-0.5, 0.5), 3),
        "SC_SHOT_OFFSET_Y_mm": round(random.uniform(-0.5, 0.5), 3),
        "SC_FIELD_SIZE_X_mm": round(random.uniform(25.0, 33.0), 1),
        "SC_FIELD_SIZE_Y_mm": round(random.uniform(25.0, 33.0), 1),
        "SC_SHOT_ROTATION_mrad": round(random.uniform(-0.1, 0.1), 4),
        "SC_ALIGN_CORR_X_nm": round(random.uniform(-3.0, 3.0), 2),
        "SC_ALIGN_CORR_Y_nm": round(random.uniform(-3.0, 3.0), 2),
        "SC_ALIGN_ROTATION_urad": round(random.uniform(-10.0, 10.0), 2),
        "SC_ALIGN_MAG_PPM": round(random.uniform(-5.0, 5.0), 2),
        "SC_WAFER_ROTATION_urad": round(random.uniform(-5.0, 5.0), 2),
        "SC_ALIGN_SEQ": f"SEQ_{layer_name.replace('_PHOTO', '')}_A",
        "SC_FOCUS_TILT_X_nm": round(random.uniform(-2.0, 2.0), 2),
        "SC_FOCUS_TILT_Y_nm": round(random.uniform(-2.0, 2.0), 2),
        "SC_FOCUS_OFFSET_nm": round(random.uniform(-10.0, 10.0), 1),
        "SC_LEVEL_SENSOR_MODE": "AUTO",
        "SC_FOCUS_EXPO_MODE": "BEST" if is_critical else "FIXED",
        "SC_GLOBAL_FOCUS_nm": round(random.uniform(-5.0, 5.0), 1),
        "SC_PELLICLE_USE": "Y" if (is_arf or is_euv) else "N",
        "SC_PELLICLE_TYPE": ("EUV-PELLICLE" if is_euv else "FSI") if (is_arf or is_euv) else None,
        "SC_PELLICLE_TRANS_PCT": round(random.uniform(90.0, 99.5), 1) if (is_arf or is_euv) else None,
        "SC_EUV_POWER_W": round(random.uniform(100.0, 350.0), 1) if is_euv else None,
        "SC_EUV_DOSE_RATE": round(random.uniform(5.0, 20.0), 2) if is_euv else None,
        "SC_EUV_FLARE_PCT": round(random.uniform(1.0, 5.0), 2) if is_euv else None,
        "SC_EUV_STOCHASTIC_MODE": random.choice(["STANDARD", "ENHANCED"]) if is_euv else None,
        "SC_EUV_MASK_3D_CORR": "Y" if is_euv else None,
        "SC_RETICLE_QUAL_DATE": f"2024-{random.randint(1, 12):02d}-{random.randint(1, 28):02d}",
        "SC_RETICLE_USAGE_COUNT": random.randint(0, 500),
        "SC_BATCH_ID": f"SCBATCH-{random.randint(1000, 9999)}",
        "SC_RECIPE_ID": f"SCRC-{layer_name.replace('_PHOTO', '')}-{off + 1:02d}",
        "SC_EXPOSE_PASSES": 1 if not is_euv else random.choice([1, 2]),
        "SC_MULTI_EXPOSE_USE": "Y" if ("_A_PHOTO" in layer_name or "_B_PHOTO" in layer_name) else "N",
        "SC_BASELINE_ENERGY_mJ": round(base_energy, 1),
        "SC_BASELINE_FOCUS_um": 0.0,
        "SC_SCAN_SPEED_mm_s": round(random.uniform(300.0, 700.0), 1),
        "SC_SLIT_PROFILE": "UNIFORM",
        "SC_PUPIL_FILL": round(random.uniform(60.0, 95.0), 1),
        "SC_SOURCE_SHAPE": "QUADRUPOLE" if is_arf else ("CIRCULAR" if is_euv else "ANNULAR"),
        "SC_PELLICLE_FRAME_ID": f"PEL-{random.randint(100, 999)}" if (is_arf or is_euv) else None,
        "SC_RETICLE_CD_nm": round(base_cd * 4, 1) if is_critical else None,
        "SC_DEFOCUS_BUDGET_nm": round(random.uniform(20.0, 80.0), 1) if is_critical else None,
        "SC_DOSE_LATITUDE_PCT": round(random.uniform(5.0, 20.0), 1) if is_critical else None,
        "SC_FOCUS_LATITUDE_um": round(random.uniform(0.05, 0.3), 3) if is_critical else None,
        "SC_NILS": round(random.uniform(1.2, 2.5), 2) if is_critical else None,
        "SC_MEF": round(random.uniform(2.0, 4.0), 2) if is_critical else None,
        "SC_THPUT_WPH": random.choice([60, 80, 100, 120]) if is_euv else random.choice([100, 150, 200]),
        "SC_IMAGE_LOG_SLOPE": round(random.uniform(10.0, 40.0), 1) if is_critical else None,
        # additional SC columns
        "SC_FOCUS_DRIFT_nm_hr": round(random.uniform(-2.0, 2.0), 2) if is_critical else None,
        "SC_DOSE_DRIFT_PCT_hr": round(random.uniform(-0.5, 0.5), 3) if is_critical else None,
        "SC_RETICLE_HEAT_CORR": "Y" if is_critical else "N",
        "SC_LENS_HEAT_CORR": "Y" if is_arf or is_euv else "N",
        "SC_WAFER_STAGE_TEMP_C": round(random.uniform(22.5, 23.5), 1),
        "SC_ILLUM_UNIFORMITY_PCT": round(random.uniform(95.0, 99.9), 1),
        "SC_RETICLE_FLATNESS_nm": round(random.uniform(20.0, 80.0), 1) if is_critical else None,
        "SC_SHOT_COUNT": random.randint(100, 50000),
        "SC_WAFER_COUNT": random.randint(10, 5000),
    }

    # ---- OVL section ----
    ref_step_seq = OVL_REFS_STEP_SEQ.get(layer_name, "za000000")
    base_spec = 3.0 if is_euv else (5.0 if is_critical else (8.0 if is_arf else 12.0))
    ovl = {
        "OVL_SPEC_X_nm": round(base_spec + off * 0.5 + random.uniform(-0.3, 0.3), 1),
        "OVL_SPEC_Y_nm": round(base_spec + off * 0.3 + random.uniform(-0.3, 0.3), 1),
        "OVL_REF_LAYER": ref_step_seq,
        "OVL_CORRECT_X_nm": round(random.uniform(-3.0, 3.0), 2),
        "OVL_CORRECT_Y_nm": round(random.uniform(-3.0, 3.0), 2),
        "OVL_APC_USE": "Y" if is_critical else "N",
        "OVL_APC_TYPE": "LINEAR" if is_critical else None,
        "OVL_MEAS_TOOL": random.choice(["ARCHER-500", "ARCHER-600", "YS-350"]),
        "OVL_MEAS_POINT_COUNT": random.choice([20, 40, 60]),
        "OVL_SAMPLING_MODE": "FULL" if is_critical else "SPARSE",
        "OVL_REG_MODEL": "10PAR" if is_critical else "6PAR",
        "OVL_FEEDBACK_USE": "Y" if is_critical else "N",
        "OVL_FEEDFORWARD_USE": "Y" if layer_name in ("M1_PHOTO", "M2_PHOTO") else "N",
        "OVL_TARGET_TYPE": "AIMplus" if is_euv else ("uDBO" if is_arf else "AIM"),
        # new OVL
        "OVL_REF_LAYER_2": None,
        "OVL_REF_LAYER_3": None,
        "OVL_REF_WEIGHT_1": 1.0,
        "OVL_REF_WEIGHT_2": None,
        "OVL_REF_WEIGHT_3": None,
        "OVL_CORR_3RD_X": round(random.uniform(-0.5, 0.5), 3) if is_euv else None,
        "OVL_CORR_3RD_Y": round(random.uniform(-0.5, 0.5), 3) if is_euv else None,
        "OVL_CORR_ROTATION_urad": round(random.uniform(-5.0, 5.0), 2),
        "OVL_CORR_MAG_PPM": round(random.uniform(-3.0, 3.0), 2),
        "OVL_CORR_ASYM_X": round(random.uniform(-1.0, 1.0), 2) if is_critical else None,
        "OVL_CORR_ASYM_Y": round(random.uniform(-1.0, 1.0), 2) if is_critical else None,
        "OVL_INTRAFIELD_CORR_USE": "Y" if is_euv else "N",
        "OVL_WAFER_BOW_um": round(random.uniform(-50.0, 50.0), 1),
        "OVL_WAFER_WARP_um": round(random.uniform(10.0, 100.0), 1),
        "OVL_STRESS_CORR_USE": "Y" if is_critical else "N",
        "OVL_THERMAL_CORR_USE": "Y" if is_critical else "N",
        "OVL_CMP_CORR_USE": "N",
        "OVL_ETCH_SHIFT_X_nm": round(random.uniform(-2.0, 2.0), 2) if is_critical else None,
        "OVL_ETCH_SHIFT_Y_nm": round(random.uniform(-2.0, 2.0), 2) if is_critical else None,
        "OVL_DEP_SHIFT_X_nm": None,
        "OVL_DEP_SHIFT_Y_nm": None,
        "OVL_CMP_SHIFT_X_nm": None,
        "OVL_CMP_SHIFT_Y_nm": None,
        "OVL_MEAS_RECIPE_ID": f"OVL-RC-{layer_name.replace('_PHOTO', '')}-{off + 1:02d}",
        "OVL_MEAS_WAVELENGTH_nm": random.choice([532, 633, 785]),
        "OVL_MEAS_ANGLE_deg": random.choice([0.0, 45.0, 90.0]),
        "OVL_MEAS_AZIMUTH_deg": random.choice([0.0, 90.0, 180.0, 270.0]),
        "OVL_MEAS_FOCUS_um": round(random.uniform(-0.5, 0.5), 2),
        "OVL_MEAS_SPOT_SIZE_um": random.choice([1.0, 2.0, 5.0]),
        "OVL_SPC_UCL_X_nm": round(base_spec * 1.5, 1),
        "OVL_SPC_LCL_X_nm": round(-base_spec * 1.5, 1),
        "OVL_SPC_UCL_Y_nm": round(base_spec * 1.5, 1),
        "OVL_SPC_LCL_Y_nm": round(-base_spec * 1.5, 1),
        "OVL_SPC_MEAN_SHIFT_X": round(random.uniform(-0.5, 0.5), 2),
        "OVL_SPC_MEAN_SHIFT_Y": round(random.uniform(-0.5, 0.5), 2),
        "OVL_MARK_LAYER": layer_name.replace("_PHOTO", "_OVL"),
        "OVL_MARK_DESIGN": "AIM_MARK" if is_euv else ("uDBO" if is_arf else "BOX_IN_BOX"),
        "OVL_MARK_SIZE_um": random.choice([10.0, 20.0, 30.0]),
        "OVL_MARK_PITCH_um": random.choice([100.0, 200.0, 300.0]),
        "OVL_DBO_NUM_PADS": random.choice([4, 8, 16]) if is_arf else None,
        "OVL_DBO_PAD_SIZE_um": random.choice([1.0, 2.0]) if is_arf else None,
        "OVL_CORR_METHOD": "CPE" if is_euv else "HPE",
        "OVL_CORR_MODEL_VER": f"v{random.randint(1, 5)}.{random.randint(0, 9)}",
        "OVL_FEEDBACK_GAIN": round(random.uniform(0.5, 0.9), 2) if is_critical else None,
        "OVL_FF_GAIN": round(random.uniform(0.5, 0.9), 2) if is_critical else None,
        "OVL_BATCH_ID": f"OVLBATCH-{random.randint(1000, 9999)}",
        "OVL_MEAS_PASS_COUNT": random.choice([1, 2, 3]),
        "OVL_MEAS_SITE_X": random.choice([5, 7, 9]),
        "OVL_MEAS_SITE_Y": random.choice([5, 7, 9]),
        "OVL_TIS_X_nm": round(random.uniform(-1.0, 1.0), 2),
        "OVL_TIS_Y_nm": round(random.uniform(-1.0, 1.0), 2),
        "OVL_WIS_X_nm": round(random.uniform(-0.5, 0.5), 2),
        "OVL_WIS_Y_nm": round(random.uniform(-0.5, 0.5), 2),
        "OVL_RESI_3SIGMA_X_nm": round(random.uniform(0.5, 3.0), 2) if is_critical else None,
        "OVL_RESI_3SIGMA_Y_nm": round(random.uniform(0.5, 3.0), 2) if is_critical else None,
        "OVL_RESI_MAX_X_nm": round(random.uniform(1.0, 5.0), 2) if is_critical else None,
        "OVL_RESI_MAX_Y_nm": round(random.uniform(1.0, 5.0), 2) if is_critical else None,
        "OVL_MMO_X_nm": round(random.uniform(-2.0, 2.0), 2),
        "OVL_MMO_Y_nm": round(random.uniform(-2.0, 2.0), 2),
        "OVL_SPEC_VECTOR_nm": round(base_spec * 1.41, 1),
        "OVL_GOLDEN_REF_USE": "Y" if is_euv else "N",
        # additional OVL columns
        "OVL_FIELD_ROTATION_urad": round(random.uniform(-5.0, 5.0), 2) if is_critical else None,
        "OVL_FIELD_MAG_PPM": round(random.uniform(-3.0, 3.0), 2) if is_critical else None,
        "OVL_CALIB_DATE": f"2024-{random.randint(1, 12):02d}-{random.randint(1, 28):02d}",
        "OVL_TOOL_INDUCED_SHIFT_X": round(random.uniform(-1.0, 1.0), 2) if is_critical else None,
        "OVL_TOOL_INDUCED_SHIFT_Y": round(random.uniform(-1.0, 1.0), 2) if is_critical else None,
    }

    # ---- DEV section ----
    dev = {
        "DEV_TYPE": "NMD-3" if "KrF" in pr_type else "TMAH_2.38",
        "DEV_PUDDLE_TIME_sec": random.choice([30, 45, 60]) + off * 5,
        "DEV_PUDDLE_COUNT": random.choice([1, 2]),
        "DEV_RINSE_TYPE": "DI_WATER",
        "DEV_RINSE_TIME_sec": random.choice([15, 20, 30]),
        "DEV_POSTBAKE_TEMP_C": 110 + off * 5,
        "DEV_POSTBAKE_TIME_sec": random.choice([60, 90]),
        "DEV_CD_TARGET_nm": round(base_cd + off * 2 + random.uniform(-1, 1), 1),
        "DEV_CD_SPEC_LOW_nm": round(base_cd - 10 + off * 2, 1),
        "DEV_CD_SPEC_HIGH_nm": round(base_cd + 10 + off * 2, 1),
        "DEV_CD_MEAS_TOOL": random.choice(["CD-SEM-01", "CD-SEM-02", "OCD-01"]),
        "DEV_CD_MEAS_POINTS": random.choice([5, 9, 13]),
        "DEV_INSPECT_TOOL": random.choice(["KLA-2810", "KLA-2815", "KLA-Puma"]),
        "DEV_DEFECT_SPEC": random.choice([50, 100, 150, 200]),
        # new DEV
        "DEV_OCD_USE": "Y" if is_critical else "N",
        "DEV_OCD_TOOL": "OCD-01" if is_critical else None,
        "DEV_OCD_RECIPE": f"OCD-{layer_name.replace('_PHOTO', '')}-R1" if is_critical else None,
        "DEV_OCD_SITE_COUNT": random.choice([5, 9]) if is_critical else None,
        "DEV_OCD_MODEL": f"MODEL-{layer_name.replace('_PHOTO', '')}" if is_critical else None,
        "DEV_AFM_USE": "N",
        "DEV_AFM_TOOL": None,
        "DEV_AFM_SCAN_SIZE_um": None,
        "DEV_AFM_SCAN_RATE_Hz": None,
        "DEV_DEFECT_CLASS_USE": "Y" if is_critical else "N",
        "DEV_DEFECT_CLASS_RECIPE": f"DCLS-{layer_name.replace('_PHOTO', '')}" if is_critical else None,
        "DEV_DEFECT_REVIEW_TOOL": random.choice(["KLA-2810", "REVIEW-SEM-01"]) if is_critical else None,
        "DEV_DEFECT_REVIEW_COUNT": random.choice([10, 20, 50]) if is_critical else None,
        "DEV_DEFECT_KILLER_PCT": round(random.uniform(0.0, 5.0), 1) if is_critical else None,
        "DEV_DEFECT_NUISANCE_PCT": round(random.uniform(0.0, 30.0), 1) if is_critical else None,
        "DEV_REWORK_SPEC_USE": "Y" if is_critical else "N",
        "DEV_REWORK_CD_LOW_nm": round(base_cd * 0.85, 1) if is_critical else None,
        "DEV_REWORK_CD_HIGH_nm": round(base_cd * 1.15, 1) if is_critical else None,
        "DEV_REWORK_OVL_LIMIT_nm": round(base_spec * 2.0, 1) if is_critical else None,
        "DEV_REWORK_DEFECT_LIMIT": random.choice([10, 20, 50]) if is_critical else None,
        "DEV_REWORK_METHOD": "STRIP_RECOAT" if is_critical else None,
        "DEV_POST_ETCH_CD_nm": round(base_cd * 0.9 + random.uniform(-2, 2), 1) if is_critical else None,
        "DEV_POST_ETCH_PROFILE_deg": round(random.uniform(80.0, 90.0), 1) if is_critical else None,
        "DEV_POST_ETCH_DEPTH_nm": round(random.uniform(50.0, 200.0), 1) if is_critical else None,
        "DEV_POST_ETCH_MEAS_TOOL": "CD-SEM-01" if is_critical else None,
        "DEV_POST_ETCH_SITE_COUNT": random.choice([5, 9]) if is_critical else None,
        "DEV_SPC_CD_UCL_nm": round(base_cd + 15, 1) if is_critical else None,
        "DEV_SPC_CD_LCL_nm": round(base_cd - 15, 1) if is_critical else None,
        "DEV_SPC_CD_TARGET_nm": round(base_cd, 1) if is_critical else None,
        "DEV_SPC_UNIFORMITY_PCT": round(random.uniform(1.0, 5.0), 1) if is_critical else None,
        "DEV_SPC_RANGE_nm": round(random.uniform(2.0, 10.0), 1) if is_critical else None,
        "DEV_TEMP_C": random.choice([23, 24]),
        "DEV_FLOW_RATE_ml_s": round(random.uniform(0.5, 2.0), 2),
        "DEV_NOZZLE_TYPE": "PUDDLE" if not is_euv else "SCAN",
        "DEV_NOZZLE_SCAN_SPEED_mm_s": round(random.uniform(20.0, 80.0), 1),
        "DEV_NOZZLE_GAP_mm": round(random.uniform(0.5, 2.0), 2),
        "DEV_DISPENSE_MODE": "STATIC",
        "DEV_SPIN_SPEED_rpm": _jitter_int(1000),
        "DEV_SPIN_TIME_sec": random.choice([10, 20, 30]),
        "DEV_PEB_TEMP_C": 110 + off * 5 + (10 if is_euv else 0),
        "DEV_PEB_TIME_sec": random.choice([60, 90, 120]),
        "DEV_PEB_RAMP_RATE_C_s": round(random.uniform(1.0, 5.0), 1),
        "DEV_PEB_UNIFORMITY_C": round(random.uniform(0.1, 0.5), 2),
        "DEV_PEB_DELAY_sec": random.choice([0, 30, 60]),
        "DEV_PROFILE_ANGLE_deg": round(random.uniform(85.0, 90.0), 1) if is_critical else None,
        "DEV_SIDEWALL_ANGLE_deg": round(random.uniform(80.0, 89.0), 1) if is_critical else None,
        "DEV_LWR_nm": round(random.uniform(1.0, 5.0), 1) if is_critical else None,
        "DEV_LER_nm": round(random.uniform(1.0, 5.0), 1) if is_critical else None,
        "DEV_RESIST_LOSS_nm": round(random.uniform(5.0, 30.0), 1),
        "DEV_PATTERN_COLLAPSE_USE": "Y" if is_euv else "N",
        "DEV_CD_UNIFORMITY_PCT": round(random.uniform(1.0, 5.0), 1),
        "DEV_CD_3SIGMA_nm": round(random.uniform(1.0, 5.0), 1),
        "DEV_CD_RANGE_nm": round(random.uniform(2.0, 10.0), 1),
        "DEV_BATCH_ID": f"DEVBATCH-{random.randint(1000, 9999)}",
        "DEV_RECIPE_ID": f"DEVRC-{layer_name.replace('_PHOTO', '')}-{off + 1:02d}",
        "DEV_TRACK_TOOL_ID": random.choice(["TEL-ACT12-01", "TEL-ACT12-02"]),
        "DEV_STRIP_USE": "N",
        "DEV_STRIP_METHOD": None,
        "DEV_STRIP_TEMP_C": None,
        "DEV_STRIP_TIME_sec": None,
        "DEV_HARD_BAKE_TEMP_C": 130 + off * 5 if not is_euv else None,
        "DEV_HARD_BAKE_TIME_sec": random.choice([60, 120]) if not is_euv else None,
        "DEV_DI_RESIST_Mohm": round(random.uniform(15.0, 18.0), 1),
        "DEV_RINSE_FLOW_ml_s": round(random.uniform(0.3, 1.0), 2),
        "DEV_RINSE_SPIN_rpm": _jitter_int(1500),
        "DEV_DRY_SPIN_rpm": _jitter_int(2000),
        "DEV_DRY_TIME_sec": random.choice([20, 30]),
        # additional DEV columns
        "DEV_PUDDLE2_TIME_sec": random.choice([30, 45, 60]) if not is_euv else None,
        "DEV_PUDDLE2_TEMP_C": random.choice([23, 24]) if not is_euv else None,
        "DEV_MEGA_SONIC_USE": "N",
        "DEV_MEGA_SONIC_FREQ_kHz": None,
        "DEV_MEGA_SONIC_POWER_W": None,
        "DEV_CD_SEM_MODE": "AUTO" if is_critical else "SEMI_AUTO",
        "DEV_CD_SEM_VOLTAGE_kV": random.choice([0.8, 1.0, 1.2]) if is_critical else None,
        "DEV_CD_SEM_CURRENT_pA": random.choice([10.0, 20.0, 30.0]) if is_critical else None,
        "DEV_CD_SITE_X_COUNT": random.choice([3, 5, 7]),
        "DEV_CD_SITE_Y_COUNT": random.choice([3, 5, 7]),
        "DEV_BRIDGE_INSPECT_USE": "Y" if is_euv else "N",
        "DEV_BRIDGE_SPEC_COUNT": random.choice([0, 1, 2]) if is_euv else None,
        "DEV_NECK_INSPECT_USE": "Y" if is_euv else "N",
        "DEV_DEFECT_SCAN_SPEED": "HIGH" if is_critical else "MEDIUM",
    }

    # Merge all sections, strip None values
    conditions = {}
    for d in (sp, sc, ovl, dev):
        for k, v in d.items():
            if v is not None:
                conditions[k] = v
    return conditions


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

        # --- Products (Backbone) + ProductLayers ---
        product_ids = {}
        pl_count = 0
        for prod in PRODUCTS:
            session.execute(
                text("INSERT INTO products (product_name, description, is_backbone, line_id, part_id) "
                     "VALUES (:name, :desc, :bb, :lid, :pid)"),
                {
                    "name": prod["product_name"], "desc": prod["description"],
                    "bb": prod["is_backbone"],
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
        print(f"  Products (backbone): {len(product_ids)}")
        print(f"  Product Layers: {pl_count} ({len(PRODUCTS)} products x {len(LAYER_NAMES)} layers)")

        # --- Non-backbone Products ---
        nb_count = 0
        nb_pl_count = 0
        for prod in NON_BACKBONE_PRODUCTS:
            session.execute(
                text("INSERT INTO products (product_name, description, is_backbone, line_id, part_id) "
                     "VALUES (:name, :desc, :bb, :lid, :pid)"),
                {
                    "name": prod["product_name"], "desc": prod["description"],
                    "bb": prod["is_backbone"],
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
        print(f"  Products (non-backbone): {nb_count}")
        print(f"  Non-backbone Product Layers: {nb_pl_count}")

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
                    "equip_source": "equipment_assignments",
                    "equip_vary_columns": ["SC_EXPOSE_ENERGY_mJ", "SC_EXPOSE_FOCUS_um"],
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

        # --- Test Project (approved) for Export Testing ---
        session.execute(
            text(
                "INSERT INTO projects (product_id, main_backbone_id, status, revision, is_latest, created_by) "
                "VALUES (:pid, :bbid, 'approved', 1, TRUE, :uid)"
            ),
            {
                "pid": product_ids["PROD-2024X"],
                "bbid": product_ids["PROD-2024X"],
                "uid": user_ids["engineer1"],
            },
        )
        result = session.execute(
            text("SELECT id FROM projects WHERE product_id = :pid AND status = 'approved'"),
            {"pid": product_ids["PROD-2024X"]},
        )
        test_project_id = result.scalar()

        random.seed(99)
        project_layer_ids = {}
        for layer_name, _, _, sort_order_val in LAYERS:
            conditions = generate_conditions(layer_name, "PROD-2024X")
            session.execute(
                text(
                    "INSERT INTO project_layers "
                    "(project_id, layer_id, backbone_product_id, conditions, backbone_conditions, sort_order) "
                    "VALUES (:proj_id, :lid, :bbpid, CAST(:cond AS jsonb), CAST(:bcond AS jsonb), :sort)"
                ),
                {
                    "proj_id": test_project_id,
                    "lid": layer_ids[layer_name],
                    "bbpid": product_ids["PROD-2024X"],
                    "cond": json.dumps(conditions),
                    "bcond": json.dumps(conditions),
                    "sort": sort_order_val,
                },
            )
            result = session.execute(
                text("SELECT id FROM project_layers WHERE project_id = :pid AND layer_id = :lid"),
                {"pid": test_project_id, "lid": layer_ids[layer_name]},
            )
            project_layer_ids[layer_name] = result.scalar()
        print(f"  Test Project (approved): id={test_project_id}, layers={len(project_layer_ids)}")

        # --- Equipment Assignments ---
        scanner_assignments = [
            "NSR-S322F-01", "NSR-S322F-02", "NSR-S631E-01", "XT-1400E-01", "NXT-2000-01",
        ]
        ea_count = 0
        random.seed(77)
        for layer_name, pl_id in project_layer_ids.items():
            num_equip = random.choice([3, 4, 5])
            for i, equip_id in enumerate(scanner_assignments[:num_equip]):
                overrides = {}
                if layer_name in LAYER_PROFILES:
                    base_energy = LAYER_PROFILES[layer_name][4]
                    overrides = {
                        "SC_EXPOSE_ENERGY_mJ": str(round(base_energy + (i - 1) * 0.5, 1)),
                        "SC_EXPOSE_FOCUS_um": str(round(random.uniform(-0.03, 0.03), 3)),
                    }
                session.execute(
                    text(
                        "INSERT INTO equipment_assignments "
                        "(project_layer_id, equipment_id, equipment_params, sort_order) "
                        "VALUES (:plid, :eid, CAST(:params AS jsonb), :sort)"
                    ),
                    {
                        "plid": pl_id, "eid": equip_id,
                        "params": json.dumps(overrides), "sort": i + 1,
                    },
                )
                ea_count += 1
        print(f"  Equipment Assignments: {ea_count}")

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

        session.commit()
        print("\nSeed completed successfully!")
        print(f"  Total columns: {len(col_ids)}")
        print(f"  Total layers: {len(layer_ids)}")
        print(f"  Total products: {len(product_ids)}")


if __name__ == "__main__":
    try:
        seed()
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
