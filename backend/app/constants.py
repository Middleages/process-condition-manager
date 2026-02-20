"""
Domain constants for the PCM application.

Single source of truth for all business-domain enumerations and rules.
"""

# --- Validation rule types ---
ALLOWED_RULE_TYPES = ("range", "required", "conditional_required", "cross_layer")
ALLOWED_VALUE_TRANSFORMS = ("to_int", "to_float", "yn_to_bool")

# --- Project status workflow ---
PROJECT_STATUSES = ("draft", "review", "approved", "rejected", "archived")
VALID_STATUS_TRANSITIONS: dict[str, list[str]] = {
    "draft": ["review"],
    "review": ["approved", "rejected"],
    "approved": ["archived"],
}

# --- Column categories ---
CATEGORY_CODES = ("SP", "SC", "OVL", "DEV")

# --- Export format types ---
EXPORT_FORMAT_TYPES = ("TYPE_A", "TYPE_B", "TYPE_C")
