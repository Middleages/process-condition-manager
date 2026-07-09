"""백본 layer 매칭 규칙 테스트."""

from app.domain.backbone import LayerMatchInput, ManualOverride, match_layers


def test_auto_matches_by_step_seq_and_layer_id() -> None:
    result = match_layers(
        [LayerMatchInput("target-a", "001", "CLN")],
        [LayerMatchInput("source-a", "001", "CLN")],
    )

    assert result.matched_count == 1
    assert result.matches[0].source_layer_key == "source-a"
    assert result.matches[0].match_type == "auto"


def test_manual_override_replaces_auto_and_reuses_source() -> None:
    result = match_layers(
        [
            LayerMatchInput("target-a", "001", "CLN"),
            LayerMatchInput("target-b", "002", "PHOTO"),
        ],
        [
            LayerMatchInput("source-a", "001", "CLN"),
            LayerMatchInput("source-b", "099", "ALT"),
        ],
        [
            ManualOverride("target-a", "source-b"),
            ManualOverride("target-b", "source-b"),
        ],
    )

    assert [(m.source_layer_key, m.match_type) for m in result.matches] == [
        ("source-b", "manual"),
        ("source-b", "manual"),
    ]


def test_unmatched_when_no_auto_or_valid_manual_source() -> None:
    result = match_layers(
        [LayerMatchInput("target-a", "001", "CLN")],
        [],
        [ManualOverride("target-a", "missing")],
    )

    assert result.unmatched_count == 1
    assert result.match_rate == 0.0


def test_auto_and_manual_counts_are_separated() -> None:
    result = match_layers(
        [
            LayerMatchInput("target-a", "001", "CLN"),
            LayerMatchInput("target-b", "010", "ACT"),
            LayerMatchInput("target-c", "020", "ETCH"),
        ],
        [
            LayerMatchInput("source-a", "001", "CLN"),
            LayerMatchInput("source-b", "010", "ACT"),
        ],
        [ManualOverride("target-c", "source-a")],
    )

    assert result.auto_count == 2
    assert result.manual_count == 1
    assert result.matched_count == 3
    assert result.unmatched_count == 0
