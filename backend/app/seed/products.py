"""Product definitions and condition generators for seed data.

제품 정의 및 조건 데이터 생성기 시드 데이터.
생산 라인, 제품(backbone/비backbone), 스캐너 할당, 조건값 생성 로직을 정의한다.
- Backbone 제품: 기존 양산 제품으로, 신규 제품 생성 시 조건 복사의 원본이 됨
- 비-Backbone 제품: 개발 중인 제품으로, 아직 조건이 확정되지 않은 상태
"""
import random

from app.seed.layers import LAYER_NAMES, LAYER_PROFILES, OVL_REFS_STEP_SEQ, _EUV_LAYERS, _ARFI_LAYERS


# ---------------------------------------------------------------------------
# 7. 생산 라인 (Fab Line)
# ---------------------------------------------------------------------------
# 각 라인은 사용 가능한 노광 장비 종류가 다름
# 프로젝트 생성 시 라인을 선택하면 해당 라인의 제품/Backbone만 표시됨

LINES = [
    {"line_code": "LINE-A", "line_name": "A\ub77c\uc778 (KrF/ArF)"},
    {"line_code": "LINE-B", "line_name": "B\ub77c\uc778 (ArF/EUV)"},
    {"line_code": "LINE-C", "line_name": "C\ub77c\uc778 (EUV\uc804\uc6a9)"},
]


# ---------------------------------------------------------------------------
# 8. 제품 (Approved 프로젝트 보유 8개 + 일반 4개 = 총 12개)
# ---------------------------------------------------------------------------
# Approved 프로젝트 보유 제품: 양산 제품의 확정된 조건표
# 신규 프로젝트 생성 시 이 제품의 Approved 프로젝트 조건을 복사하여 초안을 만듦
# (backbone 여부는 Approved 프로젝트 존재 여부로 동적 결정)
# product_name: 제품명, description: 설명, line_code: 소속 라인
# part_id: 제품 고유 ID (전산 출력 시 사용)

PRODUCTS = [
    {"product_name": "PROD-2024X", "description": "\uc8fc\ub825 \uc591\uc0b0\uc81c\ud488 (KrF/ArF \ud63c\ud569)",
     "line_code": "LINE-A", "part_id": "PROD-2024X"},
    {"product_name": "PROD-2024Y", "description": "\ucc28\uc138\ub300 \ud30c\uc77c\ub7ff (ArF \uc911\uc2ec)",
     "line_code": "LINE-B", "part_id": "PROD-2024Y"},
    {"product_name": "PROD-2024Z", "description": "\uc800\uc804\ub825 \ubcc0\ud615 \uc81c\ud488",
     "line_code": "LINE-A", "part_id": "PROD-2024Z"},
    {"product_name": "HBM-3E-MEM", "description": "HBM3E \uace0\ub300\uc5ed\ud3ed \uba54\ubaa8\ub9ac",
     "line_code": "LINE-B", "part_id": "HBM-3E-MEM"},
    {"product_name": "AP-5G-MOB", "description": "5G \ubaa8\ubc14\uc77c AP (EUV+ArF)",
     "line_code": "LINE-C", "part_id": "AP-5G-MOB"},
    {"product_name": "MCU-AUTO-V2", "description": "\uc790\ub3d9\ucc28 MCU (28nm KrF)",
     "line_code": "LINE-A", "part_id": "MCU-AUTO-V2"},
    {"product_name": "HPC-SERVER-X", "description": "\uc11c\ubc84 HPC \ud504\ub85c\uc138\uc11c (7nm EUV)",
     "line_code": "LINE-C", "part_id": "HPC-SERVER-X"},
    {"product_name": "IOT-LP-V1", "description": "IoT \uc800\uc804\ub825 \uce69 (40nm)",
     "line_code": "LINE-A", "part_id": "IOT-LP-V1"},
]

