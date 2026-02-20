from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from fastapi import HTTPException

from app.models import (
    Project, ProjectLayer, ColumnDefinition,
    ColumnValidation, Layer,
)
from app.schemas.project import ValidationResponse, ValidationErrorItem
from app.services.cross_layer_validation_service import validate_cross_layer_rules


def _validate_range(
    value: Any,
    rule: ColumnValidation,
    col_name: str,
    col_by_name: dict[str, ColumnDefinition],
    layer: Layer,
    errors: list[ValidationErrorItem],
) -> None:
    """Check if numeric value falls within min/max range."""
    if value is None or (isinstance(value, str) and value.strip() == ""):
        return  # Don't double-report with required check

    config = rule.rule_config
    try:
        numeric_val = float(value)
    except (TypeError, ValueError):
        col_def = col_by_name[col_name]
        errors.append(ValidationErrorItem(
            layer_id=layer.id,
            layer_name=layer.layer_name,
            column_name=col_name,
            display_name=col_def.display_name,
            rule_type="range",
            message=f"{col_def.display_name}: 숫자 값이 아닙니다",
        ))
        return

    min_val = config.get("min")
    max_val = config.get("max")
    col_def = col_by_name[col_name]

    if min_val is not None and numeric_val < float(min_val):
        errors.append(ValidationErrorItem(
            layer_id=layer.id,
            layer_name=layer.layer_name,
            column_name=col_name,
            display_name=col_def.display_name,
            rule_type="range",
            message=rule.error_message,
        ))
    elif max_val is not None and numeric_val > float(max_val):
        errors.append(ValidationErrorItem(
            layer_id=layer.id,
            layer_name=layer.layer_name,
            column_name=col_name,
            display_name=col_def.display_name,
            rule_type="range",
            message=rule.error_message,
        ))


def _evaluate_condition(actual_value: Any, condition_value: str, operator: str) -> bool:
    """Evaluate a condition based on operator (equals, not_equals, contains)."""
    actual_str = str(actual_value) if actual_value is not None else ""
    if operator == "not_equals":
        return actual_str != str(condition_value)
    elif operator == "contains":
        return str(condition_value).lower() in actual_str.lower()
    else:  # equals (default)
        return actual_str == str(condition_value)


def _validate_conditional_required(
    value: Any,
    rule: ColumnValidation,
    col_name: str,
    conditions: dict,
    col_by_name: dict[str, ColumnDefinition],
    layer: Layer,
    errors: list[ValidationErrorItem],
) -> None:
    """Check conditional required: if condition_column matches condition_value via operator, target must be non-empty."""
    config = rule.rule_config
    cond_col = config["condition_column"]
    cond_val = config["condition_value"]
    operator = config.get("operator", "equals")

    actual_cond_val = conditions.get(cond_col)

    # Check if condition is met
    if _evaluate_condition(actual_cond_val, cond_val, operator):
        if value is None or (isinstance(value, str) and value.strip() == ""):
            col_def = col_by_name.get(col_name)
            if col_def:
                errors.append(ValidationErrorItem(
                    layer_id=layer.id,
                    layer_name=layer.layer_name,
                    column_name=col_name,
                    display_name=col_def.display_name,
                    rule_type="conditional_required",
                    message=rule.error_message,
                ))


async def validate_project(
    db: AsyncSession,
    project_id: int,
) -> ValidationResponse:
    """Run all validation rules against all project_layers."""

    # 1. Load project with layers
    result = await db.execute(
        select(Project)
        .options(
            selectinload(Project.layers).selectinload(ProjectLayer.layer),
        )
        .where(Project.id == project_id)
    )
    project = result.scalars().first()
    if not project:
        raise HTTPException(404, "Project not found")

    # 2. Load all column definitions with active validations
    result = await db.execute(
        select(ColumnDefinition)
        .options(selectinload(ColumnDefinition.validations))
    )
    all_columns = result.scalars().unique().all()

    # Build lookups
    col_by_name: dict[str, ColumnDefinition] = {c.column_name: c for c in all_columns}
    required_columns: list[str] = [c.column_name for c in all_columns if c.is_required]
    validation_rules: dict[str, list[ColumnValidation]] = {}
    for col in all_columns:
        active_rules = [v for v in col.validations if v.is_active]
        if active_rules:
            validation_rules[col.column_name] = active_rules

    # 3. Validate each project_layer
    errors: list[ValidationErrorItem] = []

    for project_layer in project.layers:
        conditions = project_layer.conditions or {}
        layer = project_layer.layer

        # Required field checks
        for col_name in required_columns:
            value = conditions.get(col_name)
            if value is None or (isinstance(value, str) and value.strip() == ""):
                col_def = col_by_name[col_name]
                errors.append(ValidationErrorItem(
                    layer_id=layer.id,
                    layer_name=layer.layer_name,
                    column_name=col_name,
                    display_name=col_def.display_name,
                    rule_type="required",
                    message=f"{col_def.display_name}은(는) 필수 항목입니다",
                ))

        # Per-column validation rules
        for col_name, rules in validation_rules.items():
            value = conditions.get(col_name)
            for rule in rules:
                if rule.rule_type == "range":
                    _validate_range(value, rule, col_name, col_by_name, layer, errors)
                elif rule.rule_type == "conditional_required":
                    _validate_conditional_required(
                        value, rule, col_name, conditions, col_by_name, layer, errors,
                    )

    # 4. 크로스 레이어 검증 (레이어 루프 완료 후 실행)
    await validate_cross_layer_rules(db, project.layers, errors)

    return ValidationResponse(
        project_id=project_id,
        is_valid=len(errors) == 0,
        error_count=len(errors),
        errors=errors,
    )
