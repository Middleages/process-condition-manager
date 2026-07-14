"""파라미터 레지스트리 모델 (앱 DB 전용).

시스템의 축. code는 UNIQUE·불변, display_name은 가변. 하드 삭제 금지
(is_active 소프트 삭제만). cell/event는 code로 참조하므로 FK를 강제하지 않는다.
"""

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.domain.parameters.types import ValueType

if TYPE_CHECKING:
    from app.models.choice import ChoiceSet


class ParameterCategory(Base):
    """파라미터 카테고리 (관리자 설정, UI 탭/필터의 원천)."""

    __tablename__ = "parameter_category"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(128))
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="true"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    parameters: Mapped[list["Parameter"]] = relationship(back_populates="category")


class Parameter(Base):
    """전 process 공통 파라미터(컬럼) 정의."""

    __tablename__ = "parameter"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # code: 생성 후 불변. 셀 값·이벤트가 전부 이 값으로 파라미터를 참조한다.
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(128))
    description: Mapped[str | None] = mapped_column(String(512), nullable=True)
    value_type: Mapped[ValueType] = mapped_column(
        Enum(ValueType, native_enum=False, length=16)
    )
    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("parameter_category.id"), nullable=True, index=True
    )
    # Task 2 adds the reusable ChoiceSet seam additively. Task 3 validates the binding
    # rule and removes the legacy embedded ParameterOption relation in one cutover.
    choice_set_id: Mapped[int | None] = mapped_column(
        ForeignKey("choice_set.id"), nullable=True, index=True
    )
    # number 타입 부가 속성 (검증 엔진이 사용)
    unit: Mapped[str | None] = mapped_column(String(32), nullable=True)
    min_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="true"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    category: Mapped[ParameterCategory | None] = relationship(
        back_populates="parameters"
    )
    choice_set: Mapped["ChoiceSet | None"] = relationship()
    options: Mapped[list["ParameterOption"]] = relationship(
        back_populates="parameter",
        cascade="all, delete-orphan",
        order_by="ParameterOption.sort_order",
        lazy="selectin",  # async 안전 즉시 로딩 (직렬화 시 옵션 필요)
    )


class ParameterOption(Base):
    """choice 타입 파라미터의 선택지."""

    __tablename__ = "parameter_option"
    __table_args__ = (UniqueConstraint("parameter_id", "value"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    parameter_id: Mapped[int] = mapped_column(
        ForeignKey("parameter.id", ondelete="CASCADE"), index=True
    )
    value: Mapped[str] = mapped_column(String(128))
    display_name: Mapped[str] = mapped_column(String(128))
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="true"
    )

    parameter: Mapped[Parameter] = relationship(back_populates="options")
