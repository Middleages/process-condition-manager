# SPEC-002: Acceptance Criteria

**SPEC ID**: SPEC-002
**Title**: Conditional Validation Enhancement + Revision Feature

---

## Sprint 2.4: Conditional Validation Enhancement

### AC-2.4-001: Backend Extended Operator - equals (Existing Behavior Preserved)

```gherkin
Feature: Conditional required validation with equals operator

  Scenario: Condition met with equals operator - target empty
    Given a project with layer "AA_PHOTO"
    And column "SP_ADHESION_TYPE" has a conditional_required rule:
      | condition_column | condition_value | operator |
      | SP_ADHESION_USE  | Y               | equals   |
    And layer conditions contain "SP_ADHESION_USE" = "Y"
    And layer conditions do not contain "SP_ADHESION_TYPE"
    When the backend validation runs
    Then a "conditional_required" error is reported for "SP_ADHESION_TYPE"

  Scenario: Condition not met with equals operator
    Given a project with layer "AA_PHOTO"
    And column "SP_ADHESION_TYPE" has the same conditional_required rule
    And layer conditions contain "SP_ADHESION_USE" = "N"
    When the backend validation runs
    Then no "conditional_required" error is reported for "SP_ADHESION_TYPE"

  Scenario: Missing operator field defaults to equals
    Given a conditional_required rule with no "operator" field in rule_config
    And the condition column value matches the condition_value
    And the target column is empty
    When the backend validation runs
    Then a "conditional_required" error is reported (equals behavior)
```

### AC-2.4-002: Backend Extended Operator - not_equals

```gherkin
Feature: Conditional required validation with not_equals operator

  Scenario: Condition met with not_equals - values differ
    Given a project with layer "AA_PHOTO"
    And column "SP_ADHESION_TYPE" has a conditional_required rule:
      | condition_column | condition_value | operator   |
      | SP_ADHESION_USE  | N               | not_equals |
    And layer conditions contain "SP_ADHESION_USE" = "Y"
    And layer conditions do not contain "SP_ADHESION_TYPE"
    When the backend validation runs
    Then a "conditional_required" error is reported for "SP_ADHESION_TYPE"
    Because "Y" != "N" means the not_equals condition is met

  Scenario: Condition not met with not_equals - values equal
    Given the same conditional_required rule with not_equals
    And layer conditions contain "SP_ADHESION_USE" = "N"
    When the backend validation runs
    Then no "conditional_required" error is reported for "SP_ADHESION_TYPE"
    Because "N" == "N" means the not_equals condition is NOT met
```

### AC-2.4-003: Backend Extended Operator - contains

```gherkin
Feature: Conditional required validation with contains operator

  Scenario: Condition met with contains - substring match
    Given a project with layer "AA_PHOTO"
    And column "SP_ADHESION_TEMP_C" has a conditional_required rule:
      | condition_column | condition_value | operator |
      | SP_PR_TYPE       | KrF             | contains |
    And layer conditions contain "SP_PR_TYPE" = "KrF-A01"
    And layer conditions do not contain "SP_ADHESION_TEMP_C"
    When the backend validation runs
    Then a "conditional_required" error is reported for "SP_ADHESION_TEMP_C"
    Because "KrF-A01" contains "KrF"

  Scenario: Condition not met with contains - no substring match
    Given the same conditional_required rule with contains
    And layer conditions contain "SP_PR_TYPE" = "ArF-C01"
    When the backend validation runs
    Then no "conditional_required" error is reported for "SP_ADHESION_TEMP_C"
    Because "ArF-C01" does not contain "KrF"

  Scenario: Contains with empty actual value
    Given the same conditional_required rule with contains
    And layer conditions contain "SP_PR_TYPE" = ""
    When the backend validation runs
    Then no "conditional_required" error is reported for "SP_ADHESION_TEMP_C"
    Because "" does not contain "KrF"
```

### AC-2.4-004: Frontend Extended Operators

```gherkin
Feature: Frontend conditional required validation with all operators

  Scenario Outline: Frontend operator validation mirrors backend
    Given a column definition with conditional_required rule:
      | condition_column | condition_value | operator   |
      | dep_col          | <cond_val>      | <operator> |
    And row conditions contain "dep_col" = <actual_val>
    And the target cell value is <target_val>
    When validateCellValue is called
    Then <error_count> error(s) are returned

    Examples:
      | operator   | cond_val | actual_val | target_val | error_count |
      | equals     | Y        | Y          | null       | 1           |
      | equals     | Y        | N          | null       | 0           |
      | not_equals | N        | Y          | null       | 1           |
      | not_equals | N        | N          | null       | 0           |
      | contains   | KrF      | KrF-A01    | null       | 1           |
      | contains   | KrF      | ArF-C01    | null       | 0           |
```

