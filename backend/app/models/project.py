"""Phase 1 프로젝트/백본 모델."""

from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class ProjectStatus(StrEnum):
    """프로젝트 상태. Phase 1에서는 draft만 생성한다."""

    DRAFT = "draft"


class ChangeEventType(StrEnum):
    """Phase 1에서 기록하는 변경 이벤트 유형."""

    BACKBONE_COPY = "backbone_copy"
    BACKBONE_LAYER_REPLACE = "backbone_layer_replace"


class Project(Base):
    """Process 구조를 복사해 만든 조건표 프로젝트."""

    __tablename__ = "project"
    __table_args__ = (
        UniqueConstraint("line_id", "process_id", "part_id", name="uq_project_process_part"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    line_id: Mapped[str] = mapped_column(String(64), index=True)
    process_id: Mapped[str] = mapped_column(String(128), index=True)
    part_id: Mapped[str] = mapped_column(String(128), index=True)
    name: Mapped[str] = mapped_column(String(256))
    description: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    status: Mapped[ProjectStatus] = mapped_column(
        Enum(ProjectStatus, native_enum=False, length=32),
        default=ProjectStatus.DRAFT,
        server_default=ProjectStatus.DRAFT.value,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    layers: Mapped[list["SheetLayer"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        order_by="SheetLayer.sort_order",
        lazy="selectin",
    )


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

    project: Mapped[Project] = relationship(back_populates="layers")
    conditions: Mapped[list["LayerCondition"]] = relationship(
        back_populates="layer",
        cascade="all, delete-orphan",
        order_by="LayerCondition.condition_index",
        lazy="selectin",
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
    label: Mapped[str] = mapped_column(String(128), default="기본", server_default="기본")
    condition_index: Mapped[int] = mapped_column(Integer)
    is_por: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    source_condition_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    layer: Mapped[SheetLayer] = relationship(back_populates="conditions")
    cell_values: Mapped[list["CellValue"]] = relationship(
        back_populates="condition",
        cascade="all, delete-orphan",
        order_by="CellValue.parameter_code",
        lazy="selectin",
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

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("project.id", ondelete="CASCADE"), index=True
    )
    event_type: Mapped[ChangeEventType] = mapped_column(
        Enum(ChangeEventType, native_enum=False, length=64), index=True
    )
    actor: Mapped[str] = mapped_column(String(128), default="system", server_default="system")
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
