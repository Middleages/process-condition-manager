"""Admin service for master data management (Lines, Products, Layers, Columns, Categories, Equipments)."""

from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException

from app.models import Line, Product, Layer, Project, ProjectLayer, ColumnDefinition, ColumnCategory
from app.models.equipment import Equipment
from app.schemas.admin_master import (
    LineCreate, LineUpdate, LineResponse,
    ProductCreate, ProductUpdate, ProductResponse,
    LayerCreate, LayerUpdate, LayerResponse, LayerReorderRequest,
    ColumnMetadataUpdate, ColumnMetadataResponse, ColumnCreateRequest,
    CategoryCreateRequest, CategoryUpdate, CategoryResponse, CategoryReorderRequest,
    EquipmentCreate, EquipmentUpdate, EquipmentResponse, EquipmentReorderRequest,
)


# ---------------------------------------------------------------------------
# Lines
# ---------------------------------------------------------------------------

async def list_lines(db: AsyncSession) -> list[LineResponse]:
    """List all lines ordered by line_code with product counts."""
    # Get product counts per line
    count_query = (
        select(Product.line_id, func.count(Product.id).label("cnt"))
        .group_by(Product.line_id)
        .subquery()
    )

    query = (
        select(Line, func.coalesce(count_query.c.cnt, 0).label("product_count"))
        .outerjoin(count_query, Line.id == count_query.c.line_id)
        .order_by(Line.line_code)
    )
    result = await db.execute(query)
    rows = result.all()

    return [
        LineResponse(
            id=line.id,
            line_code=line.line_code,
            line_name=line.line_name,
            created_at=line.created_at,
            product_count=product_count,
        )
        for line, product_count in rows
    ]


async def create_line(db: AsyncSession, data: LineCreate) -> LineResponse:
    """Create a new line. Raises 409 on duplicate line_code."""
    existing = await db.execute(select(Line).where(Line.line_code == data.line_code))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"Line code '{data.line_code}' already exists")

    line = Line(line_code=data.line_code, line_name=data.line_name)
    db.add(line)
    await db.commit()
    await db.refresh(line)

    return LineResponse(
        id=line.id,
        line_code=line.line_code,
        line_name=line.line_name,
        created_at=line.created_at,
        product_count=0,
    )


async def update_line(db: AsyncSession, line_id: int, data: LineUpdate) -> LineResponse:
    """Update line fields. Raises 404 if not found, 409 on duplicate line_code."""
    line = await db.get(Line, line_id)
    if not line:
        raise HTTPException(status_code=404, detail="Line not found")

    if data.line_code is not None and data.line_code != line.line_code:
        existing = await db.execute(select(Line).where(Line.line_code == data.line_code))
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=409, detail=f"Line code '{data.line_code}' already exists")
        line.line_code = data.line_code

    if data.line_name is not None:
        line.line_name = data.line_name

    await db.commit()
    await db.refresh(line)

    # Get product count
    count_result = await db.execute(
        select(func.count(Product.id)).where(Product.line_id == line_id)
    )
    product_count = count_result.scalar_one()

    return LineResponse(
        id=line.id,
        line_code=line.line_code,
        line_name=line.line_name,
        created_at=line.created_at,
        product_count=product_count,
    )


async def delete_line(db: AsyncSession, line_id: int) -> None:
    """Delete a line. Raises 404 if not found, 400 if products reference this line."""
    line = await db.get(Line, line_id)
    if not line:
        raise HTTPException(status_code=404, detail="Line not found")

    product_count_result = await db.execute(
        select(func.count(Product.id)).where(Product.line_id == line_id)
    )
    if product_count_result.scalar_one() > 0:
        raise HTTPException(
            status_code=400,
            detail="이 라인에 연결된 제품이 있어 삭제할 수 없습니다",
        )

    await db.delete(line)
    await db.commit()


# ---------------------------------------------------------------------------
# Products
# ---------------------------------------------------------------------------

async def list_products(db: AsyncSession, line_id: int | None = None) -> list[ProductResponse]:
    """List products ordered by product_name with line_name joined."""
    query = (
        select(Product, Line.line_name.label("line_name"))
        .outerjoin(Line, Product.line_id == Line.id)
        .order_by(Product.product_name)
    )
    if line_id is not None:
        query = query.where(Product.line_id == line_id)

    result = await db.execute(query)
    rows = result.all()

    return [
        ProductResponse(
            id=product.id,
            product_name=product.product_name,
            description=product.description,
            line_id=product.line_id,
            line_name=line_name,
            part_id=product.part_id,
            created_at=product.created_at,
        )
        for product, line_name in rows
    ]


