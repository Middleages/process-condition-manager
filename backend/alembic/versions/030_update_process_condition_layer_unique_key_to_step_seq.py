"""Change process_condition_layers unique key from layer_id to step_seq.

Revision ID: 030_update_process_condition_layer_unique_key_to_step_seq
Revises: 029_rename_project_tables_to_process_condition
Create Date: 2026-04-18
"""

from alembic import op
import sqlalchemy as sa

revision = "030_update_process_condition_layer_unique_key_to_step_seq"
down_revision = "029_rename_project_tables_to_process_condition"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop any existing UNIQUE(project_id, layer_id) constraint regardless of generated name.
    op.execute(
        sa.text(
            """
            DO $$
            DECLARE
                constraint_name text;
            BEGIN
                SELECT c.conname
                INTO constraint_name
                FROM pg_constraint c
                JOIN pg_class t ON t.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = t.relnamespace
                JOIN unnest(c.conkey) WITH ORDINALITY AS cols(attnum, ord) ON TRUE
                JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = cols.attnum
                WHERE n.nspname = current_schema()
                  AND t.relname = 'process_condition_layers'
                  AND c.contype = 'u'
                GROUP BY c.conname
                HAVING array_agg(a.attname ORDER BY cols.ord) = ARRAY['project_id', 'layer_id'];

                IF constraint_name IS NOT NULL THEN
                    EXECUTE format(
                        'ALTER TABLE process_condition_layers DROP CONSTRAINT %I',
                        constraint_name
                    );
                END IF;
            END;
            $$;
            """
        )
    )

    op.create_unique_constraint(
        "uq_process_condition_layers_project_step_seq",
        "process_condition_layers",
        ["project_id", "step_seq"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_process_condition_layers_project_step_seq",
        "process_condition_layers",
        type_="unique",
    )
    op.create_unique_constraint(
        "uq_process_condition_layers_project_layer_id",
        "process_condition_layers",
        ["project_id", "layer_id"],
    )
