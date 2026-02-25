# SPEC-EQP-001: Column-Based Equipment Management

## Metadata

| Field       | Value                                                    |
|-------------|----------------------------------------------------------|
| SPEC ID     | SPEC-EQP-001                                             |
| Title       | Column-Based Equipment Management via Conditions JSONB   |
| Created     | 2026-02-24                                               |
| Status      | Completed                                                |
| Priority    | High                                                     |
| Phase       | 5                                                        |
| Assigned    | manager-ddd                                              |
| Related     | SPEC-EXPORT-001, SPEC-EXPORT-002, SPEC-BACKBONE-001      |

---

## 1. Environment

### 1.1 Current State

Equipment data is currently managed through a dedicated `equipment_assignments` table with the following structure:

- `equipment_assignments` table stores equipment name (`equipment_id` VARCHAR), per-equipment parameter overrides (`equipment_params` JSONB), and sort order per `project_layer_id`.
- Each project layer may have 3-5 equipment assignments (scanner IDs such as NSR-S322F-01, NSR-S631E-01, etc.).
- Equipment parameter overrides contain per-equipment values for columns like `SC_EXPOSE_ENERGY_mJ` and `SC_EXPOSE_FOCUS_um`.
- Export Type B queries this separate table to produce one Excel row per equipment per layer.
- Backbone copy, revision copy, and cross-line operations require separate equipment handling logic.

Supporting infrastructure (total ~1,235 lines of dedicated code):

| Component                   | File                                          | Lines |
|-----------------------------|-----------------------------------------------|-------|
| EquipmentAssignment model   | backend/app/models/export.py (lines 65-81)    | 17    |
| equipment_service.py        | backend/app/services/equipment_service.py     | 237   |
| equipment router            | backend/app/routers/equipment.py              | 97    |
| equipment schemas           | backend/app/schemas/equipment.py              | 51    |
| EquipmentPanel              | frontend/src/components/editor/EquipmentPanel.tsx | 211 |
| EquipmentForm               | frontend/src/components/editor/EquipmentForm.tsx  | 238 |
| useEquipment hook           | frontend/src/hooks/useEquipment.ts            | 90    |
| equipment API client        | frontend/src/api/equipment.ts                 | 60    |
| Equipment types             | frontend/src/types/export.ts (lines 126-141)  | 16    |

### 1.2 Pain Points

1. **Separate data lifecycle**: Equipment data lives outside the `conditions` JSONB, requiring independent CRUD logic, a dedicated API router (5 endpoints), and frontend components (EquipmentPanel, EquipmentForm, useEquipment).
2. **Backbone copy complexity**: When creating a project from backbone or replacing a layer's backbone source, equipment assignments must be copied separately from conditions. This adds complexity and risk of data inconsistency.
3. **Revision copy complexity**: Creating a new revision must duplicate both conditions and equipment_assignments, doubling the copy logic.
4. **Change tracking gap**: Edits to equipment assignments bypass the `change_logs` system designed for conditions JSONB cells. Equipment edits have no per-cell audit trail.
5. **Cross-line FK validity**: The equipment_id field is a free-form string with no FK to a master table, yet the separate-table architecture was originally intended to enable FK constraints that were never implemented.
6. **Export coupling**: Export Type B is tightly coupled to the `EquipmentAssignment` model, requiring JOIN queries and override-merge logic in `export_builders.py`.
7. **Excel convention mismatch**: The original semiconductor process condition Excel spreadsheet uses flat columns (eqp1, eqp1_et, eqp1_focus, ..., eqp20) rather than a normalized equipment table.

### 1.3 Excel Convention Reference

The industry-standard process condition Excel spreadsheet stores equipment data as regular columns:

```
| Layer | ... | eqp1 | eqp1_et | eqp1_focus | eqp2 | eqp2_et | eqp2_focus | ... | eqp20 | eqp20_et | eqp20_focus |
```

This flat-column approach is the target architecture for SPEC-EQP-001.

---

## 2. Assumptions