async def create_product(db: AsyncSession, data: ProductCreate) -> ProductResponse:
    """Create a new product. Raises 409 on duplicate product_name."""
    existing = await db.execute(select(Product).where(Product.product_name == data.product_name))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"Product name '{data.product_name}' already exists")

    if data.line_id is not None:
        line = await db.get(Line, data.line_id)
        if not line:
            raise HTTPException(status_code=404, detail="Line not found")

    product = Product(
        product_name=data.product_name,
        description=data.description,
        line_id=data.line_id,
        part_id=data.part_id,
    )
    db.add(product)
    await db.commit()
    await db.refresh(product)

    line_name = None
    if product.line_id:
        line = await db.get(Line, product.line_id)
        line_name = line.line_name if line else None

    return ProductResponse(
        id=product.id,
        product_name=product.product_name,
        description=product.description,
        line_id=product.line_id,
        line_name=line_name,
        part_id=product.part_id,
        created_at=product.created_at,
    )


async def update_product(db: AsyncSession, product_id: int, data: ProductUpdate) -> ProductResponse:
    """Update product fields. Raises 404 if not found, 409 on duplicate product_name."""
    product = await db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    if data.product_name is not None and data.product_name != product.product_name:
        existing = await db.execute(select(Product).where(Product.product_name == data.product_name))
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=409, detail=f"Product name '{data.product_name}' already exists")
        product.product_name = data.product_name

    if data.description is not None:
        product.description = data.description
    if data.line_id is not None:
        line = await db.get(Line, data.line_id)
        if not line:
            raise HTTPException(status_code=404, detail="Line not found")
        product.line_id = data.line_id
    if data.part_id is not None:
        product.part_id = data.part_id

    await db.commit()
    await db.refresh(product)

    line_name = None
    if product.line_id:
        line = await db.get(Line, product.line_id)
        line_name = line.line_name if line else None

    return ProductResponse(
        id=product.id,
        product_name=product.product_name,
        description=product.description,
        line_id=product.line_id,
        line_name=line_name,
        part_id=product.part_id,
        created_at=product.created_at,
    )


async def delete_product(db: AsyncSession, product_id: int) -> None:
    """Delete a product. Raises 404 if not found, 400 if projects reference it."""
    product = await db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    project_count_result = await db.execute(
        select(func.count(Project.id)).where(Project.product_id == product_id)
    )
    if project_count_result.scalar_one() > 0:
        raise HTTPException(
            status_code=400,
            detail="이 제품에 연결된 프로젝트가 있어 삭제할 수 없습니다",
        )

    await db.delete(product)
    await db.commit()


# ---------------------------------------------------------------------------
# Layers
# ---------------------------------------------------------------------------

async def list_layers(db: AsyncSession) -> list[LayerResponse]:
    """List all layers ordered by sort_order."""
    result = await db.execute(select(Layer).order_by(Layer.sort_order))
    layers = result.scalars().all()
    return [LayerResponse.model_validate(layer) for layer in layers]


async def create_layer(db: AsyncSession, data: LayerCreate) -> LayerResponse:
    """Create a new layer. Raises 409 on duplicate layer_name, step_seq, or layer_number."""
    existing_name = await db.execute(select(Layer).where(Layer.layer_name == data.layer_name))
    if existing_name.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"Layer name '{data.layer_name}' already exists")

    existing_step = await db.execute(select(Layer).where(Layer.step_seq == data.step_seq))
    if existing_step.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"Step seq '{data.step_seq}' already exists")

    existing_number = await db.execute(select(Layer).where(Layer.layer_number == data.layer_number))
    if existing_number.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"Layer number '{data.layer_number}' already exists")

    layer = Layer(
        layer_name=data.layer_name,
        step_seq=data.step_seq,
        layer_number=data.layer_number,
        sort_order=data.sort_order,
    )
    db.add(layer)
    await db.commit()
    await db.refresh(layer)
    return LayerResponse.model_validate(layer)


