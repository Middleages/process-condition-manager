from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class ColumnCategory(Base):
    __tablename__ = "column_categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    category_code: Mapped[str] = mapped_column(String(10), unique=True)  # SP, SC, OVL, DEV
    category_name: Mapped[str] = mapped_column(String(50))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    columns: Mapped[list["ColumnDefinition"]] = relationship(back_populates="category")


class ColumnDefinition(Base):
    __tablename__ = "column_definitions"

    id: Mapped[int] = mapped_column(primary_key=True)
    column_name: Mapped[str] = mapped_column(String(100), unique=True, index=True)  # JSONB 키명
    display_name: Mapped[str] = mapped_column(String(200))  # 프론트 표시명
    category_id: Mapped[int] = mapped_column(ForeignKey("column_categories.id"))
    data_type: Mapped[str] = mapped_column(String(20))  # integer / float / string / select
    select_options: Mapped[dict | None] = mapped_column(JSONB, nullable=True)  # select일 때 선택지
    unit: Mapped[str | None] = mapped_column(String(20), nullable=True)  # ℃, rpm, mJ 등
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_required: Mapped[bool] = mapped_column(Boolean, default=False)
    # 사용 여부 플래그: 미리 등록 후 테스트가 끝나면 True로 전환하여 사용자에게 노출
    use_yn: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    category: Mapped["ColumnCategory"] = relationship(back_populates="columns")
    validations: Mapped[list["ColumnValidation"]] = relationship(back_populates="column", cascade="all, delete-orphan")


class ColumnValidation(Base):
    __tablename__ = "column_validations"

    id: Mapped[int] = mapped_column(primary_key=True)
    column_id: Mapped[int] = mapped_column(ForeignKey("column_definitions.id", ondelete="CASCADE"))
    rule_type: Mapped[str] = mapped_column(String(30))  # range / required / conditional_required / cross_layer
    rule_config: Mapped[dict] = mapped_column(JSONB)  # {"min": 0, "max": 500} 등
    error_message: Mapped[str] = mapped_column(String(500))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    column: Mapped["ColumnDefinition"] = relationship(back_populates="validations")
