"""Executable binding for the guarded Phase 4 backbone-diff performance evidence."""

from __future__ import annotations

import json
import math
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

_PG_URL = os.environ.get("APP_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(_PG_URL is None, reason="APP_TEST_DATABASE_URL unset")

_BACKEND_ROOT = Path(__file__).resolve().parents[2]
_DATABASE_NAME_RE = re.compile(r"^pcm_phase26_test_[0-9a-f]+$")
_MEASURED_RUNS = 5
_STABILITY_RUNS = 3
_MEBIBYTE = 1024 * 1024


def _nearest_rank(samples: list[float], percentile: float) -> float:
    ordered = sorted(samples)
    return ordered[max(0, math.ceil(percentile * len(ordered)) - 1)]


def _assert_summary_is_nearest_rank(summary: dict[str, Any]) -> None:
    samples = summary["samples_ms"]
    assert len(samples) == _MEASURED_RUNS
    assert summary["p50_ms"] == _nearest_rank(samples, 0.50)
    assert summary["p95_ms"] == _nearest_rank(samples, 0.95)
    assert summary["max_ms"] == max(samples)


def test_measure_backbone_diff_perf_binds_exact_fixture_and_public_budgets(
    tmp_path: Path,
) -> None:
    env = os.environ.copy()
    env.pop("COVERAGE_FILE", None)
    env.pop("COVERAGE_PROCESS_START", None)
    env.pop("COVERAGE_RCFILE", None)
    reports: list[dict[str, Any]] = []
    for run_number in range(1, _STABILITY_RUNS + 1):
        output_path = tmp_path / f"run-{run_number}.json"
        completed = subprocess.run(
            [
                sys.executable,
                "-m",
                "scripts.measure_backbone_diff_perf",
                "--output",
                str(output_path),
            ],
            cwd=_BACKEND_ROOT,
            env=env,
            capture_output=True,
            text=True,
            check=False,
            timeout=180,
        )
        assert completed.returncode == 0, completed.stderr or completed.stdout
        reports.append(json.loads(output_path.read_text(encoding="utf-8")))

    for report in reports:
        assert report["schema_version"] == 1
        assert report["status"] == "passed"
        assert report["failures"] == []
        assert report["protocol"] == {
            "warmup_runs": 1,
            "measured_runs": 5,
            "percentile_method": "nearest-rank-ceiling",
            "pure_timing_gc_enabled": False,
        }

        assert report["fixture"] == {
            "seed": 20260717,
            "project_count": 1,
            "layer_count": 100,
            "condition_count": 100,
            "parameter_count": 200,
            "coordinate_count": 20_000,
            "number_parameter_count": 50,
            "text_parameter_count": 100,
            "choice_parameter_count": 50,
            "null_coordinate_count": 1_000,
            "value_kinds": ["number", "text", "choice", "null"],
            "changed_coordinate_count": 2_000,
            "cleared_coordinate_count": 1_000,
            "non_unchanged_coordinate_count": 3_000,
            "non_unchanged_ratio": 0.15,
        }

        database = report["database"]
        assert database["guarded"] is True
        assert database["dropped"] is True
        assert _DATABASE_NAME_RE.fullmatch(database["database_name"])
        assert database["transaction"] == {
            "isolation": "repeatable read",
            "read_only": "on",
            "setup_statement": "SET TRANSACTION READ ONLY",
        }

        pure = report["metrics"]["pure_diff_20k"]
        _assert_summary_is_nearest_rank(pure)
        assert pure["p95_ms"] <= 250.0
        assert pure["peak_bytes"] <= 64 * _MEBIBYTE
        assert pure["layer_count"] == 100
        assert pure["coordinate_count"] == 20_000
        assert pure["classification_counts"] == {
            "added": 0,
            "changed": 2_000,
            "cleared": 1_000,
            "removed": 0,
            "unchanged": 17_000,
        }

        expected_http_items = {
            "root_preview_20": 20,
            "condition_limit_50": 1,
            "cell_limit_100": 100,
        }
        for label, expected_items in expected_http_items.items():
            metric = report["metrics"][label]
            _assert_summary_is_nearest_rank(metric)
            assert metric["p95_ms"] <= 600.0
            assert metric["max_round_trips"] <= 9
            assert metric["max_select_count"] <= 8
            assert metric["max_response_bytes"] <= 256 * 1024
            assert metric["item_count"] == expected_items
            assert metric["status_codes"] == [200] * _MEASURED_RUNS
            assert metric["setup_statement_first"] is True
            assert len(metric["round_trips"]) == _MEASURED_RUNS
            assert len(metric["select_counts"]) == _MEASURED_RUNS
            assert len(metric["response_bytes"]) == _MEASURED_RUNS
