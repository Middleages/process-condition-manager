# SPEC-006: Acceptance Criteria

**SPEC ID**: SPEC-006
**Title**: Version History Enhancement & Change Log Accuracy Improvement
**Phase**: 3 (Workflow & Output)

---

## Milestone 1: Change Log Value Comparison Fix

### AC-1.1: Numeric Type Normalization (REQ-001)

```gherkin
Given the shared values_differ() function
When comparing old_value=490 (int) and new_value=490.0 (float)
Then the function returns False (values are equal)
  And no change_log entry would be created for this comparison
```

```gherkin
Given the shared values_differ() function
When comparing old_value=490 (int) and new_value=491 (int)
Then the function returns True (values are different)
  And a change_log entry would be created with old_value="490" and new_value="491"
```

```gherkin
Given the shared values_differ() function
When comparing old_value="1.50" (string) and new_value=1.5 (float)
Then the function returns False (numerically equal)
```

### AC-1.2: Consolidated Utility (REQ-002)

```gherkin
Given the backend codebase after SPEC-006 M1 implementation
When searching for "_values_differ" function definitions
Then exactly zero local definitions exist in condition_service.py, backbone_service.py, and recipe_service.py
  And all three files import values_differ from app.utils.comparison
```

### AC-1.3: Net-Zero Change Detection (REQ-003)

```gherkin
Given a project_layer with conditions = {"col_A": 100}
When a bulk save request submits {"col_A": 100} (same value)
Then the response shows 0 cells_changed
  And no new change_log entry is created for col_A
```

```gherkin
Given a project_layer with conditions = {"col_A": 100}
When a bulk save request submits {"col_A": 100.0} (float equivalent)
Then the response shows 0 cells_changed
  And no new change_log entry is created for col_A
```

### AC-1.4: Empty Value Equivalence (REQ-004)

```gherkin
Given the shared values_differ() function
When comparing old_value=None and new_value=""
Then the function returns False (both represent no value)
```

```gherkin
Given the shared values_differ() function
When comparing old_value="" and new_value="  " (whitespace only)
Then the function returns False (both normalize to None)
```

### AC-1.5: Whitespace Normalization (REQ-006)

```gherkin
Given the shared values_differ() function
When comparing old_value=" 490 " and new_value="490"
Then the function returns False (equal after whitespace stripping)
```

### AC-1.6: False-Positive Cleanup Migration (REQ-005)

```gherkin
Given existing change_logs with the following entries:
  | id | old_value | new_value | description           |
  | 1  | 490       | 490.0     | numeric false positive |
  | 2  | 100       | 200       | genuine change         |
  | 3  | null      | ""        | null/empty equivalent  |
  | 4  | abc       | def       | genuine text change    |
When the cleanup Alembic migration is executed
Then change_log id=1 is deleted (numeric equivalent)
  And change_log id=3 is deleted (null/empty equivalent)
  And change_log id=2 is preserved (genuine change)
  And change_log id=4 is preserved (genuine text change)
  And the migration logs "Deleted 2 false-positive change_log entries"
```

---

## Milestone 2: Revision Reason Storage

### AC-2.1: Revision Reason Column (REQ-101)

```gherkin
Given the database after running the revision_reason migration
When querying the projects table schema
Then the column "revision_reason" exists with type TEXT and nullable=True
  And all existing projects have revision_reason=NULL
```

### AC-2.2: Store Reason on Revision Creation (REQ-102)

```gherkin
Given an approved project with id=10
When a user creates a revision via POST /api/projects/10/revise
  with body {"description": "Update exposure parameters for new reticle"}
Then a new project is created with revision=original.revision+1
  And the new project's revision_reason equals "Update exposure parameters for new reticle"
```

```gherkin
Given an approved project with id=10
When a user creates a revision via POST /api/projects/10/revise
  with body {} (no description)
Then a new project is created with revision_reason=NULL
```

### AC-2.3: Return Reason in Version History API (REQ-103)

```gherkin
Given a product with two project versions:
  | project_id | revision | revision_reason                     |
  | 10         | 1        | NULL                                 |
  | 15         | 2        | "Update exposure for new reticle"    |
When the user requests GET /api/projects/15/version-history
Then the response contains versions with revision_reason fields:
  | revision | revision_reason                     |
  | 2        | "Update exposure for new reticle"    |
  | 1        | null                                 |
```

### AC-2.4: Display Reason in Version History Panel (REQ-104)

```gherkin
Given the VersionHistoryPanel is open
  And version v2 has revision_reason "Update exposure for new reticle"
  And version v1 has revision_reason null
When the user views the version list
Then v2 displays the truncated reason text below the creator/date
  And v1 does not display any reason text
  And hovering over the truncated text for v2 shows the full reason
```

### AC-2.5: Enhanced Revision Creation Modal (REQ-105)

```gherkin
Given an approved project
When the user opens the revision creation modal
Then the modal displays a multi-line text area (not a single-line input)
  And the label reads "Revision Reason (recommended)" or equivalent
  And the placeholder text guides the user (e.g., "Describe the changes...")
  And a character counter shows "0/500"
```

