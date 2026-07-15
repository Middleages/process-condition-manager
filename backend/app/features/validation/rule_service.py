"""Canonical validation-rule writes and defensive persisted-JSON loading."""

from typing import Any, NoReturn

from pydantic import TypeAdapter, ValidationError
from sqlalchemy.exc import IntegrityError

from app.core.errors import ConflictError, NotFoundError
from app.domain.decimal_values import normalize_decimal
from app.domain.errors import RuleViolationError
from app.domain.parameters.types import ValueType
from app.domain.validation.types import ValidationScope, ValidationSeverity
from app.features.validation.repository import ValidationRuleRepository
from app.features.validation.schema import (
    PriorPorSpecIn,
    RequiredIfSpecIn,
    ValidationRuleCreateIn,
    ValidationRuleOut,
    ValidationRulePatchIn,
    ValidationRuleSpecIn,
    ValidationScopeIn,
)
from app.models.parameter import Parameter
from app.models.validation import ValidationRule

_SPEC_ADAPTER = TypeAdapter(ValidationRuleSpecIn)


def _configuration_invalid(message: str) -> NoReturn:
    raise RuleViolationError(message, code="validation_configuration_invalid")


class ValidationRuleService:
    def __init__(self, repo: ValidationRuleRepository) -> None:
        self.repo = repo

    async def create_rule(self, data: ValidationRuleCreateIn) -> ValidationRuleOut:
        if await self.repo.get_by_code(data.code) is not None:
            raise _rule_exists(data.code)
        spec = await self._canonical_spec(data.spec)
        rule = ValidationRule(
            code=data.code,
            name=data.name,
            description=data.description,
            severity=data.severity,
            scope=_canonical_scope(data.scope),
            spec=spec,
            is_active=data.is_active,
        )
        try:
            await self.repo.add(rule)
        except IntegrityError as exc:
            await self.repo.session.rollback()
            raise _rule_exists(data.code) from exc
        return self._out(rule)

    async def list_rules(self, *, include_inactive: bool = False) -> list[ValidationRuleOut]:
        return [
            self._out(rule)
            for rule in await self.repo.list_rules(include_inactive=include_inactive)
        ]

    async def get_rule(self, code: str) -> ValidationRuleOut:
        rule = await self.repo.get_by_code(code)
        if rule is None:
            raise NotFoundError(f"검증 규칙을 찾을 수 없다: {code}")
        return self._out(rule)

    async def patch_rule(self, code: str, data: ValidationRulePatchIn) -> ValidationRuleOut:
        rule = await self.repo.get_for_update(code)
        if rule is None:
            raise NotFoundError(f"검증 규칙을 찾을 수 없다: {code}")
        if rule.version != data.expected_version:
            raise ConflictError(
                "검증 규칙이 다른 관리자에 의해 변경되었습니다.",
                code="validation_rule_changed",
                details={
                    "rule_code": rule.code,
                    "expected_version": data.expected_version,
                    "actual_version": rule.version,
                },
            )

        current = self._canonical_content(rule)
        fields = data.model_fields_set
        _reject_null_patch_fields(data)
        next_scope = (
            _canonical_scope(data.scope)
            if "scope" in fields and data.scope is not None
            else current["scope"]
        )
        next_is_active = data.is_active if "is_active" in fields else current["is_active"]
        next_spec = current["spec"]
        if "spec" in fields or next_is_active:
            final_spec = (
                data.spec
                if "spec" in fields and data.spec is not None
                else _SPEC_ADAPTER.validate_python(current["spec"])
            )
            next_spec = await self._canonical_spec(final_spec)
        next_content: dict[str, Any] = {
            "name": data.name if "name" in fields else current["name"],
            "description": (
                data.description if "description" in fields else current["description"]
            ),
            "severity": (
                data.severity.value
                if "severity" in fields and data.severity is not None
                else current["severity"]
            ),
            "scope": next_scope,
            "spec": next_spec,
            "is_active": next_is_active,
        }
        if next_content == current:
            return self._out(rule)

        rule.name = next_content["name"]
        rule.description = next_content["description"]
        rule.severity = ValidationSeverity(next_content["severity"])
        rule.scope = next_content["scope"]
        rule.spec = next_content["spec"]
        rule.is_active = next_content["is_active"]
        rule.version += 1
        await self.repo.flush()
        await self.repo.session.refresh(rule)
        return self._out(rule)

    async def _canonical_spec(self, spec: ValidationRuleSpecIn) -> dict[str, object]:
        if isinstance(spec, RequiredIfSpecIn):
            codes = {spec.when_parameter_code, spec.required_parameter_code}
        else:
            codes = {spec.source_parameter_code, spec.candidate_parameter_code}
        parameters = await self.repo.lock_parameters(codes)
        missing = sorted(codes - set(parameters))
        if missing:
            raise RuleViolationError(
                f"존재하지 않는 파라미터를 참조한다: {', '.join(missing)}",
                code="validation_rule_parameter_missing",
            )
        inactive = sorted(code for code in codes if not parameters[code].is_active)
        if inactive:
            raise RuleViolationError(
                f"비활성 파라미터를 참조한다: {', '.join(inactive)}",
                code="validation_rule_parameter_inactive",
            )
        if isinstance(spec, RequiredIfSpecIn):
            return _canonical_required_if(spec, parameters[spec.when_parameter_code])
        return _canonical_prior_por(spec, parameters)

    def _canonical_content(self, rule: ValidationRule) -> dict[str, Any]:
        output = self._out(rule)
        return {
            "name": output.name,
            "description": output.description,
            "severity": output.severity.value,
            "scope": output.scope,
            "spec": output.spec.model_dump(mode="json"),
            "is_active": output.is_active,
        }

    @staticmethod
    def _out(rule: ValidationRule) -> ValidationRuleOut:
        try:
            scope = ValidationScopeIn.model_validate(rule.scope)
            spec = _SPEC_ADAPTER.validate_python(rule.spec)
            return ValidationRuleOut(
                code=rule.code,
                name=rule.name,
                description=rule.description,
                severity=rule.severity,
                scope=_canonical_scope(scope),
                spec=spec,
                version=rule.version,
                is_active=rule.is_active,
                created_at=rule.created_at,
                updated_at=rule.updated_at,
            )
        except (ValidationError, TypeError, ValueError):
            _configuration_invalid(f"검증 규칙 구성이 올바르지 않다: {rule.code}")


