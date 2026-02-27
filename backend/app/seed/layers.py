"""Layer definitions, profiles, and OVL reference mappings for seed data.

레이어 정의, 프로파일(노광 조건), OVL 참조 매핑 시드 데이터.
반도체 Photo 공정의 150개 레이어(공정 단계)를 프로그래밍 방식으로 생성한다.
레이어는 FEOL(전공정) → MOL(중간배선) → BEOL(후공정) → Special 순서로 정의되며,
각 레이어에는 step_seq(공정 순번), layer_number, sort_order가 자동 부여된다.
"""


# ---------------------------------------------------------------------------
# 4. 레이어 (150개 Photo 공정 단계) - 프로그래밍 방식으로 생성
# ---------------------------------------------------------------------------

def _build_layers() -> list[tuple]:
    """150개 레이어를 프로그래밍 방식으로 생성.
    반환값: (layer_name, step_seq, layer_number, sort_order) 튜플 리스트.
    - layer_name: 레이어 이름 (예: AA_PHOTO, M1_PHOTO)
    - step_seq: 공정 순번 코드 (예: ac100000) - OVL 참조에서 레이어를 식별하는 키
    - layer_number: 레이어 번호 (예: 1.0, 2.0)
    - sort_order: UI 표시 순서
    """
    layers = []
    seq = 100000       # step_seq 시작값 (5000씩 증가)
    sort = 10          # sort_order 시작값 (10씩 증가)
    layer_num = 1      # layer_number 시작값

    def add(name: str) -> None:
        nonlocal seq, sort, layer_num
        layers.append((name, f"ac{seq:06d}", f"{layer_num}.0", sort))
        seq += 5000
        sort += 10
        layer_num += 1

    # FEOL (~40개): 전공정 - 트랜지스터 형성 단계
    # AA(Active Area), STI, Well 이온주입, Gate, Contact 등
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

    # MOL (~10개): 중간배선 - 트랜지스터와 금속배선 사이 연결층
    # VIA0, LI(Local Interconnect), MOL Plug 등
    mol_names = [
        "VIA0_PHOTO", "VIA0_A_PHOTO", "LI_PHOTO", "LI_CUT_PHOTO",
        "MOL_PLUG_PHOTO", "MOL_CAP_PHOTO", "LI_A_PHOTO", "LI_B_PHOTO",
        "MOL_OPT_PHOTO", "MOL_RES_PHOTO",
    ]
    for n in mol_names:
        add(n)

    # BEOL (~80개): 후공정 - 금속배선 및 비아(Via) 형성
    # M1~M15(금속배선층), V1~V14(비아층), IMD, Hardmask, FinFET 관련 등
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

    # Special (~24개, 총 150개): 패키징/테스트 관련
    # PAD, FUSE, BUMP, Passivation, TSV, RDL, 다이싱, 테스트키 등
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


# 전체 레이어 목록 (150개 튜플)
LAYERS = _build_layers()
# 레이어 이름만 추출한 리스트 (제품 시드에서 사용)
LAYER_NAMES = [lyr[0] for lyr in LAYERS]
# 레이어 이름 → step_seq 매핑 딕셔너리 (OVL 참조에서 사용)
_LAYER_STEP_SEQ = {lyr[0]: lyr[1] for lyr in LAYERS}


# ---------------------------------------------------------------------------
# 5. 레이어 프로파일 (노광 조건 프리셋)
# ---------------------------------------------------------------------------
# 각 레이어의 노광 기본 조건을 결정하는 프로파일
# 레이어가 EUV/ArFi/KrF 중 어떤 파장대를 사용하는지에 따라
# PR 종류, 마스크 타입, 기본 에너지, CD 타겟이 결정됨

# 주요 EUV 레이어 (13nm 파장, 최첨단 미세 패터닝)
# Gate, 하위 금속배선(M1~M2), Via(V1~V2), FinFET 관련 등
_EUV_LAYERS = {
    "GATE_PHOTO", "CONTACT_A_PHOTO", "CONTACT_B_PHOTO",
    "M1_PHOTO", "M1_A_PHOTO", "M1_B_PHOTO", "M1_CUT_PHOTO",
    "V1_PHOTO", "V1_A_PHOTO",
    "M2_PHOTO", "M2_A_PHOTO", "M2_B_PHOTO", "M2_CUT_PHOTO",
    "V2_PHOTO", "V2_A_PHOTO",
    "FIN_PHOTO", "FIN_CUT_PHOTO",
    "DUMMY_GATE_PHOTO", "LI_A_PHOTO", "LI_B_PHOTO", "LI_CUT_PHOTO",
}

# 주요 ArFi 레이어 (193nm 파장, 액침 노광 - 중간 미세도)
_ARFI_LAYERS = {
    "POLY_PHOTO", "POLY_CUT_PHOTO", "GATE_CUT_PHOTO", "HKMG_PHOTO",
    "CONTACT_PHOTO", "VIA0_PHOTO", "VIA0_A_PHOTO", "LI_PHOTO",
    "M3_PHOTO", "M3_A_PHOTO", "M3_CUT_PHOTO",
    "V3_PHOTO", "V3_A_PHOTO", "M4_PHOTO",
}

# KrF 건식 레이어 (248nm 파장, 거친 패턴 - PAD, 패키징 등)
_KRF_LAYERS = {
    "PAD_PHOTO", "FUSE_PHOTO", "TRIM_PHOTO", "RDL_PHOTO", "BUMP_PHOTO",
    "PASSIV_PHOTO", "PASSIV2_PHOTO", "BOND_PHOTO", "SEAL_PHOTO",
    "DICING_PHOTO", "TSV_PHOTO", "ALU_PAD_PHOTO", "CU_PAD_PHOTO",
    "SOLDER_PHOTO", "UBM_PHOTO", "RDL2_PHOTO", "BUMP2_PHOTO",
    "ESD_PHOTO", "DUMMY_FILL_PHOTO",
}


def _get_layer_profile(layer_name: str) -> tuple:
    """레이어 이름으로 노광 프로파일을 결정.
    반환값: (PR종류, 파장nm, 액침여부, 마스크타입, 기본에너지mJ, 기본CD타겟nm)
    우선순위: 명시적 EUV/ArFi/KrF 세트 → 이름 패턴 매칭 → 기본값(ArF dry)
    """
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


# 전체 레이어의 노광 프로파일 딕셔너리 (조건 생성 시 참조)
LAYER_PROFILES = {name: _get_layer_profile(name) for name in LAYER_NAMES}


# ---------------------------------------------------------------------------
# 6. OVL 참조 레이어 매핑
# ---------------------------------------------------------------------------
# 오버레이(정렬) 측정 시 각 레이어가 어느 레이어를 기준으로 정렬하는지 정의
# 기본적으로 이전 레이어를 참조하되, 물리적으로 의미 있는 참조로 오버라이드
# 예: M1 → Contact, V1 → M1, M2 → V1 (실제 공정 흐름에 맞춤)

def _build_ovl_refs() -> dict:
    """OVL 참조 매핑 생성: 각 레이어가 참조하는 이전 레이어의 step_seq를 반환."""
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


# 전체 레이어의 OVL 참조 step_seq 딕셔너리
# 키: 레이어 이름, 값: 참조 레이어의 step_seq (예: "ac100000")
# 첫 번째 레이어는 "za000000" (zero align, 기준점 없음)
OVL_REFS_STEP_SEQ = _build_ovl_refs()
