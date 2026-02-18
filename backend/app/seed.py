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

engine = create_engine(settings.DATABASE_URL_SYNC)


# ---------------------------------------------------------------------------
# 1. Column Categories & Definitions (67 columns)
# ---------------------------------------------------------------------------

CATEGORIES = [
    {"category_code": "SP", "category_name": "Spin / PR", "sort_order": 1},
    {"category_code": "SC", "category_name": "Scanner / Expose", "sort_order": 2},
    {"category_code": "OVL", "category_name": "Overlay", "sort_order": 3},
    {"category_code": "DEV", "category_name": "Develop", "sort_order": 4},
]

# All scanner tool IDs in the fab (used as select options)
SCANNER_TOOL_OPTIONS = [
    "NSR-S322F-01", "NSR-S322F-02", "NSR-S322F-03",
    "NSR-S631E-01", "XT-1400E-01",
    "XT-1900Gi-01", "XT-1900Gi-02", "NXT-2000-01",
]

# (column_name, display_name, category_code, data_type, unit, is_required, select_options)
COLUMN_DEFS: list[tuple] = [
    # --- SP (20) ---
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

    # --- SC (19) ---
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

    # --- OVL (14) ---
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

    # --- DEV (14) ---
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
]

# ---------------------------------------------------------------------------
# 2. Validation Rules
# ---------------------------------------------------------------------------

# (column_name, rule_type, rule_config, error_message)
VALIDATION_RULES: list[tuple] = [
    # Range validations
    ("SP_SPIN1_SPEED_rpm", "range", {"min": 500, "max": 8000},
     "Spin1 Speed는 500~8000 rpm 범위여야 합니다"),
    ("SP_SPIN2_SPEED_rpm", "range", {"min": 500, "max": 8000},
     "Spin2 Speed는 500~8000 rpm 범위여야 합니다"),
    ("SP_PREBAKE_TEMP_C", "range", {"min": 0, "max": 300},
     "Prebake 온도는 0~300℃ 범위여야 합니다"),
    ("SP_PREBAKE_TIME_sec", "range", {"min": 1, "max": 600},
     "Prebake 시간은 1~600초 범위여야 합니다"),
    ("SP_ADHESION_TEMP_C", "range", {"min": 0, "max": 200},
     "Adhesion 온도는 0~200℃ 범위여야 합니다"),
    ("SP_PR_THICKNESS_nm", "range", {"min": 100, "max": 10000},
     "PR 두께는 100~10000nm 범위여야 합니다"),
    ("SP_DISPENSE_VOL_ml", "range", {"min": 0.5, "max": 5.0},
     "Dispense 량은 0.5~5.0ml 범위여야 합니다"),
    ("SC_EXPOSE_ENERGY_mJ", "range", {"min": 1.0, "max": 200.0},
     "노광 에너지는 1~200mJ 범위여야 합니다"),
    ("SC_EXPOSE_FOCUS_um", "range", {"min": -1.0, "max": 1.0},
     "포커스는 -1.0~1.0μm 범위여야 합니다"),
    ("SC_NA", "range", {"min": 0.1, "max": 1.5},
     "NA는 0.1~1.5 범위여야 합니다"),
    ("OVL_SPEC_X_nm", "range", {"min": 0.1, "max": 50.0},
     "OVL Spec X는 0.1~50nm 범위여야 합니다"),
    ("OVL_SPEC_Y_nm", "range", {"min": 0.1, "max": 50.0},
     "OVL Spec Y는 0.1~50nm 범위여야 합니다"),
    ("DEV_PUDDLE_TIME_sec", "range", {"min": 5, "max": 300},
     "Puddle 시간은 5~300초 범위여야 합니다"),
    ("DEV_POSTBAKE_TEMP_C", "range", {"min": 0, "max": 300},
     "Postbake 온도는 0~300℃ 범위여야 합니다"),
    ("DEV_CD_TARGET_nm", "range", {"min": 1.0, "max": 5000.0},
     "CD Target은 1~5000nm 범위여야 합니다"),
    ("DEV_DEFECT_SPEC", "range", {"min": 0, "max": 1000},
     "Defect Spec은 0~1000 범위여야 합니다"),

    # Conditional required
    ("SP_ADHESION_TYPE", "conditional_required",
     {"condition_column": "SP_ADHESION_USE", "condition_value": "Y", "operator": "equals"},
     "Adhesion Use가 Y일 때 Adhesion Type은 필수입니다"),
    ("SP_ADHESION_TEMP_C", "conditional_required",
     {"condition_column": "SP_ADHESION_USE", "condition_value": "Y", "operator": "equals"},
     "Adhesion Use가 Y일 때 Adhesion Temp는 필수입니다"),
    ("OVL_APC_TYPE", "conditional_required",
     {"condition_column": "OVL_APC_USE", "condition_value": "Y", "operator": "equals"},
     "APC Use가 Y일 때 APC Type은 필수입니다"),
]


