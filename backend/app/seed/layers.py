"""Layer definitions, profiles, and OVL reference mappings for seed data."""


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

    # Special (~24 -> total 150)
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
