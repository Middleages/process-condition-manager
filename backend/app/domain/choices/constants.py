"""Fixed ChoiceSet identities used by Project Profile fields."""

PROFILE_CHOICE_SET_FIELDS = {
    "device_type": "device_type",
    "project_category": "project_category",
    "active_direction": "active_direction",
    "gate_direction": "gate_direction",
}
FIXED_PROFILE_CHOICE_SET_CODES = frozenset(PROFILE_CHOICE_SET_FIELDS)