# ---------------------------------------------------------------------------
# 3. Users
# ---------------------------------------------------------------------------

USERS = [
    {"username": "admin1", "display_name": "관리자", "role": "admin"},
    {"username": "engineer1", "display_name": "김엔지니어", "role": "editor"},
    {"username": "engineer2", "display_name": "이엔지니어", "role": "editor"},
    {"username": "engineer3", "display_name": "박엔지니어", "role": "editor"},
    {"username": "reviewer1", "display_name": "최검토자", "role": "reviewer"},
]


# ---------------------------------------------------------------------------
# 4. Layers (15 Photo process steps)
#    step_seq: 설비/전산 식별자 (문자2 + 숫자6)
#    layer_number: 사람이 읽는 레이어 번호
# ---------------------------------------------------------------------------

LAYERS = [
    # (layer_name,      step_seq,    layer_number, sort_order)
    ("AA_PHOTO",        "ac100000",  "1.0",        10),
    ("STI_PHOTO",       "ac200000",  "2.0",        20),
    ("NWELL_PHOTO",     "ac300000",  "3.0",        30),
    ("PWELL_PHOTO",     "ac300500",  "3.5",        35),
    ("POLY_PHOTO",      "ac400000",  "5.0",        50),
    ("LDD_N_PHOTO",     "ac500000",  "6.0",        60),
    ("LDD_P_PHOTO",     "ac500500",  "6.5",        65),
    ("CONTACT_PHOTO",   "ac600000",  "8.0",        80),
    ("M1_PHOTO",        "ac700000",  "10.0",       100),
    ("VIA1_PHOTO",      "ac750000",  "11.0",       110),
    ("M2_PHOTO",        "ac800000",  "12.0",       120),
    ("VIA2_PHOTO",      "ac850000",  "13.0",       130),
    ("M3_PHOTO",        "ac900000",  "15.0",       150),
    ("VIA3_PHOTO",      "ac950000",  "16.0",       160),
    ("PAD_PHOTO",       "ac990000",  "20.0",       200),
]

# Convenience lookups
LAYER_NAMES = [l[0] for l in LAYERS]
_LAYER_STEP_SEQ = {l[0]: l[1] for l in LAYERS}  # layer_name → step_seq


# ---------------------------------------------------------------------------
# 5. Products (Backbone) + Conditions generator
# ---------------------------------------------------------------------------

LINES = [
    {"line_code": "LINE-A", "line_name": "A라인 (KrF/ArF)"},
    {"line_code": "LINE-B", "line_name": "B라인 (ArF/EUV)"},
]

PRODUCTS = [
    {"product_name": "PROD-2024X", "description": "주력 양산제품 (KrF/ArF 혼합)", "is_backbone": True,
     "line_code": "LINE-A", "part_id": "PROD-2024X"},
    {"product_name": "PROD-2024Y", "description": "차세대 파일럿 (ArF 중심)", "is_backbone": True,
     "line_code": "LINE-B", "part_id": "PROD-2024Y"},
    {"product_name": "PROD-2024Z", "description": "저전력 변형 제품", "is_backbone": True,
     "line_code": "LINE-A", "part_id": "PROD-2024Z"},
]

