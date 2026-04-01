"""Step Master ingestion/serving models.

Phase 1 (spec/tasks.md Epic A):
- step_current: 서비스 조회용 최신 스냅샷
- step_event_audit: incremental 이력 append 저장소
- sync_watermark: incremental 커서
- etl_run_log / etl_run_line_status: 배치 관측성/복구 상태
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class StepCurrent(Base):
    """서비스 조회용 최신 step 스냅샷."""

    __tablename__ = "step_current"
    __table_args__ = (
        UniqueConstraint(
            "line_id", "process_id", "step_seq", name="uq_step_current_line_process_step",
        ),
        Index("idx_step_current_line_process", "line_id", "process_id"),
        Index("idx_step_current_updated_at", "updated_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    line_id: Mapped[int] = mapped_column(
        ForeignKey("lines.id", ondelete="RESTRICT"), nullable=False,
    )
    process_id: Mapped[str] = mapped_column(String(100), nullable=False)
    step_seq: Mapped[str] = mapped_column(String(50), nullable=False)
    step_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    layer_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    descript: Mapped[str | None] = mapped_column(String(500), nullable=True)
    sys_key_vals: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    raw_payload: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now(),
    )


class StepEventAudit(Base):
    """Incremental 이벤트 이력(append-only)."""

    __tablename__ = "step_event_audit"
    __table_args__ = (
        Index("idx_step_event_audit_line_process_step", "line_id", "process_id", "step_seq"),
        Index("idx_step_event_audit_event_ts", "event_ts"),
        Index("idx_step_event_audit_ingested_at", "ingested_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    line_id: Mapped[int] = mapped_column(
        ForeignKey("lines.id", ondelete="RESTRICT"), nullable=False,
    )
    process_id: Mapped[str] = mapped_column(String(100), nullable=False)
    step_seq: Mapped[str] = mapped_column(String(50), nullable=False)
    del_yn: Mapped[str | None] = mapped_column(String(1), nullable=True)
    sys_key_vals: Mapped[str | None] = mapped_column(String(255), nullable=True)
    event_ts: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    source_batch_ts: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    dag_run_id: Mapped[str | None] = mapped_column(String(250), nullable=True)
    raw_payload: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    ingested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )


class SyncWatermark(Base):
    """Pipeline별 증분 적재 워터마크."""

    __tablename__ = "sync_watermark"

    id: Mapped[int] = mapped_column(primary_key=True)
    pipeline_name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    last_event_ts: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_sys_key_vals: Mapped[str | None] = mapped_column(String(255), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now(),
    )


class EtlRunLog(Base):
    """DAG run 단위 실행 로그."""

    __tablename__ = "etl_run_log"
    __table_args__ = (
        UniqueConstraint("dag_id", "run_id", name="uq_etl_run_log_dag_run"),
        Index("idx_etl_run_log_started_at", "started_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    dag_id: Mapped[str] = mapped_column(String(200), nullable=False)
    run_id: Mapped[str] = mapped_column(String(250), nullable=False)
    airflow_dag_run_id: Mapped[str | None] = mapped_column(String(250), nullable=True)
    status: Mapped[str] = mapped_column(String(30), nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    extracted_rows: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    merged_rows: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    deleted_rows: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    failed_lines: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    duration_seconds: Mapped[float | None] = mapped_column(Numeric(12, 3), nullable=True)
    error_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )


class EtlRunLineStatus(Base):
    """라인 단위 실행 상태 로그."""

    __tablename__ = "etl_run_line_status"
    __table_args__ = (
        UniqueConstraint("run_log_id", "line_id", name="uq_etl_run_line_status_run_line"),
        Index("idx_etl_run_line_status_line_status", "line_id", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    run_log_id: Mapped[int] = mapped_column(
        ForeignKey("etl_run_log.id", ondelete="CASCADE"), nullable=False,
    )
    line_id: Mapped[int] = mapped_column(
        ForeignKey("lines.id", ondelete="RESTRICT"), nullable=False,
    )
    status: Mapped[str] = mapped_column(String(30), nullable=False)
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    extracted_rows: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    merged_rows: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    deleted_rows: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    dq_violation_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    error_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now(),
    )
