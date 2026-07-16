"""백본 layer matching and snapshot contracts."""

from app.domain.backbone.matching import (
    LayerMatchInput,
    ManualOverride,
    MatchResult,
    match_layers,
)
from app.domain.backbone.snapshot import (
    SNAPSHOT_VERSION,
    BackboneCellValue,
    BackboneConditionSnapshot,
    BackboneSnapshotSpec,
    BackboneSourceLayer,
    BackboneSourceProject,
    snapshot,
)

__all__ = [
    "BackboneCellValue",
    "BackboneConditionSnapshot",
    "BackboneSnapshotSpec",
    "BackboneSourceLayer",
    "BackboneSourceProject",
    "LayerMatchInput",
    "ManualOverride",
    "MatchResult",
    "SNAPSHOT_VERSION",
    "match_layers",
    "snapshot",
]