async def update_layer(db: AsyncSession, layer_id: int, data: LayerUpdate) -> LayerResponse:
    """Update layer fields. Raises 404 if not found, 409 on duplicate unique fields."""
    layer = await db.get(Layer, layer_id)
    if not layer:
        raise HTTPException(status_code=404, detail="Layer not found")

    if data.layer_name is not None and data.layer_name != layer.layer_name:
        existing = await db.execute(select(Layer).where(Layer.layer_name == data.layer_name))
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=409, detail=f"Layer name '{data.layer_name}' already exists")
        layer.layer_name = data.layer_name

    if data.step_seq is not None and data.step_seq != layer.step_seq:
        existing = await db.execute(select(Layer).where(Layer.step_seq == data.step_seq))
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=409, detail=f"Step seq '{data.step_seq}' already exists")
        layer.step_seq = data.step_seq

    if data.layer_number is not None and data.layer_number != layer.layer_number:
        existing = await db.execute(select(Layer).where(Layer.layer_number == data.layer_number))
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=409, detail=f"Layer number '{data.layer_number}' already exists")
        layer.layer_number = data.layer_number

    if data.sort_order is not None:
        layer.sort_order = data.sort_order

    await db.commit()
    await db.refresh(layer)
    return LayerResponse.model_validate(layer)


async def delete_layer(db: AsyncSession, layer_id: int) -> None:
    """Delete a layer. Raises 404 if not found, 400 if project_layers reference it."""
    layer = await db.get(Layer, layer_id)
    if not layer:
        raise HTTPException(status_code=404, detail="Layer not found")

    pl_count_result = await db.execute(
        select(func.count(ProjectLayer.id)).where(ProjectLayer.layer_id == layer_id)
    )
    if pl_count_result.scalar_one() > 0:
        raise HTTPException(
            status_code=400,
            detail="이 레이어에 연결된 프로젝트 레이어가 있어 삭제할 수 없습니다",
        )

    await db.delete(layer)
    await db.commit()


async def reorder_layers(db: AsyncSession, data: LayerReorderRequest) -> list[LayerResponse]:
    """Reorder layers by setting sort_order based on position in ordered_ids."""
    result = await db.execute(select(Layer).where(Layer.id.in_(data.ordered_ids)))
    layers_map = {layer.id: layer for layer in result.scalars().all()}

    for position, layer_id in enumerate(data.ordered_ids):
        if layer_id in layers_map:
            layers_map[layer_id].sort_order = position

    await db.commit()

    # Return all layers in new order
    result = await db.execute(select(Layer).order_by(Layer.sort_order))
    return [LayerResponse.model_validate(layer) for layer in result.scalars().all()]


# ---------------------------------------------------------------------------
# Column metadata
# ---------------------------------------------------------------------------

async def update_column_metadata(
    db: AsyncSession, column_id: int, data: ColumnMetadataUpdate
) -> ColumnMetadataResponse:
    """Update column metadata fields (display_name, unit, is_required)."""
    col = await db.get(ColumnDefinition, column_id)
    if not col:
        raise HTTPException(status_code=404, detail="Column not found")

    if data.display_name is not None:
        col.display_name = data.display_name
    if data.unit is not None:
        col.unit = data.unit
    if data.is_required is not None:
        col.is_required = data.is_required

    await db.commit()
    await db.refresh(col)

    cat = await db.get(ColumnCategory, col.category_id)

    return ColumnMetadataResponse(
        id=col.id,
        column_name=col.column_name,
        display_name=col.display_name,
        category_code=cat.category_code if cat else None,
        data_type=col.data_type,
        unit=col.unit,
        is_required=col.is_required,
        sort_order=col.sort_order,
    )


async def create_column(db: AsyncSession, data: ColumnCreateRequest) -> ColumnMetadataResponse:
    """Create a new column definition. Raises 409 on duplicate column_name, 404 if category not found."""
    # Validate category exists
    cat = await db.get(ColumnCategory, data.category_id)
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")

    # Check duplicate column_name
    existing = await db.execute(
        select(ColumnDefinition).where(ColumnDefinition.column_name == data.column_name)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"Column name '{data.column_name}' already exists")

    # Auto-assign sort_order = max(existing in this category) + 1
    max_order_result = await db.execute(
        select(func.coalesce(func.max(ColumnDefinition.sort_order), -1))
        .where(ColumnDefinition.category_id == data.category_id)
    )
    next_order = max_order_result.scalar_one() + 1

    col = ColumnDefinition(
        column_name=data.column_name,
        display_name=data.display_name,
        category_id=data.category_id,
        data_type=data.data_type,
        unit=data.unit,
        is_required=data.is_required,
        select_options=data.select_options,
        sort_order=next_order,
    )
    db.add(col)
    await db.commit()
    await db.refresh(col)

    return ColumnMetadataResponse(
        id=col.id,
        column_name=col.column_name,
        display_name=col.display_name,
        category_code=cat.category_code,
        data_type=col.data_type,
        unit=col.unit,
        is_required=col.is_required,
        sort_order=col.sort_order,
    )


