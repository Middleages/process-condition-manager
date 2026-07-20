# Phase 5 PRD — Approval workflow + Revision

- **Status:** RALPLAN-DR deliberate consensus approved (2026-07-19)
- **Baseline:** `main@75b0cba`
- **Context:** `.omx/context/phase-5-approval-revision-20260719T124723Z.md`
- **D-10:** [`docs/phase-5-d10-sso-rbac.md`](./phase-5-d10-sso-rbac.md)
- **Task source:** `plan/phase-5-tasks.md`
- **Test spec:** [`docs/phase-5-approval-revision-test-spec.md`](./phase-5-approval-revision-test-spec.md)
- **Architect:** `.omx/plans/review-phase5-architect-v3.md` — APPROVE
- **Critic:** `.omx/plans/review-phase5-critic-v2.md` — APPROVE

## 1. Outcome

Phase 5 turns draft-only projects into an auditable lifecycle:

`draft → review → approved | rejected → draft`, with `approved → archived` only when a Revision is
created atomically.

Approval freezes the complete parameter/category/ChoiceSet/Profile-choice/validation basis. Approved
and Archived projects render read-only from that snapshot. Revision creates a live-definition Draft
with copied conditions/cells and explicit lineage. Project/cell comments and D-10 RBAC span backend
and UI.

### In scope

- trusted-proxy SSO, `/api/auth/me`, server permissions;
- pure workflow, transition gates and events;
- snapshot-v3 frozen sheet/Profile/rule/choice rendering;
- atomic Revision and lineage;
- project/cell comments, resolve and soft delete;
- Draft-only mutation/lock enforcement;
- status/action/read-only/lineage/comment UI;
- migration, docs, automated/PostgreSQL/browser gates and PR.

### Non-goals

- tenant provisioning, gateway product choice, secrets, local users/roles or SCIM;
- four-eyes approval, notifications, attachments/rich text, transition undo;
- parallel Drafts, merge/rebase or Phase 6 output;
- duplicating Phase 4 backbone snapshots.

## 2. Brownfield invariants

1. Reuse `AuthAdapter -> UserContext`; backend, not UI, authorizes.
2. Project writes lock the project through commit and append events in the same transaction.
3. Approved/Archived definition, Profile label, choice-option, history-coordinate and backbone-diff
   parameter projections never touch live definitions. Phase 4's immutable backbone baseline remains a
   distinct input; only parameter/category universe/labels use the approval DefinitionView.
4. Draft/Review/Rejected read live definitions; only Draft is editable.
5. Review/approval use one canonical committed validation basis. Approval's validation, snapshot and
   event come from one transition-owned PostgreSQL `REPEATABLE READ` transaction started before its
   first query. The promise is one coherent pre-change or post-change MVCC graph when definition writes
   overlap, not necessarily the latest definitions at commit.
6. Successful Review stores `basis_hash` and rule versions. Approval revalidates only if current basis
   differs, and records the basis actually approved.
7. Review requires exactly one POR per layer; the DB already prevents more than one.
8. Comments/events remain audit truth. Rejected→Draft preserves comments.
9. No new dependency is required.

## 3. Domain and persistence

### 3.1 Workflow

Add framework-free `app/domain/workflow` with states `draft`, `review`, `approved`, `rejected`,
`archived` and actions `request_review`, `approve`, `reject`, `return_to_draft`, `create_revision`.
The pure decision returns target/effects or a stable violation code. Only Draft is editable. Review
entry deletes the edit lock in the same transaction; non-Draft cannot acquire/heartbeat a lock.

### 3.2 Migration 0008

- Extend `ProjectStatus` and `ChangeEventType` (`status_change`, `revision_create`, comment events).
- `project.version INTEGER NOT NULL DEFAULT 1`.
- `revision_root_id` and `revision_of_id` self-FKs; direct predecessor and series root. Root insertion
  flushes to obtain its ID, assigns `revision_root_id=self.id`, and must not commit while null.
- `parameter_snapshot JSONB`, `review_basis_hash VARCHAR(71)`, `review_rule_versions JSONB` nullable.
  Hash fields preserve exact existing `sha256:` + 64 lowercase hex format end to end.
