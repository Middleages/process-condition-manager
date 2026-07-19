"""Phase 1 프로젝트/백본 모델."""

from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    literal_column,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.domain.workflow import ProjectStatus

# PostgreSQL에서는 JSONB(인덱싱/조회 우수), 그 외(SQLite 테스트)는 JSON으로 대체한다.
_JSON_PAYLOAD = JSON().with_variant(JSONB(), "postgresql")


class ChangeEventType(StrEnum):
    """기록하는 변경 이벤트 유형."""

    PROJECT_CREATE = "project_create"
    PROJECT_PROFILE_UPDATE = "project_profile_update"
    BACKBONE_COPY = "backbone_copy"
    BACKBONE_LAYER_REPLACE = "backbone_layer_replace"
    STATUS_CHANGE = "status_change"
    REVISION_CREATE = "revision_create"
    COMMENT = "comment"
    # 셀 단위 편집 (P2-T3). 구조화 컬럼(condition_id/parameter_code/old_value/
    # new_value)을 채우고 payload에는 batch_id/origin만 싣는다.
    CELL_UPDATE = "cell_update"
    # 조건 행 관리 + POR 선택 (P2-T7 / D-16). 조건 행 단위 이벤트라 셀 전용
    # 구조화 컬럼(condition_id 등)은 쓰지 않고, 백본 이벤트처럼 payload에 싣는다.
    # (condition_remove는 삭제 전 스냅샷을, por_change는 old/new POR을 남긴다.)
    CONDITION_ADD = "condition_add"
    CONDITION_REMOVE = "condition_remove"
    POR_CHANGE = "por_change"


