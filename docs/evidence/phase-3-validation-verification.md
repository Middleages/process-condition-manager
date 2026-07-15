# Phase 3 validation engine — Task 9 verification record

## 1. Result and source provenance

**Phase 3 exit criteria EC1–EC7 are complete.** Task 9 verified the approved 22-section design,
reproduced five verification regressions before changing their affected code/tests, executed the
full backend and frontend suites, exercised real PostgreSQL and Chromium, measured both pure and
HTTP performance, and preserved an immutable Phase 4 baseline-diff handoff without implementing it
prematurely.

| Field | Value |
|---|---|
| Base source | `43a95b92986a2bb4ba2e0130e17f9c26c4379734` on `phase3-validation-engine` |
| Verification window | began `2026-07-15T13:43:50Z` / `22:43:50+09:00`; final browser run `2026-07-15T14:58:34.568Z`–`14:59:02.045Z` |
| Host | Linux WSL2 x86_64; shell Python 3.11.10; backend `.venv` Python 3.14.3; Node 22.22.0; npm 11.11.1 |
| Containers | Docker 29.2.1; Compose 5.0.2; PostgreSQL 16.14 |
| Browser | Chromium 143.0.7499.4 |
| Durable browser record | [`phase-3-validation/run.json`](phase-3-validation/run.json) |
| Artifact integrity | [`phase-3-validation/artifact-manifest.sha256`](phase-3-validation/artifact-manifest.sha256) |

The browser result does not pretend that the base commit already contained Task 9 fixes. `run.json`
records the pre-run two-column `git status --short` output and the byte length/SHA-256 of the four
changed runtime sources loaded by the final stack. It also hashes the harness and fixture seeder.
Fixture JSON, screenshots, ARIA, console, and network captures are committed alongside that run.

## 2. Test-first regressions found during verification

Only reproduced regressions caused implementation/test changes. Each frontend regression was first
locked by a focused failing Vitest assertion, then fixed and re-run green. The PostgreSQL issue was a
revision-test harness drift, so only its migration test was corrected.

| Reproduced failure (RED) | Repair | Focused GREEN evidence |
|---|---|---|
| React StrictMode's discarded sheet effect issued a real first `POST /lock`, making the surviving mount read-only. | Defer the initial acquire to a microtask and re-check effect/session authority before networking in `useSheetEditing.ts`. | `useSheetEditing.test.ts`: 10/10 passed; discarded and surviving effects produce exactly one acquire. |
| Production Tailwind v4 CSS placed named `sm:grid-cols-2` after the arbitrary 1024/1440/1920 rules, so computed layouts remained two columns. | Use one consistently ordered arbitrary breakpoint family from 640 through 1920. | `ValidationWorkbench.test.tsx`: 8/8; built CSS order and real browser computed columns are 3/4/5. |
| Configuration unavailability rendered a retry-only definition message rather than design §10's fail-closed administrator guidance. | Replace the constant with the exact approved safe copy and update all consumers' assertions. | Four focused validation/Sheet files: 50/50 passed; browser proves no false green state/raw sentinel. |
| `scrollToCell` focused Glide before the new hidden-category columns and selection committed, allowing stale-coordinate focus. | Remove imperative early focus; the selection-commit layout effect is the sole focus owner. | Grid/Sheet focused set: 4 files, 44/44; browser clipboard proves exact hidden `MISSING` and visible `99` cells. |
| The Phase 2.6 migration test inserted current Phase 3 `Parameter` ORM columns while deliberately stopped at revision `0004`; PostgreSQL rejected absent `required/pattern/pattern_hint` columns. | Seed revision-appropriate valid rows with raw SQL, matching how the same test already probes its invalid row. | Focused PostgreSQL regression 1/1, then all PostgreSQL migration/seed tests 30/30. |

No dependency was added. The fixes remove an early focus side effect, align existing breakpoint
syntax, reuse the existing generation boundary, restore approved copy, and decouple a historical
migration test from future ORM expansion.

## 3. Automated verification

Commands were run from the repository unless a `cd` is shown.