- Checks/indexes: `version >= 1`; unique `(revision_root_id, version)`; unique non-null
  `revision_of_id` (one direct successor); at most one `status != archived` for each
  `(line_id, process_id, part_id)` via partial unique index on PostgreSQL and SQLite. V1 has no
  predecessor and root/version/predecessor consistency is defensively enforced where SQL cannot.
- `review_comment`: project FK; project target or cell target (`layer_key`, `condition_id`,
  `parameter_code`) XOR; body/author; resolved/deleted actor+timestamp; audit timestamps.
- Lineage/comment indexes; SQLite-compatible variants. Backfill existing rows as Draft v1.

### 3.3 Transition API and transaction

`POST /api/projects/{id}/transitions` with `{action, expected_status}` owns a dedicated transaction
session. It selects `REPEATABLE READ` before any SQL; no querying FastAPI dependency may precede it.
The owner locks and eagerly materializes the project aggregate, captures definitions/Profile choices
as immutable values in that MVCC snapshot, validates/snapshots/appends, and commits once. PostgreSQL
serialization/deadlock errors retry the whole idempotent expected-status operation at most twice with
small jitter; exhaustion maps to `409 workflow_status_conflict` without partial state.

- Require action permission, `FOR UPDATE` aggregate, reject stale status with
  `409 workflow_status_conflict`.
- `request_review`: run canonical full validation in the consistent transaction view; require zero
  errors and exactly one POR/layer; store basis/rule versions, set Review, delete lock, append event.
  On failure return deterministic validation/POR details with no mutation.
- `approve`: compare current and stored basis. Changed basis is re-evaluated; errors leave Review.
  Serialize snapshot v3 from the exact same captured definitions, set Approved and append event with
  basis/rule versions/`revalidated`, atomically.
- `reject`: Review→Rejected, preserve review evidence, append event.
- `return_to_draft`: Rejected→Draft, clear current review basis (event preserves history), keep comments.
- Direct Approved→Archived is forbidden; only Revision may archive.

Response exposes status, allowed actions for the current user and non-sensitive gate metadata.

### 3.4 Frozen providers

- Snapshot v3 captures every rendered parameter field (including `description`), active categories,
  referenced and fixed Profile ChoiceSets with option labels/activity, validation metadata and
  applicable relation rule code/version/scope/spec plus validation basis hash.
- Sheet chooses live definitions for Draft/Review/Rejected and snapshot definitions for
  Approved/Archived. Invalid snapshot fails `snapshot_invalid`; no fallback.
- **Frozen choices are project-scoped:** Approved/Archived `SheetOut` embeds the snapshot choice-option
  aggregate (or an equivalent project-scoped frozen endpoint). The frontend must not call/version-bump
  against live ChoiceSet APIs for frozen sheets.
- One parsed, immutable, fail-closed status-selected `DefinitionView` supplies sheet columns/rules/
  choices, Profile detail, **project-list Profile labels**, validation, history coordinate proof and
  backbone-diff current parameter projections. Frozen views retain no live ORM references and do not
  replace Phase 4 backbone snapshots. Approved/Archived validation uses frozen definitions.
- Rows remain sparse/current project data and are projected to codes in the chosen view; unknown
  inactive cell codes persist but render only when
  present in the chosen definition source.

### 3.5 Revision

`POST /api/projects/{id}/revisions`, Approved only with `project.revision.create`:

1. Lock distinct `{revision_root_id, source_id}` project rows in ascending ID order (one row for v1),
   then re-read/recheck source Approved status and successor/active-sibling absence under those locks.
2. Create Draft v+1 with null snapshot/review basis, copied stable business/Profile facts and lineage.
3. Copy all layers, conditions/POR/provenance and **all** cell rows, including codes outside live registry.
4. Mark and **flush source Archived before inserting/flushing target** (partial active index is not
   deferrable), delete any source lock, append exactly two paired revision events and commit once.
5. Target reads live definitions; hidden copied values reappear if their parameter is reactivated.

List/detail expose version/root/predecessor/successor and allowed action. Ordinary project creation must
select the active member rather than assume one total row. Once an identity has any lineage, ordinary
creation remains forbidden even if every member is Archived; only Revision extends it. Copy preserves
`backbone_snapshot`, source project/layer and `source_condition_id` verbatim.