### AC-2.4-005: Cross-Field Re-Validation Trigger

```gherkin
Feature: Cross-field re-validation when condition column changes

  Scenario: Editing condition column triggers dependent column validation
    Given a project with layer "AA_PHOTO" in draft status
    And column "SP_ADHESION_TYPE" has conditional_required rule on "SP_ADHESION_USE" = "Y"
    And column "SP_ADHESION_TEMP_C" has conditional_required rule on "SP_ADHESION_USE" = "Y"
    And current conditions: SP_ADHESION_USE = "N", SP_ADHESION_TYPE = (empty), SP_ADHESION_TEMP_C = (empty)
    And no validation errors are displayed
    When the user changes "SP_ADHESION_USE" from "N" to "Y"
    Then validation errors appear for both "SP_ADHESION_TYPE" and "SP_ADHESION_TEMP_C"
    Because the condition is now met and both dependent columns are empty

  Scenario: Editing condition column to non-triggering value clears dependent errors
    Given validation errors exist for "SP_ADHESION_TYPE" and "SP_ADHESION_TEMP_C"
    And SP_ADHESION_USE is currently "Y"
    When the user changes "SP_ADHESION_USE" from "Y" to "N"
    Then validation errors for "SP_ADHESION_TYPE" and "SP_ADHESION_TEMP_C" are cleared
    Because the condition is no longer met

  Scenario: Editing a non-condition column does not trigger cross-field validation
    Given a project with conditions being edited
    When the user changes "SP_SPIN1_SPEED_rpm" value
    Then only "SP_SPIN1_SPEED_rpm" is validated (no cross-field validation triggered)
```

### AC-2.4-006: Admin UI Operator Selection

```gherkin
Feature: Admin can select operator for conditional_required rules

  Scenario: Creating new conditional_required rule with operator
    Given the admin is on the validation rules page
    And they click "Add Rule" for a column
    When they select rule type "conditional_required"
    Then an operator dropdown appears with options: equals, not_equals, contains
    And the default selected operator is "equals"

  Scenario: Editing existing conditional_required rule shows current operator
    Given a conditional_required rule exists with operator "contains"
    When the admin opens the edit modal for this rule
    Then the operator dropdown shows "contains" as the selected value
```

---

## Sprint 2.5: Revision Feature

### AC-2.5-001: Revision Creation - Happy Path

```gherkin
Feature: Create a new revision from an approved project

  Scenario: Successfully create revision from approved project
    Given a project "PROD-2025A" with status "approved", revision 1
    And the project has 45 layers with conditions data
    When the user sends POST /api/projects/{id}/revise with created_by = 1
    Then the response status is 201
    And the response contains a new project with:
      | field              | expected_value |
      | status             | draft          |
      | revision           | 2              |
      | parent_project_id  | {original_id}  |
      | is_latest          | true           |
      | product_id         | (same as original) |
      | main_backbone_id   | (same as original) |
    And the new project has 45 layers
    And each layer's conditions match the original's conditions
    And each layer's backbone_conditions match the original's conditions
    And the original project now has:
      | field     | expected_value |
      | status    | archived       |
      | is_latest | false          |
```

### AC-2.5-002: Revision Creation - Error Cases

```gherkin
Feature: Revision creation error handling

  Scenario: Cannot create revision from non-approved project
    Given a project with status "draft"
    When the user sends POST /api/projects/{id}/revise
    Then the response status is 400
    And the error message indicates the project must be approved

  Scenario: Cannot create revision when active project exists
    Given project A for "PROD-2025A" with status "approved"
    And project B for "PROD-2025A" with status "draft"
    When the user sends POST /api/projects/{id}/revise for project A
    Then the response status is 409
    And the error message indicates an active project already exists

  Scenario: Cannot create revision for non-existent project
    Given project ID 99999 does not exist
    When the user sends POST /api/projects/99999/revise
    Then the response status is 404
```

### AC-2.5-003: Archived Status Protection

