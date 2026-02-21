"""Recipe XML parsing, diff, and apply service."""

import re
from datetime import datetime, timezone
from typing import Any

from lxml import etree
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from fastapi import HTTPException

from app.models import (
    Project, ProjectLayer, ChangeLog,
    RecipeXmlMapping, ColumnDefinition,
)
from app.schemas.recipe import (
    RecipeDiffItem, RecipeDiffResult, RecipeParseWarning,
    RecipeApplyRequest, RecipeApplyResponse,
)
from app.utils.comparison import values_differ


# ---------------------------------------------------------------------------
# Value transform helpers
# ---------------------------------------------------------------------------

def apply_transform(raw_value: str, transform: str | None) -> Any:
    """Apply a value transform to a raw XML string value."""
    if not raw_value or not raw_value.strip():
        return None
    raw_value = raw_value.strip()

    if transform is None:
        return raw_value
    if transform == "to_int":
        return int(float(raw_value))
    if transform == "to_float":
        return float(raw_value)
    if transform == "yn_to_bool":
        return "Y" if raw_value.lower() in ("true", "1", "yes", "y") else "N"
    return raw_value


# ---------------------------------------------------------------------------
# Layer identification from XML PID / filename
# ---------------------------------------------------------------------------

def extract_layer_key(xml_root: etree._Element, filename: str | None = None) -> str | None:
    """Try to extract a layer identifier from the XML PID or filename.

    Strategy:
    1. Look for PID element text (e.g., "M1_PHOTO_SA.rcp" -> "M1_PHOTO")
    2. Fall back to filename (e.g., "M1_PHOTO_recipe.xml" -> "M1_PHOTO")
    """
    # Try PID from XML
    pid_elements = xml_root.xpath("//PID")
    if pid_elements and pid_elements[0].text:
        pid = pid_elements[0].text.strip()
        # Remove common suffixes like .rcp, _SA.rcp
        pid_clean = re.sub(r'[._](SA|recipe|rcp).*$', '', pid, flags=re.IGNORECASE)
        if pid_clean:
            return pid_clean

    # Try filename
    if filename:
        name_clean = re.sub(r'\.(xml|rcp)$', '', filename, flags=re.IGNORECASE)
        name_clean = re.sub(r'[._](SA|recipe).*$', '', name_clean, flags=re.IGNORECASE)
        if name_clean:
            return name_clean

    return None


def match_layer_to_project(
    layer_key: str,
    project_layers: list[ProjectLayer],
) -> ProjectLayer | None:
    """Match a layer key to a project layer by name similarity."""
    if not layer_key:
        return None

    key_upper = layer_key.upper()

    # Exact match on layer_name
    for pl in project_layers:
        if pl.layer.layer_name.upper() == key_upper:
            return pl

    # Partial match: layer_name contained in key or vice versa
    for pl in project_layers:
        lname = pl.layer.layer_name.upper()
        if lname in key_upper or key_upper in lname:
            return pl

    return None


# ---------------------------------------------------------------------------
# Core parsing
# ---------------------------------------------------------------------------

