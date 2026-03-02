"""투표 방식 변경: 라인별 reviewer + 관리자 그룹 투표.

line_id를 nullable로 변경하고, 관리자 투표 슬롯(line_id=NULL) 지원을 위해
기존 UniqueConstraint를 부분 인덱스(partial unique index)로 교체한다.
기존 pending 상태 요청에 관리자 투표 레코드를 자동 추가한다.

Revision ID: 022_change_vote_to_role_based
Revises: 021_add_config_change_consensus
Create Date: 2026-03-02
"""

import sqlalchemy as sa
from alembic import op

revision = "022_change_vote_to_role_based"
down_revision = "021_add_config_change_consensus"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. 기존 unique constraint 제거
    op.drop_constraint(
        "uq_config_change_vote_request_line",
        "config_change_votes",
        type_="unique",
    )

    # 2. line_id를 nullable로 변경
    op.alter_column(
        "config_change_votes",
        "line_id",
        existing_type=sa.Integer(),
        nullable=True,
    )

    # 3. 부분 유니크 인덱스 생성
    # 라인 투표: (request_id, line_id) WHERE line_id IS NOT NULL
    op.create_index(
        "uq_vote_request_line",
        "config_change_votes",
        ["request_id", "line_id"],
        unique=True,
        postgresql_where=sa.text("line_id IS NOT NULL"),
    )
    # 관리자 투표: request_id당 1개 WHERE line_id IS NULL
    op.create_index(
        "uq_vote_request_admin",
        "config_change_votes",
        ["request_id"],
        unique=True,
        postgresql_where=sa.text("line_id IS NULL"),
    )

    # 4. 기존 pending 요청에 관리자 투표 레코드 추가
    op.execute(
        sa.text("""
            INSERT INTO config_change_votes (request_id, line_id, vote, voted_by, reason, voted_at)
            SELECT id, NULL, NULL, NULL, NULL, NULL
            FROM config_change_requests
            WHERE status = 'pending'
            AND NOT EXISTS (
                SELECT 1 FROM config_change_votes
                WHERE config_change_votes.request_id = config_change_requests.id
                AND config_change_votes.line_id IS NULL
            )
        """)
    )


def downgrade() -> None:
    # 관리자 투표 레코드 삭제
    op.execute(
        sa.text(
            "DELETE FROM config_change_votes WHERE line_id IS NULL"
        )
    )

    # 부분 인덱스 제거
    op.drop_index("uq_vote_request_admin", table_name="config_change_votes")
    op.drop_index("uq_vote_request_line", table_name="config_change_votes")

    # line_id를 NOT NULL로 복원
    op.alter_column(
        "config_change_votes",
        "line_id",
        existing_type=sa.Integer(),
        nullable=False,
    )

    # 기존 unique constraint 복원
    op.create_unique_constraint(
        "uq_config_change_vote_request_line",
        "config_change_votes",
        ["request_id", "line_id"],
    )
