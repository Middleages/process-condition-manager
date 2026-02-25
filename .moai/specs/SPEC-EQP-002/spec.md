# SPEC-EQP-002: Equipment Master Table + Searchable Autocomplete

## Status: Completed
## Phase: 5 (Equipment Enhancement)
## Priority: High

---

## 1. Overview

Create an `equipments` master table to manage semiconductor photo equipment (scanners) per production line, and integrate searchable autocomplete into the EQP category columns in the condition editor.

### Background

- Current EQP columns use `column_definitions.select_options` with 10 hardcoded scanner names
- Real environment: ~100 equipment per line x 4 lines = 400+ equipment
- Static select dropdown is unusable at this scale
- Equipment metadata (model, IP, FTP credentials) needed for future Recipe XML integration

### Scope

- M1: Backend - Equipment model, migration, CRUD API, seed data
- M2: Frontend - Admin Equipment Management UI
- M3: Frontend - Searchable autocomplete cell editor for EQP columns
- M4: Integration - EQP select_options removal, validation linkage

---

## 2. Requirements (EARS Format)

### Functional Requirements

**REQ-EQP-010**: The system SHALL provide an `equipments` table with columns: id, line_id (FK), equipment_name, equipment_model, PRC, ip, ftp_id, ftp_pw, is_active, sort_order.

**REQ-EQP-011**: When an admin user accesses the Equipment Management page, the system SHALL display all equipment filtered by line, with CRUD operations (create, read, update, delete).

**REQ-EQP-012**: When a user edits an EQP_xx column in the condition editor, the system SHALL display a searchable autocomplete dropdown filtered by the project's line_id.

**REQ-EQP-013**: While the user types in the EQP equipment cell, the system SHALL filter the equipment list by partial match on equipment_name.

**REQ-EQP-014**: When equipment data is loaded for the editor, the system SHALL only return active equipment (is_active=true) for the project's line.

**REQ-EQP-015**: The system SHALL provide a public API endpoint `GET /api/equipments?line_id=X` that returns active equipment for a given line (for editor autocomplete).

**REQ-EQP-016**: When an admin creates/updates equipment, the system SHALL validate that equipment_name is unique within the same line.

**REQ-EQP-017**: The system SHALL NOT return ftp_pw in any API response (write-only field).

**REQ-EQP-018**: When the EQP_xx select_options are no longer needed, the system SHALL set them to null via migration to prevent conflict with the new autocomplete.

### Non-Functional Requirements

**REQ-EQP-020**: The equipment autocomplete SHALL respond within 100ms for lists up to 500 items (client-side filtering).

**REQ-EQP-021**: The Admin Equipment page SHALL support pagination or virtual scrolling for 400+ equipment records.

---

## 3. Database Schema

### New Table: `equipments`

```sql
CREATE TABLE equipments (
    id SERIAL PRIMARY KEY,
    line_id INTEGER NOT NULL REFERENCES lines(id) ON DELETE CASCADE,
    equipment_name VARCHAR(100) NOT NULL,
    equipment_model VARCHAR(100),
    prc VARCHAR(50),
    ip VARCHAR(45),
    ftp_id VARCHAR(100),
    ftp_pw VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(line_id, equipment_name)
);

CREATE INDEX idx_equipments_line_id ON equipments(line_id);
CREATE INDEX idx_equipments_active ON equipments(line_id, is_active) WHERE is_active = true;
```

### Migration Steps

1. Create `equipments` table
2. Seed initial equipment data (map from SCANNER_TOOL_OPTIONS per line)
3. Set EQP_xx column_definitions.select_options = null (autocomplete replaces static list)

---

## 4. API Design

### Admin Endpoints (require_admin)

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/admin/equipments?line_id=X | List all equipment (with line filter) |
| POST | /api/admin/equipments | Create equipment |
| PUT | /api/admin/equipments/{id} | Update equipment |
| DELETE | /api/admin/equipments/{id} | Delete equipment (soft: set is_active=false) |
| PUT | /api/admin/equipments/reorder | Reorder equipment |

### Public Endpoints (require_active_user)

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/equipments?line_id=X | Active equipment for line (autocomplete source) |

### Response Schema