### 3.6 Comments

Under `/api/projects/{id}/comments`: cursor/filter list, create project/cell target, resolve/unresolve,
soft delete. Actor comes only from auth. Author/admin may delete; any commenter may resolve. Coordinates
must name a condition belonging to the given project/layer and a parameter present in the selected
DefinitionView or already stored on that condition. Body is plain text, CRLF-normalized/outer-trimmed,
1..4000 characters, rendered only as text. Delete is terminal; later resolve/unresolve returns
`409 comment_deleted`. Every mutation locks project and appends one event containing only comment ID,
target and state transition—never body. Deleted bodies are always redacted from projections/logs.

## 4. Authorization coverage

Add `Permission` and `require_permission`:

- all business reads and non-mutating previews → `business.read`;
- registry/category/ChoiceSet/validation-rule writes → `registry.manage`;
- project create/Profile/backbone/cell/condition/POR/locks → `project.edit`;
- request Review/return Draft → `project.review.request`;
- approve/reject → `project.review.decide`;
- Revision → `project.revision.create`;
- comments → `project.comment`.

A shared edit guard uses the same session/project mutex with precedence `not_found →
project_read_only → lock_conflict`; it protects Profile, backbone, cells, conditions/POR and lock
acquire/heartbeat. Lock release/beacon is an authorized idempotent no-op outside Draft so post-Review
cleanup remains safe. A route-inventory test proves every route has authentication and its required
permission/status guard. `/auth/me` is the only no-role read exception.

## 5. Frontend

- Bootstrap `/api/auth/me`; expose identity/permissions via a small query/context. Handle 401 session
  boundary and authoritative 403/409 responses.
- All status badges, vN lineage and permission/status-specific action buttons. Confirm approval and
  Revision; prevent duplicate submission; invalidate project/sheet/history.
- Review 409 panel lists validation and missing POR details and reuses cell navigation where possible.
- Non-Draft never mounts/acquires/retries/heartbeats edit locks, autosaves or offers paste/backbone/
  condition/POR/Profile mutation. Grid remains navigable/copyable.
- Project/cell comment workbench uses selected cell and existing marker priority below validation/dirty.
- Frozen sheets consume embedded/project-scoped snapshot choices and never live ChoiceSet queries.

## 5.1 Exact workflow/API/event contracts

| From | Action | To/effect | All other states |
|---|---|---|---|
| draft | `request_review` | review; validate, POR gate, store basis, release lock | `409 workflow_transition_invalid` |
| review | `approve` | approved; compare/revalidate and freeze | `409 workflow_transition_invalid` |
| review | `reject` | rejected; preserve evidence | `409 workflow_transition_invalid` |
| rejected | `return_to_draft` | draft; clear current basis | `409 workflow_transition_invalid` |
| approved | `create_revision` | source archived + target draft | `409 workflow_transition_invalid` |

Unknown action is `422 workflow_action_invalid`; stale expected status or exhausted transaction retry
is `409 workflow_status_conflict`. Allowed actions order as `request_review, approve, reject,
return_to_draft, create_revision`, filtered by state and permission.

- Standard errors remain `{code,message,details?}`.
- Review gate error is `409 review_gate_failed` with
  `{validation:{summary,issues,evaluated_at,basis_hash,rule_versions,truncated},
  missing_por_layers:[{layer_key,layer_label}],total_missing_por_count}`. Issues reuse
  `ValidationIssueOut`, canonical-sort and cap at 200. Missing layers sort by
  `(sort_order,layer_key)` and cap at 200. Response is at most 256 KiB.
- `/api/auth/me` → `{id,display_name,email,roles,permissions}` in declared order.
- Transition → `{project_id,status,allowed_actions,basis_hash,rule_versions,revalidated,operation_id}`;
  nullable fields are explicit null.
- Revision → `{operation_id,source:{id,status,version},revision:ProjectOut}`.
- Comment list: `limit` default 50/range 1..100; optional `before_id`, target and
  `resolved=true|false|all`; `id DESC`; `{items,next_cursor}` with last returned ID or null. Reads use
  `business.read`; mutations use `project.comment`.

Every request accepts one valid UUID `X-Request-ID` or generates one and echoes it. Each mutation has a
UUID `operation_id` shared by its log/audit records. Versioned event payloads are:

