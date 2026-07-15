"""Project creation metadata contracts."""

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True, slots=True)
class ProjectProfileSeed:
    """Optional profile defaults supplied at project creation time."""

    device_type_code: str | None = None
    project_category_code: str | None = None
    comment: str | None = None
    active_direction_code: str | None = None
    gate_direction_code: str | None = None
    gross_die: str | None = None
    pitch_x: str | None = None
    pitch_y: str | None = None
    shot_x: str | None = None
    shot_y: str | None = None
    slit_occupancy: str | None = None
    lens_occupancy: str | None = None
    map_offset_x: str | None = None
    map_offset_y: str | None = None
    scribe_lane_x: str | None = None
    scribe_lane_y: str | None = None
    shot_count: str | None = None
    full_shot: str | None = None
    layer_total: str | None = None
    euv: str | None = None
    imm: str | None = None
    arf: str | None = None
    krf: str | None = None
    iline: str | None = None
    soh: str | None = None
    pspi: str | None = None
    metal_layer_count: str | None = None


class ProjectMetadataProvider(Protocol):
    """Source boundary for optional creation-time profile metadata."""

    identifier: str

    async def load_seed(
        self, *, line_id: str, process_id: str, part_id: str
    ) -> ProjectProfileSeed:
        """Load profile defaults for one canonical project identity."""
        ...