| Area | Exact command | Result |
|---|---|---|
| Backend DB-free | `cd backend && .venv/bin/pytest -q --ignore=tests/migrations --ignore=tests/scripts/test_seed_dev_pg.py` | **414 passed, 22 skipped**, 37.08s, 95% aggregate coverage |
| Backend lint/static style | `cd backend && .venv/bin/ruff check app tests scripts` | **All checks passed** |
| Backend Pyright, bare-shell command from Task 9 | `cd backend && .venv/bin/pyright app tests scripts` | **19 errors**, all `FastAPI Depends(scope=...)`/`Depends.scope` typing; see interpreter note below |
| Backend Pyright, project environment | `cd backend && VIRTUAL_ENV="$PWD/.venv" PATH="$PWD/.venv/bin:$PATH" .venv/bin/pyright app tests scripts` | **0 errors, 0 warnings, 0 information** |
| Backend Pyright, explicit equivalent | `cd backend && .venv/bin/pyright --pythonpath .venv/bin/python app tests scripts` | **0 errors, 0 warnings, 0 information** |
| Frontend tests | `cd frontend && npm test` | **76 files, 827 tests passed**, 8.84s |
| Frontend lint alias | `cd frontend && npm run lint` | passed; invokes `npm run typecheck` |
| Frontend explicit types | `cd frontend && npm run typecheck` | passed |
| Frontend production build | `cd frontend && npm run build` | passed; Vite 6.4.1, 2,194 modules, 5.68s |

### Pyright interpreter note

The requested bare-shell binary command was retained as a known environment-specific failure rather
than relabeled green. Verbose resolution showed it loading third-party stubs from the host
`/home/appuser/.pyenv/versions/3.11.10/site-packages`, whose older FastAPI typing does not expose
`Depends.scope`, even though the Pyright executable itself lives in `.venv`. With the repository
virtual environment activated—or its interpreter given explicitly—the exact same source set is
clean. No suppression or source change was introduced to hide the host-interpreter mismatch.

### Build warnings

The production build emitted only the existing Glide/Rollup misplaced `/*#__PURE__*/` annotation
warnings and the existing >500kB chunk warning. Output included a 955.37kB JS entry (299.87kB gzip).
The generated CSS was additionally inspected: the 640/1024/1440/1920 media rules appeared in that
order and encoded the intended 2/3/4/5 columns.

## 4. PostgreSQL and migration evidence

A standalone `postgres:16-alpine` container, `pcm-phase3-task9-pg`, listened only on
`127.0.0.1:15436`, had **no mounts**, and reported PostgreSQL 16.14. The browser stack used the
separate Compose project `pcm-phase3-validation-qa` and ports 15434/15435/18002/15175. Its image and
volume provenance before cleanup is preserved in
[`phase-3-validation/runtime.txt`](phase-3-validation/runtime.txt).

| Check | Result |
|---|---|
| All PostgreSQL migration + seed tests after the test-harness repair | **30 passed**, 42 Alembic `path_separator` deprecation warnings, 16.89s |
| Focused Phase 3 migration + seed selection | **10 passed**, 12 warnings, 11.22s |
| Live isolated `alembic upgrade head` | exit 0; current revision `0005 (head)` |
| Live schema probe | three parameter validation columns; `validation_rule.spec` is PostgreSQL `jsonb` |
| Full `base:head --sql` | expected exit 1 at historical revision 0004's intentional online-only reset preflight; 176 partial lines / 5,779 bytes, SHA-256 `f0622b26155296252c697caa2a226820d9c979643129963bcc602d3a6ab7ab93` |
| Phase 3-only `0004:head --sql` | exit 0; 44 lines / 2,023 bytes, SHA-256 `ccd99531435849fed536ff73e20440250288cf22a79c25aa8f4fc222eb312c31` |

The full offline failure is intentional repository behavior, not a Phase 3 migration defect:
`0004_project_profile_managed_choices.py` performs a destructive reset preflight that explicitly
raises `Phase 2.6 reset preflight requires an online database connection`. The Phase 3 delta emits
clean offline SQL and the full chain upgrades cleanly against live PostgreSQL.

## 5. Reference performance

### Pure domain, DB-free

`backend/scripts/measure_validation_perf.py` evaluated **20,000 cells, 50 relation rules, 20 samples** per
round. Every round produced the same 800 issues (450 errors, 350 warnings).

