"""Admin service for XML mapping and validation rule management."""

import json
from typing import BinaryIO
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from fastapi import HTTPException
from openpyxl import load_workbook

from app.models import (
    RecipeXmlMapping, ColumnDefinition, ColumnCategory, ColumnValidation
)
from app.schemas.admin import (
    RecipeMappingResponse, RecipeMappingCreate, RecipeMappingUpdate,
    ValidationRuleCreate, BulkUploadResponse,
)

# Constants
ALLOWED_VALUE_TRANSFORMS = ("to_int", "to_float", "yn_to_bool")
ALLOWED_RULE_TYPES = ("range", "required", "conditional_required", "cross_layer")


# ---------------------------------------------------------------------------
# Recipe XML Mapping Functions
# ---------------------------------------------------------------------------

async def _build_mapping_response(
    db: AsyncSession,
    mapping_id: int,
) -> RecipeMappingResponse:
    """Build a RecipeMappingResponse by loading the mapping with related data."""
    result = await db.execute(
        select(RecipeXmlMapping, ColumnDefinition, ColumnCategory)
        .join(ColumnDefinition, RecipeXmlMapping.column_id == ColumnDefinition.id)
        .join(ColumnCategory, ColumnDefinition.category_id == ColumnCategory.id)
        .where(RecipeXmlMapping.id == mapping_id)
    )
    mapping, col_def, category = result.one()

    return RecipeMappingResponse(
        id=mapping.id,
        xpath=mapping.xpath,
        column_id=mapping.column_id,
        column_name=col_def.column_name,
        display_name=col_def.display_name,
        category_code=category.category_code,
        data_type=col_def.data_type,
        value_transform=mapping.value_transform,
        is_active=mapping.is_active,
        created_at=mapping.created_at,
    )


async def list_mappings(
    db: AsyncSession,
    is_active: bool | None = None,
    search: str | None = None,
) -> list[RecipeMappingResponse]:
    """List recipe XML mappings with optional filters."""
    query = (
        select(RecipeXmlMapping, ColumnDefinition, ColumnCategory)
        .join(ColumnDefinition, RecipeXmlMapping.column_id == ColumnDefinition.id)
        .join(ColumnCategory, ColumnDefinition.category_id == ColumnCategory.id)
    )

    # Apply filters
    if is_active is not None:
        query = query.where(RecipeXmlMapping.is_active == is_active)

    if search:
        # Search in xpath, column_name, or display_name
        search_pattern = f"%{search}%"
        query = query.where(
            (RecipeXmlMapping.xpath.ilike(search_pattern))
            | (ColumnDefinition.column_name.ilike(search_pattern))
            | (ColumnDefinition.display_name.ilike(search_pattern))
        )

    result = await db.execute(query)
    rows = result.all()

    mappings = []
    for mapping, col_def, category in rows:
        mappings.append(
            RecipeMappingResponse(
                id=mapping.id,
                xpath=mapping.xpath,
                column_id=mapping.column_id,
                column_name=col_def.column_name,
                display_name=col_def.display_name,
                category_code=category.category_code,
                data_type=col_def.data_type,
                value_transform=mapping.value_transform,
                is_active=mapping.is_active,
                created_at=mapping.created_at,
            )
        )

    return mappings


async def create_mapping(
    db: AsyncSession,
    data: RecipeMappingCreate,
) -> RecipeMappingResponse:
    """Create a new recipe XML mapping."""
    # Validate column exists
    col_def = await db.get(ColumnDefinition, data.column_id)
    if not col_def:
        raise HTTPException(404, "Column not found")

    # Validate value_transform
    if data.value_transform is not None and data.value_transform not in ALLOWED_VALUE_TRANSFORMS:
        raise ValueError(f"Invalid value_transform: {data.value_transform}")

    # Create mapping
    mapping = RecipeXmlMapping(
        xpath=data.xpath,
        column_id=data.column_id,
        value_transform=data.value_transform,
        is_active=True,
    )
    db.add(mapping)
    await db.commit()
    await db.refresh(mapping)

    # Build and return response
    return await _build_mapping_response(db, mapping.id)


async def update_mapping(
    db: AsyncSession,
    mapping_id: int,
    data: RecipeMappingUpdate,
) -> RecipeMappingResponse:
    """Update an existing recipe XML mapping."""
    # Find mapping
    mapping = await db.get(RecipeXmlMapping, mapping_id)
    if not mapping:
        raise HTTPException(404, "Mapping not found")

    # Validate value_transform if provided
    if data.value_transform is not None and data.value_transform not in ALLOWED_VALUE_TRANSFORMS:
        raise ValueError(f"Invalid value_transform: {data.value_transform}")

    # Update fields
    if data.xpath is not None:
        mapping.xpath = data.xpath
    if data.column_id is not None:
        # Validate new column exists
        col_def = await db.get(ColumnDefinition, data.column_id)
        if not col_def:
            raise HTTPException(404, "Column not found")
        mapping.column_id = data.column_id
    if data.value_transform is not None:
        mapping.value_transform = data.value_transform
    if data.is_active is not None:
        mapping.is_active = data.is_active

    await db.commit()
    await db.refresh(mapping)

    # Build and return response
    return await _build_mapping_response(db, mapping.id)


async def delete_mapping(
    db: AsyncSession,
    mapping_id: int,
) -> None:
    """Delete a recipe XML mapping."""
    mapping = await db.get(RecipeXmlMapping, mapping_id)
    if not mapping:
        raise HTTPException(404, "Mapping not found")

    await db.delete(mapping)
    await db.commit()


# ---------------------------------------------------------------------------
# Validation Rule Functions
# ---------------------------------------------------------------------------

