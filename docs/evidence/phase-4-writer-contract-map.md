# Phase 4 writer-contract integration map

This note documents the production touchpoints and the current conflict surfaces for the
writer regression work in `backend/tests/features/test_projects_pg_writer_contracts.py`.

## Primary production touchpoints

| Surface | Production seam | Why it matters |
| --- | --- | --- |
| Project create | `backend/app/features/projects/service.py::create_project` | The only place that can atomically assemble the new aggregate, record `PROJECT_CREATE`, and decide whether a duplicate identity should roll back. |
| Backbone replace | `backend/app/features/projects/service.py::replace_layer_backbone` | Deletes the target layer, snapshots the source layer, then repopulates; this is the highest-risk rollback/source-fencing boundary. |
| Shared session boundary | `backend/app/features/projects/router.py::get_service` | The route dependency commits on teardown, so writer services must leave the session in a clean state before re-raising. |
| Identity lookup | `backend/app/features/projects/repository.py::get_by_identity` | Used as the pre-flush duplicate check in project create. |
| Choice locking | `backend/app/features/choice_sets/repository.py::lock_sets_for_write` and `::resolve_active_options` | Participates in project create; in tests it is no-op’d only to isolate the project-identity rollback boundary. |

## Existing sibling coverage

- `backend/tests/features/test_cells_api.py` covers manual/paste cell batches and structured
  `change_event(cell_update)` payloads.
- `backend/tests/features/test_conditions_api.py` covers condition add/remove/duplicate and POR
  events.
- `backend/tests/features/test_project_profiles_api.py` covers profile patch atomicity and
  structured profile event payloads.
- `backend/tests/test_boundaries.py` covers the transaction/session wiring at the router layer.

## Conflicts and risks

1. **Router teardown commits are shared.** If a writer mutates the session and then raises after
   flush/commit work has started, the router teardown is the last shared boundary. Services must
   either validate before mutation or roll back explicitly on failure.
2. **Backbone replace is destructive before rebuild.** The target layer rows are deleted before
   the replacement snapshot is applied. Any mid-flight exception in that path is high risk.
3. **Project create has a real duplicate race.** The unique constraint is the final guardrail, so
   the PG regression intentionally exercises the loser rollback path instead of relying only on the
   pre-check.
4. **Source fencing is required.** The replace flow must copy from the captured source snapshot,
   not from live source rows that may change before repopulation completes.

## Verification intent

- Keep the project-identity regression red/green around the true uniqueness boundary.
- Keep the backbone-replace regression source-fenced against mid-flight source edits.
- Avoid production edits in this slice; use the tests and this map to guide the next writer lane.
