"""Persistence and row-locking for typed validation rules."""

from collections.abc import Collection

from pydantic import TypeAdapter, ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.domain.errors import RuleViolationError
from app.features.validation.schema import (
    PriorPorSpecIn,
    RequiredIfSpecIn,
    ValidationRuleSpecIn,
)
from app.models.choice import ChoiceSet
from app.models.parameter import Parameter
from app.models.validation import ValidationRule

_SPEC_ADAPTER = TypeAdapter(ValidationRuleSpecIn)


class ValidationRuleRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def add(self, rule: ValidationRule) -> ValidationRule:
        self.session.add(rule)
        await self.session.flush()
        return rule

    async def flush(self) -> None:
        await self.session.flush()

    async def get_by_code(self, code: str) -> ValidationRule | None:
        stmt = select(ValidationRule).where(ValidationRule.code == code)
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def get_for_update(self, code: str) -> ValidationRule | None:
        stmt = (
            select(ValidationRule)
            .where(ValidationRule.code == code)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def list_rules(self, *, include_inactive: bool = False) -> list[ValidationRule]:
        stmt = select(ValidationRule).order_by(ValidationRule.code)
        if not include_inactive:
            stmt = stmt.where(ValidationRule.is_active.is_(True))
        return list((await self.session.execute(stmt)).scalars())

    async def lock_parameters(self, codes: Collection[str]) -> dict[str, Parameter]:
        unique_codes = set(codes)
        if not unique_codes:
            return {}
        stmt = (
            select(Parameter)
            .options(selectinload(Parameter.choice_set).selectinload(ChoiceSet.options))
            .where(Parameter.code.in_(unique_codes))
            .order_by(Parameter.code)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        rows = list((await self.session.execute(stmt)).scalars())
        return {row.code: row for row in rows}

    async def active_rule_references_parameter(self, parameter_code: str) -> bool:
        """Fence deactivation; corrupt active specs fail closed rather than disappear."""
        stmt = select(ValidationRule.spec).where(ValidationRule.is_active.is_(True))
        for raw_spec in (await self.session.execute(stmt)).scalars():
            try:
                spec = _SPEC_ADAPTER.validate_python(raw_spec)
            except (ValidationError, TypeError) as exc:
                raise RuleViolationError(
                    "활성 검증 규칙 구성이 올바르지 않다",
                    code="validation_configuration_invalid",
                ) from exc
            if isinstance(spec, RequiredIfSpecIn) and parameter_code in {
                spec.when_parameter_code,
                spec.required_parameter_code,
            }:
                return True
            if isinstance(spec, PriorPorSpecIn) and parameter_code in {
                spec.source_parameter_code,
                spec.candidate_parameter_code,
            }:
                return True
        return False
