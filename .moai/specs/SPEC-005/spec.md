# SPEC-005: Export System - Computational Output Tables (Type A/B/C)

## Metadata

| Field       | Value                                              |
|-------------|----------------------------------------------------|
| SPEC ID     | SPEC-005                                           |
| Title       | Export System - Computational Output Tables (Type A/B/C) |
| Created     | 2026-02-16                                         |
| Status      | Completed                                          |
| Priority    | High                                               |
| Phase       | Phase 3 (Workflow & Output)                        |
| Depends On  | SPEC-003 (Approval Workflow), SPEC-004 (Change History) |
| Category    | Backend Service + API + Frontend UI                |

---

## 1. Environment

### 1.1 System Context

PCM (Process Condition Manager) is a web-based system managing semiconductor Photo process condition tables. Each product has approximately 300 parameter columns across 30-60 layers. After Phase 2 (MVP editing, backbone management, recipe XML, revision), the system needs to export approved condition tables into formats required by various internal computational systems.

### 1.2 Existing Infrastructure

- **Backend**: FastAPI (Python 3.12), SQLAlchemy 2.x (async), PostgreSQL 16 with JSONB storage
- **Frontend**: React 18 + TypeScript + Vite, AG Grid Community, Axios, TanStack Query, Zustand
- **Existing Models**: `ExportSystem`, `ExportColumnMapping` already defined in `backend/app/models/export.py`
- **File Processing**: openpyxl 3.1.5 already in tech stack for Excel generation
- **Status Workflow**: Draft -> Review -> Approved -> Archived (Approved status required for export)

### 1.3 Existing Database Tables

The following tables are already defined and migrated:

- `export_systems` - Export system definitions (system_name, format_type, description, additional_config, is_active)
- `export_column_mappings` - Per-system column mappings (export_system_id, column_id, target_column_name, sort_order, is_required)
- `project_layers` - Project layer data with `conditions` (JSONB) containing the parameter values
- `layers` - Layer master data (layer_name, step_seq, layer_number)
- `products` - Product master data (product_name)
- `column_definitions` - Column metadata (column_key, display_name, category_id)

### 1.4 Target Export Systems (Phase 3 Scope)

| # | System Name   | Format Type | Category     | Status             |
|---|---------------|-------------|--------------|--------------------|
| 1 | MES-TRACK     | TYPE_A      | SP + DEV     | Format defined     |
| 2 | EQP-SCANNER   | TYPE_B      | SC           | Format defined     |
| 3 | SPC-OVL       | TYPE_C      | OVL          | Format defined     |

Remaining 7 systems (MES-COATER, MES-DEV, SPC-CD, EQP-RETICLE, APC-SYSTEM, YIELD-DB, REPORT-GEN) are deferred to Phase 4.

---

## 2. Assumptions

- **A1**: SPEC-003 (Approval Workflow) is implemented before this SPEC. Projects can reach "Approved" status.
- **A2**: SPEC-004 (Change History) is implemented before this SPEC. Change tracking infrastructure is available.
- **A3**: Export is only available for projects with `status = 'approved'`. Draft/Review/Rejected/Archived projects cannot be exported.
- **A4**: The `export_systems` and `export_column_mappings` tables already exist in the database schema. Seed data will populate them with the 3 target systems.
- **A5**: Equipment assignment data for Type B exports is managed via a new `equipment_assignments` table. Equipment management UI is deferred to Phase 4; Phase 3 uses seed data only.
- **A6**: openpyxl is the Excel generation library (already in tech stack requirements).
- **A7**: Column definitions and their `column_key` values in `column_definitions` match the keys stored in `project_layers.conditions` JSONB.
- **A8**: Each export system maps specific columns from the condition table. Not all 300 columns are exported - only mapped columns appear in the output.
- **A9**: UNIT information for Type C is stored in `export_systems.additional_config` as a JSON mapping of column_key to unit string.
- **A10**: Multiple export downloads produce a ZIP file containing individual Excel files, one per system.

---

## 3. Requirements

### 3.1 Export Service Core (Ubiquitous Requirements)