def _canonical_scope(scope: ValidationScopeIn) -> dict[str, object]:
    layers = scope.layers
    domain_scope = ValidationScope(
        line_ids=tuple(sorted(scope.line_ids or ())),
        process_ids=tuple(sorted(scope.process_ids or ())),
        layer_ids=tuple(sorted(layers.layer_ids or ())) if layers is not None else (),
        step_seqs=tuple(sorted(layers.step_seqs or ())) if layers is not None else (),
        eqp_types=tuple(sorted(layers.eqp_types or ())) if layers is not None else (),
        area_names=tuple(sorted(layers.area_names or ())) if layers is not None else (),
    )
    result: dict[str, object] = {}
    if domain_scope.line_ids:
        result["line_ids"] = list(domain_scope.line_ids)
    if domain_scope.process_ids:
        result["process_ids"] = list(domain_scope.process_ids)
    layer_filters: dict[str, list[str]] = {}
    for field in ("layer_ids", "step_seqs", "eqp_types", "area_names"):
        values = getattr(domain_scope, field)
        if values:
            layer_filters[field] = list(values)
    if layer_filters:
        result["layers"] = layer_filters
    return result


def _canonical_required_if(spec: RequiredIfSpecIn, when: Parameter) -> dict[str, object]:
    equals = spec.equals
    if when.value_type is ValueType.NUMBER:
        equals = normalize_decimal(equals)
    elif when.value_type is ValueType.CHOICE:
        if when.choice_set is None or equals not in {
            option.code for option in when.choice_set.options
        }:
            raise RuleViolationError(
                "required_if 리터럴이 알려진 선택지 code가 아니다",
                code="validation_rule_choice_literal_unknown",
            )
    return {
        "schema_version": 1,
        "type": "required_if",
        "when_parameter_code": spec.when_parameter_code,
        "equals": equals,
        "required_parameter_code": spec.required_parameter_code,
    }


def _canonical_prior_por(
    spec: PriorPorSpecIn, parameters: dict[str, Parameter]
) -> dict[str, object]:
    source = parameters[spec.source_parameter_code]
    candidate = parameters[spec.candidate_parameter_code]
    if source.value_type is not candidate.value_type:
        raise RuleViolationError(
            "prior-POR 파라미터의 값 타입이 다르다",
            code="validation_rule_parameter_type_mismatch",
        )
    if source.value_type is ValueType.CHOICE and source.choice_set_id != candidate.choice_set_id:
        raise RuleViolationError(
            "prior-POR choice 파라미터의 ChoiceSet이 다르다",
            code="validation_rule_choice_set_mismatch",
        )
    return {
        "schema_version": 1,
        "type": "value_exists_in_prior_por",
        "source_parameter_code": spec.source_parameter_code,
        "candidate_parameter_code": spec.candidate_parameter_code,
    }


def _reject_null_patch_fields(data: ValidationRulePatchIn) -> None:
    for field in ("name", "severity", "scope", "spec", "is_active"):
        if field in data.model_fields_set and getattr(data, field) is None:
            raise RuleViolationError(
                f"{field}는 null일 수 없다",
                code="validation_rule_field_not_nullable",
            )


def _rule_exists(code: str) -> ConflictError:
    return ConflictError(
        f"이미 존재하는 검증 규칙 code: {code}",
        code="validation_rule_exists",
        details={"rule_code": code},
    )