class Project(Base):
    """Process 구조를 복사해 만든 조건표 프로젝트."""

    __tablename__ = "project"
    __table_args__ = (
        CheckConstraint("version >= 1", name="ck_project_version"),
        CheckConstraint(
            "(version = 1 AND revision_of_id IS NULL) OR "
            "(version > 1 AND revision_root_id IS NOT NULL AND "
            "revision_root_id <> id AND revision_of_id IS NOT NULL AND revision_of_id <> id)",
            name="ck_project_revision_lineage_shape",
        ),
        UniqueConstraint("revision_root_id", "version", name="uq_project_revision_root_version"),
        UniqueConstraint("revision_of_id", name="uq_project_direct_successor"),
        Index(
            "ix_project_active_line_process_part",
            "line_id",
            "process_id",
            "part_id",
            unique=True,
            sqlite_where=text("status != 'archived'"),
            postgresql_where=text("status != 'archived'"),
        ),
        Index("ix_project_revision_root_id", "revision_root_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    line_id: Mapped[str] = mapped_column(String(64), index=True)
    process_id: Mapped[str] = mapped_column(String(128), index=True)
    part_id: Mapped[str] = mapped_column(String(128), index=True)
    name: Mapped[str] = mapped_column(String(256))
    status: Mapped[ProjectStatus] = mapped_column(
        Enum(
            ProjectStatus,
            native_enum=False,
            length=32,
            values_callable=lambda enum_type: [item.value for item in enum_type],
        ),
        default=ProjectStatus.DRAFT,
        server_default=ProjectStatus.DRAFT.value,
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    revision_root_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("project.id", ondelete="SET NULL"), nullable=True
    )
    revision_of_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("project.id", ondelete="SET NULL"),
        nullable=True,
    )
    parameter_snapshot: Mapped[dict | None] = mapped_column(_JSON_PAYLOAD, nullable=True)
    review_basis_hash: Mapped[str | None] = mapped_column(String(71), nullable=True)
    review_rule_versions: Mapped[dict | None] = mapped_column(_JSON_PAYLOAD, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    layers: Mapped[list["SheetLayer"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        order_by="SheetLayer.sort_order",
    )
    profile: Mapped["ProjectProfile"] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        uselist=False,
        single_parent=True,
    )
    events: Mapped[list["ChangeEvent"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        order_by="ChangeEvent.id",
    )
    comments: Mapped[list["ReviewComment"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        order_by="ReviewComment.id",
    )


class ProjectProfile(Base):
    """Creation-time facts copied into and subsequently owned by one Project."""

    __tablename__ = "project_profile"

    project_id: Mapped[int] = mapped_column(
        ForeignKey("project.id", ondelete="CASCADE"), primary_key=True
    )
    process_name: Mapped[str] = mapped_column(Text)
    device_type_code: Mapped[str] = mapped_column(String(128))
    project_category_code: Mapped[str] = mapped_column(String(128))
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    active_direction_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    gate_direction_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    gross_die: Mapped[str | None] = mapped_column(Text, nullable=True)
    pitch_x: Mapped[str | None] = mapped_column(Text, nullable=True)
    pitch_y: Mapped[str | None] = mapped_column(Text, nullable=True)
    shot_x: Mapped[str | None] = mapped_column(Text, nullable=True)
    shot_y: Mapped[str | None] = mapped_column(Text, nullable=True)
    slit_occupancy: Mapped[str | None] = mapped_column(Text, nullable=True)
    lens_occupancy: Mapped[str | None] = mapped_column(Text, nullable=True)
    map_offset_x: Mapped[str | None] = mapped_column(Text, nullable=True)
    map_offset_y: Mapped[str | None] = mapped_column(Text, nullable=True)
    scribe_lane_x: Mapped[str | None] = mapped_column(Text, nullable=True)
    scribe_lane_y: Mapped[str | None] = mapped_column(Text, nullable=True)
    shot_count: Mapped[str | None] = mapped_column(Text, nullable=True)
    full_shot: Mapped[str | None] = mapped_column(Text, nullable=True)
    layer_total: Mapped[str | None] = mapped_column(Text, nullable=True)
    euv: Mapped[str | None] = mapped_column(Text, nullable=True)
    imm: Mapped[str | None] = mapped_column(Text, nullable=True)
    arf: Mapped[str | None] = mapped_column(Text, nullable=True)
    krf: Mapped[str | None] = mapped_column(Text, nullable=True)
    iline: Mapped[str | None] = mapped_column(Text, nullable=True)
    soh: Mapped[str | None] = mapped_column(Text, nullable=True)
    pspi: Mapped[str | None] = mapped_column(Text, nullable=True)
    metal_layer_count: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    project: Mapped[Project] = relationship(back_populates="profile")


class SheetLayer(Base):
    """프로젝트에 복사된 process layer 구조."""

    __tablename__ = "sheet_layer"
    __table_args__ = (UniqueConstraint("project_id", "layer_key", name="uq_sheet_layer_key"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("project.id", ondelete="CASCADE"), index=True
    )
    layer_key: Mapped[str] = mapped_column(String(256))
    step_seq: Mapped[str] = mapped_column(String(64), index=True)
    layer_id: Mapped[str] = mapped_column(String(64), index=True)
    eqp_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    eqp_type_desc: Mapped[str | None] = mapped_column(String(256), nullable=True)
    area_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    source_project_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_layer_key: Mapped[str | None] = mapped_column(String(256), nullable=True)
    backbone_snapshot: Mapped[dict | None] = mapped_column(
        _JSON_PAYLOAD,
        nullable=True,
    )

    project: Mapped[Project] = relationship(back_populates="layers")
    conditions: Mapped[list["LayerCondition"]] = relationship(
        back_populates="layer",
        cascade="all, delete-orphan",
        order_by="LayerCondition.condition_index",
    )


class LayerCondition(Base):
    """시트의 행: layer 안의 조건 행."""

    __tablename__ = "layer_condition"
    __table_args__ = (
        UniqueConstraint("layer_id", "condition_index", name="uq_condition_index"),
        Index(
            "uq_layer_condition_por",
            "layer_id",
            unique=True,
            postgresql_where=text("is_por"),
            sqlite_where=text("is_por = 1"),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    layer_id: Mapped[int] = mapped_column(
        ForeignKey("sheet_layer.id", ondelete="CASCADE"), index=True
    )
    label: Mapped[str] = mapped_column(String(128), default="base", server_default="base")
    condition_index: Mapped[int] = mapped_column(Integer)
    is_por: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    source_condition_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    layer: Mapped[SheetLayer] = relationship(back_populates="conditions")
    cell_values: Mapped[list["CellValue"]] = relationship(
        back_populates="condition",
        cascade="all, delete-orphan",
        order_by="CellValue.parameter_code",
    )


class CellValue(Base):
    """조건 행 × 파라미터 컬럼의 값."""

    __tablename__ = "cell_value"
    __table_args__ = (
        UniqueConstraint("condition_id", "parameter_code", name="uq_cell_condition_param"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    condition_id: Mapped[int] = mapped_column(
        ForeignKey("layer_condition.id", ondelete="CASCADE"), index=True
    )
    parameter_code: Mapped[str] = mapped_column(String(64), index=True)
    value_text: Mapped[str | None] = mapped_column(Text, nullable=True)

    condition: Mapped[LayerCondition] = relationship(back_populates="cell_values")


class ChangeEvent(Base):
    """Phase 1부터 쌓는 append-only 변경 이벤트."""

    __tablename__ = "change_event"
    __table_args__ = (
        Index(
            "ix_change_event_project_id_id_desc",
            "project_id",
            literal_column("id").desc(),
        ),
        Index(
            "ix_change_event_project_type_id_desc",
            "project_id",
            "event_type",
            literal_column("id").desc(),
        ),
        Index(
            "ix_change_event_project_cell_id_desc",
            "project_id",
            "condition_id",
            "parameter_code",
            literal_column("id").desc(),
            postgresql_where=text("condition_id IS NOT NULL AND parameter_code IS NOT NULL"),
        ),
        Index(
            "ix_change_event_project_condition_id_desc",
            "project_id",
            "condition_id",
            literal_column("id").desc(),
            postgresql_where=text("condition_id IS NOT NULL"),
        ),
        Index(
            "ix_change_event_project_layer_id_desc",
            "project_id",
            "layer_key",
            literal_column("id").desc(),
            postgresql_where=text("layer_key IS NOT NULL"),
        ),
        Index(
            "ix_change_event_project_actor_id_desc",
            "project_id",
            "actor",
            literal_column("id").desc(),
        ),
        Index(
            "ix_change_event_project_origin_id_desc",
            "project_id",
            "origin",
            literal_column("id").desc(),
            postgresql_where=text("origin IS NOT NULL"),
        ),
        Index(
            "ix_change_event_project_source_id_desc",
            "project_id",
            "source_project_id",
            literal_column("id").desc(),
            postgresql_where=text("source_project_id IS NOT NULL"),
        ),
        Index(
            "ix_change_event_project_created_id_desc",
            "project_id",
            literal_column("created_at").desc(),
            literal_column("id").desc(),
        ),
        Index(
            "ix_change_event_project_batch_id_desc",
            "project_id",
            "batch_id",
            literal_column("id").desc(),
            postgresql_where=text("batch_id IS NOT NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("project.id", ondelete="CASCADE"))
    event_type: Mapped[ChangeEventType] = mapped_column(
        Enum(ChangeEventType, native_enum=False, length=64)
    )
    actor: Mapped[str] = mapped_column(String(128), default="system", server_default="system")
    payload: Mapped[dict] = mapped_column(_JSON_PAYLOAD, default=dict)
    # 셀 단위 이벤트 전용 구조화 컬럼 (P2-D7). 벌크 이벤트는 기존처럼 payload를 쓴다.
    # condition_id는 FK가 아니다 — 삭제된 조건 행의 이벤트도 남아야 하므로
    # (cell_value.parameter_code가 FK가 아닌 것과 같은 이유).
    condition_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    parameter_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    old_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    new_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    layer_key: Mapped[str | None] = mapped_column(String(256), nullable=True)
    batch_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    origin: Mapped[str | None] = mapped_column(String(32), nullable=True)
    source_project_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_layer_key: Mapped[str | None] = mapped_column(String(256), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    project: Mapped[Project] = relationship(back_populates="events")


class EditLock(Base):
    """프로젝트 편집 잠금 (P2-D6 / D-09).

    프로젝트당 1개 — project_id가 PK. 소유는 사용자 + lock_token으로 식별한다.
    lock_token은 획득 시 서버가 발급하는 불투명 토큰으로, 같은 계정의 다른 탭도
    한쪽만 편집하도록 구분하고, TTL 만료 후 탈취된 잠금에 옛 탭이 뒤늦게 저장하는
    사고를 막는다. locked_at/expires_at은 항상 UTC로 저장/비교한다
    (app.core.locks 시간 헬퍼 참고 — SQLite는 naive, PG는 aware 반환).
    """

    __tablename__ = "edit_lock"

    project_id: Mapped[int] = mapped_column(
        ForeignKey("project.id", ondelete="CASCADE"), primary_key=True
    )
    locked_by: Mapped[str] = mapped_column(String(128))
    lock_token: Mapped[str] = mapped_column(String(64))
    locked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ReviewComment(Base):
    """프로젝트/셀 코멘트(소프트 삭제 포함)."""

    __tablename__ = "review_comment"
    __table_args__ = (
        CheckConstraint(
            "(condition_id IS NULL AND layer_key IS NULL AND parameter_code IS NULL) "
            "OR (condition_id IS NOT NULL AND layer_key IS NOT NULL AND "
            "parameter_code IS NOT NULL)",
            name="ck_review_comment_target_xor",
        ),
        Index("ix_review_comment_project_id_id_desc", "project_id", literal_column("id").desc()),
        Index(
            "ix_review_comment_project_condition_id_desc",
            "project_id",
            "condition_id",
            literal_column("id").desc(),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("project.id", ondelete="CASCADE"))
    condition_id: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )
    layer_key: Mapped[str | None] = mapped_column(String(256), nullable=True)
    parameter_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    author: Mapped[str] = mapped_column(String(128), nullable=False)
    resolved: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    resolved_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    deleted_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    project: Mapped[Project] = relationship(back_populates="comments")
