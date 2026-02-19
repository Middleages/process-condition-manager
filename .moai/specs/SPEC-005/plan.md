# SPEC-005: Implementation Plan

## Metadata

| Field       | Value                                              |
|-------------|----------------------------------------------------|
| SPEC ID     | SPEC-005                                           |
| Title       | Export System - Computational Output Tables (Type A/B/C) |
| Created     | 2026-02-16                                         |
| Status      | Planned                                            |

---

## 1. Implementation Strategy

### 1.1 Approach

Bottom-up implementation starting with database schema changes and seed data, then building export services per format type, followed by API endpoints, and finally the frontend UI. Each export type (A/B/C) is implemented and tested independently before integration.

### 1.2 Architecture Decisions

| Decision                        | Choice                  | Rationale                                          |
|---------------------------------|-------------------------|----------------------------------------------------|
| Export generation library        | openpyxl                | Already in tech stack, full xlsx support with styling |
| Export service pattern           | Strategy pattern        | Clean separation of Type A/B/C logic, easy to extend for Phase 4 systems |
| Multi-file download format       | ZIP (zipfile module)    | Standard approach for bundling multiple files       |
| Preview data format              | JSON (list of dicts)    | Lightweight, easy to render in frontend table       |
| Equipment data source (Type B)   | New DB table            | Isolated from condition JSONB, proper relational model |
| File response                    | StreamingResponse       | Memory-efficient for large Excel files              |

---

## 2. Milestones

### Milestone 1 (Primary Goal): Database Schema + Seed Data

**Scope**: Alembic migration for `equipment_assignments` table, SQLAlchemy model, seed data for 3 export systems with column mappings and equipment assignments.

**Deliverables**:
- New Alembic migration (`005_add_equipment_assignments.py`)
- `EquipmentAssignment` SQLAlchemy model in `backend/app/models/export.py` (with `updated_at` field)
- `ExportColumnMapping` model enhancement: add `column_definition` relationship for eager loading
- Seed script additions for export systems, column mappings, equipment assignments
- Unit mapping config for Type C in `additional_config`

**Files to Create/Modify**:
- `backend/app/models/export.py` - Add EquipmentAssignment model, add column_definition relationship to ExportColumnMapping
- `backend/app/models/__init__.py` - Export new model
- `backend/alembic/versions/005_add_equipment_assignments.py` - New migration
- Seed data script (existing seed infrastructure)

**Verification**: Migration runs successfully, seed data is inserted correctly, column_definition relationship works with eager loading.

---

### Milestone 2 (Primary Goal): Export Service - Type A

**Scope**: Implement Type A (horizontal) export generation.

**Deliverables**:
- `ExportService` class with `_generate_type_a` method
- Column mapping lookup logic
- Excel generation with openpyxl (headers + data rows)
- Preview data generation for Type A
- Pytest tests for Type A export correctness

**Files to Create/Modify**:
- `backend/app/services/export_service.py` - New service file
- `backend/app/services/__init__.py` - Export new service
- `backend/tests/test_export_service.py` - Type A tests

**Verification**: Generated Excel matches PRD Type A format with correct column name conversions.

---

### Milestone 3 (Primary Goal): Export Service - Type B

**Scope**: Implement Type B (equipment-split) export generation.

**Deliverables**:
- `_generate_type_b` method in ExportService
- Equipment assignment query and override logic
- Equipment parameter merge (base conditions + overrides)
- Pytest tests for Type B including override scenarios

**Files to Create/Modify**:
- `backend/app/services/export_service.py` - Add Type B method
- `backend/tests/test_export_service.py` - Type B tests

**Verification**: Generated Excel shows multiple rows per layer-equipment combination with correct overrides.

---

### Milestone 4 (Primary Goal): Export Service - Type C

**Scope**: Implement Type C (key-value transpose) export generation.

**Deliverables**:
- `_generate_type_c` method in ExportService
- UNIT mapping lookup from `additional_config`
- Parameter key/value transposition logic
- Pytest tests for Type C including unit mapping

**Files to Create/Modify**:
- `backend/app/services/export_service.py` - Add Type C method
- `backend/tests/test_export_service.py` - Type C tests

**Verification**: Generated Excel shows one row per parameter with correct PARAM_KEY, PARAM_VALUE, UNIT.

---

### Milestone 5 (Primary Goal): Export API Endpoints