| Round | Median | p95 | Approved target |
|---|---:|---:|---:|
| 1 | 20.975ms | 23.674ms | ≤500ms |
| 2 | 23.518ms | 27.558ms | ≤500ms |
| 3 | 23.093ms | 30.537ms | ≤500ms |

The non-flaky regression tests also passed **2/2** in 2.58s; the measured evaluator portion was
1.798996s against its wider 15s CI ceiling.

### Repository load + real HTTP endpoint

A separate migrated PostgreSQL database contained 200 parameters, 121 conditions, 20,000 cells and
50 rules. A cold `POST /api/projects/{id}/validate` completed in **461.111ms**. Across 20 warm
samples:

| Metric | Median | p95 | Approved target |
|---|---:|---:|---:|
| HTTP total | 462.843ms | 539.921ms | ≤1.5s |
| Time to first byte | 461.180ms | 538.144ms | ≤1.5s |

The deterministic response held 5,000 issues (2,500 error/2,500 warning), 50 rule versions,
1,681,514 bytes, and basis
`sha256:2acdec8bab1b46610ce1e5f862bcb2697608a298e2f4e3005236047563e3b1ab`.
Both reference targets pass with substantial margin; no validation-result persistence or cache was
introduced.

## 6. Real Chromium evidence

The complete observation tree and artifact hashes are in
[`phase-3-validation/run.json`](phase-3-validation/run.json); the assertion-by-assertion ledger is
[`phase-3-validation-browser-checklist.md`](phase-3-validation-browser-checklist.md).

- Initial zero state reserved no workbench height; explicit validation produced a 30px success strip.
- The held-edit timeline proves provisional feedback precedes persistence and a later correction is
  not cleared by an older generation.
- The six-issue state exercised standalone required/range/pattern, `required_if`, all-prior-POR
  membership, and inactive-choice warning with safe Korean actions.
- Autosave failure, validation 503/retry, and definition unavailability each retained truthful state
  and exact approved guidance.
- Keyboard filters, Enter/Space tiles, full accessible guidance, separator step/clamps, bidirectional
  pointer resize, paste guard, visible navigation, and hidden-category navigation all passed.
- Computed layouts were 3/4/5 columns at 1024/1440/1920; collapsed tiles were 50px and the selected
  long tile 74px; no measured horizontal overflow occurred.
- There were zero unexpected console warnings/errors/page errors, HTTP failures, or request failures.
  Seven deliberately injected 503 responses and their seven Chromium resource errors are retained
  and categorized in the raw logs.
- Screenshots and ARIA snapshots were visually inspected, not merely generated. No clipped primary
  action, covered focus ring, or viewport overflow was found.

Three bounded gaps are explicit rather than converted into pass claims: no comment-bearing browser
fixture; no in-flight project-switch browser race (generation fencing is in Vitest); and the safe
configuration screen was induced by a ChoiceSet-options 503 rather than physical database JSON
corruption (corrupt active configuration is covered in backend tests).

## 7. Exit-criteria evidence

| Criterion | Status | Evidence |
|---|---|---|
| EC1 immediate provisional + durable server confirmation | **pass** | Held PATCH/correction browser timeline; local/server generation tests |
| EC2 `required_if` + all-prior-layer POR membership | **pass** | Shared language-neutral golden cases in pytest/Vitest; six-issue PostgreSQL browser fixture |
| EC3 DB-free pure domain | **pass** | 414-test DB-free suite; boundary tests; pure performance runner |
| EC4 stable whole-sheet issues + exact cell jump | **pass** | whole-project API tests; `run.json` issue codes/typed coordinates; clipboard-proven visible/hidden targets |
| EC5 safe actionable Korean copy | **pass** | typed mapper tests; forbidden-token audit; screenshots/ARIA; fail-closed administrator message |
| EC6 snapshot v3 + deterministic basis | **pass** | snapshot/hash tests; Sheet/validation basis equality in fixture; rule-version map |
| EC7 20,000-cell/50-rule reference evidence | **pass** | three pure rounds and 20-sample live PostgreSQL HTTP measurements above |

## 8. Approved-design audit — all 22 sections

