# Phase 5 Test Specification — Approval workflow + Revision

- **Status:** deliberate consensus approved (Architect v3 → Critic v2)
- **PRD:** [`docs/phase-5-approval-revision-prd.md`](./phase-5-approval-revision-prd.md)
- **D-10:** [`docs/phase-5-d10-sso-rbac.md`](./phase-5-d10-sso-rbac.md)

## 1. Policy and traceability

- Tests precede implementation. Pure domain tests import no framework/ORM.
- API tests assert status/error, persisted truth and exact event count/payload.
- PostgreSQL, not SQLite, proves transaction races and migration invariants.
- Frontend proves affordances/request suppression; backend proves security.
- Frozen tests mutate all live definition kinds after approval.
- Repository tests use normalized headers only; no production secret/real IdP.

| Criterion | Groups |
|---|---|
| EC1 frozen truth | B-SNAP, I-SNAPSHOT, F-RO/F-CHOICE, PG-APP |
| EC2 Revision | D-WF, I-REV, PG-REV, F-LINEAGE |
| EC3 RBAC/SSO | D-AUTH, I-RBAC, F-AUTH |
| EC4 validation/POR | I-REVIEW, I-APP |
| EC5 read-only | I-STATE, F-RO |
| EC6 comments | I-COM, F-COM |
| concurrency/regression/browser | PG-*, GATE-*, E2E-* |

## 2. Unit tests

### D-WF

Exhaustive state × action table: allowed target/effects and stable deny code. Draft Review requires
validation/POR/lock release; Review approve/reject; Rejected return; Approved Revision effect only;
Archived terminal; `is_editable` true only Draft.

### D-AUTH

- dev stub only in allowed dev/test configuration;
- missing/wrong secret/issuer/subject/groups, malformed base64/JSON, non-list/string, duplicate,
  oversize/control characters rejected without echo; duplicate header fields are separate from
  duplicate group values; raw/decoded/element limits and strict unpadded alphabet are covered;
- optional display/email cannot change identity/roles; strict unpadded base64url UTF-8 covers Korean
  names, byte/scalar bounds, malformed UTF-8/alphabet/padding and control characters;
- exact group mapping, unknown ignore, multi-role union and exact D-10 permission matrix;
- strict unpadded base64url Subject/proxy-secret wire grammar; exact SHA-256
  issuer+NUL+decoded-sub actor encoding, deterministic role/permission order and 128-char storage;
- production mode/config validity, two-secret overlap rotation, mapping overlap/absence, and valid empty
  user claims; unsafe method missing/duplicate/invalid CSRF proof rejected in `trusted_proxy`, while
  development/test `dev_stub` remains usable without it.

### B-SNAP

- v3 round-trip to sheet columns, category, frozen options, rules and Profile labels;
- unknown/malformed version → `snapshot_invalid`, no live fallback;
- decimal/pattern/required/order/category/**description**/option activity/rule scope+spec+version preserved;
- fixed Profile ChoiceSets included; inactive/unregistered cell values remain stored but hidden.

### D-COM

Project target and complete valid cell target accepted; partial/mixed/non-member rejected; resolve,
unresolve, redaction and soft-delete projections deterministic.

## 3. Backend integration

### I-RBAC

Parameterize admin/reviewer/editor/no-role/unauthenticated across every read and mutation class:
registry/category/ChoiceSet/rule; project create/Profile/backbone/cell/condition/POR/lock;
transitions/Revision/comments/history/validation and `/auth/me`. Assert exact allow/401/403,
`required_permission`, zero mutation/event on denial, and body/header actor spoof resistance.
Inventory includes process, registry/rule reads and previews, project/backbone/list/detail/Profile,
sheet/history/validation/diff/comments. Assert precedence 401 → 403 → not-found/status/lock and that
`/auth/me` is the sole no-role exception. Static route-inventory test fails on an unclassified route.
Invalid production auth must not crash import/startup: `/health` stays exact 200, `/health/ready` and
all business requests return the D-10 exact safe 503 contract. Valid dev/test and production are ready.

### I-REVIEW / I-APP