- **REQ-001**: The system **shall** support three export format types: TYPE_A (horizontal, 1 row per layer), TYPE_B (equipment-split multi-row), and TYPE_C (key-value vertical transpose).
- **REQ-002**: The system **shall** generate Excel files using openpyxl with proper column headers, data formatting, and sheet naming.
- **REQ-003**: The system **shall** read column mappings from `export_column_mappings` to determine which source columns to include and their target names in the output.

### 3.2 Type A - 1 Row per Layer (Horizontal)

- **REQ-010**: **When** a Type A export is requested, **then** the system **shall** generate an Excel file where each layer is represented as a single row.
- **REQ-011**: **When** generating Type A output, **then** the system **shall** include fixed columns (LAYER_ID, PRODUCT_ID) followed by mapped condition columns in `sort_order` sequence.
- **REQ-012**: **When** generating Type A output, **then** the system **shall** convert source column keys to target column names as defined in `export_column_mappings.target_column_name`.
- **REQ-013**: **When** a mapped column has `is_required = true` but the condition value is null or missing, **then** the system **shall** include the cell as empty but log a warning.

### 3.3 Type B - Equipment-Split Multi-Row

- **REQ-020**: **When** a Type B export is requested, **then** the system **shall** generate an Excel file where each layer appears in multiple rows, one per assigned equipment.
- **REQ-021**: **When** generating Type B output, **then** the system **shall** include fixed columns (LAYER_ID, PRODUCT_ID, EQUIP_ID) followed by mapped condition columns.
- **REQ-022**: **When** an equipment has `equipment_params` overrides in the `equipment_assignments` table, **then** the system **shall** use the override values instead of the base condition values for those specific parameters.
- **REQ-023**: **If** a layer has no equipment assignments, **then** the system **shall** output a single row for that layer with EQUIP_ID as empty string.
- **REQ-024**: **When** generating Type B output, **then** the system **shall** order equipment rows by `equipment_assignments.sort_order` within each layer.

### 3.4 Type C - Key-Value Vertical Transpose

- **REQ-030**: **When** a Type C export is requested, **then** the system **shall** generate an Excel file where each mapped parameter becomes a row with columns: LAYER_ID, PRODUCT_ID, PARAM_KEY, PARAM_VALUE, UNIT.
- **REQ-031**: **When** generating Type C output, **then** the system **shall** use `target_column_name` from mappings as the PARAM_KEY value.
- **REQ-032**: **When** generating Type C output, **then** the system **shall** look up unit information from `export_systems.additional_config.unit_mappings` and populate the UNIT column.
- **REQ-033**: **If** no unit mapping exists for a parameter, **then** the system **shall** leave the UNIT cell empty.

### 3.5 Equipment Assignments (New Table)

- **REQ-040**: The system **shall** have an `equipment_assignments` table to store per-layer equipment allocation and parameter overrides for Type B exports.
- **REQ-041**: The `equipment_assignments` table **shall** contain: id, project_layer_id (FK to project_layers), equipment_id (VARCHAR), equipment_params (JSONB), sort_order, created_at, updated_at.
- **REQ-042**: **When** generating Type B output, **then** the system **shall** query `equipment_assignments` by `project_layer_id` for each project layer.

### 3.6 Export API

- **REQ-050**: **When** GET `/api/export/systems` is called, **then** the system **shall** return a list of active export systems including system_name, format_type, description, and the count of mapped columns per system.
- **REQ-051**: **When** POST `/api/projects/{id}/export` is called with `system_ids` in the body, **then** the system **shall** generate Excel files for each selected system and return them as a downloadable response.
- **REQ-052**: **If** the project status is not "approved" when export is requested, **then** the system **shall** return HTTP 400 with error message "Export is only available for approved projects."
- **REQ-053**: **When** GET `/api/projects/{id}/export/preview/{system_id}` is called, **then** the system **shall** return the first 5 rows of the transformed data as JSON for UI preview.
- **REQ-054**: **When** multiple systems are requested in a single export, **then** the system **shall** return a ZIP file containing individual Excel files named `{system_name}.xlsx`.
- **REQ-055**: **When** a single system is requested, **then** the system **shall** return a single Excel file directly (not zipped).
- **REQ-056**: **If** `system_ids` contains a non-existent system ID, **then** the system **shall** return HTTP 404 with error message identifying the invalid system ID.
- **REQ-057**: **If** `system_ids` contains an inactive system ID, **then** the system **shall** return HTTP 400 with error message "Inactive export system cannot be used for export."