NON_BACKBONE_PRODUCTS = [
    {"product_name": "PROD-2025A", "description": "신규 개발 제품 A (조건 미설정)",
     "is_backbone": False, "line_code": "LINE-A", "part_id": "PROD-2025A",
     "layer_names": LAYER_NAMES},
    {"product_name": "PROD-2025B", "description": "신규 개발 제품 B (일부 레이어)",
     "is_backbone": False, "line_code": "LINE-B", "part_id": "PROD-2025B",
     "layer_names": LAYER_NAMES[:10]},
]

# Scanner tools per product
SCANNERS = {
    "PROD-2024X": ["NSR-S322F-01", "NSR-S322F-02", "NSR-S631E-01"],
    "PROD-2024Y": ["XT-1900Gi-01", "XT-1900Gi-02", "NXT-2000-01"],
    "PROD-2024Z": ["NSR-S322F-03", "XT-1400E-01"],
}

# Layer properties: determines PR type, wavelength, etc.
# (pr_type, wavelength, immersion, mask_type, base_energy, base_cd_target)
LAYER_PROFILES = {
    "AA_PHOTO":      ("KrF-A01",  248, "N", "BINARY",  35.0, 250.0),
    "STI_PHOTO":     ("KrF-A01",  248, "N", "BINARY",  38.0, 200.0),
    "NWELL_PHOTO":   ("KrF-B02",  248, "N", "BINARY",  32.0, 500.0),
    "PWELL_PHOTO":   ("KrF-B02",  248, "N", "BINARY",  33.0, 500.0),
    "POLY_PHOTO":    ("ArF-C01",  193, "N", "EAPSM",   42.0, 65.0),
    "LDD_N_PHOTO":   ("KrF-A01",  248, "N", "BINARY",  30.0, 180.0),
    "LDD_P_PHOTO":   ("KrF-A01",  248, "N", "BINARY",  30.0, 180.0),
    "CONTACT_PHOTO": ("ArF-C01",  193, "Y", "EAPSM",   55.0, 90.0),
    "M1_PHOTO":      ("ArF-D01",  193, "Y", "ALTPSM",  48.0, 80.0),
    "VIA1_PHOTO":    ("ArF-C01",  193, "Y", "PSM",     50.0, 100.0),
    "M2_PHOTO":      ("ArF-D01",  193, "Y", "ALTPSM",  45.0, 100.0),
    "VIA2_PHOTO":    ("KrF-B02",  248, "N", "BINARY",  36.0, 150.0),
    "M3_PHOTO":      ("ArF-C01",  193, "N", "EAPSM",   40.0, 130.0),
    "VIA3_PHOTO":    ("KrF-B02",  248, "N", "BINARY",  35.0, 200.0),
    "PAD_PHOTO":     ("KrF-A01",  248, "N", "BINARY",  28.0, 800.0),
}

# OVL reference layers — mapped to step_seq (stored value in conditions)
# AA_PHOTO의 첫 레이어 참조는 zero align (za000000) 사용
OVL_REFS_STEP_SEQ = {
    "AA_PHOTO":      "za000000",              # Zero Align (웨이퍼 기준)
    "STI_PHOTO":     _LAYER_STEP_SEQ["AA_PHOTO"],
    "NWELL_PHOTO":   _LAYER_STEP_SEQ["AA_PHOTO"],
    "PWELL_PHOTO":   _LAYER_STEP_SEQ["AA_PHOTO"],
    "POLY_PHOTO":    _LAYER_STEP_SEQ["AA_PHOTO"],
    "LDD_N_PHOTO":   _LAYER_STEP_SEQ["POLY_PHOTO"],
    "LDD_P_PHOTO":   _LAYER_STEP_SEQ["POLY_PHOTO"],
    "CONTACT_PHOTO": _LAYER_STEP_SEQ["POLY_PHOTO"],
    "M1_PHOTO":      _LAYER_STEP_SEQ["CONTACT_PHOTO"],
    "VIA1_PHOTO":    _LAYER_STEP_SEQ["M1_PHOTO"],
    "M2_PHOTO":      _LAYER_STEP_SEQ["VIA1_PHOTO"],
    "VIA2_PHOTO":    _LAYER_STEP_SEQ["M2_PHOTO"],
    "M3_PHOTO":      _LAYER_STEP_SEQ["VIA2_PHOTO"],
    "VIA3_PHOTO":    _LAYER_STEP_SEQ["M3_PHOTO"],
    "PAD_PHOTO":     _LAYER_STEP_SEQ["M3_PHOTO"],
}


