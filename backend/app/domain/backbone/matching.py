"""Layer backbone matching rules."""

from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True, slots=True)
class LayerMatchInput:
    """매칭에 필요한 최소 layer 정보."""

    layer_key: str
    step_seq: str
    layer_id: str


@dataclass(frozen=True, slots=True)
class ManualOverride:
    """사용자 수동 매칭 지정."""

    target_layer_key: str
    source_layer_key: str


@dataclass(frozen=True, slots=True)
class LayerMatch:
    """단일 target layer 매칭 결과."""

    target_layer_key: str
    source_layer_key: str | None
    match_type: Literal["auto", "manual", "unmatched"]


@dataclass(frozen=True, slots=True)
class MatchResult:
    """전체 layer 매칭 결과."""

    matches: tuple[LayerMatch, ...]

    @property
    def matched_count(self) -> int:
        return sum(1 for match in self.matches if match.source_layer_key is not None)

    @property
    def unmatched_count(self) -> int:
        return sum(1 for match in self.matches if match.source_layer_key is None)

    @property
    def auto_count(self) -> int:
        return sum(1 for match in self.matches if match.match_type == "auto")

    @property
    def manual_count(self) -> int:
        return sum(1 for match in self.matches if match.match_type == "manual")

    @property
    def match_rate(self) -> float:
        if not self.matches:
            return 0.0
        return self.matched_count / len(self.matches)


def match_layers(
    target_layers: list[LayerMatchInput],
    source_layers: list[LayerMatchInput],
    manual_overrides: list[ManualOverride] | None = None,
) -> MatchResult:
    """`step_seq + layer_id` 자동 매칭 후 수동 override를 병합한다.

    같은 source layer를 여러 target layer에 수동 매칭하는 것은 허용한다.
    """
    source_by_key = {layer.layer_key: layer for layer in source_layers}
    source_by_match_key = {
        (layer.step_seq, layer.layer_id): layer for layer in source_layers
    }
    manual_by_target = {
        override.target_layer_key: override.source_layer_key
        for override in (manual_overrides or [])
        if override.source_layer_key in source_by_key
    }

    matches: list[LayerMatch] = []
    for target in target_layers:
        manual_source_key = manual_by_target.get(target.layer_key)
        if manual_source_key is not None:
            matches.append(LayerMatch(target.layer_key, manual_source_key, "manual"))
            continue

        auto_source = source_by_match_key.get((target.step_seq, target.layer_id))
        if auto_source is not None:
            matches.append(LayerMatch(target.layer_key, auto_source.layer_key, "auto"))
        else:
            matches.append(LayerMatch(target.layer_key, None, "unmatched"))

    return MatchResult(tuple(matches))
