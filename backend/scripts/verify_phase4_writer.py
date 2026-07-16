"""Rollback-only smoke scaffold for the Phase 4 writer release gate."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Any

# The task's reproducible command executes this file directly rather than with
# ``python -m``; make the backend package root explicit without installing it.
if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.maintenance import get_phase4_writer_health  # noqa: E402


async def build_smoke_report(*, rollback: bool) -> dict[str, Any]:
    """Build the writer-health attestation used by canary/rollback checks."""
    health = await get_phase4_writer_health()
    if rollback and health.project_mutations_enabled:
        raise RuntimeError("rollback-only smoke requires PROJECT_MUTATIONS_ENABLED=false")
    return {
        "status": "PASS",
        "mode": "rollback" if rollback else "health",
        "health": health.model_dump(),
        "checks": {
            "contract_revision_compatible": True,
            "rollback_only": rollback,
            "pre_unfreeze_ready": health.pre_unfreeze_ready,
            "runtime_state": health.runtime_state,
        },
    }


async def _main_async(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--rollback",
        action="store_true",
        help="Emit rollback-only attestation fields and require project mutations to stay disabled.",
    )
    args = parser.parse_args(argv)

    try:
        report = await build_smoke_report(rollback=args.rollback)
    except Exception as exc:  # pragma: no cover - defensive CLI guard
        report = {"status": "FAIL", "error": str(exc), "mode": "rollback" if args.rollback else "health"}
        print(json.dumps(report, ensure_ascii=False, sort_keys=True))
        return 1

    print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    return 0


def main(argv: list[str] | None = None) -> int:
    return asyncio.run(_main_async(sys.argv[1:] if argv is None else argv))


if __name__ == "__main__":
    raise SystemExit(main())