- `status_change` v1: `{schema_version:1,operation_id,action,from_status,to_status,basis_hash,
  rule_versions,revalidated}`.
- exactly two `revision_create` v1 events share operation/pair ID:
  `{schema_version:1,operation_id,source_project_id,target_project_id,source_version,target_version,
  event_role:"source"|"target"}`.
- comment v1: `{schema_version:1,operation_id,comment_id,target:{layer_key,condition_id,
  parameter_code},action,from_resolved,to_resolved,deleted}`; never body.

Rule-version maps sort by code. Python/TypeScript/history tests assert these shapes and labels.

## 6. Acceptance criteria

- **AC1/EC1:** after approval, every live parameter/category/Choice/Profile label/option/rule mutation
  leaves Approved and Archived sheet/Profile/definition UI semantically unchanged.
- **AC2/EC2:** Revision archives source, creates Draft v+1 with all copied truth and new live columns;
  lineage is visible.
- **AC3/EC3:** full role × permission matrix produces exact 401/403/allow behavior; spoofed headers and
  CSRF proof, production dev-stub and invalid config fail closed.
- **AC4/EC4:** errors or missing POR reject Review without side effects. Approval reuses equal basis or
  atomically revalidates changed basis.
- **AC5/EC5:** every edit/lock path rejects non-Draft server-side; UI sends no edit traffic.
- **AC6/EC6:** project/cell comments create/list/resolve/delete with audit actor/events and survive
  rejected-to-draft.
- **AC7:** competing transition/Revision yields one winner and no partial state.
- **AC8:** all Phase 0–4 tests, lint, types, build, migration and PostgreSQL guards stay green.
- **AC9:** browser QA covers editor/reviewer flows, frozen approval, Revision, comments,
  1024/1440/1920 and keyboard basics.
- **AC10:** normalized SSO conformance passes; real tenant smoke is explicitly external/pending if no
  credentials exist.

## 7. Delivery plan

1. Add failing workflow/auth/snapshot/revision/comment contract tests.
2. Implement D-10 adapter, permissions, `/auth/me`, env/runbook and shared edit/status guards.
3. Add migration/models and pure workflow.
4. Implement transition gate with consistent validation/snapshot transaction.
5. Add frozen providers, Revision/lineage and comments.
6. Apply authorization/status guards to every existing mutation/history mapping.
7. Implement auth/status/actions/read-only/lineage/comments/frozen-choice frontend.
8. Run targeted then full backend/frontend/migration/PostgreSQL/browser gates.
9. Run changed-file anti-slop pass and rerun gates.
10. Independent current-model architecture/code review; fix until clean; update evidence/status;
    Lore commit, push branch and open PR.

## 8. Risks and pre-mortem

1. **Frozen UI changes:** a Profile/choice path remains live. Mitigation: one provider and full live
   mutation/query-spy matrix, including list labels and frontend live-choice request suppression.
2. **Mixed approval basis:** multiple READ COMMITTED selects observe different registry versions.
   Mitigation: repeatable-read/locked definition capture and equality of event/snapshot hash.
3. **Duplicate/partial Revision:** weak uniqueness/non-atomic copy. Mitigation: lineage lock, DB
   invariant, one transaction and PostgreSQL race/failure injection.
4. **Unauthorized mutation:** UI-only gate or header spoof. Mitigation: route dependencies, private
   proxy boundary and negative matrix.

| Failure | Early signal | Prevention/proof | Runtime/rollback action | Owner |
|---|---|---|---|---|
| invalid auth crashes startup | import/startup exit | non-throwing config + liveness/readiness tests | abort rollout; restore config | platform/operator |
| gateway corrupts headers | conformance decode failure | strict base64url Unicode cases | reject 401; fix gateway map | platform/operator |
| 20k transition/revision stalls | perf p95/peak/query RED | bounded bulk copy + PG benchmark | abort rollout/disable mutations | backend |
| migration/index conflict | guarded migration RED | 0007 fixture + lineage assertions | rollback before traffic | DB/backend |
| audit pair correlation loss | missing pair/event count | exact parity/failure injection | block release, repair | backend |
| stale permission unsafe replay | frontend 403 retry trace | refresh without mutation replay | show error/re-auth | frontend |
| tenant evidence absent | report remains pending | release checklist JSON | block production promotion | release/operator |

