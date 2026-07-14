"""Real development-seed smoke test in a guarded PostgreSQL database."""

from __future__ import annotations

import os
import subprocess
from decimal import Decimal
from pathlib import Path
from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.features.sheets.repository import SheetRepository
from app.features.sheets.service import SheetService
from tests.postgres_database import temporary_postgres_database

_BACKEND_ROOT = Path(__file__).resolve().parents[2]
_FIXED_CODES = {
    "active_direction",
    "device_type",
    "gate_direction",
    "project_category",
}


def _run(command: list[str], *, database_url: str) -> subprocess.CompletedProcess[str]:
    environment = os.environ.copy()
    environment["APP_DATABASE_URL"] = database_url
    return subprocess.run(
        command,
        cwd=_BACKEND_ROOT,
        env=environment,
        check=True,
        capture_output=True,
        text=True,
    )


def _option_array_count(value: Any) -> int:
    if isinstance(value, dict):
        return sum(
            (len(item) if key in {"options", "choice_options"} and isinstance(item, list) else 0)
            + _option_array_count(item)
            for key, item in value.items()
        )
    if isinstance(value, list):
        return sum(_option_array_count(item) for item in value)
    return 0


async def test_real_dev_seed_bootstraps_profile_choices_and_large_sheet() -> None:
    with temporary_postgres_database() as database:
        migration = _run(
            ["uv", "run", "alembic", "upgrade", "head"],
            database_url=database.async_url,
        )
        seed = _run(
            ["uv", "run", "python", "-m", "scripts.seed_dev"],
            database_url=database.async_url,
        )
        assert "0004" in migration.stderr
        assert "seeded parameters=200" in seed.stdout

        sync_engine = sa.create_engine(database.sync_url)
        try:
            with sync_engine.connect() as connection:
                choice_sets = set(
                    connection.execute(sa.text("SELECT code FROM choice_set")).scalars()
                )
                assert choice_sets == _FIXED_CODES | {"equipment_mode"}
                assert connection.scalar(
                    sa.text(
                        "SELECT count(*) FROM project p "
                        "JOIN project_profile pp ON pp.project_id = p.id"
                    )
                ) == connection.scalar(sa.text("SELECT count(*) FROM project"))
                assert connection.scalar(
                    sa.text("SELECT count(*) FROM choice_option WHERE is_active")
                ) > 0
                assert connection.scalar(
                    sa.text("SELECT count(*) FROM choice_option WHERE NOT is_active")
                ) > 0
                assert connection.scalar(
                    sa.text(
                        "SELECT count(DISTINCT choice_set_id) FROM parameter "
                        "WHERE value_type = 'choice'"
                    )
                ) == 1
                assert connection.scalar(
                    sa.text(
                        "SELECT count(*) FROM choice_option co "
                        "JOIN choice_set cs ON cs.id = co.choice_set_id "
                        "WHERE cs.code = 'equipment_mode'"
                    )
                ) >= 300
                bounds = connection.execute(
                    sa.text(
                        "SELECT min_value, max_value FROM parameter "
                        "WHERE code = 'param_000'"
                    )
                ).one()
                assert bounds == (Decimal("0"), Decimal("1000"))
                assert connection.scalar(
                    sa.text(
                        "SELECT value_text FROM cell_value "
                        "WHERE parameter_code = 'param_000' ORDER BY id LIMIT 1"
                    )
                ) == "0"
                project_id = connection.scalar(sa.text("SELECT id FROM project"))
                assert isinstance(project_id, int)
        finally:
            sync_engine.dispose()

        async_engine = create_async_engine(database.async_url)
        try:
            session_factory = async_sessionmaker(async_engine, expire_on_commit=False)
            async with session_factory() as session:
                sheet = await SheetService(SheetRepository(session)).get_sheet(
                    project_id, user_id="seed-smoke"
                )
        finally:
            await async_engine.dispose()

        assert len(sheet.columns) == 200
        assert len({row.layer_key for row in sheet.rows}) == 100
        assert {
            column.choice_set_code
            for column in sheet.columns
            if column.choice_set_code is not None
        } == {"equipment_mode"}
        assert _option_array_count(sheet.model_dump(mode="json")) == 0