```python
class EquipmentResponse(BaseModel):
    id: int
    line_id: int
    line_name: str  # joined
    equipment_name: str
    equipment_model: str | None
    prc: str | None
    ip: str | None
    ftp_id: str | None
    # ftp_pw excluded (REQ-EQP-017)
    is_active: bool
    sort_order: int

class EquipmentPublicResponse(BaseModel):
    id: int
    equipment_name: str
    equipment_model: str | None
```
---

## 5. Frontend Design

### M2: Admin Equipment Management

- Location: Admin > Master Data > Equipment tab (new sub-tab)
- Layout: Line filter dropdown + Equipment table + Add button
- Table columns: sort_order, equipment_name, equipment_model, PRC, IP, FTP ID, is_active, Actions
- Form modal: All fields except ftp_pw shows as password input (masked)
- Bulk operations: Toggle is_active

### M3: Searchable Autocomplete Cell Editor

- Custom AG Grid Cell Editor component: `EquipmentAutocompleteEditor`
- Behavior:
  1. On cell edit start: Show input with dropdown
  2. Input filters equipment list by partial match (case-insensitive)
  3. Arrow keys navigate, Enter selects, Escape cancels
  4. Shows equipment_name + equipment_model in dropdown items
  5. Stores equipment_name as cell value (backward compatible with conditions JSONB)
- Data source: Preloaded equipment list from `GET /api/equipments?line_id=X`
- Integration: `buildColumnDefs.ts` - EQP_xx columns use custom editor instead of agSelectCellEditor

### Data Flow

```
ConditionEditorPage
  → useEffect: fetch equipments for project.line_id
  → pass to buildColumnDefs as parameter
  → EQP_xx columns: cellEditor = EquipmentAutocompleteEditor
  → cellEditorParams = { equipments: [...] }
```

---

## 6. Milestones

### M1: Backend - Equipment Model + API (~8 endpoints)
- Equipment SQLAlchemy model
- Alembic migration (create table + seed + clear select_options)
- Pydantic schemas (Create, Update, Response, PublicResponse)
- admin_master_service: equipment CRUD + list_by_line
- admin_master router: 5 admin endpoints
- Public router: 1 endpoint (equipments by line)

### M2: Frontend - Admin Equipment Management
- API client functions (fetchEquipments, createEquipment, updateEquipment, deleteEquipment)
- React Query hooks (useAdminEquipments, useCreateEquipment, etc.)
- EquipmentManagementPanel component
- EquipmentFormModal component
- MasterDataPage: Add Equipment sub-tab

### M3: Frontend - Searchable Autocomplete Editor
- EquipmentAutocompleteEditor custom cell editor component
- buildColumnDefs integration for EQP_xx columns
- ConditionEditorPage: fetch equipment list on mount
- useEditorStore: store equipment list

### M4: Integration + Cleanup
- Condition save validation (optional: warn if equipment not in master)
- Remove SCANNER_TOOL_OPTIONS from seed columns.py
- Update EQP column_definitions: select_options = null

---

## 7. Acceptance Criteria

- [ ] AC-1: Admin can CRUD equipment per line in web UI
- [ ] AC-2: Equipment name is unique within a line
- [ ] AC-3: ftp_pw is never returned in API responses
- [ ] AC-4: EQP_xx cells in editor show searchable autocomplete dropdown
- [ ] AC-5: Autocomplete filters by typed text (partial match, case-insensitive)
- [ ] AC-6: Autocomplete only shows active equipment for the project's line
- [ ] AC-7: Existing condition data (equipment_name strings) remains valid
- [ ] AC-8: 400+ equipment records render without lag in admin table

---

## 8. Technical Approach

### Backend Pattern
Follow existing admin_master_service pattern (Lines CRUD as template):
- Service: `admin_master_service.py` - add equipment functions
- Router: `admin_master.py` - add equipment endpoints
- Schemas: `admin_master.py` - add Equipment schemas
- Public endpoint: separate route for editor autocomplete

### Frontend Pattern
Follow existing LineManagementPanel pattern:
- EquipmentManagementPanel.tsx (table + CRUD)
- EquipmentFormModal.tsx (create/edit form)
- Custom cell editor: new component using AG Grid ICellEditorComp interface

### Security
- ftp_pw: Write-only field, never in response schemas
- Store as plain text for now (needed for FTP connection), encrypt in Phase 6 if needed
- Admin-only access for full CRUD, editor users get public endpoint (name + model only)

---

Version: 1.0.0
Created: 2025-02-25
