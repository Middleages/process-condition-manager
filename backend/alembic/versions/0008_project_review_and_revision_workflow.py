"""project review workflow and revision metadata

Revision ID: 0008
Revises: 0007

Phase 5 introduces workflow metadata columns on project plus review comments
with project-vs-cell target XOR validation and revision lineage constraints.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_JSON_PAYLOAD = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.add_column("project", sa.Column("version", sa.Integer(), nullable=False, server_default="1"))
    op.add_column(
        "project",
        sa.Column(
            "revision_root_id",
            sa.Integer(),
            sa.ForeignKey("project.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "project",
        sa.Column(
            "revision_of_id",
            sa.Integer(),
            sa.ForeignKey("project.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "project", sa.Column("parameter_snapshot", _JSON_PAYLOAD, nullable=True)
    )
    op.add_column("project", sa.Column("review_basis_hash", sa.String(length=71), nullable=True))
    op.add_column("project", sa.Column("review_rule_versions", _JSON_PAYLOAD, nullable=True))

    op.execute(sa.text("UPDATE project SET version = 1 WHERE version IS NULL"))
    op.alter_column("project", "version", existing_type=sa.Integer(), nullable=False)
    op.execute(
        sa.text("UPDATE project SET status = lower(status) WHERE status IS NOT NULL")
    )

    op.create_check_constraint(
        "ck_project_version",
        "project",
        sa.text("version >= 1"),
    )
    op.create_check_constraint(
        "ck_project_revision_lineage_shape",
        "project",
        sa.text(
            "(version = 1 AND revision_of_id IS NULL) OR "
            "(version > 1 AND revision_root_id IS NOT NULL AND "
            "revision_root_id <> id AND revision_of_id IS NOT NULL AND revision_of_id <> id)"
        ),
    )
    op.drop_constraint("uq_project_process_part", "project", type_="unique")
    op.execute(
        sa.text(
            """
            UPDATE project
            SET revision_root_id = id
            WHERE revision_root_id IS NULL
              AND version = 1
            """
        )
    )
    op.create_unique_constraint(
        "uq_project_revision_root_version",
        "project",
        ["revision_root_id", "version"],
    )
    op.create_unique_constraint(
        "uq_project_direct_successor",
        "project",
        ["revision_of_id"],
    )
    op.create_index(
        "ix_project_active_line_process_part",
        "project",
        ["line_id", "process_id", "part_id"],
        unique=True,
        postgresql_where=sa.text("status != 'archived'"),
        sqlite_where=sa.text("status != 'archived'"),
    )
    op.create_index("ix_project_revision_root_id", "project", ["revision_root_id"])

    op.create_table(
        "review_comment",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "project_id",
            sa.Integer(),
            sa.ForeignKey("project.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "condition_id",
            sa.Integer(),
            nullable=True,
        ),
        sa.Column("layer_key", sa.String(length=256), nullable=True),
        sa.Column("parameter_code", sa.String(length=64), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("author", sa.String(length=128), nullable=False),
        sa.Column("resolved", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("resolved_by", sa.String(length=128), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("deleted_by", sa.String(length=128), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
        ),
        sa.CheckConstraint(
            "(condition_id IS NULL AND layer_key IS NULL AND parameter_code IS NULL) OR "
            "(condition_id IS NOT NULL AND layer_key IS NOT NULL AND parameter_code IS NOT NULL)",
            name="ck_review_comment_target_xor",
        ),
    )
    op.create_index(
        "ix_review_comment_project_id_id_desc",
        "review_comment",
        ["project_id", sa.text("id DESC")],
    )
    op.create_index(
        "ix_review_comment_project_condition_id_desc",
        "review_comment",
        ["project_id", "condition_id", sa.text("id DESC")],
    )


def downgrade() -> None:
    op.drop_index("ix_review_comment_project_condition_id_desc", table_name="review_comment")
    op.drop_index("ix_review_comment_project_id_id_desc", table_name="review_comment")
    op.drop_table("review_comment")

    op.drop_index("ix_project_revision_root_id", table_name="project")
    op.drop_index("ix_project_active_line_process_part", table_name="project")
    op.drop_constraint("uq_project_direct_successor", "project", type_="unique")
    op.drop_constraint("uq_project_revision_root_version", "project", type_="unique")
    op.drop_constraint("ck_project_revision_lineage_shape", "project", type_="check")
    op.drop_constraint("ck_project_version", "project", type_="check")
    op.create_unique_constraint(
        "uq_project_process_part",
        "project",
        ["line_id", "process_id", "part_id"],
    )

    op.drop_column("project", "review_rule_versions")
    op.drop_column("project", "review_basis_hash")
    op.drop_column("project", "parameter_snapshot")
    op.drop_column("project", "revision_of_id")
    op.drop_column("project", "revision_root_id")
    op.drop_column("project", "version")