- Valid Draft, one POR/layer, no errors → Review with stored basis/rules, lock deletion, one event.
- Every error class/missing POR/stale or duplicate transition → deterministic 409 and no side effects;
  inactive existing choice warning is allowed.
- Equal-basis approval creates snapshot/event with `revalidated=false`.
- Live definition change forces revalidation. Success snapshots exact new basis; error stays Review.
- Serialization/event/status failure injection rolls back everything.
- reject and return preserve events/comments and clear only current review evidence as specified.
- serialization/deadlock retry succeeds at most twice; exhaustion yields stable 409 and no duplicate
  transition/event. No transaction-owner query runs before isolation is selected.

### I-STATE

For every non-Draft state call every legacy mutation and lock acquire/heartbeat with an old valid token.
Expect `409 project_read_only` and no DB/event/lock change. Draft compatibility stays green.

### I-SNAPSHOT

Approve and capture Profile/sheet/validation/frozen-choice responses; then add/change/reorder/deactivate
parameters/categories, sheet/fixed-Profile choices and applicable rules. Approved/Archived responses
stay semantically identical and make no live ChoiceSet dependency. Revision Draft uses live changes.
Query-spy assertions prove zero live parameter/category/ChoiceSet/rule reads for frozen sheet, Profile
detail, project list labels, validation and frozen choices. Stored rows are projected through the view.
Approved/Archived history coordinate proof and backbone-diff parameter projections also use the frozen
view after live mutations. Phase 4 immutable baseline and repeatable-read diff loader stay distinct.

### I-REV

- Approved source → Archived + Draft v+1, copied Profile/layers/conditions/POR/provenance/all sparse
  cells, null target snapshot/review basis and exact paired events.
- non-Approved/unauthorized/existing successor/stale state rejected.
- inactive code copied/hidden then rendered after reactivation; source/target data independent.
- list/detail lineage and ordinary active-project creation invariant.
- exact checks/indexes (`version>=1`, root+version, unique predecessor, active identity), root assignment,
  archive-before-target flush, new-root-after-archive prohibition and preserved Phase 4 provenance.

### I-COM

Cursor/filter list; create project/cell; membership validation; resolve/unresolve; author/admin delete;
deleted body redaction; auth actor; exact atomic events; rollback; persistence across rejected→draft and
attachment to Archived source after Revision.
Cell target membership/DefinitionView-or-stored-cell predicate, 1..4000 normalized plain text,
XSS-shaped rendering, body-free events/logs, delete-terminal conflict and delete authorization are exact.

### I-MIG/HISTORY

Fresh and 0007→head migration, backfill, constraints/indexes/model parity and supported downgrade on
SQLite/PostgreSQL. New event types appear in backend/frontend history label/filter contracts and
boundary route enumerations.
Persist and round-trip the canonical 71-character `sha256:<64 hex>` Review basis on PostgreSQL;
model, migration, Pydantic and event contracts use the same format.
The upgrade fixture includes legacy identity plus Phase 4 snapshots and 20,000 cells/100,000 events.

## 4. PostgreSQL races

- `PG-APP-01`: approve/approve and approve/reject yield one winner/event/snapshot.
- `PG-APP-02`: concurrent registry/rule/choice change cannot mix basis; snapshot hash, event hash and
  approved hash agree. Barriers between loader queries prove the result is wholly pre-change or
  post-change, never mixed; overlap may validly capture the earlier coherent snapshot.
- `PG-REV-01`: concurrent Revision creates exactly one successor/version and archives source with it;
  distinct root/source rows lock in ascending project-ID order and source is rechecked under lock.
- `PG-REV-02`: failure after copy rolls back target/source/events.
- `PG-RBAC-01`: denied writes leave DB/event count unchanged.
- `PG-COM-01`: resolve/delete race is deterministic and never exposes deleted body.
- A registry writer committed between Review and Approval proves revalidation and a coherent new basis.
  Separate conformance cases distinguish PCM group-map reload from gateway membership/session refresh.

Use the existing disposable-database safety guard only.

## 5. Frontend

### F-AUTH/STATUS/LINEAGE

