"""Persisted typed relation rules for the validation definition basis."""

from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    Index,
    Integer,
    String,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.domain.validation.types import ValidationSeverity

_JSON_STORAGE = JSON().with_variant(JSONB(), "postgresql")


class ValidationRule(Base):
    """Immutable-code, soft-deletable relation-rule definition."""

    __tablename__ = "validation_rule"
    __table_args__ = (
        CheckConstraint(
            "length(code) > 0 AND code = lower(code)",
            name="ck_validation_rule_code_format",
        ),
        CheckConstraint("length(trim(name)) > 0", name="ck_validation_rule_name_nonblank"),
        CheckConstraint(
            "description IS NULL OR length(trim(description)) > 0",
            name="ck_validation_rule_description_nonblank",
        ),
        CheckConstraint(
            "severity IN ('error', 'warning')",
            name="ck_validation_rule_severity",
        ),
        CheckConstraint("version >= 1", name="ck_validation_rule_version"),
        Index("ix_validation_rule_active_code", "is_active", "code"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(128))
    description: Mapped[str | None] = mapped_column(String(512), nullable=True)
    severity: Mapped[ValidationSeverity] = mapped_column(
        Enum(
            ValidationSeverity,
            native_enum=False,
            length=16,
            values_callable=lambda members: [member.value for member in members],
        )
    )
    scope: Mapped[dict[str, Any]] = mapped_column(
        _JSON_STORAGE,
        default=dict,
        server_default="{}",
    )
    spec: Mapped[dict[str, Any]] = mapped_column(_JSON_STORAGE)
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        server_default="true",
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