### Performance and boundedness

On guarded PostgreSQL with 100 layers × 200 parameters (20,000 cells), warm once and measure five
samples (nearest-rank p95):

- Review and Approval p95 ≤1.5 s each, ≤14 SELECT round trips, traced peak ≤64 MiB, response ≤256 KiB.
- Revision p95 ≤2.5 s, ≤8 SELECT and ≤20 mutation round trips, peak ≤64 MiB, response ≤256 KiB.
  Cell copy is set-based or bounded bulk/executemany, never a SELECT/INSERT round trip per cell, and
  remains one atomic transaction.
- A 10,000-comment cursor and 100,000-event history page each have p95 ≤250 ms, ≤4 SQL and response
  ≤256 KiB, use the expected index and never full-scan the project corpus.

Fixture setup is excluded and invariants are hard-asserted. Reuse `seed_dev.py` and Phase 3/4
performance/disposable-database harnesses; do not weaken a RED budget.

### Operational signals

Use dependency-free structured JSON logs with safe fields only: `event`, timestamp, request/operation
IDs, project ID, action/status/result, stable error code, retry, duration and counts. Required events:
`auth.config_invalid`, `auth.reject`, `auth.permission_denied`, `workflow.attempt/result`,
`workflow.serialization_retry/exhausted`, `revision.result`, `snapshot.invalid`, and
`comment.mutation`. Never log proxy secret, raw subject/groups, display/email unless necessary,
comment/deleted body, cell values or full snapshot. Log-capture tests include attacker-controlled
exception text and prove redaction.

Abort rollout on any auth-config 503 or snapshot-invalid. Alert on 401/403 >5× seven-day baseline or
>5% for 10 minutes; serialization retry >1% for 10 minutes or any exhaustion; approval/revision failure
>5% for 10 minutes; or p95 above budgets. Dashboard wiring is deployment-owned. The repo emits a
machine-readable tenant report (`pass|fail|pending`, owner, timestamp, checks, evidence path).

## 9. ADR

- **Decision:** trusted OIDC proxy, IdP-group permissions, pure workflow, consistent transactional
  approval snapshot, one active Revision successor and new approval/comment slice. The gateway owns
  cookie CSRF enforcement and PCM requires its verified proof on unsafe methods.
- **Drivers:** security boundary, immutable approved truth, atomic auditability and brownfield fit.
- **Alternatives:** direct JWT/SPA OIDC/local roles; mutable approved definitions; normalized snapshot
  tables; event replay; in-place revision. Rejected for added token/dependency/dual truth, lost
  immutability, over-modeling, incomplete replay or lost lineage.
- **Consequences:** gateway/group configuration is deployment-owned; snapshots consume JSONB; sparse
  rows are copied; tenant smoke needs external credentials.
- **Follow-up:** Phase 6 consumes frozen Approved/Archived definitions; rollout completes tenant and
  ingress/secret-rotation checklist.

## 10. Staffing/handoff

Available roles: `explore`, `planner`, `architect`, `critic`, `executor`, `test-engineer`,
`code-reviewer`, `security-reviewer`, `verifier`, `qa-tester`, `code-simplifier`.

- Current frontier model: sequential Architect→Critic consensus and final architecture/code review.
- Fast `gpt-5.3-codex-spark`: file-partitioned implementation/test lanes.
- Leader owns durable execution/checkpoints and integration; Team workers return evidence. Ralph is not
  selected. Recommended execution is explicit `$team` inside an Ultragoal-style leader-owned phase.

## 11. Consensus improvement log

- Added gateway CSRF/session/Origin, strict header/config/readiness and `business.read` contracts.
- Selected transition-owned `REPEATABLE READ`, exact retry/error/hash persistence and DefinitionView.
- Closed frozen Profile/list/choice/history/diff escapes while preserving Phase 4 baseline truth.
- Fixed lineage indexes/lock/flush order, edit-release exception and comment audit/security rules.
- Added exact cross-language DTO/event/cursor tables, 20k/100k performance gates, structured signals,
  rollout thresholds and owned pre-mortem actions.
