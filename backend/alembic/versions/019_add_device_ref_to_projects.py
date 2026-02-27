"""projects/project_layers 테이블에 디바이스 참조 컬럼 추가 + device_master 유니크 제약 확장.

SPEC-PROJECT-002 M1:
- projects: device_master_id FK, process, device_type, header_metadata,
  line_id FK, product_name, part_id 추가. product_id/main_backbone_id nullable 전환.
- project_layers: layer_id INT->VARCHAR(10) 타입 변경, layer_name/step_seq 비정규화 추가.
- device_master: uq 제약 (line_id, product_name) -> (line_id, product_name, process, part_id).

Revision ID: 019_add_device_ref_to_projects
Revises: 018_create_device_layer_master_tables
Create Date: 2026-02-27
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "019_add_device_ref_to_projects"
down_revision = "018_create_device_layer_master_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ==================================================================
    # Part 1: projects table changes
    # ==================================================================

    # 1-1. Add new columns
    op.add_column(
        "projects",
        sa.Column(
            "device_master_id",
            sa.Integer(),
            sa.ForeignKey("device_master.id"),
            nullable=True,
        ),
    )
    op.add_column(
        "projects",
        sa.Column("process", sa.String(50), nullable=True),
    )
    op.add_column(
        "projects",
        sa.Column(
            "device_type",
            sa.String(20),
            nullable=False,
            server_default=sa.text("'full'"),
        ),
    )
    op.add_column(
        "projects",
        sa.Column("header_metadata", JSONB, nullable=True),
    )
    op.add_column(
        "projects",
        sa.Column(
            "line_id",
            sa.Integer(),
            sa.ForeignKey("lines.id"),
            nullable=True,
        ),
    )
    op.add_column(
        "projects",
        sa.Column("product_name", sa.String(100), nullable=True),
    )
    op.add_column(
        "projects",
        sa.Column("part_id", sa.String(100), nullable=True),
    )

    # 1-2. Alter product_id and main_backbone_id to NULLABLE
    op.alter_column(
        "projects",
        "product_id",
        existing_type=sa.Integer(),
        nullable=True,
    )
    op.alter_column(
        "projects",
        "main_backbone_id",
        existing_type=sa.Integer(),
        nullable=True,
    )

    # 1-3. Backfill line_id, product_name, part_id from products table
    op.execute(
        sa.text(
            "UPDATE projects SET "
            "  line_id = p.line_id, "
            "  product_name = p.product_name, "
            "  part_id = p.part_id "
            "FROM products p "
            "WHERE projects.product_id = p.id"
        )
    )

    # 1-4. Create partial unique index for device reference
    op.create_index(
        "ix_projects_device_ref_active",
        "projects",
        ["line_id", "product_name", "process", "part_id", "revision"],
        unique=True,
        postgresql_where=sa.text("is_latest = true"),
    )

    # ==================================================================
    # Part 2: project_layers table changes (layer_id INT -> VARCHAR)
    # ==================================================================

    # 2-1. Add denormalized columns
    op.add_column(
        "project_layers",
        sa.Column("layer_name", sa.String(100), nullable=True),
    )
    op.add_column(
        "project_layers",
        sa.Column("step_seq", sa.String(20), nullable=True),
    )

    # 2-2. Backfill layer_name and step_seq from layers table BEFORE dropping FK
    op.execute(
        sa.text(
            "UPDATE project_layers SET "
            "  layer_name = l.layer_name, "
            "  step_seq = l.step_seq "
            "FROM layers l "
            "WHERE project_layers.layer_id = l.id"
        )
    )

    # 2-3. Use temp column pattern for INT -> VARCHAR(10) conversion
    op.execute(
        sa.text("ALTER TABLE project_layers ADD COLUMN layer_id_new VARCHAR(10)")
    )
    op.execute(
        sa.text(
            "UPDATE project_layers SET layer_id_new = l.layer_number "
            "FROM layers l WHERE project_layers.layer_id = l.id"
        )
    )

    # 2-4. Drop old FK and unique constraints
    op.execute(
        sa.text(
            "ALTER TABLE project_layers "
            "DROP CONSTRAINT IF EXISTS project_layers_layer_id_fkey"
        )
    )
    op.execute(
        sa.text(
            "ALTER TABLE project_layers "
            "DROP CONSTRAINT IF EXISTS project_layers_project_id_layer_id_key"
        )
    )

    # 2-5. Swap columns
    op.execute(
        sa.text("ALTER TABLE project_layers DROP COLUMN layer_id")
    )
    op.execute(
        sa.text("ALTER TABLE project_layers RENAME COLUMN layer_id_new TO layer_id")
    )
    op.execute(
        sa.text("ALTER TABLE project_layers ALTER COLUMN layer_id SET NOT NULL")
    )

    # 2-6. Re-create unique constraint
    op.execute(
        sa.text(
            "ALTER TABLE project_layers "
            "ADD CONSTRAINT project_layers_project_id_layer_id_key "
            "UNIQUE (project_id, layer_id)"
        )
    )

    # ==================================================================
    # Part 3: device_master unique constraint change
    # ==================================================================

    # 3-1. Drop old 2-field unique constraint
    op.drop_constraint(
        "uq_device_master_line_product",
        "device_master",
        type_="unique",
    )

    # 3-2. Create new 4-field unique constraint
    op.create_unique_constraint(
        "uq_device_master_line_product_process_part",
        "device_master",
        ["line_id", "product_name", "process", "part_id"],
    )


def downgrade() -> None:
    # ==================================================================
    # Part 3 reverse: device_master constraint
    # ==================================================================
    op.drop_constraint(
        "uq_device_master_line_product_process_part",
        "device_master",
        type_="unique",
    )
    op.create_unique_constraint(
        "uq_device_master_line_product",
        "device_master",
        ["line_id", "product_name"],
    )

    # ==================================================================
    # Part 2 reverse: project_layers layer_id VARCHAR -> INT
    #
    # NOTE: This reversal requires the original layers table to contain
    # the same layer_number -> id mapping. If layers were modified after
    # the upgrade, manual intervention is required.
    # ==================================================================

    # 2-1. Drop the unique constraint on (project_id, layer_id)
    op.execute(
        sa.text(
            "ALTER TABLE project_layers "
            "DROP CONSTRAINT IF EXISTS project_layers_project_id_layer_id_key"
        )
    )

    # 2-2. Create temp column and reverse map VARCHAR -> INT via layers table
    op.execute(
        sa.text("ALTER TABLE project_layers ADD COLUMN layer_id_old INTEGER")
    )
    op.execute(
        sa.text(
            "UPDATE project_layers SET layer_id_old = l.id "
            "FROM layers l WHERE project_layers.layer_id = l.layer_number"
        )
    )

    # 2-3. Swap columns
    op.execute(
        sa.text("ALTER TABLE project_layers DROP COLUMN layer_id")
    )
    op.execute(
        sa.text("ALTER TABLE project_layers RENAME COLUMN layer_id_old TO layer_id")
    )
    op.execute(
        sa.text("ALTER TABLE project_layers ALTER COLUMN layer_id SET NOT NULL")
    )

    # 2-4. Re-create FK and unique constraint
    op.execute(
        sa.text(
            "ALTER TABLE project_layers "
            "ADD CONSTRAINT project_layers_layer_id_fkey "
            "FOREIGN KEY (layer_id) REFERENCES layers(id)"
        )
    )
    op.execute(
        sa.text(
            "ALTER TABLE project_layers "
            "ADD CONSTRAINT project_layers_project_id_layer_id_key "
            "UNIQUE (project_id, layer_id)"
        )
    )

    # 2-5. Drop denormalized columns
    op.drop_column("project_layers", "step_seq")
    op.drop_column("project_layers", "layer_name")

    # ==================================================================
    # Part 1 reverse: projects table
    # ==================================================================

    # 1-1. Drop partial unique index
    op.drop_index("ix_projects_device_ref_active", table_name="projects")

    # 1-2. Restore product_id and main_backbone_id to NOT NULL
    #       (backfill NULLs with a safe default if any exist)
    op.execute(
        sa.text(
            "UPDATE projects SET product_id = 1 WHERE product_id IS NULL"
        )
    )
    op.execute(
        sa.text(
            "UPDATE projects SET main_backbone_id = 1 WHERE main_backbone_id IS NULL"
        )
    )
    op.alter_column(
        "projects",
        "product_id",
        existing_type=sa.Integer(),
        nullable=False,
    )
    op.alter_column(
        "projects",
        "main_backbone_id",
        existing_type=sa.Integer(),
        nullable=False,
    )

    # 1-3. Drop new columns (reverse order)
    op.drop_column("projects", "part_id")
    op.drop_column("projects", "product_name")
    op.drop_column("projects", "line_id")
    op.drop_column("projects", "header_metadata")
    op.drop_column("projects", "device_type")
    op.drop_column("projects", "process")
    op.drop_column("projects", "device_master_id")
