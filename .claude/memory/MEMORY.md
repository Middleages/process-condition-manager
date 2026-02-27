# PCM Project Memory

## Completed SPECs

- **SPEC-DEVICE-001** (Completed) - Device/Layer Master Integration, PR #34
  - device_master, layer_master, sync_source_config, device_meta_source (4 tables)
  - Migration 018, 4 services, 2 routers

- **SPEC-PROJECT-002 M1** (Completed) - Schema Migration + Backend API, PR #35
  - Migration 019: device_master_id, process, device_type, header_metadata on projects
  - project_layers.layer_id: INT → VARCHAR(10) with backfill + denormalization
  - create_project_v2() TDD (8 tests), 4 new router endpoints
  - 17-file refactor: `pl.layer.X` → `pl.X` (Layer relationship removed)
  - 513 backend tests passing

## Current Work: SPEC-PROJECT-002 M2

**Status**: READY TO IMPLEMENT (document update session completed)

### Pre-implementation cleanup done:
- Frontend type migration (layer_id INT→STRING) across all files
- ProjectCreateRequestV2 type + Project V2 fields added
- Backend bugs fixed (BackboneLayerResponse, changelog layer_id filter)
- Tests: Backend 513 pass, Frontend 137 pass, TSC 0 errors

### M2 Implementation Plan (M2+M3+M4 combined):
1. API client functions (searchDevices, checkDuplicate, createProjectV2)
2. ProjectCreateModalV2 component (cascading dropdowns + header preview)
3. Full/Short type selector + Layer Selection Panel
4. Backbone dropdown + "No backbone" option
5. ProjectListPage integration

### Key decisions:
- Cascading dropdown: Approach B (reuse `GET /api/device-masters` list API, extract unique values client-side)
- V1 modal preserved, V2 as ProjectCreateModalV2.tsx (default)
- SPEC doc Section 5.2 has full details

## Key Architecture Decisions

- **project_layers.layer_id**: VARCHAR(10), e.g. "1.0", "1.21", "17.31"
- **Numeric sorting**: `sorted(key=float)` or `CAST(layer_id AS FLOAT)`
- **V2 projects**: product_id=null, use device_master_id instead
- **Display name**: `{product_name} | {process} | {part_id}`
- **Backbone optional**: backbone_product_id=null → empty conditions {}
- **Layer matching**: By layer_id (VARCHAR), not layer_name
- **Dynamic Backbone**: SPEC-BACKBONE-001 sources from approved project_layers

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
