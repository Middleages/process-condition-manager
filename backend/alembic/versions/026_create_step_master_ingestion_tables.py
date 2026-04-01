"""Create step master ingestion tables.

Revision ID: 026_create_step_master_ingestion_tables
Revises: 025_users_userid_and_drop_display_name
Create Date: 2026-03-31
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "026_create_step_master_ingestion_tables"
down_revision = "025_users_userid_and_drop_display_name"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "step_current",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "line_id",
            sa.Integer(),
            sa.ForeignKey("lines.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("process_id", sa.String(length=100), nullable=False),
        sa.Column("step_seq", sa.String(length=50), nullable=False),
        sa.Column("step_name", sa.String(length=200), nullable=True),
        sa.Column("layer_id", sa.String(length=50), nullable=True),
        sa.Column("descript", sa.String(length=500), nullable=True),
        sa.Column("sys_key_vals", sa.String(length=255), nullable=True),
        sa.Column("source_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("raw_payload", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("line_id", "process_id", "step_seq", name="uq_step_current_line_process_step"),
    )
    op.create_index("idx_step_current_line_process", "step_current", ["line_id", "process_id"])
    op.create_index("idx_step_current_updated_at", "step_current", ["updated_at"])

    op.create_table(
        "step_event_audit",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "line_id",
            sa.Integer(),
            sa.ForeignKey("lines.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("process_id", sa.String(length=100), nullable=False),
        sa.Column("step_seq", sa.String(length=50), nullable=False),
        sa.Column("del_yn", sa.String(length=1), nullable=True),
        sa.Column("sys_key_vals", sa.String(length=255), nullable=True),
        sa.Column("event_ts", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source_batch_ts", sa.DateTime(timezone=True), nullable=True),
        sa.Column("dag_run_id", sa.String(length=250), nullable=True),
        sa.Column("raw_payload", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("ingested_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("idx_step_event_audit_line_process_step", "step_event_audit", ["line_id", "process_id", "step_seq"])
    op.create_index("idx_step_event_audit_event_ts", "step_event_audit", ["event_ts"])
    op.create_index("idx_step_event_audit_ingested_at", "step_event_audit", ["ingested_at"])

    op.create_table(
        "sync_watermark",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("pipeline_name", sa.String(length=100), nullable=False, unique=True),
        sa.Column("last_event_ts", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_sys_key_vals", sa.String(length=255), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "etl_run_log",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("dag_id", sa.String(length=200), nullable=False),
        sa.Column("run_id", sa.String(length=250), nullable=False),
        sa.Column("airflow_dag_run_id", sa.String(length=250), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("extracted_rows", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("merged_rows", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("deleted_rows", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failed_lines", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("duration_seconds", sa.Numeric(12, 3), nullable=True),
        sa.Column("error_summary", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("dag_id", "run_id", name="uq_etl_run_log_dag_run"),
    )
    op.create_index("idx_etl_run_log_started_at", "etl_run_log", ["started_at"])
    op.create_index("idx_etl_run_log_airflow_run_id", "etl_run_log", ["airflow_dag_run_id"])

    op.create_table(
        "etl_run_line_status",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "run_log_id",
            sa.Integer(),
            sa.ForeignKey("etl_run_log.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "line_id",
            sa.Integer(),
            sa.ForeignKey("lines.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("extracted_rows", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("merged_rows", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("deleted_rows", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("dq_violation_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("run_log_id", "line_id", name="uq_etl_run_line_status_run_line"),
    )
    op.create_index("idx_etl_run_line_status_line_status", "etl_run_line_status", ["line_id", "status"])


def downgrade() -> None:
    op.drop_index("idx_etl_run_line_status_line_status", table_name="etl_run_line_status")
    op.drop_table("etl_run_line_status")
    op.drop_index("idx_etl_run_log_started_at", table_name="etl_run_log")
    op.drop_index("idx_etl_run_log_airflow_run_id", table_name="etl_run_log")
    op.drop_table("etl_run_log")
    op.drop_table("sync_watermark")
    op.drop_index("idx_step_event_audit_ingested_at", table_name="step_event_audit")
    op.drop_index("idx_step_event_audit_event_ts", table_name="step_event_audit")
    op.drop_index("idx_step_event_audit_line_process_step", table_name="step_event_audit")
    op.drop_table("step_event_audit")
    op.drop_index("idx_step_current_updated_at", table_name="step_current")
    op.drop_index("idx_step_current_line_process", table_name="step_current")
    op.drop_table("step_current")
