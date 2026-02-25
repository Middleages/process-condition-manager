# SPEC-EQP-001: Implementation Plan

## Overview

Replace the separate `equipment_assignments` table with column-based equipment management where equipment names and parameters are stored as regular columns in the `conditions` JSONB, matching the original Excel convention. This eliminates ~1,235 lines of dedicated equipment infrastructure and unifies equipment data with the existing conditions editing, backbone copy, revision, change tracking, and export pipelines.

---

## Milestone Summary

| Milestone | Title                                     | Priority       | Dependencies |
|-----------|-------------------------------------------|----------------|--------------|
| M1        | Backend: EQP Columns + Migration          | Primary Goal   | None         |
| M2        | Export Type B Adaptation                   | Primary Goal   | M1           |
| M3        | Legacy Cleanup (Backend + Frontend)        | Secondary Goal | M1, M2       |
| M4        | Admin select_options Management (Optional) | Optional Goal  | M1           |

---

## M1: Backend -- EQP Column Definitions + Seed + Migration

### Priority: Primary Goal

### Scope

Create the EQP column category and 60 column definitions, update seed data, and write the Alembic migration that transforms existing `equipment_assignments` data into conditions JSONB.

### Tasks

1. **Add EQP category and column definitions to seed**
   - File: `backend/app/seed/columns.py`
   - Add `{"category_code": "EQP", "category_name": "Equipment", "sort_order": 5}` to `CATEGORIES`.
   - Add 60 column definitions programmatically:
     - `EQP_01` through `EQP_20`: `data_type="select"`, `select_options=SCANNER_TOOL_OPTIONS`, `is_required=False`
     - `EQP_01_ET` through `EQP_20_ET`: `data_type="float"`, `unit="mJ"`, `is_required=False`
     - `EQP_01_FOCUS` through `EQP_20_FOCUS`: `data_type="float"`, `unit="um"`, `is_required=False`
   - Sort order: `(slot-1)*3 + 1` for name, `+2` for ET, `+3` for FOCUS.

2. **Update conditions seed to include EQP data**
   - File: `backend/app/seed/runner.py`
   - Replace the `equipment_assignments` INSERT block (lines ~434-462) with logic that:
     - Generates EQP column values in the `conditions` dict for each project layer.
     - Maps scanner assignments to sequential EQP_01..EQP_05 slots with ET and FOCUS values.
   - Remove all `equipment_assignments` table references from the seed.

3. **Update export system config seed**
   - File: `backend/app/seed/runner.py`
   - Change EQP-SCANNER `additional_config`:
     - `equip_source`: `"conditions_eqp_columns"` (was `"equipment_assignments"`)
     - Add `equip_vary_mapping`: `{"SC_EXPOSE_ENERGY_mJ": "_ET", "SC_EXPOSE_FOCUS_um": "_FOCUS"}`

4. **Create Alembic migration**
   - Generate migration: `alembic revision --autogenerate -m "eqp_columns_migration"`
   - Upgrade function:
     a. Insert EQP category into `column_categories`.
     b. Insert 60 EQP column definitions into `column_definitions`.
     c. Query all `equipment_assignments` grouped by `project_layer_id` ordered by `sort_order`.
     d. For each project_layer, build EQP key-value pairs and merge into `conditions` JSONB via `jsonb_set` or Python-side update.
     e. Merge into `backbone_conditions` JSONB where applicable.
     f. Update EQP-SCANNER export system config.
     g. Drop `equipment_assignments` table.
   - Downgrade function:
     a. Recreate `equipment_assignments` table schema.
     b. Extract EQP data from `conditions` JSONB back to rows.
     c. Remove EQP keys from `conditions` and `backbone_conditions`.
     d. Remove EQP column definitions and category.

5. **Verify backbone auto-copy includes EQP columns**
   - No code changes needed. Write characterization tests confirming:
     - Project creation from backbone copies EQP columns in conditions.
     - Layer-level backbone replacement copies EQP columns.
     - Revision creation copies EQP columns.

