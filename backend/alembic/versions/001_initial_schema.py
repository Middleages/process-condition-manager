"""Initial schema - all tables

Revision ID: 001_initial
Revises:
Create Date: 2025-02-11
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # === users ===
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("username", sa.String(50), unique=True, nullable=False),
        sa.Column("display_name", sa.String(100), nullable=False),
        sa.Column("role", sa.String(20), nullable=False, server_default="editor"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_users_username", "users", ["username"])

    # === products ===
    op.create_table(
        "products",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("product_name", sa.String(100), unique=True, nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_backbone", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_products_product_name", "products", ["product_name"])

    # === layers ===
    op.create_table(
        "layers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("layer_name", sa.String(100), unique=True, nullable=False),
        sa.Column("step_seq", sa.String(10), unique=True, nullable=False),
        sa.Column("layer_number", sa.String(10), unique=True, nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_layers_layer_name", "layers", ["layer_name"])
    op.create_index("ix_layers_step_seq", "layers", ["step_seq"])

    # === product_layers ===
    op.create_table(
        "product_layers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("product_id", sa.Integer(), sa.ForeignKey("products.id", ondelete="CASCADE"), nullable=False),
        sa.Column("layer_id", sa.Integer(), sa.ForeignKey("layers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("conditions", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("product_id", "layer_id"),
    )
    op.create_index("idx_product_layers_product", "product_layers", ["product_id"])

    # === column_categories ===
    op.create_table(
        "column_categories",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("category_code", sa.String(10), unique=True, nullable=False),
        sa.Column("category_name", sa.String(50), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default=sa.text("0")),
    )

    # === column_definitions ===
    op.create_table(
        "column_definitions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("column_name", sa.String(100), unique=True, nullable=False),
        sa.Column("display_name", sa.String(200), nullable=False),
        sa.Column("category_id", sa.Integer(), sa.ForeignKey("column_categories.id"), nullable=False),
        sa.Column("data_type", sa.String(20), nullable=False),
        sa.Column("select_options", postgresql.JSONB(), nullable=True),
        sa.Column("unit", sa.String(20), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("is_required", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_column_definitions_column_name", "column_definitions", ["column_name"])

    # === column_validations ===
    op.create_table(
        "column_validations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("column_id", sa.Integer(), sa.ForeignKey("column_definitions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("rule_type", sa.String(30), nullable=False),
        sa.Column("rule_config", postgresql.JSONB(), nullable=False),
        sa.Column("error_message", sa.String(500), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )

    # === projects ===
    op.create_table(
        "projects",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("product_id", sa.Integer(), sa.ForeignKey("products.id"), nullable=False),
        sa.Column("main_backbone_id", sa.Integer(), sa.ForeignKey("products.id"), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default=sa.text("'draft'")),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("reviewed_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("idx_projects_product", "projects", ["product_id"])
    op.create_index("idx_projects_status", "projects", ["status"])

    # === project_layers ===
    op.create_table(
        "project_layers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("layer_id", sa.Integer(), sa.ForeignKey("layers.id"), nullable=False),
        sa.Column("backbone_product_id", sa.Integer(), sa.ForeignKey("products.id"), nullable=True),
        sa.Column("conditions", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("backbone_conditions", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("project_id", "layer_id"),
    )
    op.create_index("idx_project_layers_project", "project_layers", ["project_id"])
    op.create_index(
        "idx_project_layers_conditions_gin",
        "project_layers",
        ["conditions"],
        postgresql_using="gin",
    )

    # === change_logs ===
    op.create_table(
        "change_logs",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("project_layer_id", sa.Integer(), sa.ForeignKey("project_layers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("column_name", sa.String(100), nullable=False),
        sa.Column("old_value", sa.Text(), nullable=True),
        sa.Column("new_value", sa.Text(), nullable=True),
        sa.Column("change_type", sa.String(20), nullable=False),
        sa.Column("changed_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("changed_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("idx_change_logs_project_layer_time", "change_logs", ["project_layer_id", sa.text("changed_at DESC")])
    op.create_index("idx_change_logs_column", "change_logs", ["project_layer_id", "column_name"])

    # === project_status_logs ===
    op.create_table(
        "project_status_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("from_status", sa.String(20), nullable=False),
        sa.Column("to_status", sa.String(20), nullable=False),
        sa.Column("changed_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("changed_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("idx_project_status_logs_project", "project_status_logs", ["project_id"])

    # === review_comments ===
    op.create_table(
        "review_comments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_layer_id", sa.Integer(), sa.ForeignKey("project_layers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("column_name", sa.String(100), nullable=True),
        sa.Column("comment", sa.Text(), nullable=False),
        sa.Column("is_resolved", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("idx_review_comments_project_layer", "review_comments", ["project_layer_id"])
    op.create_index(
        "idx_review_comments_unresolved",
        "review_comments",
        ["project_layer_id"],
        postgresql_where=sa.text("is_resolved = false"),
    )

    # === export_systems ===
    op.create_table(
        "export_systems",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("system_name", sa.String(100), unique=True, nullable=False),
        sa.Column("format_type", sa.String(10), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("additional_config", postgresql.JSONB(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # === export_column_mappings ===
    op.create_table(
        "export_column_mappings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("export_system_id", sa.Integer(), sa.ForeignKey("export_systems.id", ondelete="CASCADE"), nullable=False),
        sa.Column("column_id", sa.Integer(), sa.ForeignKey("column_definitions.id"), nullable=False),
        sa.Column("target_column_name", sa.String(100), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("is_required", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )

    # === recipe_xml_mappings ===
    op.create_table(
        "recipe_xml_mappings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("xpath", sa.String(300), nullable=False),
        sa.Column("column_id", sa.Integer(), sa.ForeignKey("column_definitions.id"), nullable=False),
        sa.Column("value_transform", sa.String(50), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("recipe_xml_mappings")
    op.drop_table("export_column_mappings")
    op.drop_table("export_systems")
    op.drop_table("review_comments")
    op.drop_table("project_status_logs")
    op.drop_table("change_logs")
    op.drop_table("project_layers")
    op.drop_table("projects")
    op.drop_table("column_validations")
    op.drop_table("column_definitions")
    op.drop_table("column_categories")
    op.drop_table("product_layers")
    op.drop_table("layers")
    op.drop_table("products")
    op.drop_table("users")
