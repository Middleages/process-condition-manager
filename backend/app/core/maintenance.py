"""Phase 4 writer maintenance gates and health attestation."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import settings
from app.core.db import app_engine
from app.core.errors import AppError

PHASE4_WRITER_CONTRACT_VERSION = 1
PHASE4_WRITER_MIN_REVISION = "0006"
PROJECT_MUTATION_RETRY_AFTER_SECONDS = 60


class ProjectMutationsDisabledError(AppError):
    """Phase 4 writer가 rollback-only일 때 project truth mutation을 차단한다."""

    status_code = 503
    code = "project_mutations_disabled"

    def __init__(self) -> None:
        super().__init__(
            "프로젝트 쓰기가 비활성화되어 있다",
            details={"project_mutations_enabled": False},
            headers={"Retry-After": str(PROJECT_MUTATION_RETRY_AFTER_SECONDS)},
        )


class Phase4WriterContractMismatchError(AppError):
    """Writer health contract/revision mismatch."""

    status_code = 503
    code = "phase4_writer_contract_mismatch"

    def __init__(self, *, db_revision: str | None) -> None:
        super().__init__(
            "Phase 4 writer contract 또는 DB revision이 호환되지 않는다",
            details={
                "contract_version": PHASE4_WRITER_CONTRACT_VERSION,
                "db_revision": db_revision,
                "minimum_revision": PHASE4_WRITER_MIN_REVISION,
            },
        )


class Phase4WriterHealthOut(BaseModel):
    """/health/phase4-writer 응답 계약."""

    status: Literal["ok"] = "ok"
    contract_version: int
    db_revision: str
    project_mutations_enabled: bool
    pre_unfreeze_ready: bool
    runtime_state: Literal["pre_unfreeze", "active"]


def require_project_mutations_enabled() -> None:
    """Project truth mutation gate dependency."""
    if not settings.project_mutations_enabled:
        raise ProjectMutationsDisabledError()


def _revision_is_compatible(db_revision: str | None) -> bool:
    return db_revision is not None and db_revision >= PHASE4_WRITER_MIN_REVISION


async def read_app_revision() -> str | None:
    """Read the current Alembic revision from the app database."""
    try:
        async with app_engine.connect() as connection:
            return await connection.scalar(text("SELECT version_num FROM alembic_version"))
    except SQLAlchemyError:
        return None


async def get_phase4_writer_health() -> Phase4WriterHealthOut:
    """Return the health attestation used by canary and rollback smoke checks."""
    db_revision = await read_app_revision()
    if not _revision_is_compatible(db_revision):
        raise Phase4WriterContractMismatchError(db_revision=db_revision)
    assert db_revision is not None

    mutations_enabled = settings.project_mutations_enabled
    return Phase4WriterHealthOut(
        contract_version=PHASE4_WRITER_CONTRACT_VERSION,
        db_revision=db_revision,
        project_mutations_enabled=mutations_enabled,
        pre_unfreeze_ready=not mutations_enabled,
        runtime_state="active" if mutations_enabled else "pre_unfreeze",
    )