def _jitter(base: float, pct: float = 0.05) -> float:
    """Add small random variation to a base value."""
    return round(base * (1 + random.uniform(-pct, pct)), 2)


def _jitter_int(base: int, pct: float = 0.05) -> int:
    return int(round(base * (1 + random.uniform(-pct, pct))))


def generate_conditions(layer_name: str, product_name: str) -> dict:
    """Generate realistic conditions for a given layer + product."""
    prof = LAYER_PROFILES[layer_name]
    pr_type, wavelength, immersion, mask_type, base_energy, base_cd = prof

    # Product-specific offsets
    offsets = {"PROD-2024X": 0, "PROD-2024Y": 1, "PROD-2024Z": -1}
    off = offsets.get(product_name, 0)

    scanners = SCANNERS[product_name]
    scanner = random.choice(scanners)

    is_arf = wavelength == 193
    is_adhesion = layer_name not in ("PAD_PHOTO",)

    # SP
    sp = {
        "SP_PR_TYPE": pr_type,
        "SP_PR_VENDOR": "TOK" if "KrF" in pr_type else "JSR",
        "SP_PR_VISCOSITY_cP": round(random.uniform(5.0, 25.0), 1),
        "SP_DISPENSE_VOL_ml": round(random.uniform(1.5, 2.5), 2),
        "SP_SPIN1_SPEED_rpm": _jitter_int(2000 if is_arf else 1500),
        "SP_SPIN1_TIME_sec": random.choice([5, 7, 10]),
        "SP_SPIN2_SPEED_rpm": _jitter_int(4000 if is_arf else 3500),
        "SP_SPIN2_TIME_sec": random.choice([20, 25, 30]),
        "SP_EBR_SPEED_rpm": _jitter_int(2500 + off * 100),
        "SP_PREBAKE_TEMP_C": 110 + off * 5 + (10 if is_arf else 0),
        "SP_PREBAKE_TIME_sec": random.choice([60, 90, 120]),
        "SP_PR_THICKNESS_nm": _jitter_int(1200 if is_arf else 800),
        "SP_ADHESION_USE": "Y" if is_adhesion else "N",
        "SP_ADHESION_TYPE": "HMDS" if is_adhesion else "NONE",
        "SP_ADHESION_TEMP_C": 100 + off * 5 if is_adhesion else None,
        "SP_COOL_TEMP_C": 23,
        "SP_COOL_TIME_sec": random.choice([30, 40, 60]),
        "SP_COAT_METHOD": "SPIN",
        "SP_HUMIDITY_PCT": round(random.uniform(40.0, 50.0), 1),
        "SP_BACKSIDE_RINSE": "Y",
    }

    # SC
    sc = {
        "SC_TOOL_ID": scanner,
        "SC_RETICLE_ID": f"RTL-{layer_name.replace('_PHOTO', '')}-{str(off + 1).zfill(3)}",
        "SC_EXPOSE_ENERGY_mJ": round(base_energy + off * 1.5 + random.uniform(-0.5, 0.5), 1),
        "SC_EXPOSE_FOCUS_um": round(random.uniform(-0.05, 0.05) + off * 0.005, 3),
        "SC_ILLUM_MODE": "ANNULAR" if is_arf else "CONVENTIONAL",
        "SC_ILLUM_SIGMA_IN": round(random.uniform(0.4, 0.6), 2) if is_arf else round(random.uniform(0.3, 0.5), 2),
        "SC_ILLUM_SIGMA_OUT": round(random.uniform(0.7, 0.9), 2),
        "SC_NA": 1.35 if immersion == "Y" else (0.85 if is_arf else 0.68),
        "SC_DOSE_TOLERANCE_PCT": round(random.uniform(2.0, 5.0), 1),
        "SC_ALIGN_MARK_TYPE": "ATHENA" if is_arf else "SSA",
        "SC_ALIGN_TREE": f"TREE_{layer_name.replace('_PHOTO', '')}",
        "SC_EXPOSE_MODE": "STEP_SCAN",
        "SC_SCAN_DIRECTION": random.choice(["IN_SCAN", "OUT_SCAN"]),
        "SC_SLIT_WIDTH_mm": round(random.uniform(8.0, 14.0), 1),
        "SC_RETICLE_CORR_X_nm": round(random.uniform(-5.0, 5.0), 2),
        "SC_RETICLE_CORR_Y_nm": round(random.uniform(-5.0, 5.0), 2),
        "SC_WAVELENGTH_nm": wavelength,
        "SC_MASK_TYPE": mask_type,
        "SC_IMMERSION": immersion,
    }

    # OVL — OVL_REF_LAYER는 step_seq로 저장
    ref_step_seq = OVL_REFS_STEP_SEQ[layer_name]
    is_critical = layer_name in ("POLY_PHOTO", "CONTACT_PHOTO", "M1_PHOTO")
    base_spec = 5.0 if is_critical else (8.0 if is_arf else 12.0)
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
        "OVL_FEEDFORWARD_USE": "Y" if layer_name in ("M1_PHOTO",) else "N",
        "OVL_TARGET_TYPE": "uDBO" if is_arf else "AIM",
    }

    # DEV
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
    }

    # Merge all — strip None values
    conditions = {}
    for d in (sp, sc, ovl, dev):
        for k, v in d.items():
            if v is not None:
                conditions[k] = v
    return conditions