```gherkin
Feature: Archived projects are read-only

  Scenario: Cannot bulk save to archived project
    Given a project with status "archived"
    When the user sends PUT /api/projects/{id}/conditions (bulk save)
    Then the response status is 403
    And the error message indicates the project cannot be modified

  Scenario: Cannot change archived project status
    Given a project with status "archived"
    When the user sends PATCH /api/projects/{id}/status
    Then the response status is 403

  Scenario: Cannot replace backbone on archived project
    Given a project with status "archived"
    When the user sends PUT /api/projects/{id}/layers/{layerId}/backbone
    Then the response status is 403

  Scenario: Cannot apply recipe to archived project
    Given a project with status "archived"
    When the user sends POST /api/projects/{id}/recipe/apply
    Then the response status is 403

  Scenario: Cannot delete layer from archived project
    Given a project with status "archived"
    When the user sends DELETE /api/projects/{id}/layers/{layerId}
    Then the response status is 403
```

### AC-2.5-004: Version History API

```gherkin
Feature: Version history for a product

  Scenario: Get revision history with multiple versions
    Given "PROD-2025A" has 3 project versions:
      | project_id | revision | status   |
      | 1          | 1        | archived |
      | 5          | 2        | archived |
      | 12         | 3        | draft    |
    When the user sends GET /api/products/{productId}/revisions
    Then the response contains 3 items ordered by revision descending
    And each item includes: project_id, revision, status, creator_name, created_at

  Scenario: Get revision history for product with single version
    Given "PROD-2025B" has 1 project version (revision 1, approved)
    When the user sends GET /api/products/{productId}/revisions
    Then the response contains 1 item with revision = 1
```

### AC-2.5-005: Project List Version Display

```gherkin
Feature: Project list shows version information

  Scenario: Project list displays version number
    Given the project list page loads
    And project "PROD-2025A" is at revision 3 (draft, is_latest=true)
    Then the table shows a "Version" column with "v3" for PROD-2025A

  Scenario: Version history indicator for multi-version projects
    Given project "PROD-2025A" has revision 3
    Then a small text "v1, v2" appears below the version number
    And it is clickable

  Scenario: No version history indicator for v1 projects
    Given project "PROD-2025B" has revision 1
    Then no version history indicator appears below the version number

  Scenario: Project list only shows latest versions
    Given "PROD-2025A" has 3 versions (v1 archived, v2 archived, v3 draft)
    When the project list loads
    Then only v3 (draft) appears in the list
    And v1 and v2 are not shown in the main list
```

### AC-2.5-006: Revision Creation Modal

```gherkin
Feature: Revision creation modal in editor

  Scenario: Revision button visible for approved projects
    Given the user opens an approved project in the editor
    Then a "Create Revision" button is visible in the header

  Scenario: Revision button hidden for non-approved projects
    Given the user opens a draft project in the editor
    Then no "Create Revision" button is visible

  Scenario: Revision button hidden for archived projects
    Given the user opens an archived project in the editor
    Then no "Create Revision" button is visible

  Scenario: Revision modal displays correct information
    Given the user clicks "Create Revision" on "PROD-2025A v2 (Approved)"
    Then a modal appears with:
      | field           | value                          |
      | Current version | PROD-2025A v2 (Approved)       |
      | New version     | PROD-2025A v3 (Draft)          |
    And an explanation that v2 will become read-only
    And an optional "Revision description" text field
    And Cancel and Create buttons

  Scenario: Successful revision creation navigates to new project
    Given the revision modal is open for project ID 5
    When the user fills in optional description and clicks "Create"
    Then the API call POST /api/projects/5/revise is made
    And the browser navigates to /projects/{newProjectId}/edit
    And a success toast message is displayed
```

### AC-2.5-007: Version History Panel

```gherkin
Feature: Version history panel for products

  Scenario: Opening version history from project list
    Given project "PROD-2025A" has revision 3 with previous versions
    When the user clicks the version history indicator
    Then a modal or panel opens showing all versions
    And versions are listed newest first: v3, v2, v1
    And each entry shows: version number, status badge, creator, date

  Scenario: Navigation from version history
    Given the version history panel is open
    When the user clicks "View" on v1 (archived)
    Then the browser navigates to /projects/{v1_project_id}/edit
    And the editor opens in read-only mode

    When the user clicks "Edit" on v3 (draft)
    Then the browser navigates to /projects/{v3_project_id}/edit
    And the editor opens in edit mode
```

### AC-2.5-008: Archived Project UI Behavior