### 3.7 Export UI

- **REQ-060**: **When** a project is in "Approved" status, **then** the system **shall** display an "Export" button/section on the project detail page.
- **REQ-061**: **If** a project is not in "Approved" status, **then** the system **shall not** display the export functionality.
- **REQ-062**: **When** the export panel is opened, **then** the system **shall** display a checkbox list of available export systems showing: system name, format type badge, category description, and mapped column count.
- **REQ-063**: **Where** an export system has incomplete configuration (no column mappings), the system **shall** display it as disabled with a tooltip explaining the reason.
- **REQ-064**: **When** a user clicks on an export system in the list, **then** the system **shall** fetch and display a preview table showing the first 5 rows of transformed data.
- **REQ-065**: **When** the user clicks the bulk download button with systems selected, **then** the system **shall** trigger the export API and initiate a file download.
- **REQ-066**: **When** downloading, **then** the system **shall** show a loading indicator until the file download begins.
- **REQ-067**: The system **shall** also provide individual download buttons per system for single-system export.

### 3.8 Seed Data

- **REQ-070**: The system **shall** include seed data for 3 export systems: MES-TRACK (TYPE_A), EQP-SCANNER (TYPE_B), SPC-OVL (TYPE_C).
- **REQ-071**: The seed data **shall** include column mappings for each system using existing `column_definitions` entries.
- **REQ-072**: The seed data **shall** include equipment assignments for Type B: 3-5 equipment entries per scanner-category layer.
- **REQ-073**: The seed data **shall** include UNIT mapping in `additional_config` for the SPC-OVL (TYPE_C) system.

### 3.9 Model Enhancement (Existing Table)

- **REQ-075**: The existing `ExportColumnMapping` model **shall** have a `column_definition` relationship added to enable eager loading of `column_key` from `column_definitions` during export generation.

### 3.10 Unwanted Behavior

- **REQ-080**: The system **shall not** allow export of projects that are not in "approved" status. Archived projects (previously approved) are also excluded from export; users must refer to the approved version.
- **REQ-081**: The system **shall not** include unmapped columns in the export output (only columns defined in `export_column_mappings` for that system appear).
- **REQ-082**: The system **shall not** expose raw JSONB keys in export output; all column headers must use `target_column_name`.
- **REQ-083**: The system **shall** sanitize `product_name` and `system_name` in export filenames by replacing special characters (spaces, slashes, etc.) with underscores.

---

## 4. Specifications

### 4.1 Database Schema Change

#### New Table: `equipment_assignments`

```sql
CREATE TABLE equipment_assignments (
    id SERIAL PRIMARY KEY,
    project_layer_id INTEGER NOT NULL REFERENCES project_layers(id) ON DELETE CASCADE,
    equipment_id VARCHAR(50) NOT NULL,
    equipment_params JSONB DEFAULT '{}',
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_equipment_assignments_project_layer
    ON equipment_assignments(project_layer_id);
```

**Alembic Migration**: Create migration `005_add_equipment_assignments.py`.

#### SQLAlchemy Model

```python
class EquipmentAssignment(Base):
    __tablename__ = "equipment_assignments"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_layer_id: Mapped[int] = mapped_column(
        ForeignKey("project_layers.id", ondelete="CASCADE"), index=True
    )
    equipment_id: Mapped[str] = mapped_column(String(50))
    equipment_params: Mapped[dict] = mapped_column(JSONB, default=dict)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
```

### 4.2 Backend Service Architecture

#### ExportService (`backend/app/services/export_service.py`)