async def delete_column(db: AsyncSession, column_id: int) -> None:
    """Delete a column definition and its validations. Raises 404 if not found."""
    col = await db.get(ColumnDefinition, column_id)
    if not col:
        raise HTTPException(status_code=404, detail="Column not found")

    await db.delete(col)
    await db.commit()


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------

async def create_category(db: AsyncSession, data: CategoryCreateRequest) -> CategoryResponse:
    """Create a new category. Raises 409 on duplicate category_code."""
    existing = await db.execute(
        select(ColumnCategory).where(ColumnCategory.category_code == data.category_code)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"Category code '{data.category_code}' already exists")

    # Auto-assign sort_order = max(existing) + 1
    max_order_result = await db.execute(
        select(func.coalesce(func.max(ColumnCategory.sort_order), -1))
    )
    next_order = max_order_result.scalar_one() + 1

    cat = ColumnCategory(
        category_code=data.category_code,
        category_name=data.category_name,
        sort_order=next_order,
    )
    db.add(cat)
    await db.commit()
    await db.refresh(cat)

    return CategoryResponse(
        id=cat.id,
        category_code=cat.category_code,
        category_name=cat.category_name,
        sort_order=cat.sort_order,
        column_count=0,
    )


async def delete_category(db: AsyncSession, category_id: int) -> None:
    """Delete a category. Raises 404 if not found, 400 if columns reference it."""
    cat = await db.get(ColumnCategory, category_id)
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")

    col_count_result = await db.execute(
        select(func.count(ColumnDefinition.id)).where(ColumnDefinition.category_id == category_id)
    )
    if col_count_result.scalar_one() > 0:
        raise HTTPException(
            status_code=400,
            detail="컬럼이 있는 카테고리는 삭제할 수 없습니다",
        )

    await db.delete(cat)
    await db.commit()


async def list_categories(db: AsyncSession) -> list[CategoryResponse]:
    """List all categories ordered by sort_order with column counts."""
    count_query = (
        select(ColumnDefinition.category_id, func.count(ColumnDefinition.id).label("cnt"))
        .group_by(ColumnDefinition.category_id)
        .subquery()
    )

    query = (
        select(ColumnCategory, func.coalesce(count_query.c.cnt, 0).label("column_count"))
        .outerjoin(count_query, ColumnCategory.id == count_query.c.category_id)
        .order_by(ColumnCategory.sort_order)
    )
    result = await db.execute(query)
    rows = result.all()

    return [
        CategoryResponse(
            id=cat.id,
            category_code=cat.category_code,
            category_name=cat.category_name,
            sort_order=cat.sort_order,
            column_count=column_count,
        )
        for cat, column_count in rows
    ]


async def update_category(
    db: AsyncSession, category_id: int, data: CategoryUpdate
) -> CategoryResponse:
    """Update category name. Raises 404 if not found."""
    cat = await db.get(ColumnCategory, category_id)
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")

    if data.category_name is not None:
        cat.category_name = data.category_name

    await db.commit()
    await db.refresh(cat)

    count_result = await db.execute(
        select(func.count(ColumnDefinition.id)).where(ColumnDefinition.category_id == category_id)
    )
    column_count = count_result.scalar_one()

    return CategoryResponse(
        id=cat.id,
        category_code=cat.category_code,
        category_name=cat.category_name,
        sort_order=cat.sort_order,
        column_count=column_count,
    )


async def reorder_categories(db: AsyncSession, data: CategoryReorderRequest) -> list[CategoryResponse]:
    """Reorder categories by setting sort_order based on position in ordered_ids."""
    result = await db.execute(
        select(ColumnCategory).where(ColumnCategory.id.in_(data.ordered_ids))
    )
    cats_map = {cat.id: cat for cat in result.scalars().all()}

    for position, cat_id in enumerate(data.ordered_ids):
        if cat_id in cats_map:
            cats_map[cat_id].sort_order = position

    await db.commit()

    return await list_categories(db)


# ---------------------------------------------------------------------------
# Equipments
# ---------------------------------------------------------------------------

def _equipment_to_response(eqp: Equipment, line_name: str = "") -> EquipmentResponse:
    """Convert Equipment ORM instance to EquipmentResponse."""
    return EquipmentResponse(
        id=eqp.id,
        line_id=eqp.line_id,
        line_name=line_name,
        equipment_name=eqp.equipment_name,
        equipment_model=eqp.equipment_model,
        prc=eqp.prc,
        ip=eqp.ip,
        ftp_id=eqp.ftp_id,
        is_active=eqp.is_active,
        sort_order=eqp.sort_order,
    )