async def parse_recipe_xml(
    db: AsyncSession,
    project_id: int,
    xml_content: bytes,
    filename: str | None = None,
) -> RecipeDiffResult:
    """Parse a recipe XML file and compute diff against project conditions.

    Returns diff result without modifying any data.
    """

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
        raise HTTPException(status_code=404, detail="Project not found")

    # 2. Parse XML
    try:
        xml_root = etree.fromstring(xml_content)
    except etree.XMLSyntaxError as e:
        raise HTTPException(status_code=400, detail=f"XML 파싱 오류: {str(e)}")

    # 3. Identify target layer
    layer_key = extract_layer_key(xml_root, filename)
    matched_pl: ProjectLayer | None = None
    if layer_key:
        matched_pl = match_layer_to_project(layer_key, project.layers)

    # 4. Load active XML mappings with column definitions
    mapping_result = await db.execute(
        select(RecipeXmlMapping, ColumnDefinition)
        .join(ColumnDefinition, RecipeXmlMapping.column_id == ColumnDefinition.id)
        .where(RecipeXmlMapping.is_active)
    )
    mappings = mapping_result.all()

    if not mappings:
        return RecipeDiffResult(
            project_layer_id=matched_pl.id if matched_pl else None,
            layer_name=matched_pl.layer.layer_name if matched_pl else None,
            detected_layer_key=layer_key,
            total_mapped=0,
            diff_count=0,
            warnings=[RecipeParseWarning(
                xpath="",
                message="활성화된 Recipe XML 매핑이 없습니다. 관리자 설정에서 매핑을 추가해주세요.",
            )],
        )

    # 5. Extract values and compute diff
    items: list[RecipeDiffItem] = []
    warnings: list[RecipeParseWarning] = []
    current_conditions = matched_pl.conditions if matched_pl else {}

    # Track which xpaths in XML are not mapped
    all_leaf_xpaths: set[str] = set()
    for elem in xml_root.iter():
        if len(elem) == 0 and elem.text and elem.text.strip():
            all_leaf_xpaths.add(xml_root.getroottree().getpath(elem))

    mapped_xpaths: set[str] = set()

    for mapping, col_def in mappings:
        mapped_xpaths.add(mapping.xpath)
        try:
            elements = xml_root.xpath(mapping.xpath)
        except etree.XPathEvalError:
            warnings.append(RecipeParseWarning(
                xpath=mapping.xpath,
                message=f"잘못된 XPath: {mapping.xpath}",
            ))
            continue

        if not elements:
            continue

        # Get first match's text
        elem = elements[0]
        raw_value = elem.text if hasattr(elem, 'text') else str(elem)
        if raw_value is None:
            continue

        try:
            recipe_value = apply_transform(raw_value, mapping.value_transform)
        except (ValueError, TypeError) as e:
            warnings.append(RecipeParseWarning(
                xpath=mapping.xpath,
                message=f"값 변환 오류 ({col_def.column_name}): {str(e)}",
            ))
            continue

        if recipe_value is None:
            continue

        current_value = current_conditions.get(col_def.column_name)

        # Get category code from column definition
        cat_result = await db.execute(
            select(ColumnDefinition)
            .options(selectinload(ColumnDefinition.category))
            .where(ColumnDefinition.id == col_def.id)
        )
        col_with_cat = cat_result.scalars().first()
        category_code = col_with_cat.category.category_code if col_with_cat and col_with_cat.category else None

        items.append(RecipeDiffItem(
            column_name=col_def.column_name,
            display_name=col_def.display_name,
            current_value=current_value,
            recipe_value=recipe_value,
            is_different=values_differ(current_value, recipe_value),
            category_code=category_code,
        ))

    diff_count = sum(1 for item in items if item.is_different)

    return RecipeDiffResult(
        project_layer_id=matched_pl.id if matched_pl else None,
        layer_name=matched_pl.layer.layer_name if matched_pl else None,
        detected_layer_key=layer_key,
        total_mapped=len(items),
        diff_count=diff_count,
        unmapped_xpaths=[],  # simplified: don't report unmapped for now
        warnings=warnings,
        items=items,
    )


# ---------------------------------------------------------------------------
# Apply recipe changes
# ---------------------------------------------------------------------------

async def apply_recipe_changes(
    db: AsyncSession,
    project_id: int,
    request: RecipeApplyRequest,
) -> RecipeApplyResponse:
    """Apply selected recipe diff changes to project conditions."""

    # 1. Load project and validate status
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.status != "draft":
        raise HTTPException(status_code=400, detail="Can only apply recipe changes to draft projects")

    # 2. Load project layers
    pl_result = await db.execute(
        select(ProjectLayer).where(ProjectLayer.project_id == project_id)
    )
    pl_map: dict[int, ProjectLayer] = {
        pl.id: pl for pl in pl_result.scalars().all()
    }

    # 3. Apply changes
    change_count = 0
    for change in request.changes:
        pl = pl_map.get(change.project_layer_id)
        if not pl:
            raise HTTPException(status_code=400, detail=f"Invalid project_layer_id: {change.project_layer_id}")

        old_conditions = pl.conditions or {}
        old_value = old_conditions.get(change.column_name)

        if values_differ(old_value, change.new_value):
            # Create change_log
            db.add(ChangeLog(
                project_layer_id=change.project_layer_id,
                column_name=change.column_name,
                old_value=str(old_value) if old_value is not None else None,
                new_value=str(change.new_value) if change.new_value is not None else None,
                change_type="recipe",
                changed_by=request.applied_by,
            ))

            # Update conditions (full reassignment for JSONB mutation detection)
            new_conditions = dict(old_conditions)
            new_conditions[change.column_name] = change.new_value
            pl.conditions = new_conditions
            change_count += 1

    # 4. Touch project.updated_at
    project.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(project)

    return RecipeApplyResponse(
        applied_count=change_count,
        change_log_count=change_count,
        updated_at=project.updated_at,
    )
