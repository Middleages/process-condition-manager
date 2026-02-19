import io
import logging

from openpyxl import Workbook
from openpyxl.styles import Font

from app.models import ProjectLayer, ExportColumnMapping, EquipmentAssignment

logger = logging.getLogger(__name__)


def sanitize_filename(name: str) -> str:
    import re
    return re.sub(r'[^\w\-.]', '_', name)


def build_type_a_data(
    product_name: str, layers: list[ProjectLayer],
    mappings: list[ExportColumnMapping]
) -> tuple[list[str], list[dict]]:
    headers = ["LAYER_ID", "PRODUCT_ID"]
    for m in mappings:
        headers.append(m.target_column_name)

    rows = []
    for pl in layers:
        row = {
            "LAYER_ID": pl.layer.layer_name,
            "PRODUCT_ID": product_name,
        }
        conditions = pl.conditions or {}
        for m in mappings:
            col_name = m.column_definition.column_name
            value = conditions.get(col_name)
            if value is None and m.is_required:
                logger.warning(
                    "Required column %s is null for layer %s",
                    col_name, pl.layer.layer_name
                )
            row[m.target_column_name] = value if value is not None else ""
        rows.append(row)
    return headers, rows


def generate_type_a(
    product_name: str, layers: list[ProjectLayer],
    mappings: list[ExportColumnMapping]
) -> bytes:
    headers, rows = build_type_a_data(product_name, layers, mappings)
    return write_excel(headers, rows)


def build_type_b_data(
    product_name: str, layers: list[ProjectLayer],
    mappings: list[ExportColumnMapping],
    equipment: dict[int, list[EquipmentAssignment]]
) -> tuple[list[str], list[dict]]:
    headers = ["LAYER_ID", "PRODUCT_ID", "EQUIP_ID"]
    for m in mappings:
        headers.append(m.target_column_name)

    rows = []
    for pl in layers:
        equip_list = equipment.get(pl.id, [])
        conditions = pl.conditions or {}

        if not equip_list:
            row = {
                "LAYER_ID": pl.layer.layer_name,
                "PRODUCT_ID": product_name,
                "EQUIP_ID": "",
            }
            for m in mappings:
                col_name = m.column_definition.column_name
                row[m.target_column_name] = conditions.get(col_name, "")
            rows.append(row)
        else:
            for ea in equip_list:
                row = {
                    "LAYER_ID": pl.layer.layer_name,
                    "PRODUCT_ID": product_name,
                    "EQUIP_ID": ea.equipment_id,
                }
                overrides = ea.equipment_params or {}
                for m in mappings:
                    col_name = m.column_definition.column_name
                    # Equipment override takes precedence
                    if col_name in overrides:
                        row[m.target_column_name] = overrides[col_name]
                    else:
                        row[m.target_column_name] = conditions.get(col_name, "")
                rows.append(row)
    return headers, rows


def generate_type_b(
    product_name: str, layers: list[ProjectLayer],
    mappings: list[ExportColumnMapping],
    equipment: dict[int, list[EquipmentAssignment]]
) -> bytes:
    headers, rows = build_type_b_data(product_name, layers, mappings, equipment)
    return write_excel(headers, rows)


def build_type_c_data(
    product_name: str, layers: list[ProjectLayer],
    mappings: list[ExportColumnMapping],
    unit_mappings: dict[str, str]
) -> tuple[list[str], list[dict]]:
    headers = ["LAYER_ID", "PRODUCT_ID", "PARAM_KEY", "PARAM_VALUE", "UNIT"]

    rows = []
    for pl in layers:
        conditions = pl.conditions or {}
        for m in mappings:
            col_name = m.column_definition.column_name
            value = conditions.get(col_name, "")
            unit = unit_mappings.get(col_name, "")
            rows.append({
                "LAYER_ID": pl.layer.layer_name,
                "PRODUCT_ID": product_name,
                "PARAM_KEY": m.target_column_name,
                "PARAM_VALUE": value,
                "UNIT": unit,
            })
    return headers, rows


def generate_type_c(
    product_name: str, layers: list[ProjectLayer],
    mappings: list[ExportColumnMapping],
    unit_mappings: dict[str, str]
) -> bytes:
    headers, rows = build_type_c_data(product_name, layers, mappings, unit_mappings)
    return write_excel(headers, rows)


def write_excel(headers: list[str], rows: list[dict]) -> bytes:
    wb = Workbook()
    ws = wb.active

    # Write headers with bold font
    bold_font = Font(bold=True)
    for col_idx, header in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col_idx, value=header)
        cell.font = bold_font

    # Write data rows
    for row_idx, row_data in enumerate(rows, 2):
        for col_idx, header in enumerate(headers, 1):
            value = row_data.get(header, "")
            ws.cell(row=row_idx, column=col_idx, value=value)

    # Auto-adjust column widths
    for col_idx, header in enumerate(headers, 1):
        max_len = len(str(header))
        for row_idx in range(2, len(rows) + 2):
            cell_value = ws.cell(row=row_idx, column=col_idx).value
            if cell_value is not None:
                max_len = max(max_len, len(str(cell_value)))
        ws.column_dimensions[ws.cell(row=1, column=col_idx).column_letter].width = min(max_len + 2, 50)

    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()
