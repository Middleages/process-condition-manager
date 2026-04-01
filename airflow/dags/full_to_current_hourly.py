"""Step Master full snapshot -> step_current hourly DAG.

Scope:
- B1 build_line_list (whitelist)
- B2 extract_stage_line (line-level mapped task scaffold)
- B3 validate_line_load (line-level mapped task scaffold)
"""

from __future__ import annotations

import os
from datetime import datetime

from airflow.decorators import dag, task
from airflow.exceptions import AirflowSkipException


def _parse_line_whitelist(raw: str) -> list[int]:
    lines: list[int] = []
    for token in raw.split(","):
        token = token.strip()
        if not token:
            continue
        lines.append(int(token))
    return sorted(set(lines))


@dag(
    dag_id="full_to_current_hourly",
    start_date=datetime(2026, 3, 31),
    schedule="40 * * * *",
    catchup=False,
    tags=["step-master", "full-sync"],
)
def full_to_current_hourly():
    @task
    def build_line_list() -> list[int]:
        raw = os.getenv("STEP_LINE_WHITELIST", "")
        line_ids = _parse_line_whitelist(raw)
        if not line_ids:
            raise AirflowSkipException("STEP_LINE_WHITELIST is empty. Skipping run.")
        return line_ids

    @task
    def extract_stage_line(line_id: int) -> dict:
        # TODO(B2): source DB read + stage load 구현
        return {
            "line_id": line_id,
            "extracted_rows": 0,
            "source_max_ts": None,
            "stage_table": f"step_stage_{line_id}",
        }

    @task
    def validate_line_load(stage_result: dict) -> dict:
        # TODO(B3): null-key, duplicate-key, min-row threshold 검증 구현
        extracted_rows = int(stage_result.get("extracted_rows", 0))
        return {
            "line_id": stage_result["line_id"],
            "extracted_rows": extracted_rows,
            "duplicate_key_count": 0,
            "null_key_count": 0,
            "is_delete_allowed": extracted_rows > 0,
        }

    lines = build_line_list()
    staged = extract_stage_line.expand(line_id=lines)
    validate_line_load.expand(stage_result=staged)


full_to_current_hourly()