| ID   | Assumption                                                                                               | Confidence | Risk if Wrong                                                |
|------|----------------------------------------------------------------------------------------------------------|------------|--------------------------------------------------------------|
| A-01 | A maximum of 20 equipment slots per layer is sufficient for all production scenarios.                    | High       | Additional columns need to be added, but the pattern is extensible. |
| A-02 | Each equipment slot has exactly 2 associated parameter columns (ET and FOCUS).                           | High       | If more parameters are needed per equipment, additional column families must be added. |
| A-03 | The `select_options` for equipment name columns can reuse the existing `SCANNER_TOOL_OPTIONS` list.      | High       | If different equipment types are needed, the options list is extensible via Admin UI. |
| A-04 | The `conditions` JSONB flat structure can accommodate 60 additional keys without performance impact.     | High       | JSONB operations are O(n) on keys but 60 additional keys on ~350 existing is negligible. |
| A-05 | Existing backbone copy logic (which copies entire `conditions` JSONB) automatically includes equipment columns. | High | No risk; this is by design of the conditions JSONB approach. |
| A-06 | Export Type B can derive per-equipment rows by iterating over EQP_01..EQP_20 columns in conditions.     | High       | The iteration pattern is simpler than the current JOIN-based approach. |
| A-07 | The `equipment_assignments` table can be dropped after data migration with a rollback-safe Alembic migration. | Medium | Rollback requires re-creating the table and extracting data from conditions JSONB. |
| A-08 | All current equipment_assignments data can be mapped to sequential EQP_01..EQP_20 slots by sort_order.  | High       | Maximum observed is 5 assignments per layer; 20 slots is more than sufficient. |

---

## 3. Requirements

### R1: EQP Column Category and Column Definitions

**[Ubiquitous]** The system shall provide an EQP column category containing equipment columns in `column_definitions`, following the naming convention `EQP_{NN}`, `EQP_{NN}_ET`, and `EQP_{NN}_FOCUS` for slots 01 through 20.

- R1.1: A new `column_categories` row with `category_code = 'EQP'`, `category_name = 'Equipment'`, `sort_order = 5` shall be created.
- R1.2: 20 equipment name columns (`EQP_01` through `EQP_20`) shall be created with `data_type = 'select'` and `select_options` populated from `SCANNER_TOOL_OPTIONS`.
- R1.3: 20 expose energy columns (`EQP_01_ET` through `EQP_20_ET`) shall be created with `data_type = 'float'`, `unit = 'mJ'`.
- R1.4: 20 focus columns (`EQP_01_FOCUS` through `EQP_20_FOCUS`) shall be created with `data_type = 'float'`, `unit = 'um'`.
- R1.5: All 60 columns shall have `is_required = False` (equipment assignments are optional per layer).
- R1.6: Column `sort_order` values shall group each equipment slot together: EQP_01 (sort 1), EQP_01_ET (sort 2), EQP_01_FOCUS (sort 3), EQP_02 (sort 4), etc.

### R2: Equipment Dropdown via select_options

**[Event-Driven]** WHEN a user clicks on an EQP_{NN} cell in the AG Grid editor, THEN the system shall display a dropdown selector populated from the column's `select_options` list.

- R2.1: The existing `buildColumnDefs.ts` logic that auto-creates `agSelectCellEditor` for `data_type = 'select'` columns shall handle EQP columns without modification.
- R2.2: The `select_options` for all `EQP_{NN}` columns shall be identical and sourced from `SCANNER_TOOL_OPTIONS`.
- R2.3: Admin users shall be able to modify the `select_options` for EQP columns via the existing EnumManagementPage (Admin > Select Options).

### R3: Data Migration from equipment_assignments to Conditions JSONB

**[Event-Driven]** WHEN the Alembic migration runs, THEN the system shall transform existing `equipment_assignments` data into EQP columns within `project_layers.conditions` JSONB.

- R3.1: For each `project_layer`, equipment assignments (ordered by `sort_order`) shall be mapped to sequential slots: first assignment to EQP_01/EQP_01_ET/EQP_01_FOCUS, second to EQP_02/EQP_02_ET/EQP_02_FOCUS, etc.
- R3.2: The `equipment_id` value shall be written to `EQP_{NN}`.
- R3.3: The `equipment_params["SC_EXPOSE_ENERGY_mJ"]` value (if present) shall be written to `EQP_{NN}_ET`.
- R3.4: The `equipment_params["SC_EXPOSE_FOCUS_um"]` value (if present) shall be written to `EQP_{NN}_FOCUS`.
- R3.5: The `backbone_conditions` JSONB shall also be updated for project layers whose backbone source had equipment assignments.
- R3.6: The migration shall be reversible (downgrade function shall recreate the table and extract data back).

