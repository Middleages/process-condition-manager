# PCM Project Memory

## Completed SPECs

- **SPEC-DEVICE-001** (Completed) - Device/Layer Master Integration, PR #34
  - device_master, layer_master, sync_source_config, device_meta_source (4 tables)
  - Migration 018, 4 services, 2 routers

## Next SPECs (Implementation Queue)

1. **SPEC-PROJECT-002** (Priority 1 - Depends on DEVICE-001)
   - Device-ref based project creation (line, product_name, process, part_id)
   - Short product support (layer selection)
   - Empty condition table support
   - UNIQUE(line, product_name, process, part_id, revision)
   - M1: schema+API, M2: frontend modal, M3: short product, M4: backbone matching
   - Path: `.moai/specs/SPEC-PROJECT-002/`

## Key Architecture Decisions (2026-02-26 Discussion)

- **Project = Product**: Creating a project means a new product arrived. Approved project = backbone.
- **External data**: Loaded into PCM DB (same PostgreSQL), not remote calls. Periodic ETL.
- **Layer matching**: By layer_id (numeric: 1.0, 2.0...), not step_seq. step_seq varies per product.
- **Device Ref = project header**: pitch_size, shot_count etc. are header-level, NOT in conditions JSONB.
- **Empty conditions**: Allowed for products without existing backbone (system built mid-stream).
- **Dual-path API**: V1 (product_id) and V2 (device-ref) coexist during transition.
- **Legacy cleanup deferred**: products/product_layers removal is a separate future SPEC after stabilization.
- **Dynamic Backbone already works**: SPEC-BACKBONE-001 changed backbone source to approved project_layers.

## Project Structure Quick Reference

- Backend models: `backend/app/models/`
- Backend services: `backend/app/services/`
- Backend routers: `backend/app/routers/`
- Frontend pages: `frontend/src/pages/`
- Frontend components: `frontend/src/components/`
- Migrations: `backend/alembic/versions/`
- Latest migration: 018 (device/layer master tables)