### Technical Approach

- The migration is data-heavy (reads all equipment_assignments, updates all project_layers.conditions JSONB). Use batch processing with commit intervals (e.g., 100 rows per batch) to avoid memory issues.
- For the JSONB merge, use PostgreSQL's `||` operator: `UPDATE project_layers SET conditions = conditions || :eqp_data WHERE id = :pl_id`.
- The seed update replaces imperative INSERT statements with declarative dict construction during conditions generation.

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Large migration on production DB with many project_layers | Medium | High | Batch processing, test on staging first, reversible migration |
| Missing equipment_assignments data (orphan rows without project_layer) | Low | Low | Query with INNER JOIN to project_layers |
| backbone_conditions not updated for all layers | Medium | Medium | Separate pass to update backbone_conditions for layers that had backbone equipment |

---

## M2: Export Type B Adaptation

### Priority: Primary Goal

### Scope

Rewrite the `build_type_b_data` function to read equipment data from conditions JSONB EQP columns instead of querying the `equipment_assignments` table.

### Tasks

1. **Rewrite `build_type_b_data` in `export_builders.py`**
   - File: `backend/app/services/export_builders.py`
   - Remove the `equipment: dict[int, list[EquipmentAssignment]]` parameter.
   - Add `equip_config: dict | None = None` parameter (from system's `additional_config`).
   - New logic:
     ```
     For each project_layer in layers:
       conditions = pl.conditions or {}
       equip_vary_mapping = equip_config.get("equip_vary_mapping", {})
       found_equipment = False
       For slot in range(1, 21):  # EQP_01 through EQP_20
         nn = f"{slot:02d}"
         eqp_name = conditions.get(f"EQP_{nn}", "")
         if not eqp_name:
           continue
         found_equipment = True
         row = {"LAYER_ID": pl.layer.layer_name, "PRODUCT_ID": product_name, "EQUIP_ID": eqp_name}
         For each mapping m:
           if m is condition-type and m.column_definition.column_name in equip_vary_mapping:
             suffix = equip_vary_mapping[m.column_definition.column_name]
             row[m.target_column_name] = conditions.get(f"EQP_{nn}{suffix}", "")
           else:
             row[m.target_column_name] = _get_mapping_value(m, conditions, ext_data, pl.id)
         rows.append(row)
       if not found_equipment:
         # Fallback: single row with empty EQUIP_ID (preserves current behavior)
         row = {"LAYER_ID": ..., "PRODUCT_ID": ..., "EQUIP_ID": ""}
         ...
     ```

2. **Update `generate_type_b` in `export_builders.py`**
   - File: `backend/app/services/export_builders.py`
   - Match the new signature of `build_type_b_data`.

3. **Update `export_service.py` to pass config instead of equipment**
   - File: `backend/app/services/export_service.py`
   - Remove `_get_equipment_assignments` method.
   - Remove all `EquipmentAssignment` imports.
   - For TYPE_B export calls, pass `system.additional_config` as `equip_config` parameter instead of fetching equipment_assignments.
   - Update all TYPE_B call sites: `generate_export`, `preview_export`, `_build_type_b_data`, `_generate_type_b`.

4. **Update export system model imports**
   - File: `backend/app/services/export_service.py`
   - Remove `EquipmentAssignment` from model imports.

### Technical Approach

- The new `build_type_b_data` iterates over a fixed range (1-20) checking for non-empty EQP columns, replacing the variable-length equipment_assignments list.
- The `equip_vary_mapping` config provides a declarative way to map vary-column names to EQP parameter suffixes, avoiding hardcoded column name checks.
- The fallback behavior (single row with empty EQUIP_ID when no equipment) preserves backward compatibility.

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Export Type B output differs from current output | Medium | High | Write comparison tests: run both old and new logic on same data, verify identical output |
| equip_vary_mapping config missing on existing systems | Low | Medium | Default to empty mapping; add migration to update existing export system configs |
| Performance regression iterating 20 slots vs. variable-length list | Low | Low | 20 iterations per layer is negligible; no DB query required |

---

## M3: Legacy Cleanup (Backend + Frontend)

### Priority: Secondary Goal

### Scope

Remove all legacy equipment infrastructure after M1 and M2 are verified.

### Tasks

#### Backend Cleanup

1. **Remove EquipmentAssignment model**
   - File: `backend/app/models/export.py`
   - Delete lines 65-81 (EquipmentAssignment class).
   - Remove from `__init__.py` model imports if present.

2. **Delete equipment service**
   - File: `backend/app/services/equipment_service.py` (entire file, 237 lines)

3. **Delete equipment router**
   - File: `backend/app/routers/equipment.py` (entire file, 97 lines)

4. **Delete equipment schemas**
   - File: `backend/app/schemas/equipment.py` (entire file, 51 lines)

5. **Remove equipment router registration**
   - File: `backend/app/main.py`
   - Remove `equipment` from the import line.
   - Remove `app.include_router(equipment.router)`.

6. **Clean up export_service.py**
   - Remove `_get_equipment_assignments` method.
   - Remove `EquipmentAssignment` from all imports.
   - Remove equipment-related parameters from `_build_type_b_data` and `_generate_type_b` wrapper methods.

7. **Clean up export_builders.py**
   - Remove `EquipmentAssignment` from imports.
   - Ensure no references to the old model remain.

8. **Remove equipment seed logic**
   - File: `backend/app/seed/runner.py`
   - Remove all `equipment_assignments` references (already done in M1 if seed was updated).

#### Frontend Cleanup

9. **Delete EquipmentPanel**
   - File: `frontend/src/components/editor/EquipmentPanel.tsx` (entire file, 211 lines)

10. **Delete EquipmentForm**
    - File: `frontend/src/components/editor/EquipmentForm.tsx` (entire file, 238 lines)

11. **Delete useEquipment hook**
    - File: `frontend/src/hooks/useEquipment.ts` (entire file, 90 lines)

12. **Delete equipment API client**
    - File: `frontend/src/api/equipment.ts` (entire file, 60 lines)

13. **Remove Equipment types from export.ts**
    - File: `frontend/src/types/export.ts`
    - Delete lines 126-141 (`Equipment` and `EquipmentCreate` interfaces).
    - Remove the `// ========== Equipment Types ==========` comment.

14. **Remove EquipmentPanel from ConditionEditorPage**
    - File: `frontend/src/pages/ConditionEditorPage.tsx`
    - Remove `import { EquipmentPanel }` statement.
    - Remove `<EquipmentPanel ... />` JSX element.

15. **Verify no remaining equipment references**
    - Run grep for `equipment`, `Equipment`, `useEquipment` across both `backend/` and `frontend/src/`.
    - Ensure zero references remain (except in migration files and SPEC documents).

### Technical Approach

- Cleanup should be done in a single commit after M1 and M2 are verified working.
- Use grep to find all references before deletion to avoid orphan imports.
- Frontend cleanup can be done in parallel with backend cleanup as they are independent.

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Orphan imports after deletion | Medium | Low | Run full grep scan after cleanup; fix any remaining references |
| TypeScript compilation errors | Medium | Medium | Run `npm run build` after cleanup to catch all type errors |
| Python import errors | Medium | Medium | Run `python -c "from app.main import app"` to verify import chain |

---

## M4: Admin select_options Management (Optional)

### Priority: Optional Goal

### Scope

Verify and document that the existing Admin > Select Options (EnumManagementPage) works for EQP columns.

### Tasks

1. **Verify EnumManagementPage lists EQP columns**
   - The page queries all columns with `data_type = 'select'` -- EQP_01 through EQP_20 should appear automatically.
   - Verify that editing `select_options` for an EQP column updates the dropdown in the AG Grid editor.

2. **Document the workflow**
   - Admin navigates to Admin > Select Options.
   - Filters by EQP category.
   - Edits the select_options list for any EQP_XX column.
   - New equipment names become available in the dropdown.

### Technical Approach

- No code changes expected. This milestone is verification-only.
- If the EnumManagementPage does not filter by category, consider adding a category filter (minor enhancement).

---

## Dependencies

```
M1 (EQP Columns + Migration)
 |
 +---> M2 (Export Type B Adaptation)
 |      |
 +------+---> M3 (Legacy Cleanup)
 |
 +---> M4 (Admin Verification) [Optional, independent]
```

- M1 must be complete before M2 can begin (Type B needs EQP data in conditions).
- M3 requires both M1 and M2 to be verified before removing legacy code.
- M4 can be done any time after M1.

---

## Technical Approach Summary

### Architecture Decision: Column-Based over Table-Based

| Aspect                | Table-Based (Current)              | Column-Based (Target)             |
|-----------------------|------------------------------------|-----------------------------------|
| Storage               | Separate `equipment_assignments`   | `conditions` JSONB                |
| CRUD API              | 5 dedicated endpoints              | Existing bulk save endpoint       |
| Backbone copy         | Separate copy logic needed         | Automatic (JSONB is copied)       |
| Revision copy         | Separate copy logic needed         | Automatic (JSONB is copied)       |
| Change tracking       | Not tracked in change_logs         | Automatic (JSONB cell tracking)   |
| Validation            | Custom validation in service       | Existing column_validations       |
| AG Grid editing       | Custom EquipmentPanel              | Standard grid cell editing        |
| Export Type B         | JOIN query + override merge        | Iterate EQP columns in conditions |
| Admin management      | N/A                                | EnumManagementPage (existing)     |
| Code to maintain      | ~1,235 lines                       | ~0 new lines (reuses existing)    |

### Key Design Decisions

1. **20 equipment slots**: Based on industry practice (max ~10-15 equipment per layer in production). 20 provides comfortable headroom.
2. **Fixed parameter columns (ET, FOCUS)**: These are the only per-equipment varying parameters in the current data. If additional parameters are needed in the future, new column families (e.g., `EQP_XX_DOSE`) can be added following the same pattern.
3. **select_options from SCANNER_TOOL_OPTIONS**: Reuses the existing scanner list already used for `SC_TOOL_ID`. Admin can modify via EnumManagementPage.
4. **Export Type B config-driven**: The `equip_vary_mapping` in `additional_config` makes the vary-column-to-EQP-suffix mapping declarative and extensible.

---

## Files Changed Summary

### New Files
- `backend/alembic/versions/xxx_eqp_columns_migration.py` (Alembic migration)

### Modified Files
- `backend/app/seed/columns.py` (add EQP category + 60 columns)
- `backend/app/seed/runner.py` (replace equipment_assignments with EQP conditions, update export config)
- `backend/app/services/export_builders.py` (rewrite build_type_b_data)
- `backend/app/services/export_service.py` (remove equipment queries, pass config)
- `backend/app/main.py` (remove equipment router)
- `backend/app/models/export.py` (remove EquipmentAssignment class)
- `frontend/src/pages/ConditionEditorPage.tsx` (remove EquipmentPanel)
- `frontend/src/types/export.ts` (remove Equipment types)

### Deleted Files
- `backend/app/services/equipment_service.py`
- `backend/app/routers/equipment.py`
- `backend/app/schemas/equipment.py`
- `frontend/src/components/editor/EquipmentPanel.tsx`
- `frontend/src/components/editor/EquipmentForm.tsx`
- `frontend/src/hooks/useEquipment.ts`
- `frontend/src/api/equipment.ts`

### Net Code Change
- Approximately **-1,100 lines removed** (legacy cleanup)
- Approximately **+200 lines added** (migration, seed updates, export rewrite)
- Net: **~900 lines reduction**