### R4: Export Type B Adaptation

**[State-Driven]** WHILE the export system is configured with `format_type = 'TYPE_B'`, the system shall read equipment data from the `conditions` JSONB EQP columns instead of querying the `equipment_assignments` table.

- R4.1: The `build_type_b_data` function shall iterate over `EQP_01` through `EQP_20` in the layer's `conditions` JSONB.
- R4.2: For each non-empty `EQP_{NN}` value, one output row shall be generated.
- R4.3: The `EQUIP_ID` output column shall be populated from `EQP_{NN}`.
- R4.4: For mapped columns that are designated as `equip_vary_columns` (e.g., `SC_EXPOSE_ENERGY_mJ`, `SC_EXPOSE_FOCUS_um`), the values shall be read from the corresponding `EQP_{NN}_ET` and `EQP_{NN}_FOCUS` columns respectively.
- R4.5: For mapped columns that are NOT `equip_vary_columns`, the base `conditions` value shall be used (shared across all equipment rows).
- R4.6: The `additional_config` for the EQP-SCANNER export system shall be updated: `equip_source` changed from `"equipment_assignments"` to `"conditions_eqp_columns"`.
- R4.7: A new `additional_config` field `equip_vary_mapping` shall map vary-column names to EQP parameter suffixes: `{"SC_EXPOSE_ENERGY_mJ": "_ET", "SC_EXPOSE_FOCUS_um": "_FOCUS"}`.
- R4.8: If a layer has no non-empty EQP columns, a single row with empty `EQUIP_ID` shall be produced (preserving current fallback behavior).

### R5: Legacy Code Cleanup

**[Event-Driven]** WHEN the column-based equipment system is fully operational, THEN the following legacy components shall be removed:

- R5.1: Backend model: `EquipmentAssignment` class from `models/export.py` (lines 65-81).
- R5.2: Backend service: `equipment_service.py` (entire file, 237 lines).
- R5.3: Backend router: `routers/equipment.py` (entire file, 97 lines, 5 endpoints).
- R5.4: Backend schemas: `schemas/equipment.py` (entire file, 51 lines).
- R5.5: Backend registration: Equipment router from `main.py` import and `include_router` call.
- R5.6: Backend export: `_get_equipment_assignments` method and all `EquipmentAssignment`-related parameters from `export_service.py`.
- R5.7: Frontend component: `EquipmentPanel.tsx` (entire file, 211 lines).
- R5.8: Frontend component: `EquipmentForm.tsx` (entire file, 238 lines).
- R5.9: Frontend hook: `useEquipment.ts` (entire file, 90 lines).
- R5.10: Frontend API client: `api/equipment.ts` (entire file, 60 lines).
- R5.11: Frontend types: `Equipment` and `EquipmentCreate` interfaces from `types/export.ts` (lines 126-141).
- R5.12: Frontend page: `EquipmentPanel` import and usage from `ConditionEditorPage.tsx`.
- R5.13: Backend seed: Equipment assignment seeding logic from `seed/runner.py`.
- R5.14: Database: `equipment_assignments` table dropped via Alembic migration.

### R6: Backbone and Revision Auto-Copy (Documentation Requirement)

**[Ubiquitous]** The system shall automatically include equipment columns in backbone copy and revision copy operations because they are stored in the `conditions` JSONB.

- R6.1: No new code is required for backbone copy. When `conditions` JSONB is copied from the backbone project layer, all EQP columns are included automatically.
- R6.2: No new code is required for layer-level backbone replacement. The replacement copies the entire `conditions` JSONB from the source layer.
- R6.3: No new code is required for revision creation. When a new draft revision is created from an Approved project, the `conditions` JSONB (including EQP columns) is copied.
- R6.4: No new code is required for change log tracking. Any edit to EQP columns in the conditions JSONB is automatically tracked by the existing `change_logs` system.

### R7: Unwanted Behaviors