# ---------------------------------------------------------------------------
# Main seed function
# ---------------------------------------------------------------------------

def seed():
    random.seed(42)  # reproducible

    with Session(engine) as session:
        # Check if already seeded
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
        col_ids = {}  # column_name -> id
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
        for u in USERS:
            session.execute(
                text("INSERT INTO users (username, display_name, role) VALUES (:un, :dn, :r)"),
                {"un": u["username"], "dn": u["display_name"], "r": u["role"]},
            )
            result = session.execute(
                text("SELECT id FROM users WHERE username = :un"),
                {"un": u["username"]},
            )
            user_ids[u["username"]] = result.scalar()
        print(f"  Users: {len(user_ids)}")

        # --- Layers (with step_seq, layer_number) ---
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

            # Create product_layers with conditions
            for layer_name in LAYER_NAMES:
                conditions = generate_conditions(layer_name, prod["product_name"])
                session.execute(
                    text(
                        "INSERT INTO product_layers (product_id, layer_id, conditions) "
                        "VALUES (:pid, :lid, CAST(:cond AS jsonb))"
                    ),
                    {
                        "pid": pid,
                        "lid": layer_ids[layer_name],
                        "cond": json.dumps(conditions),
                    },
                )
                pl_count += 1
        print(f"  Products (backbone): {len(product_ids)}")
        print(f"  Product Layers: {pl_count} ({len(PRODUCTS)} products \u00d7 {len(LAYER_NAMES)} layers)")

        # --- Non-backbone Products (empty conditions) ---
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
                    {
                        "pid": pid,
                        "lid": layer_ids[layer_name],
                        "cond": json.dumps({}),
                    },
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
        # TYPE_A (MES-TRACK): SP + DEV columns
        SP_COLUMN_TARGET_NAMES = {
            "SP_PR_TYPE": "RESIST_CODE",
            "SP_PR_VENDOR": "RESIST_VENDOR",
            "SP_PR_VISCOSITY_cP": "RESIST_VISCOSITY",
            "SP_DISPENSE_VOL_ml": "DISPENSE_VOL",
            "SP_SPIN1_SPEED_rpm": "SPIN1_SPEED",
            "SP_SPIN1_TIME_sec": "SPIN1_TIME",
            "SP_SPIN2_SPEED_rpm": "SPIN2_SPEED",
            "SP_SPIN2_TIME_sec": "SPIN2_TIME",
            "SP_EBR_SPEED_rpm": "EBR_SPEED",
            "SP_PREBAKE_TEMP_C": "PREBAKE_TEMP",
            "SP_PREBAKE_TIME_sec": "PREBAKE_TIME",
            "SP_PR_THICKNESS_nm": "PR_THICKNESS",
            "SP_ADHESION_USE": "ADHESION_USE",
            "SP_ADHESION_TYPE": "ADHESION_TYPE",
            "SP_ADHESION_TEMP_C": "ADHESION_TEMP",
            "SP_COOL_TEMP_C": "COOL_TEMP",
            "SP_COOL_TIME_sec": "COOL_TIME",
            "SP_COAT_METHOD": "COAT_METHOD",
            "SP_HUMIDITY_PCT": "HUMIDITY",
            "SP_BACKSIDE_RINSE": "BACKSIDE_RINSE",
        }
        DEV_COLUMN_TARGET_NAMES = {
            "DEV_TYPE": "DEVELOPER_TYPE",
            "DEV_PUDDLE_TIME_sec": "PUDDLE_TIME",
            "DEV_PUDDLE_COUNT": "PUDDLE_COUNT",
            "DEV_RINSE_TYPE": "RINSE_TYPE",
            "DEV_RINSE_TIME_sec": "RINSE_TIME",
            "DEV_POSTBAKE_TEMP_C": "POSTBAKE_TEMP",
            "DEV_POSTBAKE_TIME_sec": "POSTBAKE_TIME",
            "DEV_CD_TARGET_nm": "CD_TARGET",
            "DEV_CD_SPEC_LOW_nm": "CD_SPEC_LOW",
            "DEV_CD_SPEC_HIGH_nm": "CD_SPEC_HIGH",
            "DEV_CD_MEAS_TOOL": "CD_MEAS_TOOL",
            "DEV_CD_MEAS_POINTS": "CD_MEAS_POINTS",
            "DEV_INSPECT_TOOL": "INSPECT_TOOL",
            "DEV_DEFECT_SPEC": "DEFECT_SPEC",
        }
        # TYPE_B (EQP-SCANNER): SC columns
        SC_COLUMN_TARGET_NAMES = {
            "SC_TOOL_ID": "SCANNER_TOOL",
            "SC_RETICLE_ID": "RETICLE_ID",
            "SC_EXPOSE_ENERGY_mJ": "EXPOSE_ENERGY",
            "SC_EXPOSE_FOCUS_um": "EXPOSE_FOCUS",
            "SC_ILLUM_MODE": "ILLUM_MODE",
            "SC_ILLUM_SIGMA_IN": "SIGMA_INNER",
            "SC_ILLUM_SIGMA_OUT": "SIGMA_OUTER",
            "SC_NA": "NA",
            "SC_DOSE_TOLERANCE_PCT": "DOSE_TOLERANCE",
            "SC_ALIGN_MARK_TYPE": "ALIGN_MARK_TYPE",
            "SC_ALIGN_TREE": "ALIGN_TREE",
            "SC_EXPOSE_MODE": "EXPOSE_MODE",
            "SC_SCAN_DIRECTION": "SCAN_DIRECTION",
            "SC_SLIT_WIDTH_mm": "SLIT_WIDTH",
            "SC_RETICLE_CORR_X_nm": "RETICLE_CORR_X",
            "SC_RETICLE_CORR_Y_nm": "RETICLE_CORR_Y",
            "SC_WAVELENGTH_nm": "WAVELENGTH",
            "SC_MASK_TYPE": "MASK_TYPE",
            "SC_IMMERSION": "IMMERSION",
        }
        # TYPE_C (SPC-OVL): OVL columns
        OVL_COLUMN_TARGET_NAMES = {
            "OVL_SPEC_X_nm": "OVL_SPEC_X",
            "OVL_SPEC_Y_nm": "OVL_SPEC_Y",
            "OVL_REF_LAYER": "REF_LAYER",
            "OVL_CORRECT_X_nm": "CORRECT_X",
            "OVL_CORRECT_Y_nm": "CORRECT_Y",
            "OVL_APC_USE": "APC_USE",
            "OVL_APC_TYPE": "APC_TYPE",
            "OVL_MEAS_TOOL": "MEAS_TOOL",
            "OVL_MEAS_POINT_COUNT": "MEAS_POINTS",
            "OVL_SAMPLING_MODE": "SAMPLING_MODE",
            "OVL_REG_MODEL": "REG_MODEL",
            "OVL_FEEDBACK_USE": "FEEDBACK_USE",
            "OVL_FEEDFORWARD_USE": "FEEDFORWARD_USE",
            "OVL_TARGET_TYPE": "TARGET_TYPE",
        }

        # Required columns per system
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
        # MES-TRACK: SP + DEV
        mes_system_id = export_system_ids["MES-TRACK"]
        sort_idx = 1
        for col_name, target_name in SP_COLUMN_TARGET_NAMES.items():
            if col_name not in col_ids:
                continue
            session.execute(
                text(
                    "INSERT INTO export_column_mappings "
                    "(export_system_id, column_id, target_column_name, sort_order, is_required) "
                    "VALUES (:esid, :cid, :tname, :sort, :req)"
                ),
                {
                    "esid": mes_system_id,
                    "cid": col_ids[col_name],
                    "tname": target_name,
                    "sort": sort_idx,
                    "req": col_name in TYPE_A_REQUIRED,
                },
            )
            sort_idx += 1
            ecm_count += 1
        for col_name, target_name in DEV_COLUMN_TARGET_NAMES.items():
            if col_name not in col_ids:
                continue
            session.execute(
                text(
                    "INSERT INTO export_column_mappings "
                    "(export_system_id, column_id, target_column_name, sort_order, is_required) "
                    "VALUES (:esid, :cid, :tname, :sort, :req)"
                ),
                {
                    "esid": mes_system_id,
                    "cid": col_ids[col_name],
                    "tname": target_name,
                    "sort": sort_idx,
                    "req": col_name in TYPE_A_REQUIRED,
                },
            )
            sort_idx += 1
            ecm_count += 1

        # EQP-SCANNER: SC
        sc_system_id = export_system_ids["EQP-SCANNER"]
        sort_idx = 1
        for col_name, target_name in SC_COLUMN_TARGET_NAMES.items():
            if col_name not in col_ids:
                continue
            session.execute(
                text(
                    "INSERT INTO export_column_mappings "
                    "(export_system_id, column_id, target_column_name, sort_order, is_required) "
                    "VALUES (:esid, :cid, :tname, :sort, :req)"
                ),
                {
                    "esid": sc_system_id,
                    "cid": col_ids[col_name],
                    "tname": target_name,
                    "sort": sort_idx,
                    "req": col_name in TYPE_B_REQUIRED,
                },
            )
            sort_idx += 1
            ecm_count += 1

        # SPC-OVL: OVL
        ovl_system_id = export_system_ids["SPC-OVL"]
        sort_idx = 1
        for col_name, target_name in OVL_COLUMN_TARGET_NAMES.items():
            if col_name not in col_ids:
                continue
            session.execute(
                text(
                    "INSERT INTO export_column_mappings "
                    "(export_system_id, column_id, target_column_name, sort_order, is_required) "
                    "VALUES (:esid, :cid, :tname, :sort, :req)"
                ),
                {
                    "esid": ovl_system_id,
                    "cid": col_ids[col_name],
                    "tname": target_name,
                    "sort": sort_idx,
                    "req": col_name in TYPE_C_REQUIRED,
                },
            )
            sort_idx += 1
            ecm_count += 1
        print(f"  Export Column Mappings: {ecm_count}")

        # --- Test Project (approved) for Export Testing ---
        # Create a test project based on PROD-2024X in approved status
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

        # Create project_layers with same conditions as PROD-2024X product_layers
        # Reset random seed to generate deterministic conditions independent of prior calls
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
                text(
                    "SELECT id FROM project_layers "
                    "WHERE project_id = :pid AND layer_id = :lid"
                ),
                {"pid": test_project_id, "lid": layer_ids[layer_name]},
            )
            project_layer_ids[layer_name] = result.scalar()
        print(f"  Test Project (approved): id={test_project_id}, layers={len(project_layer_ids)}")

        # --- Equipment Assignments for SC-category layers (Type B export testing) ---
        # Use a subset of scanner tools to create realistic assignments
        scanner_assignments = [
            "NSR-S322F-01", "NSR-S322F-02", "NSR-S631E-01", "XT-1400E-01", "NXT-2000-01",
        ]
        ea_count = 0
        random.seed(77)  # deterministic assignments
        for layer_name, pl_id in project_layer_ids.items():
            num_equip = random.choice([3, 4, 5])
            for i, equip_id in enumerate(scanner_assignments[:num_equip]):
                # Create equipment-specific energy/focus overrides for Type B vary columns
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
                        "plid": pl_id,
                        "eid": equip_id,
                        "params": json.dumps(overrides),
                        "sort": i + 1,
                    },
                )
                ea_count += 1
        print(f"  Equipment Assignments: {ea_count}")

        # --- Recipe XML Mappings ---
        # Map common Recipe XML xpaths to column definitions
        RECIPE_XML_MAPPINGS = [
            # (xpath, column_name, value_transform)
            ("//RECIPE_DATA/SPIN/DISPENSE_VOL", "SP_DISPENSE_VOL_ml", "to_float"),
            ("//RECIPE_DATA/SPIN/SPIN1_SPEED", "SP_SPIN1_SPEED_rpm", "to_int"),
            ("//RECIPE_DATA/SPIN/SPIN1_TIME", "SP_SPIN1_TIME_sec", "to_int"),
            ("//RECIPE_DATA/SPIN/SPIN2_SPEED", "SP_SPIN2_SPEED_rpm", "to_int"),
            ("//RECIPE_DATA/SPIN/SPIN2_TIME", "SP_SPIN2_TIME_sec", "to_int"),
            ("//RECIPE_DATA/SPIN/EBR_SPEED", "SP_EBR_SPEED_rpm", "to_int"),
            ("//RECIPE_DATA/BAKE/PREBAKE_TEMP", "SP_PREBAKE_TEMP_C", "to_int"),
            ("//RECIPE_DATA/BAKE/PREBAKE_TIME", "SP_PREBAKE_TIME_sec", "to_int"),
            ("//RECIPE_DATA/EXPOSE/ENERGY", "SC_EXPOSE_ENERGY_mJ", "to_float"),
            ("//RECIPE_DATA/EXPOSE/FOCUS", "SC_EXPOSE_FOCUS_um", "to_float"),
            ("//RECIPE_DATA/EXPOSE/NA", "SC_NA", "to_float"),
            ("//RECIPE_DATA/EXPOSE/DOSE_TOLERANCE", "SC_DOSE_TOLERANCE_PCT", "to_float"),
            ("//RECIPE_DATA/DEVELOP/PUDDLE_TIME", "DEV_PUDDLE_TIME_sec", "to_int"),
            ("//RECIPE_DATA/DEVELOP/PUDDLE_COUNT", "DEV_PUDDLE_COUNT", "to_int"),
            ("//RECIPE_DATA/DEVELOP/RINSE_TIME", "DEV_RINSE_TIME_sec", "to_int"),
            ("//RECIPE_DATA/DEVELOP/POSTBAKE_TEMP", "DEV_POSTBAKE_TEMP_C", "to_int"),
            ("//RECIPE_DATA/DEVELOP/CD_TARGET", "DEV_CD_TARGET_nm", "to_float"),
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
                {
                    "xpath": xpath,
                    "col_id": col_ids[col_name],
                    "transform": transform,
                },
            )
            rxm_count += 1
        print(f"  Recipe XML Mappings: {rxm_count}")

        session.commit()
        print("\nSeed completed successfully!")


if __name__ == "__main__":
    try:
        seed()
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
