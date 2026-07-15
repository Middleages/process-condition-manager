"""Phase 3 parameter-validation migration evidence on isolated PostgreSQL."""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import cast

import pytest
import sqlalchemy as sa
from alembic.config import Config
from sqlalchemy.engine import Connection
from sqlalchemy.exc import IntegrityError

from alembic import command
from tests.postgres_database import (
    TemporaryPostgresDatabase,
    temporary_postgres_database,
)

_BACKEND_ROOT = Path(__file__).resolve().parents[2]


def _config(database: TemporaryPostgresDatabase) -> Config:
    config = Config(str(_BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(_BACKEND_ROOT / "alembic"))
    config.set_main_option("sqlalchemy.url", database.sync_url)
    return config


@dataclass
class MigrationDatabase:
    database: TemporaryPostgresDatabase
    connection: Connection

    def upgrade(self, target: str) -> None:
        config = _config(self.database)
        config.attributes["connection"] = self.connection
        try:
            command.upgrade(config, target)
        except Exception:
            self.connection.rollback()
            raise

    def downgrade(self, target: str) -> None:
        config = _config(self.database)
        config.attributes["connection"] = self.connection
        try:
            command.downgrade(config, target)
        except Exception:
            self.connection.rollback()
            raise

    def current_revision(self) -> str | None:
        return self.connection.scalar(sa.text("SELECT version_num FROM alembic_version"))


@pytest.fixture
def migration_db() -> Iterator[MigrationDatabase]:
    with temporary_postgres_database() as database:
        engine = sa.create_engine(database.sync_url)
        try:
            with engine.connect() as connection:
                yield MigrationDatabase(database, connection)
        finally:
            engine.dispose()


def test_existing_parameters_upgrade_with_safe_validation_defaults(
    migration_db: MigrationDatabase,
) -> None:
    migration_db.upgrade("0004")
    migration_db.connection.execute(
        sa.text(
            "INSERT INTO parameter "
            "(code, display_name, value_type, unit, min_value, max_value) VALUES "
            "('dose', 'Dose', 'number', 'mJ', 1, 100), "
            "('note', 'Note', 'text', NULL, NULL, NULL)"
        )
    )
    migration_db.connection.commit()

    migration_db.upgrade("head")

    assert migration_db.current_revision() == "0005"
    rows = migration_db.connection.execute(
        sa.text("SELECT code, required, pattern, pattern_hint FROM parameter ORDER BY code")
    ).all()
    assert rows == [
        ("dose", False, None, None),
        ("note", False, None, None),
    ]

    columns = {
        column["name"]: column
        for column in sa.inspect(migration_db.connection).get_columns("parameter")
    }
    assert columns["required"]["nullable"] is False
    assert columns["required"]["default"] == "false"
    assert cast(sa.String, columns["pattern"]["type"]).length == 256
    assert cast(sa.String, columns["pattern_hint"]["type"]).length == 256

    inspector = sa.inspect(migration_db.connection)
    rule_columns = {column["name"]: column for column in inspector.get_columns("validation_rule")}
    assert set(rule_columns) == {
        "id",
        "code",
        "name",
        "description",
        "severity",
        "scope",
        "spec",
        "version",
        "is_active",
        "created_at",
        "updated_at",
    }
    assert str(rule_columns["scope"]["type"]) == "JSONB"
    assert str(rule_columns["spec"]["type"]) == "JSONB"
    assert {constraint["name"] for constraint in inspector.get_check_constraints(
        "validation_rule"
    )} >= {
        "ck_validation_rule_code_format",
        "ck_validation_rule_name_nonblank",
        "ck_validation_rule_description_nonblank",
        "ck_validation_rule_severity",
        "ck_validation_rule_scope_object",
        "ck_validation_rule_spec_object",
        "ck_validation_rule_version",
    }
    assert {index["name"] for index in inspector.get_indexes("validation_rule")} >= {
        "ix_validation_rule_active_code",
        "ix_validation_rule_code",
    }


def test_legacy_non_number_numeric_metadata_survives_the_unvalidated_constraint(
    migration_db: MigrationDatabase,
) -> None:
    migration_db.upgrade("0004")
    choice_set_id = migration_db.connection.scalar(
        sa.text("SELECT id FROM choice_set WHERE code = 'device_type'")
    )
    assert isinstance(choice_set_id, int)
    migration_db.connection.execute(
        sa.text(
            "INSERT INTO parameter "
            "(code, display_name, value_type, unit, min_value, max_value) VALUES "
            "('legacy_text', 'Legacy text', 'text', 'nm', 1.25, 9.5)"
        )
    )
    migration_db.connection.execute(
        sa.text(
            "INSERT INTO parameter "
            "(code, display_name, value_type, choice_set_id, unit, min_value, max_value) "
            "VALUES ('legacy_choice', 'Legacy choice', 'choice', :choice_set_id, "
            "'legacy-unit', 2, 3)"
        ),
        {"choice_set_id": choice_set_id},
    )
    migration_db.connection.commit()

    migration_db.upgrade("head")

    rows = migration_db.connection.execute(
        sa.text(
            "SELECT code, value_type, unit, min_value::text, max_value::text, "
            "required, pattern, pattern_hint FROM parameter "
            "WHERE code LIKE 'legacy_%' ORDER BY code"
        )
    ).all()
    assert rows == [
        ("legacy_choice", "choice", "legacy-unit", "2", "3", False, None, None),
        ("legacy_text", "text", "nm", "1.25", "9.5", False, None, None),
    ]
    assert (
        migration_db.connection.scalar(
            sa.text(
                "SELECT convalidated FROM pg_constraint "
                "WHERE conrelid = 'parameter'::regclass "
                "AND conname = 'ck_parameter_number_metadata'"
            )
        )
        is False
    )

    with pytest.raises(IntegrityError):
        migration_db.connection.execute(
            sa.text(
                "INSERT INTO parameter "
                "(code, display_name, value_type, unit) "
                "VALUES ('new_bad_text', 'New bad text', 'text', 'nm')"
            )
        )
    migration_db.connection.rollback()


@pytest.mark.parametrize(
    "values_sql",
    [
        "('bad_text_unit', 'Bad', 'text', 'nm', NULL, NULL, false, NULL, NULL)",
        "('bad_text_bound', 'Bad', 'text', NULL, 0, NULL, false, NULL, NULL)",
        "('bad_number_pattern', 'Bad', 'number', NULL, NULL, NULL, false, '[0-9]', '숫자')",
        "('bad_missing_hint', 'Bad', 'text', NULL, NULL, NULL, false, '[A-Z]', NULL)",
        "('bad_hint_only', 'Bad', 'text', NULL, NULL, NULL, false, NULL, '영문')",
        "('bad_blank_hint', 'Bad', 'text', NULL, NULL, NULL, false, '[A-Z]', '   ')",
    ],
)
def test_database_constraints_reject_illegal_raw_parameter_metadata(
    migration_db: MigrationDatabase,
    values_sql: str,
) -> None:
    migration_db.upgrade("head")

    with pytest.raises(IntegrityError):
        migration_db.connection.execute(
            sa.text(
                "INSERT INTO parameter "
                "(code, display_name, value_type, unit, min_value, max_value, "
                "required, pattern, pattern_hint) VALUES " + values_sql
            )
        )
    migration_db.connection.rollback()


def test_validation_columns_downgrade_without_losing_parameter_rows(
    migration_db: MigrationDatabase,
) -> None:
    migration_db.upgrade("head")
    migration_db.connection.execute(
        sa.text(
            "INSERT INTO parameter "
            "(code, display_name, value_type, required, pattern, pattern_hint) "
            "VALUES ('mask_id', 'Mask ID', 'text', true, '[A-Z]{2}', '영문 2자리')"
        )
    )
    migration_db.connection.commit()

    migration_db.downgrade("0004")

    assert migration_db.current_revision() == "0004"
    columns = {
        column["name"] for column in sa.inspect(migration_db.connection).get_columns("parameter")
    }
    assert {"required", "pattern", "pattern_hint"}.isdisjoint(columns)
    assert "validation_rule" not in sa.inspect(migration_db.connection).get_table_names()
    assert (
        migration_db.connection.scalar(
            sa.text("SELECT count(*) FROM parameter WHERE code = 'mask_id'")
        )
        == 1
    )