- R7.1: **[Unwanted]** The system shall NOT allow direct insertion into the dropped `equipment_assignments` table after migration.
- R7.2: **[Unwanted]** The system shall NOT display the legacy EquipmentPanel in the condition editor UI after cleanup.
- R7.3: **[Unwanted]** The system shall NOT produce Export Type B output that references the `equipment_assignments` table after the adaptation is complete.
- R7.4: **[Unwanted]** If an EQP parameter column (e.g., `EQP_03_ET`) has a value but its corresponding equipment name column (`EQP_03`) is empty, the system shall NOT include that slot in Export Type B output.

---

## 4. Specifications

### 4.1 Database Changes

#### 4.1.1 New column_categories Row

| Field          | Value       |
|----------------|-------------|
| category_code  | EQP         |
| category_name  | Equipment   |
| sort_order     | 5           |

#### 4.1.2 New column_definitions Rows (60 total)

For each slot NN from 01 to 20:

| column_name      | display_name           | category | data_type | unit | is_required | select_options        | sort_order     |
|------------------|------------------------|----------|-----------|------|-------------|----------------------|----------------|
| EQP_{NN}         | Equipment {NN}         | EQP      | select    | null | false       | SCANNER_TOOL_OPTIONS | (NN-1)*3 + 1  |
| EQP_{NN}_ET      | Equipment {NN} ET      | EQP      | float     | mJ   | false       | null                 | (NN-1)*3 + 2  |
| EQP_{NN}_FOCUS   | Equipment {NN} Focus   | EQP      | float     | um   | false       | null                 | (NN-1)*3 + 3  |

#### 4.1.3 Conditions JSONB Structure Change

Before (equipment in separate table):
```json
{
  "SP_PR_TYPE": "KrF-A01",
  "SC_TOOL_ID": "NSR-S322F-01",
  "SC_EXPOSE_ENERGY_mJ": "38.2"
}
```

After (equipment as regular columns in same JSONB):
```json
{
  "SP_PR_TYPE": "KrF-A01",
  "SC_TOOL_ID": "NSR-S322F-01",
  "SC_EXPOSE_ENERGY_mJ": "38.2",
  "EQP_01": "NSR-S322F-01",
  "EQP_01_ET": "38.2",
  "EQP_01_FOCUS": "0.001",
  "EQP_02": "NSR-S322F-02",
  "EQP_02_ET": "37.7",
  "EQP_02_FOCUS": "-0.012",
  "EQP_03": "NSR-S631E-01",
  "EQP_03_ET": "39.2",
  "EQP_03_FOCUS": "0.025"
}
```

#### 4.1.4 Table Removal

The `equipment_assignments` table shall be dropped in the Alembic migration with a rollback-safe downgrade function that recreates the table schema and restores data.

### 4.2 API Changes

#### 4.2.1 Removed Endpoints (5 total)

| Method | Path                                                      | Description                |
|--------|-----------------------------------------------------------|----------------------------|
| GET    | /api/projects/{id}/layers/{lid}/equipment                 | List equipment (removed)   |
| POST   | /api/projects/{id}/layers/{lid}/equipment                 | Create equipment (removed) |
| PUT    | /api/projects/{id}/layers/{lid}/equipment/{eid}           | Update equipment (removed) |
| DELETE | /api/projects/{id}/layers/{lid}/equipment/{eid}           | Delete equipment (removed) |
| PUT    | /api/projects/{id}/layers/{lid}/equipment/reorder         | Reorder equipment (removed)|

#### 4.2.2 No New Endpoints Required

Equipment data is now edited through the existing conditions bulk save endpoint (`PUT /api/projects/{id}/conditions`). No new API endpoints are needed.

#### 4.2.3 Modified Export Behavior

The export endpoints remain unchanged in their HTTP signatures. Only the internal logic of `build_type_b_data` and `generate_type_b` changes to read from conditions JSONB instead of equipment_assignments.

### 4.3 UI Changes

#### 4.3.1 Removed Components

| Component       | File Path                                              |
|-----------------|--------------------------------------------------------|
| EquipmentPanel  | frontend/src/components/editor/EquipmentPanel.tsx      |
| EquipmentForm   | frontend/src/components/editor/EquipmentForm.tsx       |
| useEquipment    | frontend/src/hooks/useEquipment.ts                     |
| equipment API   | frontend/src/api/equipment.ts                          |