```gherkin
Feature: Archived projects display in read-only mode

  Scenario: Status badge displays "Archived"
    Given a project with status "archived"
    When the status badge renders
    Then it shows "Archived" text
    And uses a distinct visual style (e.g., gray/muted color)

  Scenario: Editor in read-only mode for archived project
    Given the user opens an archived project
    Then the save button is hidden
    Then the recipe upload button is hidden
    Then the grid cells are not editable
    Then layer navigation context menu does not show "Backbone Replace" or "Delete"
    Then no "Add Layer" button is visible
    And a read-only indicator is displayed in the header

  Scenario: Editor in read-only mode for approved project
    Given the user opens an approved project
    Then the save button is hidden
    Then the grid cells are not editable
    But the "Create Revision" button is visible
```

### AC-2.5-009: Revision Backbone Conditions (Diff Highlighting)

```gherkin
Feature: Revision uses previous approved conditions as diff baseline

  Scenario: New revision shows changes relative to previous version
    Given project v1 had SP_PREBAKE_TEMP_C = 110 for layer "AA_PHOTO"
    And v1 was approved and archived
    And v2 was created from v1
    And v2's backbone_conditions contain SP_PREBAKE_TEMP_C = 110
    When the user edits SP_PREBAKE_TEMP_C to 115 in v2
    Then the cell is highlighted yellow (changed from backbone)
    Because backbone_conditions = v1's approved conditions
```

---

## Quality Gate Criteria

### Test Coverage

- Backend: All new and modified functions have corresponding pytest tests
- Frontend: All new and modified validation functions have Vitest tests
- Minimum 85% coverage for modified files
- All existing tests continue to pass (no regressions)

### TRUST 5 Validation

| Pillar | Criteria |
|--------|----------|
| **Tested** | All requirements (REQ-2.4-xxx, REQ-2.5-xxx) have at least one test scenario |
| **Readable** | All functions have clear names, type hints (Python), TypeScript types |
| **Unified** | Code follows existing project conventions (ruff, ESLint) |
| **Secured** | Status guards prevent unauthorized modifications to archived projects |
| **Trackable** | Conventional commits referencing SPEC-002 |

### Definition of Done

- [ ] All REQ-2.4-xxx requirements implemented and tested
- [ ] All REQ-2.5-xxx requirements implemented and tested
- [ ] Backend validation supports equals, not_equals, contains operators
- [ ] Frontend validation mirrors backend operator support
- [ ] Cross-field re-validation triggers when condition column changes
- [ ] `POST /api/projects/{id}/revise` creates new draft from approved project
- [ ] Original project transitions to archived status on revision
- [ ] Archived projects are fully read-only (backend guards + frontend UI)
- [ ] `GET /api/products/{productId}/revisions` returns version history
- [ ] Project list shows version information and history links
- [ ] Revision creation modal with optional description works end-to-end
- [ ] StatusBadge supports archived variant
- [ ] No existing test regressions
- [ ] Phase 2 DoD checklist fully satisfied:
  - [x] Backbone replacement via layer navigation context menu
  - [x] Recipe XML upload -> diff -> selective apply -> green cells
  - [x] Admin page for XML mapping and validation rules
  - [ ] Conditional required validation with cross-field triggering
  - [ ] Revision creation from Approved project
  - [ ] Project list shows latest version per product, previous versions Archived

---

## Edge Cases and Error Scenarios

### Validation Edge Cases

| Case | Expected Behavior |
|------|------------------|
| `contains` with `condition_value` = "" (empty string) | Every string contains "" -- condition always met. Should still work but effectively acts as a required rule |
| `not_equals` with null condition column value | `str(None) != str("Y")` is True -- condition met. Target must have value |
| Multiple conditional_required rules on same column | All rules are evaluated independently. Error reported if ANY condition is met and target is empty |
| Condition column not present in conditions JSONB | Treated as `None`. `equals` with "Y" -> not met. `not_equals` with "Y" -> met |

### Revision Edge Cases

| Case | Expected Behavior |
|------|------------------|
| Rapid double-click on "Create" button | Frontend should disable button after first click. Backend transaction prevents duplicate via active project check |
| Revision of a project with 0 layers (edge case) | Create empty project with revision+1, no layers to copy. Should not error |
| Browser navigates away during revision creation | Server-side transaction ensures atomicity. Either fully created or not |
| Product with revision chain v1->v2->v3, user opens v1 (archived) | Read-only mode. No edit buttons. No revision button (only Approved gets it) |
| Concurrent revision attempts | First request succeeds. Second request gets 409 (active project exists) |
| Archived project accessed via direct URL | Backend serves data normally. Frontend renders in read-only mode |