Every numbered section of
[`2026-07-15-phase-3-validation-engine-design.md`](../superpowers/specs/2026-07-15-phase-3-validation-engine-design.md)
was re-read against production code, migrations, tests, and the runtime evidence.

| § | Audit result and concrete evidence |
|---:|---|
| 1 Purpose | **covered** — hard edit/paste rejection remains distinct from soft Draft issues; local mirror plus server whole-project validation were exercised. |
| 2 Approved decisions | **covered** — D1–D20 map to pure domains, typed rules, ephemeral results, v3 basis and the Phase 4 handoff; no conflicting architecture was found. |
| 3 Goals/non-goals | **covered** — parity, DB-free evaluation and safe UX pass; searches found no DSL, rule-builder UI, result cache/persistence, approval state machine or production business-rule seed. |
| 4 Architecture | **covered** — Python domain imports remain free of models/features/FastAPI/Pydantic/SQLAlchemy; application and frontend boundaries are separate; grid consumes aggregate status. |
| 5 Data model | **covered** — revision 0005 adds constrained parameter metadata and the sole `validation_rule` table; snapshot serializer emits v3 rules and basis. |
| 6 Pure domain contracts | **covered** — immutable typed inputs/issues, Decimal canonicalization, stable keys and deterministic error-first coordinate/rule ordering pass shared cases. |
| 7 Portable pattern | **covered** — both runtimes enforce length/alternative/atom/quantifier/repetition/max-match and adjacent-overlap bounds, complete matching and forbidden constructs. |
| 8 Standalone semantics | **covered** — required, malformed number, inclusive range, pattern, active/inactive/unknown choice vectors pass in both runtimes. |
| 9 Relation schema | **covered** — strict scope and typed `required_if`/prior-POR specs; evaluator uses a cumulative typed set, evaluates current rows before adding current POR, and never nests earlier-layer rescans. |
| 10 Administration validation | **covered** — strict schemas, immutable code, canonical no-op/versioning, optimistic conflict and parameter-reference/type/ChoiceSet checks pass; corrupt active configuration fails closed. |
| 11 Sheet/validation APIs | **covered** — Sheet definition/basis fields and rule APIs exist; only bodyless whole-project `POST /projects/{id}/validate` exists; it is read-only/no edit lock; cell PATCH output remains cells + batch identity. |
| 12 Frontend confirmation | **covered** — dirty-display mirror, 500ms durable-save debounce, explicit save ordering, abort/coalescing, project/mount/definition/persist-generation fences and basis refetch are tested; lifecycle was browser-exercised. |
| 13 Issue/message contract | **covered** — stable codes and closed typed details feed the Korean mapper; raw backend message, pattern, SQL detail and stack rendering are absent; unknown-code fallback is safe. |
| 14 Grid/workbench UX | **covered** — aggregate validation/dirty/comment state and priority tests pass; content gate, truthful failure retention, filters, accessibility, resize and exact navigation pass; combined comment browser fixture remains the declared gap. |
| 15 Phase 5 contract | **covered as a reusable boundary** — deterministic v3 snapshot, basis and active rule versions are available without persisting issues; Phase 5 workflow/UI remains correctly out of scope. |
| 16 Performance | **covered** — cumulative-set complexity audit plus measured ≤500ms pure and ≤1.5s live HTTP targets; no per-cell ChoiceSet query or cache/persistence shortcut. |
| 17 Testing strategy | **covered** — shared JSON parity, DB-free, API, PostgreSQL migration, snapshot, soft/hard write, frontend generation/status/message/workbench and real-browser suites all ran. |
| 18 Migration/rollout | **covered** — live base→0005 works on PostgreSQL, Phase 3-only offline SQL works, existing defaults are safe, and no guessed production rules were seeded. |
| 19 Phase 4 handoff | **covered as plan-only** — `plan/phase-4-tasks.md` fixes copy/replacement-time immutable snapshot identity, every-row/every-cell classification and `baseline_unavailable`; no live-source implementation exists. |
| 20 Rejected alternatives | **preserved** — searches found no generic AST, unrestricted regex, named-template-only system, code-defined business rules, persisted issues, partial PATCH validation or live-source backbone comparison. |
| 21 Risks/mitigations | **covered** — parity, bounded regex, generation fencing, reference deactivation guard, basis/versioning, cumulative set, composite status, safe fallback and strict scopes have tests/evidence. |
| 22 Exit mapping | **covered** — EC1–EC7 evidence is linked above; lint/types/tests/migrations/build/static audit/browser/performance all have recorded outcomes and honest exceptions. |