#### 4.3.2 New UI Behavior (Automatic via existing infrastructure)

- The EQP category appears as a new tab in the category tab bar alongside SP, SC, OVL, DEV.
- Equipment columns render in AG Grid with the same editing experience as all other columns.
- Equipment name columns (EQP_{NN}) display dropdown selectors via `agSelectCellEditor`.
- Equipment parameter columns (EQP_{NN}_ET, EQP_{NN}_FOCUS) display float input editors.
- Dirty cell tracking, auto-save, and bulk save work identically to other condition columns.
- The EquipmentPanel reference in ConditionEditorPage is removed; the panel slot is freed.

### 4.4 Seed Data Changes

#### 4.4.1 Column Seed (`seed/columns.py`)

- Add `{"category_code": "EQP", "category_name": "Equipment", "sort_order": 5}` to `CATEGORIES`.
- Add 60 EQP column definitions to `COLUMN_DEFS` using a programmatic loop for `EQP_01` through `EQP_20` with their `_ET` and `_FOCUS` variants.

#### 4.4.2 Conditions Seed (`seed/runner.py`)

- Replace the `equipment_assignments` INSERT block with logic that writes EQP columns directly into the `conditions` dict during project layer creation.
- Remove all references to `equipment_assignments` table.

#### 4.4.3 Export System Config Seed (`seed/runner.py`)

- Update the EQP-SCANNER system's `additional_config`:
  - `equip_source`: `"conditions_eqp_columns"` (was `"equipment_assignments"`)
  - Add `equip_vary_mapping`: `{"SC_EXPOSE_ENERGY_mJ": "_ET", "SC_EXPOSE_FOCUS_um": "_FOCUS"}`

### 4.5 Migration Strategy

**Upgrade path:**
1. Add EQP category to `column_categories` if not exists.
2. Add 60 EQP column definitions to `column_definitions`.
3. Read all `equipment_assignments` grouped by `project_layer_id`, ordered by `sort_order`.
4. For each project_layer, merge equipment data into `conditions` JSONB as `EQP_01`..`EQP_20` keys.
5. Also merge into `backbone_conditions` JSONB where the backbone source had equipment.
6. Update EQP-SCANNER export system `additional_config`.
7. Drop `equipment_assignments` table.

**Downgrade path:**
1. Recreate `equipment_assignments` table schema.
2. Extract EQP columns from `conditions` JSONB back into `equipment_assignments` rows.
3. Remove EQP keys from `conditions` and `backbone_conditions` JSONB.
4. Remove EQP column definitions from `column_definitions`.
5. Remove EQP category from `column_categories`.
6. Restore EQP-SCANNER export system `additional_config` to original.

---

## 5. Traceability

| Requirement | Milestone | Acceptance Criteria       |
|-------------|-----------|---------------------------|
| R1          | M1        | AC-01, AC-02              |
| R2          | M1, M3    | AC-03                     |
| R3          | M1        | AC-04, AC-05              |
| R4          | M2        | AC-06, AC-07, AC-08       |
| R5          | M3        | AC-09, AC-10, AC-11       |
| R6          | M1        | AC-12, AC-13, AC-14       |
| R7          | M2, M3    | AC-15                     |

---

## 6. Expert Consultation Recommendations

### Backend Expert Consultation

This SPEC involves database schema changes (new column category, data migration), export pipeline modification (Type B), and legacy code removal across models, services, routers, and schemas. Consulting `expert-backend` is recommended for:
- Migration strategy review (data integrity during equipment_assignments to JSONB migration)
- Export Type B redesign validation (ensure row-per-equipment logic produces correct output)
- Legacy cleanup sequencing (ensure no orphan references remain)

### Frontend Expert Consultation

The frontend changes are primarily removals (EquipmentPanel, EquipmentForm, etc.) plus verification that the existing AG Grid infrastructure handles EQP columns correctly. Consulting `expert-frontend` is recommended for:
- Verify `buildColumnDefs.ts` handles 60 additional columns without performance impact
- Confirm category tab rendering with 5 categories (SP, SC, OVL, DEV, EQP)
- Validate ConditionEditorPage layout after EquipmentPanel removal
