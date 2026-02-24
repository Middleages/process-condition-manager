# SPEC-EQP-001: Acceptance Criteria

## Quality Gate Criteria

- All EARS requirements (R1--R7) implemented and verified
- Alembic migration runs successfully (upgrade and downgrade)
- Export Type B output is identical to current output for migrated data
- All legacy equipment code removed with zero orphan references
- Existing tests pass (no regressions)
- Backend: `pytest` passes with 85%+ coverage on changed files
- Frontend: `npm run build` succeeds with zero TypeScript errors

---

## AC-01: EQP Column Category Exists

**Requirement:** R1.1

```gherkin
Given the database has been seeded or migrated
When I query column_categories
Then a row with category_code = 'EQP' and category_name = 'Equipment' and sort_order = 5 shall exist
```

---

## AC-02: EQP Column Definitions Are Complete

**Requirement:** R1.2, R1.3, R1.4, R1.5, R1.6

```gherkin
Given the database has been seeded or migrated
When I query column_definitions where category = EQP
Then exactly 60 rows shall exist

And for each slot NN from 01 to 20:
  | column_name    | data_type | unit | is_required | select_options           |
  | EQP_{NN}       | select    | null | false       | SCANNER_TOOL_OPTIONS     |
  | EQP_{NN}_ET    | float     | mJ   | false       | null                     |
  | EQP_{NN}_FOCUS | float     | um   | false       | null                     |

And the sort_order for EQP_{NN} = (NN-1)*3 + 1
And the sort_order for EQP_{NN}_ET = (NN-1)*3 + 2
And the sort_order for EQP_{NN}_FOCUS = (NN-1)*3 + 3
```

---

## AC-03: Equipment Dropdown Works in AG Grid

**Requirement:** R2.1, R2.2, R2.3

```gherkin
Given the user is editing a project in the condition editor
And the EQP category tab is selected
When the user clicks on an EQP_01 cell
Then a dropdown selector shall appear with values from SCANNER_TOOL_OPTIONS

When the user selects "NSR-S322F-01" from the dropdown
Then the cell value shall be set to "NSR-S322F-01"
And the cell shall be marked as dirty

When the user clicks on an EQP_01_ET cell
Then a float input editor shall appear (not a dropdown)

When the user enters "38.5" in the EQP_01_ET cell
Then the cell value shall be set to "38.5"
And the cell shall be marked as dirty
```

---

## AC-04: Data Migration Transforms Equipment Assignments

**Requirement:** R3.1, R3.2, R3.3, R3.4

```gherkin
Given a project_layer with 3 equipment_assignments:
  | sort_order | equipment_id   | equipment_params                                                     |
  | 1          | NSR-S322F-01   | {"SC_EXPOSE_ENERGY_mJ": "38.2", "SC_EXPOSE_FOCUS_um": "0.001"}      |
  | 2          | NSR-S322F-02   | {"SC_EXPOSE_ENERGY_mJ": "37.7", "SC_EXPOSE_FOCUS_um": "-0.012"}     |
  | 3          | NSR-S631E-01   | {"SC_EXPOSE_ENERGY_mJ": "39.2", "SC_EXPOSE_FOCUS_um": "0.025"}      |

When the Alembic upgrade migration runs
Then the project_layer.conditions JSONB shall contain:
  | key            | value          |
  | EQP_01         | NSR-S322F-01   |
  | EQP_01_ET      | 38.2           |
  | EQP_01_FOCUS   | 0.001          |
  | EQP_02         | NSR-S322F-02   |
  | EQP_02_ET      | 37.7           |
  | EQP_02_FOCUS   | -0.012         |
  | EQP_03         | NSR-S631E-01   |
  | EQP_03_ET      | 39.2           |
  | EQP_03_FOCUS   | 0.025          |

And the existing conditions keys (SP_*, SC_*, OVL_*, DEV_*) shall be unchanged
And EQP_04 through EQP_20 shall not be present in the JSONB (empty slots are omitted)
```

---

## AC-05: Migration Is Reversible

**Requirement:** R3.6

```gherkin
Given the Alembic upgrade migration has been applied
And equipment data exists in conditions JSONB as EQP columns

When the Alembic downgrade migration runs
Then the equipment_assignments table shall be recreated
And for each project_layer with EQP columns:
  equipment_assignments rows shall be created matching the EQP data
And the EQP keys shall be removed from conditions JSONB
And the EQP keys shall be removed from backbone_conditions JSONB
And the EQP column definitions shall be removed from column_definitions
And the EQP category shall be removed from column_categories
```

---

## AC-06: Export Type B Produces Correct Per-Equipment Rows

**Requirement:** R4.1, R4.2, R4.3, R4.4, R4.5