```gherkin
Given the revision creation modal is open
When the user types 450 characters into the reason field
Then the character counter shows "450/500"
  And the text area is still editable
```

```gherkin
Given the revision creation modal is open
When the user submits without entering a reason
Then the revision is created successfully with revision_reason=NULL
  And no validation error is shown (reason is recommended, not required)
```

---

## Milestone 3: Version Diff (JSONB Direct Comparison)

### AC-3.1: Version Diff API -- Basic Comparison (REQ-201)

```gherkin
Given two project versions for the same product:
  Project A (id=10, revision=1) with layers:
    | layer_id | conditions                    |
    | 1        | {"col_A": 490, "col_B": 100}  |
    | 2        | {"col_A": 200, "col_B": 300}  |
  Project B (id=15, revision=2) with layers:
    | layer_id | conditions                    |
    | 1        | {"col_A": 500, "col_B": 100}  |
    | 2        | {"col_A": 200, "col_B": 300}  |
When the user requests GET /api/projects/10/versions/15/diff
Then the response status is 200
  And summary.total_layers_changed equals 1
  And summary.total_cells_changed equals 1
  And layers contains one entry for layer_id=1
  And that entry's changes contains {"column_name": "col_A", "old_value": "490", "new_value": "500"}
  And layer_id=2 is NOT included (no changes)
```

### AC-3.2: Version Diff API -- Numeric Normalization (REQ-201 + REQ-001)

```gherkin
Given two project versions for the same product:
  Project A (id=10) with layer 1 conditions: {"col_A": 490}
  Project B (id=15) with layer 1 conditions: {"col_A": 490.0}
When the user requests GET /api/projects/10/versions/15/diff
Then summary.total_layers_changed equals 0
  And summary.total_cells_changed equals 0
  And layers is an empty list
```

### AC-3.3: Version Diff API -- Added/Removed Layers (REQ-201)

```gherkin
Given two project versions for the same product:
  Project A (id=10) with layers: [layer_id=1, layer_id=2]
  Project B (id=15) with layers: [layer_id=1, layer_id=3]
When the user requests GET /api/projects/10/versions/15/diff
Then layers contains an entry for layer_id=2 with change_type="removed"
  And layers contains an entry for layer_id=3 with change_type="added"
```

### AC-3.4: Version Diff API -- Authorization (REQ-202)

```gherkin
Given project_id=10 exists but compare_project_id=999 does not exist
When the user requests GET /api/projects/10/versions/999/diff
Then the response status is 404
```

```gherkin
Given project_id=10 (product_id=1) and compare_project_id=20 (product_id=2)
When the user requests GET /api/projects/10/versions/20/diff
Then the response status is 400
  And the error message indicates "Cannot compare projects from different products"
```

### AC-3.5: Diff Summary in Version History Panel (REQ-203)

```gherkin
Given the VersionHistoryPanel is open for a project with versions v1 and v2
  And the diff between v1 and v2 shows 5 layers and 23 cells changed
When the user views the version list
Then version v1 (the older version) displays a compact summary: "5 layers, 23 cells changed"
```

### AC-3.6: Expandable Layer Diff View (REQ-204)

```gherkin
Given the version diff view shows 3 changed layers
When the user clicks on a layer section header
Then the layer section expands to show a table of changed columns
  And each row shows: Column Name, Old Value, New Value
  And added values are highlighted in green
  And removed values are highlighted in red
  And modified values are highlighted in yellow
```

```gherkin
Given an expanded layer diff section
When the user clicks the layer section header again
Then the section collapses to show only the layer name and change count
```

### AC-3.7: Diff View Navigation to Cell History (REQ-205)

```gherkin
Given the version diff view shows a changed cell (layer_id=1, column_name="col_A")
When the user clicks on that cell change row
Then the existing cell history modal opens
  And it shows the full change_log lineage for layer_id=1, column_name="col_A"
```

---

## Definition of Done

### Milestone 1
- [ ] `backend/app/utils/comparison.py` created with `normalize_value()` and `values_differ()`
- [ ] Unit tests for comparison utility with 100% branch coverage
- [ ] All three service files import from shared utility (no local duplicates)
- [ ] Alembic data migration for false-positive cleanup (tested in staging)
- [ ] Integration tests verify no false-positive change_logs created
- [ ] All existing backend tests pass

### Milestone 2
- [ ] Alembic migration adds `revision_reason` column
- [ ] `revise_project()` stores description in `revision_reason`
- [ ] Version history API returns `revision_reason` per version
- [ ] `VersionHistoryPanel` displays revision reason (with truncation)
- [ ] `RevisionCreateModal` uses textarea with recommended label
- [ ] Frontend renders correctly with null/empty revision reasons

### Milestone 3
- [ ] Diff API endpoint returns correct diff for two project versions
- [ ] Diff uses normalized comparison (no false positives)
- [ ] 404 returned for non-existent projects, 400 for cross-product comparison
- [ ] Frontend VersionDiffView component renders expandable layer diffs
- [ ] VersionHistoryPanel shows diff summary per version
- [ ] Clicking cell change in diff opens cell history modal
- [ ] Diff API responds within 2 seconds for max-size products (60 layers x 300 columns)