```python
class ExportService:
    """Generates Excel exports for approved project condition tables."""

    async def get_systems(self, db: AsyncSession) -> list[ExportSystemResponse]:
        """Return all active export systems with column mapping counts."""

    async def generate(
        self, db: AsyncSession, project_id: int, system_id: int
    ) -> bytes:
        """Generate Excel bytes for a single system export."""
        system = await self._get_export_system(db, system_id)
        mappings = await self._get_column_mappings(db, system_id)
        layers = await self._get_project_layers(db, project_id)
        product = await self._get_project_product(db, project_id)

        if system.format_type == "TYPE_A":
            return self._generate_type_a(product, layers, mappings)
        elif system.format_type == "TYPE_B":
            equipment = await self._get_equipment_assignments(db, layers)
            return self._generate_type_b(product, layers, mappings, equipment)
        elif system.format_type == "TYPE_C":
            unit_mappings = system.additional_config.get("unit_mappings", {})
            return self._generate_type_c(product, layers, mappings, unit_mappings)

    async def generate_preview(
        self, db: AsyncSession, project_id: int, system_id: int, limit: int = 5
    ) -> list[dict]:
        """Generate preview data (first N rows) as JSON."""

    async def generate_bulk(
        self, db: AsyncSession, project_id: int, system_ids: list[int]
    ) -> bytes:
        """Generate ZIP file containing Excel files for multiple systems."""

    def _generate_type_a(self, product, layers, mappings) -> bytes:
        """Type A: 1 row per layer, horizontal format."""

    def _generate_type_b(self, product, layers, mappings, equipment) -> bytes:
        """Type B: Equipment-split multi-row format."""

    def _generate_type_c(self, product, layers, mappings, unit_mappings) -> bytes:
        """Type C: Key-value vertical transpose format."""
```

### 4.3 API Endpoints

#### Export Router (`backend/app/routers/export.py`)

| Method | Path                                        | Description                         | Auth     |
|--------|---------------------------------------------|-------------------------------------|----------|
| GET    | `/api/export/systems`                       | List active export systems          | Any user |
| POST   | `/api/projects/{id}/export`                 | Generate & download Excel export    | Any user |
| GET    | `/api/projects/{id}/export/preview/{system_id}` | Preview first 5 rows as JSON    | Any user |

**Request/Response Schemas**:

```python
# Request
class ExportRequest(BaseModel):
    system_ids: list[int]

# Response - Systems list
class ExportSystemResponse(BaseModel):
    id: int
    system_name: str
    format_type: str
    description: str | None
    column_count: int
    is_active: bool

# Response - Preview
class ExportPreviewResponse(BaseModel):
    system_name: str
    format_type: str
    headers: list[str]
    rows: list[dict[str, Any]]
    total_rows: int
```

### 4.4 Frontend Components

#### Export UI Component Structure

```
frontend/src/
  components/
    export/
      ExportPanel.tsx          # Main export panel (system list + preview)
      ExportSystemList.tsx     # Checkbox list of export systems
      ExportPreviewTable.tsx   # Preview table for selected system
      ExportDownloadButton.tsx # Download button with loading state
  api/
    export.ts                  # Export API client functions
  hooks/
    useExportSystems.ts        # TanStack Query hook for export systems
    useExportPreview.ts        # TanStack Query hook for preview data
  types/
    export.ts                  # TypeScript type definitions
```

#### Integration Point

The `ExportPanel` component is rendered within `ConditionEditorPage` (or project detail view) conditionally when `project.status === 'approved'`.

### 4.5 Excel Output Format Specifications

#### Type A Sheet Structure (MES-TRACK example)

| Column Position | Header        | Source                               |
|-----------------|---------------|--------------------------------------|
| A               | LAYER_ID      | `layers.layer_name`                  |
| B               | PRODUCT_ID    | `products.product_name`              |
| C onwards       | (mapped)      | `conditions[column_key]` -> `target_column_name` |

#### Type B Sheet Structure (EQP-SCANNER example)

| Column Position | Header        | Source                                          |
|-----------------|---------------|-------------------------------------------------|
| A               | LAYER_ID      | `layers.layer_name`                             |
| B               | PRODUCT_ID    | `products.product_name`                         |
| C               | EQUIP_ID      | `equipment_assignments.equipment_id`            |
| D onwards       | (mapped)      | `conditions[key]` or `equipment_params[key]` override |

#### Type C Sheet Structure (SPC-OVL example)

| Column Position | Header        | Source                                   |
|-----------------|---------------|------------------------------------------|
| A               | LAYER_ID      | `layers.layer_name`                      |
| B               | PRODUCT_ID    | `products.product_name`                  |
| C               | PARAM_KEY     | `export_column_mappings.target_column_name` |
| D               | PARAM_VALUE   | `conditions[column_key]`                 |
| E               | UNIT          | `additional_config.unit_mappings[column_key]` |