Auth bootstrap loading/success/401/no-role; permission action visibility plus authoritative 403 refresh;
all status badges/vN links; exact status×permission actions; double-submit prevention; query invalidation;
Review gate issue/POR rendering and coordinate navigation.
Auth bootstrap failure recovery may refresh identity once but never automatically replays the rejected
unsafe mutation after stale-permission 403.

### F-RO/F-CHOICE

Review/Approved/Rejected/Archived never acquire/retry/heartbeat locks, autosave, paste, backbone,
condition/POR or Profile writes. Grid copy/navigation/history/diff remain. Frozen choice labels/options
come from project snapshot resources, never live summary/version-retry APIs.
Lock release/beacon remains an authorized no-op outside Draft; error precedence is read-only before
lock conflict.

### F-COM

Project/cell threads, selected-cell target, cursor/error/retry, resolve/delete/redaction, keyboard focus
and marker priority below paste/validation/dirty.

## 6. Browser/adversarial QA

1. Editor edits Draft and requests Review; lock traffic stops/read-only begins.
2. Reviewer comments/rejects; editor returns Draft; comments persist.
3. Reviewer approves; admin mutates live registry; frozen sheet/Profile/options/rules, history
   coordinate labels and diff parameter universe remain; Phase 4 baseline truth remains unchanged.
4. Editor creates Revision; Archived v1 and live Draft v2 navigate by lineage.
5. Project/cell comment keyboard/workbench/marker flow.
6. Spoofed headers, stale permission/status, duplicate click and old lock token fail safely.
   Unsafe requests with wrong Origin/CSRF proof are denied by the gateway conformance path.
7. 1024/1440/1920 layout and dialog/focus/live-error accessibility.

Evidence lives under `docs/evidence/phase-5-approval-revision/`.

## 7. Deployment/observability

- Production refuses dev stub/missing secret/issuer/group mapping.
- Env/runbook covers gateway redirect/session/issuer/audience, header strip/replace, private ingress,
  encryption and secret rotation without committing secrets.
- Logs never contain secret/raw groups/deleted body.
- External tenant checklist: login, each role, revocation/session refresh, logout/expiry, direct backend
  denial, cookie flags, Origin/CSRF rejection and header stripping. Mark credential-gated rather than
  inventing a pass.
- Capture every PRD Operational signal with correlation fields and verify redaction even when exception
  text is attacker-controlled. Emit tenant JSON with `pass|fail|pending`, owner, timestamp, checks and
  retained evidence path.

## 7.1 Exact contract parity

Python domain/API and TypeScript tests assert PRD §5.1: workflow matrix/action order, DTO nullability,
200-item/256-KiB gate bounds, comment cursor, event schema v1 and shared Revision operation/pair ID.
Route inventory distinguishes `business.read` comment list from `project.comment` mutations. History
labels/filters accept all new event payloads.

## 7.2 Performance gates

- 20k Review/Approval: p95 ≤1.5 s, ≤14 SELECT, peak ≤64 MiB, response ≤256 KiB.
- 20k Revision: p95 ≤2.5 s, ≤8 SELECT/≤20 mutation round trips, peak ≤64 MiB, response ≤256 KiB;
  assert no per-cell SQL.
- 10k comments + 100k events: cursor/history p95 ≤250 ms, ≤4 SQL, response ≤256 KiB, expected index
  and no corpus full scan.

Warm once, sample five, exclude setup, assert fixture shape and emit JSON/Markdown evidence.

## 8. Gates

- `cd backend && uv run ruff check app tests`
- `cd backend && uv run pyright`
- targeted Phase 5 pytest, then `cd backend && uv run pytest`
- Alembic fresh/0007→head and disposable PostgreSQL concurrency suite
- `cd frontend && npm test && npm run typecheck && npm run build`
- browser/adversarial QA and Phase 4 writer/safety regression where applicable
- changed-file anti-slop pass, rerun impacted/full gates
- independent current-model code-reviewer `APPROVE` and architect `CLEAR`
- status/evidence docs, Lore commit, push and PR body with EC1–EC6 and external IdP smoke gap

Do not claim completion while any automated gate fails, any route/state permission path is untested,
frozen output can touch live definitions, or independent review has an unresolved finding.