**Scope**: REST API endpoints for export operations.

**Deliverables**:
- `backend/app/routers/export.py` - New router with 3 endpoints
- Pydantic schemas for request/response
- Status validation (approved-only guard)
- Error handling for non-existent/inactive system IDs (REQ-056, REQ-057)
- Filename sanitization for special characters (REQ-083)
- ZIP generation for multi-system export
- StreamingResponse for file downloads
- API integration tests

**Files to Create/Modify**:
- `backend/app/routers/export.py` - New router
- `backend/app/routers/__init__.py` - Register router
- `backend/app/schemas/export.py` - New schemas
- `backend/app/schemas/__init__.py` - Export schemas
- `backend/app/main.py` - Register export router
- `backend/tests/test_export_api.py` - API tests

**Verification**: All 3 API endpoints work correctly, status guard rejects non-approved projects.

---

### Milestone 6 (Secondary Goal): Export UI

**Scope**: Frontend components for export system selection, preview, and download.

**Deliverables**:
- Export panel component with system checkbox list
- Preview table component with dynamic columns
- Download functionality (single + bulk)
- Loading states and error handling
- TypeScript types for export data
- API client functions for export endpoints
- TanStack Query hooks for data fetching

**Files to Create**:
- `frontend/src/components/export/ExportPanel.tsx`
- `frontend/src/components/export/ExportSystemList.tsx`
- `frontend/src/components/export/ExportPreviewTable.tsx`
- `frontend/src/components/export/ExportDownloadButton.tsx`
- `frontend/src/api/export.ts`
- `frontend/src/hooks/useExportSystems.ts`
- `frontend/src/hooks/useExportPreview.ts`
- `frontend/src/types/export.ts`

**Files to Modify**:
- `frontend/src/pages/ConditionEditorPage.tsx` - Integrate ExportPanel (conditional on approved status)

**Verification**: Export panel renders when project is approved, preview loads correctly, downloads work.

---

### Milestone 7 (Final Goal): Integration Testing + Polish

**Scope**: End-to-end testing and quality assurance.

**Deliverables**:
- End-to-end test: Create approved project -> Export all 3 types -> Verify Excel content
- Verify export output matches PRD example formats
- Edge case handling (empty conditions, missing mappings, no equipment assignments)
- Error message quality review
- Frontend Vitest tests for export utility functions

**Verification**: All tests pass, exported Excel files match PRD format specifications.

---

## 3. Technical Approach

### 3.1 Export Service Design (Strategy Pattern)

The `ExportService` uses an internal dispatch mechanism based on `format_type`:

```
ExportService
  |
  |-- get_systems()           -> List active systems with column counts
  |-- generate()              -> Dispatch to appropriate type generator
  |   |-- _generate_type_a()  -> Horizontal: 1 row per layer
  |   |-- _generate_type_b()  -> Equipment-split: N rows per layer
  |   |-- _generate_type_c()  -> Transpose: 1 row per parameter
  |
  |-- generate_preview()      -> Return first N rows as dicts
  |-- generate_bulk()         -> ZIP multiple Excel files
  |
  |-- _get_export_system()    -> Query export_systems table
  |-- _get_column_mappings()  -> Query export_column_mappings with joins
  |-- _get_project_layers()   -> Query project_layers with layer info
  |-- _get_equipment()        -> Query equipment_assignments (Type B)
```

### 3.2 Excel Generation Pattern

Each type generator follows the same pattern:
1. Create openpyxl Workbook
2. Add headers row (fixed columns + mapped columns)
3. Iterate over layers and populate data rows
4. Apply basic formatting (bold headers, auto-width columns)
5. Save to BytesIO buffer and return bytes

### 3.3 Query Optimization

- Use eager loading (`selectinload`) for column mappings when fetching export systems
- Batch-load all project layers in a single query with joined layer info
- For Type B, batch-load equipment assignments for all relevant layer IDs in one query
- Avoid N+1 queries by pre-loading all condition data before Excel generation

### 3.4 File Download Strategy

- Single system: Return `StreamingResponse` with `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` content type
- Multiple systems: Generate individual Excel bytes, package into ZIP using Python `zipfile` module in memory, return as `application/zip`
- Set `Content-Disposition` header with proper filename

### 3.5 Frontend Integration

