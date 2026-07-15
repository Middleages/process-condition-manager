"""Database-free performance fixture and reporting contract."""

from scripts.measure_validation_perf import build_fixture, measure_samples


def test_fixture_and_measurement_are_deterministic_and_database_free() -> None:
    fixture = build_fixture(cell_count=200, rule_count=5)

    assert fixture.cell_count == 200
    assert len(fixture.rules) == 5

    first = measure_samples(cell_count=200, rule_count=5, samples=3)
    second = measure_samples(cell_count=200, rule_count=5, samples=1)

    assert first.cell_count == second.cell_count == 200
    assert first.rule_count == second.rule_count == 5
    assert first.error_count == second.error_count == 5
    assert first.warning_count == second.warning_count == 3
    assert first.issue_count == second.issue_count == 8
    assert first.issue_count == first.error_count + first.warning_count
    assert first.median_ms >= 0
    assert first.p95_ms >= first.median_ms