async def list_equipments(db: AsyncSession, line_id: int | None = None) -> list[EquipmentResponse]:
    """List equipments joined with Line for line_name, optionally filtered by line_id."""
    query = (
        select(Equipment, Line.line_name.label("line_name"))
        .join(Line, Equipment.line_id == Line.id)
        .order_by(Equipment.line_id, Equipment.sort_order)
    )
    if line_id is not None:
        query = query.where(Equipment.line_id == line_id)

    result = await db.execute(query)
    rows = result.all()

    return [_equipment_to_response(eqp, line_name) for eqp, line_name in rows]


async def create_equipment(db: AsyncSession, data: EquipmentCreate) -> EquipmentResponse:
    """Create a new equipment. Raises 404 if line not found, 409 on duplicate name within line."""
    line = await db.get(Line, data.line_id)
    if not line:
        raise HTTPException(status_code=404, detail="Line not found")

    existing = await db.execute(
        select(Equipment).where(
            and_(Equipment.line_id == data.line_id, Equipment.equipment_name == data.equipment_name)
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=409,
            detail=f"Equipment name '{data.equipment_name}' already exists in this line",
        )

    eqp = Equipment(
        line_id=data.line_id,
        equipment_name=data.equipment_name,
        equipment_model=data.equipment_model,
        prc=data.prc,
        ip=data.ip,
        ftp_id=data.ftp_id,
        ftp_pw=data.ftp_pw,
        is_active=data.is_active,
        sort_order=data.sort_order,
    )
    db.add(eqp)
    await db.commit()
    await db.refresh(eqp)

    return _equipment_to_response(eqp, line.line_name)


async def update_equipment(db: AsyncSession, equipment_id: int, data: EquipmentUpdate) -> EquipmentResponse:
    """Update equipment fields. Raises 404 if not found, 409 on duplicate name within line."""
    eqp = await db.get(Equipment, equipment_id)
    if not eqp:
        raise HTTPException(status_code=404, detail="Equipment not found")

    if data.equipment_name is not None and data.equipment_name != eqp.equipment_name:
        existing = await db.execute(
            select(Equipment).where(
                and_(
                    Equipment.line_id == eqp.line_id,
                    Equipment.equipment_name == data.equipment_name,
                )
            )
        )
        if existing.scalar_one_or_none():
            raise HTTPException(
                status_code=409,
                detail=f"Equipment name '{data.equipment_name}' already exists in this line",
            )
        eqp.equipment_name = data.equipment_name

    if data.equipment_model is not None:
        eqp.equipment_model = data.equipment_model
    if data.prc is not None:
        eqp.prc = data.prc
    if data.ip is not None:
        eqp.ip = data.ip
    if data.ftp_id is not None:
        eqp.ftp_id = data.ftp_id
    if data.ftp_pw is not None:
        eqp.ftp_pw = data.ftp_pw
    if data.is_active is not None:
        eqp.is_active = data.is_active
    if data.sort_order is not None:
        eqp.sort_order = data.sort_order

    await db.commit()
    await db.refresh(eqp)

    line = await db.get(Line, eqp.line_id)
    line_name = line.line_name if line else ""

    return _equipment_to_response(eqp, line_name)


async def delete_equipment(db: AsyncSession, equipment_id: int) -> None:
    """Soft-delete equipment by setting is_active = false.

    Equipment may be referenced in conditions JSONB, so hard delete is avoided.
    Raises 404 if not found.
    """
    eqp = await db.get(Equipment, equipment_id)
    if not eqp:
        raise HTTPException(status_code=404, detail="Equipment not found")

    eqp.is_active = False
    await db.commit()


async def reorder_equipments(db: AsyncSession, data: EquipmentReorderRequest) -> list[EquipmentResponse]:
    """Reorder equipments by setting sort_order based on position in ordered_ids."""
    result = await db.execute(
        select(Equipment).where(Equipment.id.in_(data.ordered_ids))
    )
    eqp_map = {eqp.id: eqp for eqp in result.scalars().all()}

    for position, eqp_id in enumerate(data.ordered_ids):
        if eqp_id in eqp_map:
            eqp_map[eqp_id].sort_order = position

    await db.commit()

    # Determine the line_id from the first equipment to return the filtered list
    if eqp_map:
        first_eqp = next(iter(eqp_map.values()))
        return await list_equipments(db, line_id=first_eqp.line_id)
    return []
