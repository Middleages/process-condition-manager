"""device_master, layer_master, sync_source_config, device_meta_source 테이블 생성.

SPEC-DEVICE-001 M1: 디바이스/레이어 마스터 + 동기화 설정 테이블.

Revision ID: 018_create_device_layer_master_tables
Revises: 017_user_role_to_roles_array
Create Date: 2026-02-26
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "018_create_device_layer_master_tables"
down_revision = "017_user_role_to_roles_array"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1) device_master
    # ------------------------------------------------------------------
    op.create_table(
        "device_master",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "line_id",
            sa.Integer(),
            sa.ForeignKey("lines.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("product_name", sa.String(100), nullable=False),
        sa.Column("process", sa.String(50), nullable=False),
        sa.Column("part_id", sa.String(100), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("enrichment", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("line_id", "product_name", name="uq_device_master_line_product"),
    )
    op.create_index("idx_device_master_line_id", "device_master", ["line_id"])
    op.create_index("idx_device_master_product_name", "device_master", ["product_name"])

    # ------------------------------------------------------------------
    # 2) layer_master
    # ------------------------------------------------------------------
    op.create_table(
        "layer_master",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "device_master_id",
            sa.Integer(),
            sa.ForeignKey("device_master.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("layer_id", sa.String(10), nullable=False),
        sa.Column("step_seq", sa.String(20), nullable=True),
        sa.Column("descript", sa.String(200), nullable=True),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "device_master_id", "layer_id", name="uq_layer_master_device_layer",
        ),
    )
    op.create_index("idx_layer_master_device_id", "layer_master", ["device_master_id"])

    # ------------------------------------------------------------------
    # 3) sync_source_config
    # ------------------------------------------------------------------
    op.create_table(
        "sync_source_config",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("source_type", sa.String(20), nullable=False),
        sa.Column("source_name", sa.String(100), nullable=False),
        sa.Column("table_name", sa.String(200), nullable=False),
        sa.Column("schema_name", sa.String(50), nullable=False, server_default="public"),
        sa.Column("column_mappings", JSONB, nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("source_type", "source_name", name="uq_sync_source_type_name"),
    )

    # ------------------------------------------------------------------
    # 4) device_meta_source
    # ------------------------------------------------------------------
    op.create_table(
        "device_meta_source",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("source_name", sa.String(100), unique=True, nullable=False),
        sa.Column("table_name", sa.String(200), nullable=False),
        sa.Column("schema_name", sa.String(50), nullable=False, server_default="public"),
        sa.Column("join_keys", JSONB, nullable=False),
        sa.Column("column_mappings", JSONB, nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    # 역순으로 삭제 (FK 종속 관계 고려)
    op.drop_table("device_meta_source")
    op.drop_table("sync_source_config")
    op.drop_index("idx_layer_master_device_id", table_name="layer_master")
    op.drop_table("layer_master")
    op.drop_index("idx_device_master_product_name", table_name="device_master")
    op.drop_index("idx_device_master_line_id", table_name="device_master")
    op.drop_table("device_master")