# 일반 제품: 개발 중인 제품 (조건 미설정, Approved 프로젝트 없음)
# layer_names: 이 제품이 사용하는 레이어 목록 (전체 또는 일부)
NON_BACKBONE_PRODUCTS = [
    {"product_name": "DEV-2025A", "description": "\uac1c\ubc1c \uc81c\ud488 A (\uc870\uac74 \ubbf8\uc124\uc815)",
     "line_code": "LINE-A", "part_id": "DEV-2025A",
     "layer_names": LAYER_NAMES},
    {"product_name": "DEV-2025B", "description": "\uac1c\ubc1c \uc81c\ud488 B (\uc77c\ubd80 \ub808\uc774\uc5b4)",
     "line_code": "LINE-B", "part_id": "DEV-2025B",
     "layer_names": LAYER_NAMES[:80]},
    {"product_name": "DEV-2025C", "description": "\uac1c\ubc1c \uc81c\ud488 C (\ud480\uc2a4\ud0dd \ud14c\uc2a4\ud2b8)",
     "line_code": "LINE-A", "part_id": "DEV-2025C",
     "layer_names": LAYER_NAMES},
    {"product_name": "DEV-2025D", "description": "\uac1c\ubc1c \uc81c\ud488 D (BEOL \ucd95\uc18c)",
     "line_code": "LINE-B", "part_id": "DEV-2025D",
     "layer_names": LAYER_NAMES[:80]},
]


# ---------------------------------------------------------------------------
# 9. 제품별 스캐너(노광장비) 할당
# ---------------------------------------------------------------------------
# 각 제품이 사용하는 스캐너 장비 목록
# 조건 생성 시 이 목록에서 랜덤 선택하여 SC_TOOL_ID에 할당
# 신규 제품의 스캐너를 변경하려면 이 딕셔너리에 항목 추가/수정

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
# 10. 조건 데이터 생성기
# ---------------------------------------------------------------------------
# Backbone 제품의 각 레이어에 대해 현실적인 공정 조건값을 자동 생성
# 레이어 프로파일(EUV/ArF/KrF)과 제품별 오프셋을 기반으로 값을 결정하며,
# random jitter를 추가하여 제품 간 약간의 차이를 만듦

def _jitter(base: float, pct: float = 0.05) -> float:
    """기준값에 +-pct% 범위의 랜덤 변동을 추가 (실수)"""
    return round(base * (1 + random.uniform(-pct, pct)), 2)


def _jitter_int(base: int, pct: float = 0.05) -> int:
    """기준값에 +-pct% 범위의 랜덤 변동을 추가 (정수)"""
    return int(round(base * (1 + random.uniform(-pct, pct))))


def generate_conditions(layer_name: str, product_name: str) -> dict:
    """주어진 레이어+제품 조합의 현실적인 조건값 생성 (350개 컬럼 전체).
    레이어 프로파일(파장, PR종류 등)과 제품 오프셋을 기반으로 각 섹션(SP/SC/OVL/DEV)의 값을 결정.
    None 값은 최종 딕셔너리에서 제거됨 (해당 레이어에 불필요한 항목).
    """
    prof = LAYER_PROFILES[layer_name]
    pr_type, wavelength, immersion, mask_type, base_energy, base_cd = prof

    # 제품별 오프셋: 동일 레이어라도 제품마다 조건값이 약간 다르게 생성됨
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

    # ---- SP 섹션: 포토레지스트 도포 관련 조건 ----
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

    # ---- SC 섹션: 스캐너/노광 관련 조건 ----
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

    # ---- OVL 섹션: 오버레이(정렬) 관련 조건 ----
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

    # ---- DEV 섹션: 현상 공정 관련 조건 ----
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

    # 모든 섹션을 병합하고, None 값은 제거 (해당 레이어에 불필요한 항목 제외)
    conditions = {}
    for d in (sp, sc, ovl, dev):
        for k, v in d.items():
            if v is not None:
                conditions[k] = v
    return conditions