async def list_columns_with_validations(
    db: AsyncSession,
    category_code: str | None = None,
) -> list:
    """List columns grouped by category with their validation rules.

    Returns the same ColumnCategory structure as GET /api/columns
    to maintain frontend compatibility.
    """
    query = (
        select(ColumnCategory)
        .options(
            selectinload(ColumnCategory.columns)
            .selectinload(ColumnDefinition.validations)
        )
        .order_by(ColumnCategory.sort_order)
    )

    if category_code:
        query = query.where(ColumnCategory.category_code == category_code)

    result = await db.execute(query)
    categories = result.scalars().unique().all()

    # Sort columns within each category
    for cat in categories:
        cat.columns.sort(key=lambda c: c.sort_order)

    return categories


async def replace_validations(
    db: AsyncSession,
    column_id: int,
    rules: list[ValidationRuleCreate],
) -> dict:
    """Replace all validation rules for a column."""
    # Validate column exists
    col_def = await db.get(ColumnDefinition, column_id)
    if not col_def:
        raise HTTPException(404, "Column not found")

    # Validate all rules before making changes
    for rule in rules:
        # Validate rule_type
        if rule.rule_type not in ALLOWED_RULE_TYPES:
            raise ValueError(f"Invalid rule_type: {rule.rule_type}. Must be one of: {', '.join(ALLOWED_RULE_TYPES)}")

        # Validate rule_config for specific rule types
        if rule.rule_type == "range":
            if "min" not in rule.rule_config or "max" not in rule.rule_config:
                raise ValueError("Range rule requires 'min' and 'max' in rule_config")

        if rule.rule_type == "conditional_required":
            required_fields = ["condition_column", "condition_value", "operator"]
            missing_fields = [f for f in required_fields if f not in rule.rule_config]
            if missing_fields:
                raise ValueError(
                    f"conditional_required rule requires: {', '.join(required_fields)}. "
                    f"Missing: {', '.join(missing_fields)}"
                )

    # Delete existing validations
    await db.execute(
        delete(ColumnValidation).where(ColumnValidation.column_id == column_id)
    )

    # Create new validations
    for rule in rules:
        validation = ColumnValidation(
            column_id=column_id,
            rule_type=rule.rule_type,
            rule_config=rule.rule_config,
            error_message=rule.error_message,
            is_active=rule.is_active,
        )
        db.add(validation)

    await db.commit()

    return {
        "column_id": column_id,
        "rules_replaced": len(rules),
    }


async def bulk_upload_validations(
    db: AsyncSession,
    file: BinaryIO,
) -> BulkUploadResponse:
    """Bulk upload validation rules from Excel file."""
    try:
        wb = load_workbook(file)
        ws = wb.active
    except Exception as e:
        raise HTTPException(400, f"Failed to read Excel file: {str(e)}")

    # Read header row
    headers = [cell.value for cell in ws[1]]
    required_headers = ["column_name", "rule_type", "rule_config", "error_message", "is_active"]
    if not all(h in headers for h in required_headers):
        raise HTTPException(
            400,
            f"Excel file must have headers: {', '.join(required_headers)}"
        )

    # Map column names to column IDs
    result = await db.execute(select(ColumnDefinition))
    all_columns = result.scalars().all()
    column_map = {col.column_name: col for col in all_columns}

    # Process rows
    total_rows = 0
    columns_updated = set()
    rules_created = 0
    warnings = []

    # Group rules by column_name
    rules_by_column = {}

    for row_idx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        if not row or not any(row):
            continue

        total_rows += 1

        # Parse row
        row_dict = dict(zip(headers, row))
        column_name = row_dict.get("column_name")
        rule_type = row_dict.get("rule_type")
        rule_config_str = row_dict.get("rule_config")
        error_message = row_dict.get("error_message")
        is_active_str = row_dict.get("is_active", "TRUE")

        # Validate column exists
        if column_name not in column_map:
            warnings.append(f"Row {row_idx}: Column '{column_name}' not found")
            continue

        # Validate rule_type
        if rule_type not in ALLOWED_RULE_TYPES:
            warnings.append(
                f"Row {row_idx}: Invalid rule_type '{rule_type}'. "
                f"Must be one of: {', '.join(ALLOWED_RULE_TYPES)}"
            )
            continue

        # Parse rule_config JSON
        try:
            rule_config = json.loads(rule_config_str) if rule_config_str else {}
        except json.JSONDecodeError:
            warnings.append(f"Row {row_idx}: Invalid JSON in rule_config: {rule_config_str}")
            continue

        # Parse is_active
        is_active = str(is_active_str).upper() in ("TRUE", "1", "YES", "Y")

        # Create ValidationRuleCreate object
        try:
            rule_create = ValidationRuleCreate(
                rule_type=rule_type,
                rule_config=rule_config,
                error_message=error_message,
                is_active=is_active,
            )
        except ValueError as e:
            warnings.append(f"Row {row_idx}: Validation error: {str(e)}")
            continue

        # Group by column
        if column_name not in rules_by_column:
            rules_by_column[column_name] = []
        rules_by_column[column_name].append(rule_create)

    # Replace validations for each column
    for column_name, rules in rules_by_column.items():
        col_def = column_map[column_name]
        try:
            await replace_validations(db, col_def.id, rules)
            columns_updated.add(column_name)
            rules_created += len(rules)
        except Exception as e:
            warnings.append(f"Column '{column_name}': Failed to replace validations: {str(e)}")

    return BulkUploadResponse(
        total_rows=total_rows,
        columns_updated=len(columns_updated),
        rules_created=rules_created,
        warnings=warnings,
    )