```gherkin
Given a project layer with conditions:
  | key                  | value          |
  | SC_TOOL_ID           | NSR-S322F-01   |
  | SC_EXPOSE_ENERGY_mJ  | 38.0           |
  | SC_EXPOSE_FOCUS_um   | 0.000          |
  | EQP_01               | NSR-S322F-01   |
  | EQP_01_ET            | 38.2           |
  | EQP_01_FOCUS         | 0.001          |
  | EQP_02               | NSR-S322F-02   |
  | EQP_02_ET            | 37.7           |
  | EQP_02_FOCUS         | -0.012         |

And the export system has:
  equip_vary_columns: ["SC_EXPOSE_ENERGY_mJ", "SC_EXPOSE_FOCUS_um"]
  equip_vary_mapping: {"SC_EXPOSE_ENERGY_mJ": "_ET", "SC_EXPOSE_FOCUS_um": "_FOCUS"}

When Export Type B is generated
Then 2 rows shall be produced for this layer:
  Row 1:
    | EQUIP_ID       | SC_EXPOSE_ENERGY_mJ | SC_EXPOSE_FOCUS_um | SC_TOOL_ID     |
    | NSR-S322F-01   | 38.2                | 0.001              | NSR-S322F-01   |
  Row 2:
    | EQUIP_ID       | SC_EXPOSE_ENERGY_mJ | SC_EXPOSE_FOCUS_um | SC_TOOL_ID     |
    | NSR-S322F-02   | 37.7                | -0.012             | NSR-S322F-01   |

Note: SC_TOOL_ID is NOT in equip_vary_columns, so it uses the base conditions value for both rows.
Note: SC_EXPOSE_ENERGY_mJ IS in equip_vary_columns, so Row 1 uses EQP_01_ET and Row 2 uses EQP_02_ET.
```

---

## AC-07: Export Type B Config Updated

**Requirement:** R4.6, R4.7

```gherkin
Given the EQP-SCANNER export system in the database
When I query its additional_config
Then it shall contain:
  | key                | value                                                        |
  | equip_source       | conditions_eqp_columns                                       |
  | equip_vary_mapping | {"SC_EXPOSE_ENERGY_mJ": "_ET", "SC_EXPOSE_FOCUS_um": "_FOCUS"} |
  | equip_vary_columns | ["SC_EXPOSE_ENERGY_mJ", "SC_EXPOSE_FOCUS_um"]                |
  | categories         | ["SC"]                                                       |
```

---

## AC-08: Export Type B Fallback for No Equipment

**Requirement:** R4.8, R7.4

```gherkin
Given a project layer with conditions containing no EQP columns
  (EQP_01 through EQP_20 are all empty or missing)
When Export Type B is generated
Then exactly 1 row shall be produced for this layer with EQUIP_ID = ""
And all mapped column values shall come from the base conditions

Given a project layer with conditions:
  | EQP_03    |           | (empty)
  | EQP_03_ET | 39.0      | (has value but name is empty)
When Export Type B is generated
Then slot 03 shall NOT produce an output row (R7.4)
```

---

## AC-09: Legacy Backend Code Removed

**Requirement:** R5.1, R5.2, R5.3, R5.4, R5.5, R5.6, R5.13, R5.14

```gherkin
Given the legacy cleanup is complete
Then the following files shall not exist:
  | File Path                                     |
  | backend/app/services/equipment_service.py     |
  | backend/app/routers/equipment.py              |
  | backend/app/schemas/equipment.py              |

And the EquipmentAssignment class shall not exist in backend/app/models/export.py
And "equipment" shall not appear in backend/app/main.py router imports
And "_get_equipment_assignments" method shall not exist in export_service.py
And "EquipmentAssignment" shall not appear in export_service.py or export_builders.py
And "equipment_assignments" INSERT statements shall not appear in seed/runner.py
And the equipment_assignments table shall not exist in the database
```

---

## AC-10: Legacy Frontend Code Removed

**Requirement:** R5.7, R5.8, R5.9, R5.10, R5.11, R5.12

```gherkin
Given the legacy cleanup is complete
Then the following files shall not exist:
  | File Path                                               |
  | frontend/src/components/editor/EquipmentPanel.tsx       |
  | frontend/src/components/editor/EquipmentForm.tsx        |
  | frontend/src/hooks/useEquipment.ts                      |
  | frontend/src/api/equipment.ts                           |

And the Equipment and EquipmentCreate interfaces shall not exist in frontend/src/types/export.ts
And EquipmentPanel shall not be imported or used in frontend/src/pages/ConditionEditorPage.tsx
And `npm run build` shall succeed with zero TypeScript errors
```

---

## AC-11: No Orphan Equipment References

**Requirement:** R5 (all sub-requirements)

```gherkin
Given all legacy cleanup is complete
When I search the codebase for "equipment" (case-insensitive)
Then the only matches shall be:
  - Alembic migration files (migration history)
  - SPEC documents (.moai/specs/)
  - ext_eqp_status table references (external data source, unrelated)
  - Git history (immutable)

And no Python import shall reference equipment_service, equipment router, or EquipmentAssignment
And no TypeScript import shall reference equipment.ts, EquipmentPanel, EquipmentForm, or useEquipment
```

---

## AC-12: Backbone Copy Includes EQP Columns

**Requirement:** R6.1