- Use `window.URL.createObjectURL` and programmatic `<a>` click for file downloads
- Axios request with `responseType: 'blob'` for binary file handling
- TanStack Query `useQuery` for preview data (cached per system)
- TanStack Query `useMutation` for export generation (not cached, triggers download)

---

## 4. Risks and Mitigation

| Risk                                          | Impact   | Mitigation                                               |
|-----------------------------------------------|----------|----------------------------------------------------------|
| Large Excel files for products with many layers | Medium  | Use StreamingResponse, test with max layer count (60)    |
| Equipment assignment data may be incomplete    | Low      | Graceful fallback: output single row with empty EQUIP_ID |
| Column mapping inconsistency with conditions   | Medium   | Validate mappings against column_definitions at export time |
| JSONB key mismatch between conditions and mappings | High  | Add validation step and clear error messages             |
| Concurrent export requests for same project    | Low      | Each request generates independently (stateless service) |
| ZIP file size for many systems                 | Low      | Phase 3 has only 3 systems; optimize in Phase 4 if needed |

---

## 5. Dependencies

### Internal Dependencies

| Dependency              | Required For          | Status      |
|-------------------------|-----------------------|-------------|
| SPEC-003 (Approval)     | Approved status gate  | Planned     |
| SPEC-004 (Change History) | Complete Phase 3 flow | Planned   |
| Existing export models   | Schema foundation     | Implemented |
| Existing seed infrastructure | Seed data insertion | Implemented |
| openpyxl in requirements | Excel generation      | In tech stack |

### External Dependencies

| Dependency  | Version  | Purpose               |
|-------------|----------|-----------------------|
| openpyxl    | 3.1.5    | Excel file generation |
| zipfile     | stdlib   | Multi-file packaging  |

---

## 6. File Impact Summary

### New Files (Backend)

| File                                          | Purpose                              |
|-----------------------------------------------|--------------------------------------|
| `backend/app/services/export_service.py`      | Core export generation logic         |
| `backend/app/routers/export.py`               | Export API endpoints                 |
| `backend/app/schemas/export.py`               | Pydantic request/response schemas    |
| `backend/alembic/versions/005_add_equipment_assignments.py` | DB migration       |
| `backend/tests/test_export_service.py`        | Service layer tests                  |
| `backend/tests/test_export_api.py`            | API integration tests                |

### Modified Files (Backend)

| File                                          | Change                               |
|-----------------------------------------------|--------------------------------------|
| `backend/app/models/export.py`                | Add EquipmentAssignment model, add column_definition relationship to ExportColumnMapping |
| `backend/app/models/__init__.py`              | Export new model                     |
| `backend/app/routers/__init__.py`             | Register export router               |
| `backend/app/schemas/__init__.py`             | Export new schemas                   |
| `backend/app/main.py`                         | Include export router                |

### New Files (Frontend)

| File                                          | Purpose                              |
|-----------------------------------------------|--------------------------------------|
| `frontend/src/components/export/ExportPanel.tsx` | Main export panel                 |
| `frontend/src/components/export/ExportSystemList.tsx` | System checkbox list          |
| `frontend/src/components/export/ExportPreviewTable.tsx` | Preview table              |
| `frontend/src/components/export/ExportDownloadButton.tsx` | Download button          |
| `frontend/src/api/export.ts`                  | API client functions                 |
| `frontend/src/hooks/useExportSystems.ts`      | Systems query hook                   |
| `frontend/src/hooks/useExportPreview.ts`      | Preview query hook                   |
| `frontend/src/types/export.ts`                | TypeScript types                     |

### Modified Files (Frontend)

| File                                          | Change                               |
|-----------------------------------------------|--------------------------------------|
| `frontend/src/pages/ConditionEditorPage.tsx`  | Integrate ExportPanel conditionally  |

---

## 7. Traceability

| Milestone | Requirements Covered         | PRD Tasks   |
|-----------|------------------------------|-------------|
| M1        | REQ-040~042, REQ-070~073, REQ-075 | Seed data + Model |
| M2        | REQ-001~003, REQ-010~013    | 3-6, 3.12   |
| M3        | REQ-020~024                  | 3-7, 3.13   |
| M4        | REQ-030~033                  | 3-8, 3.14   |
| M5        | REQ-050~057, REQ-080~083    | 3-15        |
| M6        | REQ-060~067                  | 3-16        |
| M7        | All REQs (integration)       | 3-17        |