### 4.6 Seed Data Specification

#### Export Systems Seed

```python
export_systems = [
    {
        "system_name": "MES-TRACK",
        "format_type": "TYPE_A",
        "description": "Track equipment control system (SP + DEV categories)",
        "additional_config": {"categories": ["SP", "DEV"]},
        "is_active": True,
    },
    {
        "system_name": "EQP-SCANNER",
        "format_type": "TYPE_B",
        "description": "Scanner equipment parameter management (SC category)",
        "additional_config": {
            "categories": ["SC"],
            "equip_source": "equipment_assignments",
            "equip_vary_columns": ["SC_EXPOSE_ENERGY_mJ", "SC_EXPOSE_FOCUS_um"],
        },
        "is_active": True,
    },
    {
        "system_name": "SPC-OVL",
        "format_type": "TYPE_C",
        "description": "SPC overlay measurement system (OVL category)",
        "additional_config": {
            "categories": ["OVL"],
            "unit_mappings": {
                "OVL_SPEC_X_nm": "nm",
                "OVL_SPEC_Y_nm": "nm",
                "OVL_CORR_X_nm": "nm",
                "OVL_CORR_Y_nm": "nm",
                "OVL_REF_LAYER": "",
                "OVL_TOOL": "",
            },
        },
        "is_active": True,
    },
]
```

#### Equipment Assignments Seed (for Type B)

Equipment assignment seed data provides 3-5 scanner equipment entries per SC-category layer, each with equipment-specific parameter overrides for energy and focus values.

### 4.7 File Naming Convention

- Single system export: `{product_name}_{system_name}.xlsx`
- Multi-system ZIP: `{product_name}_export_{YYYYMMDD_HHMMSS}.zip`
- Sheet name within Excel: `{system_name}`

---

## 5. Traceability

| Requirement | PRD Section | Phase Task | Test Scenario   |
|-------------|-------------|------------|-----------------|
| REQ-001     | 7.1, 7.2    | 3-6/7/8    | TC-001, TC-002  |
| REQ-010~013 | 7.2 Type A  | 3-6, 3.12  | TC-010~TC-013   |
| REQ-020~024 | 7.2 Type B  | 3-7, 3.13  | TC-020~TC-024   |
| REQ-030~033 | 7.2 Type C  | 3-8, 3.14  | TC-030~TC-033   |
| REQ-040~042 | 7.3 (note)  | 3-7        | TC-040~TC-042   |
| REQ-050~057 | 3.2 API     | 3-15       | TC-050~TC-057   |
| REQ-060~067 | 3.5 UI      | 3-16       | TC-060~TC-067   |
| REQ-070~073 | Seed data   | 3-12       | TC-070          |
| REQ-075     | Model fix   | 3-6        | TC-075          |
| REQ-080~083 | 7.1         | 3-15       | TC-080~TC-083   |

---

## 6. Expert Consultation Recommendations

### Backend Expert (expert-backend)

**Recommended** for the following SPEC elements:
- Export service architecture design (strategy pattern for Type A/B/C)
- Database query optimization for JSONB extraction across multiple layers
- File streaming for large Excel downloads
- Alembic migration for `equipment_assignments` table

### Frontend Expert (expert-frontend)

**Recommended** for the following SPEC elements:
- Export panel component architecture and state management
- File download handling via Axios (blob response type)
- Preview table rendering with dynamic columns
- Conditional rendering based on project status

---

## 7. Glossary

| Term                  | Definition                                                                     |
|-----------------------|--------------------------------------------------------------------------------|
| Type A                | Horizontal export format - 1 row per layer with mapped columns                 |
| Type B                | Equipment-split export - same layer appears in multiple rows per equipment      |
| Type C                | Key-value transpose - each parameter becomes a row (PARAM_KEY/PARAM_VALUE/UNIT)|
| Column Mapping        | Configuration linking source column_key to target export column name           |
| Equipment Assignment  | Per-layer equipment allocation with optional parameter overrides                |
| additional_config     | JSONB field in export_systems for type-specific configuration                  |
| unit_mappings         | Type C specific config mapping column keys to unit strings                     |