```gherkin
Given a backbone project with Approved status
And its project_layers contain EQP columns in conditions JSONB:
  | EQP_01 | NSR-S322F-01 |
  | EQP_01_ET | 38.2 |
  | EQP_01_FOCUS | 0.001 |

When a new project is created using this backbone
Then the new project's project_layers.conditions shall contain the same EQP values
And the new project's project_layers.backbone_conditions shall contain the same EQP values
And no separate equipment copy logic shall have executed
```

---

## AC-13: Revision Copy Includes EQP Columns

**Requirement:** R6.3

```gherkin
Given an Approved project with EQP columns in its conditions JSONB
When a new revision is created via POST /api/projects/{id}/revise
Then the new Draft project's conditions JSONB shall contain all EQP values from the Approved version
And no separate equipment copy logic shall have executed
```

---

## AC-14: Change Log Tracks EQP Edits

**Requirement:** R6.4

```gherkin
Given a user edits EQP_02 from "NSR-S322F-02" to "NSR-S631E-01" in the condition editor
And the user clicks Save (bulk save)
When I query change_logs for this project_layer
Then a change_log entry shall exist with:
  | column_name | old_value      | new_value      |
  | EQP_02      | NSR-S322F-02   | NSR-S631E-01   |
```

---

## AC-15: Unwanted Behaviors Are Prevented

**Requirement:** R7.1, R7.2, R7.3, R7.4

```gherkin
# R7.1: Table does not exist
Given the migration has been applied
When I attempt to INSERT into equipment_assignments
Then a database error shall occur (table does not exist)

# R7.2: No EquipmentPanel in UI
Given the user opens the condition editor for any project
Then no EquipmentPanel component shall be rendered
And the EQP tab in the category bar shall be the only way to view/edit equipment

# R7.3: Export does not reference equipment_assignments
Given Export Type B is generated for any project
Then no SQL query to equipment_assignments shall be executed
And the export shall read equipment data exclusively from conditions JSONB

# R7.4: Empty equipment name blocks export row
Given a project layer with EQP_05_ET = "39.0" but EQP_05 = "" (empty)
When Export Type B is generated
Then no row shall be produced for equipment slot 05
```

---

## Regression Test Scenarios

### REG-01: Export Type B Output Parity

```gherkin
Given the seed data has been applied with EQP columns in conditions
When Export Type B is generated for the PROD-2024X project
Then the Excel output shall contain:
  - One header row with LAYER_ID, PRODUCT_ID, EQUIP_ID, and mapped columns
  - Multiple rows per layer (one per non-empty equipment slot)
  - Equipment-specific values in equip_vary_columns
  - Shared base values in non-vary columns
And the row count per layer shall match the number of non-empty EQP slots
```

### REG-02: Export Type A Not Affected

```gherkin
Given Export Type A is generated for any project
Then the output shall be identical to before the EQP migration
And no EQP columns shall appear in Type A output (unless explicitly mapped)
```

### REG-03: Export Type C Not Affected

```gherkin
Given Export Type C is generated for any project
Then the output shall be identical to before the EQP migration
And no EQP columns shall appear in Type C output (unless explicitly mapped)
```

### REG-04: Bulk Save Works with EQP Columns

```gherkin
Given the user has edited EQP_01, EQP_01_ET, and SC_EXPOSE_ENERGY_mJ cells
When the user clicks Save (bulk save via PUT /api/projects/{id}/conditions)
Then all three values shall be saved to the conditions JSONB
And change_log entries shall be created for each changed cell
```

### REG-05: Validation Framework Works with EQP Columns

```gherkin
Given a column_validation rule for EQP_01_ET with rule_type = 'range' and rule_config = {"min": 0, "max": 100}
When the user enters "150" in the EQP_01_ET cell
Then a validation error shall be displayed
And the cell shall be highlighted in the validation panel
```

### REG-06: Cross-Layer Validation Not Affected

```gherkin
Given existing cross-layer validation rules for SC category columns
When the EQP migration is complete
Then all existing cross-layer validations shall continue to work unchanged
And EQP columns shall not interfere with existing validation logic
```

---

## Definition of Done

- [ ] EQP category and 60 column definitions exist in the database
- [ ] Alembic migration successfully converts equipment_assignments data to conditions JSONB
- [ ] Alembic downgrade successfully reverses the migration
- [ ] Export Type B produces correct per-equipment rows from conditions JSONB
- [ ] Export Type B config uses `conditions_eqp_columns` as equip_source
- [ ] All 11 legacy files/components removed (5 backend files, 4 frontend files, 2 partial cleanups)
- [ ] No orphan references to equipment infrastructure remain in codebase
- [ ] AG Grid displays EQP tab with dropdown editing for equipment name columns
- [ ] Backbone copy includes EQP columns automatically
- [ ] Revision copy includes EQP columns automatically
- [ ] Change log tracks EQP column edits
- [ ] `pytest` passes with no regressions
- [ ] `npm run build` succeeds with no TypeScript errors
- [ ] Seed data generates EQP columns in conditions instead of equipment_assignments rows