## 9. Targeted safety/prohibition audit

Repository searches and direct source inspection established:

- **No persisted validation results:** the only validation ORM model/table is `ValidationRule` /
  `validation_rule`; issues are response/domain values only.
- **No per-cell validation API:** the only validation execution route is whole-project
  `POST /api/projects/{project_id}/validate`; `CellsPatchOut` contains persisted cells and `batch_id`.
- **No validation edit lock:** the validation route uses read authorization/service loading and never
  acquires or requires the project edit lock.
- **No raw internal rendering:** frontend message construction consumes known typed detail keys and
  `pattern_hint`; browser forbidden-token assertions pass.
- **No unrestricted regex:** both portable scanners bound grammar/complexity before host compilation.
- **No binary-float comparison:** Python validation uses Decimal canonical strings; validation
  comparison code contains no `Number(` conversion.
- **No quadratic prior-layer scan:** each prior-POR rule owns one cumulative `set`, checks all current
  rows, then adds the current POR candidate once.
- **No live backbone dependency:** `backbone_snapshot` appears only in approved design/data-model/
  Phase 4 planning, not current production models/migrations/frontend. Phase 4 explicitly rejects
  mutable live-source comparison.

## 10. Phase 4 immutable-baseline handoff

This verification deliberately makes **no Phase 4 schema or runtime implementation**. The immutable
handoff in `plan/phase-4-tasks.md` remains the source of truth:

1. Capture a versioned `sheet_layer.backbone_snapshot` at project creation or the latest layer
   replacement, in the same transaction as the copy/apply.
2. Preserve source project/layer identity, capture time, every source condition identity/label/order/
   POR flag, and every non-null parameter value.
3. Compare the full current condition/cell set, classifying `added`, `changed`, `cleared`, `removed`,
   and `unchanged`, with typed equality and lineage-first row matching.
4. Report missing/untrustworthy history as `baseline_unavailable`; never substitute the source
   project's later live values.

This is the Phase 4 starting contract and the explicit defense against rewriting historical truth.

## 11. Cleanup and remaining risks

Task 9 used only uniquely named disposable containers/volumes. After evidence capture, the Compose
project is removed with `down -v --remove-orphans`, the no-mount standalone PostgreSQL container is
removed, and exact-name/Compose-label probes confirm no Task 9 containers, networks, or volumes
remain. Python bytecode/cache directories generated by verification are removed from the workspace.
No unrelated Docker resources are touched.

Remaining risks are bounded and do not invalidate EC1–EC7:

- invoke Pyright with the repository virtual environment activated (or `--pythonpath`) until its
  bare-shell interpreter auto-discovery is made deterministic at the toolchain level;
- the two compound browser checklist rows stay unchecked for a comment-bearing cell and an
  in-flight project-switch race, although their code paths are unit-covered;
- real configuration corruption is backend-tested but was not injected into the browser database;
- build bundle size and third-party Glide annotation warnings predate Task 9 and remain visible;
- full offline base→head SQL remains impossible by intentional revision-0004 online preflight;
  use live base→head plus focused `0004:head --sql` for Phase 3.

## 12. Reproduction commands

```bash
# Backend DB-free and static verification
cd backend
.venv/bin/pytest -q --ignore=tests/migrations --ignore=tests/scripts/test_seed_dev_pg.py
.venv/bin/ruff check app tests scripts
VIRTUAL_ENV="$PWD/.venv" PATH="$PWD/.venv/bin:$PATH" .venv/bin/pyright app tests scripts
.venv/bin/alembic upgrade 0004:head --sql

# Frontend
cd ../frontend
npm test
npm run lint
npm run typecheck
npm run build

# Browser (requires the isolated stack and fixture described by the checklist)
cd ..
node docs/evidence/phase-3-validation/phase3_browser_qa.mjs

# Verify artifact integrity
(cd docs/evidence/phase-3-validation && sha256sum -c artifact-manifest.sha256)
```
