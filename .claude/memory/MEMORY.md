# PCM Project Memory

## Completed SPECs

- **SPEC-DEVICE-001** (Completed) - Device/Layer Master Integration, PR #34
  - device_master, layer_master, sync_source_config, device_meta_source (4 tables)
  - Migration 018, 4 services, 2 routers

- **SPEC-PROJECT-002** (Completed) - Device-Ref Based Project Creation
  - M1: Schema migration + Backend API (PR #35)
    - Migration 019: device_master_id, process, device_type, header_metadata on projects
    - project_layers.layer_id: INT → VARCHAR(10) with backfill + denormalization
    - create_project_v2() TDD (8 tests), 4 new router endpoints
  - M2: Frontend Device-Ref Creation Modal (M2+M3+M4 combined)
    - ProjectCreateModalV2: Cascading dropdowns (Approach B), Full/Short selector
    - Layer checkbox panel, optional Backbone, header preview, duplicate check
    - ProjectListPage: V2 modal default, display name `{name} | {process} | {part_id}`
    - Frontend type migration: layer_id INT→STRING across 15+ files
    - 513 BE / 137 FE tests passing, TSC 0 errors

## Key Architecture Decisions

- **project_layers.layer_id**: VARCHAR(10), e.g. "1.0", "1.21", "17.31"
- **Numeric sorting**: `sorted(key=float)` or `CAST(layer_id AS FLOAT)`
- **V2 projects**: product_id=null, use device_master_id instead
- **Display name**: `{product_name} | {process} | {part_id}`
- **Backbone optional**: backbone_product_id=null → empty conditions {}
- **Layer matching**: By layer_id (VARCHAR), not layer_name
- **Dynamic Backbone**: SPEC-BACKBONE-001 sources from approved project_layers
- **Cascading dropdown**: Approach B — fetch all device_masters for line, extract unique values client-side

## Project Conventions

- conversation_language: ko (Korean)
- code_comments: en (English)
- Latest migration: 019 (device ref on projects)

## Project Structure Quick Reference

- Backend models: `backend/app/models/`
- Backend services: `backend/app/services/`
- Backend routers: `backend/app/routers/`
- Frontend pages: `frontend/src/pages/`
- Frontend components: `frontend/src/components/`
- Migrations: `backend/alembic/versions/`
- SPEC: `.moai/specs/SPEC-PROJECT-002/spec.md`
