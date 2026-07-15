# Phase 3 Validation Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete Phase 3 validation engine: portable parameter validation, typed relation rules, server-authoritative whole-project validation, frontend parity, composite grid status, and the content-gated validation workbench.

**Architecture:** Pure Python and TypeScript domain mirrors evaluate immutable sheet inputs and emit the same stable issue contract. SQLAlchemy/FastAPI and React Query/Zustand orchestration translate persistence and UI state at the boundaries; validation results remain ephemeral and are fenced by definition-basis and mutation generations.

**Tech Stack:** Python 3.13+, FastAPI, Pydantic v2, SQLAlchemy async, Alembic, PostgreSQL JSONB/SQLite JSON variant, pytest, TypeScript 5.7, React 18, TanStack Query, Zustand, Glide Data Grid, Vitest.

**Design source of truth:** `docs/superpowers/specs/2026-07-15-phase-3-validation-engine-design.md`

## Global Constraints

- Add no dependencies.
- Follow strict TDD for every behavioral change: add one focused test, run it and observe the expected failure, implement the minimum behavior, rerun the focused test, then rerun the affected suite.
- Keep `backend/app/domain/validation/` free of imports from Pydantic, SQLAlchemy, FastAPI, `app.models`, and `app.features`.
- Use `Decimal` for all numeric parsing/comparison; never use binary float for validation.
- Persist no validation results and add no per-cell validation query.
- Keep malformed-number and new unknown/inactive-choice rejection as hard atomic Cell PATCH boundaries; required, range, pattern, and relation issues remain soft Draft issues.
- Never render raw backend exception text, raw rule JSON, or raw pattern source in the frontend.
- Portable patterns are whole-string, flag-free, length-bounded expressions using only literals, dot, explicit classes/ranges, top-level alternation, `?`, `{m}`, and `{m,n}` with the exact complexity ceilings in the design spec.
- `value_exists_in_prior_por` checks every current condition row against typed candidate values from strictly earlier POR rows, then adds the current layer POR candidate after evaluating that layer.
- Active rules are global by default and may narrow by project and current-layer scope only.
- All issue arrays and definition serializations are deterministic.
- Use Lore-format commits whose first line explains intent and whose trailers report confidence, scope risk, tests, and known untested PostgreSQL/browser evidence.
- PostgreSQL-only tests require `APP_TEST_DATABASE_URL`; absence is an environment limitation, not a reason to weaken or skip the tests in code.

---

### Task 1: Portable validation domain primitives

**Files:**
- Create: `backend/app/domain/validation/__init__.py`
- Create: `backend/app/domain/validation/types.py`
- Create: `backend/app/domain/validation/pattern.py`
- Create: `backend/tests/domain/validation/test_pattern.py`
- Modify: `backend/tests/test_boundaries.py`

**Interfaces:**
- Produces immutable `ParameterDefinition`, `ChoiceDefinition`, `ProjectContext`, `LayerInput`, `ConditionInput`, `ValidationScope`, `RequiredIfSpec`, `PriorPorSpec`, `ValidationRuleDefinition`, `ValidationIssue`, and `ValidationResult` dataclasses/enums.
- Produces `compile_portable_pattern(source: str) -> PortablePattern`, where `PortablePattern.fullmatch(value: str) -> bool` and `PortablePattern.max_match_length: int`.
- Produces `canonical_typed_value(value_type: ValueType, value: str | None) -> str | None` for text/choice identity and Decimal canonicalization.
- Consumes existing `app.domain.parameters.types.ValueType` and `app.domain.decimal_values.normalize_decimal` only.

- [ ] **Step 1: Add boundary and pattern contract tests**

  Add an import-boundary test that walks `backend/app/domain/validation/*.py` AST imports and rejects `pydantic`, `sqlalchemy`, `fastapi`, `app.models`, and `app.features`. Add parameterized parser tests covering all approved examples plus anchors, groups, lookarounds, backreferences, shorthands, inline flags, `*`, `+`, `{2,}`, descending ranges, more than 16 alternatives, more than 64 atoms, more than 16 quantified atoms, repetition upper bounds over 256, branch maximum length over 1,024, and adjacent overlapping quantified atoms. Assert final-newline and Unicode full-match behavior.

  ```python
  @pytest.mark.parametrize(
      ("source", "accepted", "rejected"),
      [
          ("[A-Z]{2}-[0-9]{4}", ["AB-1234"], ["xAB-1234", "AB-1234\n"]),
          ("Y|N", ["Y", "N"], ["", "YN"]),
          ("[A-Za-z0-9_.-]{1,64}", ["a_b-1.txt"], ["한글"]),
          ("가|나|다", ["가", "나", "다"], ["라마"]),
      ],
  )
  def test_portable_pattern_fullmatches(source, accepted, rejected):
      compiled = compile_portable_pattern(source)
      assert all(compiled.fullmatch(value) for value in accepted)
      assert not any(compiled.fullmatch(value) for value in rejected)
  ```

- [ ] **Step 2: Run the focused tests and verify RED**

  Run: `cd backend && .venv/bin/pytest -q tests/domain/validation/test_pattern.py tests/test_boundaries.py`

  Expected: collection/import failure because `app.domain.validation` and its public types do not exist.

- [ ] **Step 3: Implement immutable types and the bounded parser**

  Implement frozen, slotted dataclasses and string enums. The parser must scan the approved grammar instead of accepting arbitrary host regex; compute accepted character sets sufficiently to reject adjacent overlapping quantified atoms, compute branch maximum length, then compile only the already-validated source. `fullmatch` must first reject values longer than `max_match_length` and use Python `re.fullmatch`.

  ```python
  @dataclass(frozen=True, slots=True)
  class PortablePattern:
      source: str
      max_match_length: int
      _compiled: re.Pattern[str] = field(repr=False, compare=False)

      def fullmatch(self, value: str) -> bool:
          return len(value) <= self.max_match_length and self._compiled.fullmatch(value) is not None
  ```

  Raise `RuleViolationError` with stable code `portable_pattern_invalid`; keep parser diagnostics in exception details, not in issue details.

- [ ] **Step 4: Verify GREEN and static quality**

  Run:

  ```bash
  cd backend
  .venv/bin/pytest -q tests/domain/validation/test_pattern.py tests/test_boundaries.py
  .venv/bin/ruff check app/domain/validation tests/domain/validation/test_pattern.py tests/test_boundaries.py
  .venv/bin/pyright app/domain/validation tests/domain/validation/test_pattern.py
  ```

  Expected: all focused tests pass, Ruff reports no violations, and Pyright reports zero errors.

- [ ] **Step 5: Commit the domain foundation**

  Commit only Task 1 files with intent `Bound validation syntax before either runtime can evaluate it` and Lore trailers including the focused pytest/Ruff/Pyright evidence.

---

### Task 2: Pure standalone and relation evaluator with a shared golden contract

**Files:**
- Create: `frontend/src/shared/domain/validation/golden-cases.json`
- Create: `backend/app/domain/validation/scope.py`
- Create: `backend/app/domain/validation/evaluator.py`
- Create: `backend/app/domain/validation/hashing.py`
- Create: `backend/tests/domain/validation/test_evaluator.py`
- Create: `backend/tests/domain/validation/test_golden_contract.py`
- Create: `backend/tests/domain/validation/test_performance.py`
- Modify: `backend/app/domain/validation/__init__.py`

**Interfaces:**
- Consumes Task 1 immutable types and portable pattern compiler.
- Produces `evaluate_project(context, parameters, layers, rules) -> ValidationResult`.
- Produces `scope_applies_to_project(scope, context) -> bool` and `scope_applies_to_layer(scope, layer) -> bool`.
- Produces `validation_basis_hash(parameters, choice_set_versions, rules) -> str` in `sha256:<hex>` format using canonical JSON.
- The golden JSON has top-level `pattern_vectors` and `evaluation_vectors`; expected issues contain every public field and typed detail.

- [ ] **Step 1: Write golden and evaluator tests**

  Encode required absent/present, inclusive Decimal min/max, malformed stored number, pattern mismatch, active/inactive/unknown choices, `required_if` true/false/absent, and prior-POR cases. Include all project/layer scope fields, OR-within/AND-across behavior, first-layer failure, non-POR exclusion, empty-source skip, strictly earlier all-layer membership, deterministic keys/order, and two input permutations producing byte-identical normalized output.

  ```python
  result = evaluate_project(context, parameters, layers, rules)
  assert [issue.code for issue in result.issues] == [
      "required",
      "value_not_found_in_prior_por",
      "choice_inactive",
  ]
  assert json.dumps([issue.to_dict() for issue in result.issues], ensure_ascii=False) == expected_json
  ```

  The performance fixture must build 20,000 cells and 50 relation rules and assert algorithmic output counts; place the wall-clock CI ceiling behind a deliberately wider documented threshold while recording elapsed time.

- [ ] **Step 2: Run focused tests and verify RED**

  Run: `cd backend && .venv/bin/pytest -q tests/domain/validation/test_evaluator.py tests/domain/validation/test_golden_contract.py tests/domain/validation/test_performance.py`

  Expected: import failures for the evaluator, scope, and hashing functions.

- [ ] **Step 3: Implement one-pass deterministic evaluation**

  Pre-index parameters and choice options. Evaluate standalone issues row-by-row. Evaluate `required_if` in O(rows) per rule. For each prior-POR rule, maintain a typed candidate set and searched-layer count while traversing `sorted(layers, key=(sort_order, key))`; evaluate all current rows first and only then add the current POR candidate. Sort once using severity, layer, condition, parameter, rule, and issue keys.

  ```python
  for layer in ordered_layers:
      if scope_applies_to_layer(rule.scope, layer):
          for condition in ordered_conditions(layer):
              source = canonical_typed_value(source_parameter.value_type, condition.values.get(source_code))
              if source is not None and source not in prior_candidates:
                  issues.append(prior_por_issue(...))
      por = next((row for row in layer.conditions if row.is_por), None)
      if por is not None:
          candidate = canonical_typed_value(candidate_parameter.value_type, por.values.get(candidate_code))
          if candidate is not None:
              prior_candidates.add(candidate)
      searched_layer_count += 1
  ```

  Configuration/type mismatches raise stable `validation_configuration_invalid`; they never return an empty successful result.

- [ ] **Step 4: Verify GREEN, determinism, and performance shape**

  Run:

  ```bash
  cd backend
  .venv/bin/pytest -q tests/domain/validation
  .venv/bin/ruff check app/domain/validation tests/domain/validation
  .venv/bin/pyright app/domain/validation tests/domain/validation
  ```

  Expected: all domain validation tests pass and no static errors are reported.

- [ ] **Step 5: Commit the pure evaluator**

  Commit Task 2 files with intent `Keep every validation outcome deterministic and portable` and Lore test/performance trailers.

---

### Task 3: Parameter validation metadata, migration, and snapshot v3

**Files:**
- Create: `backend/alembic/versions/0005_validation_engine.py`
- Modify: `backend/app/models/parameter.py`
- Modify: `backend/app/features/parameters/schema.py`
- Modify: `backend/app/features/parameters/service.py`
- Modify: `backend/app/domain/parameters/rules.py`
- Modify: `backend/app/domain/parameters/snapshot.py`
- Modify: `backend/tests/domain/test_parameter_rules.py`
- Modify: `backend/tests/domain/test_parameter_snapshot.py`
- Modify: `backend/tests/features/test_parameters_api.py`
- Create: `backend/tests/migrations/test_phase_3_migration_pg.py`
- Modify: `frontend/src/api/types.ts`
- Modify: `frontend/src/features/parameters/form.ts`
- Modify: `frontend/src/features/parameters/form.test.ts`
- Modify: `frontend/src/features/parameters/ParameterAdminPage.tsx`
- Modify: `frontend/src/features/parameters/ParameterAdminPage.test.tsx`

**Interfaces:**
- Adds non-null `Parameter.required: bool = false`, nullable `pattern: str(256)`, and nullable `pattern_hint: str(256)`.
- Extends parameter create/update/output API using `model_fields_set` so omitted fields remain unchanged and explicit null clears nullable values.
- Extends `snapshot(..., validation_rules=())` to deterministic version 3 with parameter metadata, canonical filtered rules, and `validation_basis_hash`.
- Consumes `compile_portable_pattern` from Task 1 and `validation_basis_hash` from Task 2.

- [ ] **Step 1: Add failing metadata, clear-semantics, UI, snapshot, and migration tests**

  Assert: text pattern requires a nonblank paired hint; hint without pattern fails; non-text pattern fails; non-number unit/min/max fail; explicit null clears description/category/unit/min/max/pattern+hint; omission preserves values; clearing pattern also clears hint atomically; snapshot version is 3 and deterministic; existing rows upgrade with `required=false`; DB constraints reject illegal raw rows. Frontend form tests must serialize explicit clears rather than silently omit them and show only the hint, never raw pattern, in validation guidance.

- [ ] **Step 2: Run tests and verify RED**

  Run:

  ```bash
  cd backend
  .venv/bin/pytest -q tests/domain/test_parameter_rules.py tests/domain/test_parameter_snapshot.py tests/features/test_parameters_api.py
  cd ../frontend
  npm test -- src/features/parameters/form.test.ts src/features/parameters/ParameterAdminPage.test.tsx
  ```

  Expected: assertions fail because validation metadata fields and snapshot v3 are absent.

- [ ] **Step 3: Implement model/API/domain/snapshot/UI changes**

  Use `data.model_fields_set` for nullable patch fields. Canonicalize a submitted pattern before persistence; pair clearing must be atomic. Keep update code/value type immutability. Add database check constraints for text pattern pairing and number-only numeric metadata. Extend the form without exposing raw pattern in validation issue presentation.

  ```python
  if "pattern" in data.model_fields_set:
      if data.pattern is None:
          parameter.pattern = None
          parameter.pattern_hint = None
      else:
          parameter.pattern = compile_portable_pattern(data.pattern).source
          parameter.pattern_hint = normalized_required_hint(data.pattern_hint)
  elif "pattern_hint" in data.model_fields_set:
      raise DomainValidationError("pattern과 pattern_hint를 함께 보내야 한다")
  ```

- [ ] **Step 4: Verify focused suites and migration offline rendering**

  Run:

  ```bash
  cd backend
  .venv/bin/pytest -q tests/domain/test_parameter_rules.py tests/domain/test_parameter_snapshot.py tests/features/test_parameters_api.py
  .venv/bin/alembic upgrade head --sql >/tmp/phase3-upgrade.sql
  .venv/bin/ruff check app tests/domain/test_parameter_rules.py tests/domain/test_parameter_snapshot.py tests/features/test_parameters_api.py tests/migrations/test_phase_3_migration_pg.py
  .venv/bin/pyright app tests/domain/test_parameter_rules.py tests/domain/test_parameter_snapshot.py tests/features/test_parameters_api.py
  cd ../frontend
  npm test -- src/features/parameters/form.test.ts src/features/parameters/ParameterAdminPage.test.tsx
  npm run typecheck
  ```

  If `APP_TEST_DATABASE_URL` is set, also run `cd backend && .venv/bin/pytest -q tests/migrations/test_phase_3_migration_pg.py`; otherwise preserve the test and report the environment gap.

- [ ] **Step 5: Commit metadata and snapshot v3**

  Commit Task 3 files with intent `Let validation definitions travel with every parameter basis` and Lore trailers naming SQLite/unit/frontend evidence and the PostgreSQL environment status.

---

### Task 4: Typed validation-rule persistence and administration API

**Files:**
- Create: `backend/app/models/validation.py`
- Modify: `backend/app/models/__init__.py`
- Extend: `backend/alembic/versions/0005_validation_engine.py`
- Create: `backend/app/features/validation/__init__.py`
- Create: `backend/app/features/validation/schema.py`
- Create: `backend/app/features/validation/repository.py`
- Create: `backend/app/features/validation/rule_service.py`
- Create: `backend/app/features/validation/router.py`
- Modify: `backend/app/main.py`
- Modify: `backend/app/features/parameters/service.py`
- Create: `backend/tests/features/test_validation_rules_api.py`
- Modify: `backend/tests/features/test_parameters_api.py`
- Modify: `backend/tests/test_boundaries.py`

**Interfaces:**
- Adds `ValidationRule` ORM model with immutable unique code, name, description, severity, JSON/JSONB scope/spec, integer version, active flag, and timestamps.
- Adds `GET/POST/GET-by-code/PATCH /api/validation-rules`; no DELETE route.
- PATCH input always carries `expected_version`; row is locked with `SELECT ... FOR UPDATE`; canonical no-op does not increment and a content change increments exactly once.
- Adds repository query `active_rule_references_parameter(parameter_code: str) -> bool` used to block parameter deactivation.

- [ ] **Step 1: Write failing API and dependency tests**

  Cover strict `extra="forbid"` recursively, code regex/immutability, scope trimming and duplicate/empty rejection, typed spec union, parameter existence/activity/type/ChoiceSet compatibility, choice literal existence, Decimal literal canonicalization, global default scope, no-op/version behavior, stale expected version conflict, soft deactivation, absence of DELETE, and active-reference parameter deactivation blocking.

  ```python
  created = await client.post("/api/validation-rules", json=payload)
  assert created.status_code == 201
  unchanged = await client.patch(
      "/api/validation-rules/equipment_required",
      json={"expected_version": 1, "name": payload["name"]},
  )
  assert unchanged.json()["version"] == 1
  changed = await client.patch(
      "/api/validation-rules/equipment_required",
      json={"expected_version": 1, "severity": "warning"},
  )
  assert changed.json()["version"] == 2
  ```

- [ ] **Step 2: Run focused tests and verify RED**

  Run: `cd backend && .venv/bin/pytest -q tests/features/test_validation_rules_api.py tests/features/test_parameters_api.py tests/test_boundaries.py`

  Expected: imports/routes/model metadata assertions fail because the rule slice does not exist.

- [ ] **Step 3: Implement strict schemas, repository locking, canonical service, and routes**

  Use a discriminated Pydantic union on `spec.type`; set `ConfigDict(extra="forbid")` on every request object. Normalize and validate against active Parameter/ChoiceSet data before persistence. Compare canonical dictionaries, not raw JSON ordering. Translate defensive corrupt JSON to stable `validation_configuration_invalid` at the application boundary.

- [ ] **Step 4: Verify CRUD, deactivation fencing, and static checks**

  Run:

  ```bash
  cd backend
  .venv/bin/pytest -q tests/features/test_validation_rules_api.py tests/features/test_parameters_api.py tests/test_boundaries.py
  .venv/bin/ruff check app/features/validation app/models/validation.py app/main.py tests/features/test_validation_rules_api.py
  .venv/bin/pyright app/features/validation app/models/validation.py tests/features/test_validation_rules_api.py
  ```

  Expected: all focused tests pass and the route table contains no validation-rule DELETE method.

- [ ] **Step 5: Commit typed rule administration**

  Commit Task 4 files with intent `Prevent invalid or stale relation rules from entering the active basis` and Lore trailers.

---

### Task 5: Sheet definition expansion and whole-project validation endpoint

**Files:**
- Modify: `backend/app/features/sheets/schema.py`
- Modify: `backend/app/features/sheets/repository.py`
- Modify: `backend/app/features/sheets/service.py`
- Create: `backend/app/features/validation/project_service.py`
- Modify: `backend/app/features/validation/router.py`
- Create: `backend/tests/features/test_project_validation_api.py`
- Modify: `backend/tests/features/test_sheets_api.py`
- Modify: `backend/tests/features/test_cells_api.py`
- Modify: `backend/tests/features/test_projects_api.py`
- Create: `backend/scripts/measure_validation_perf.py`
- Create: `backend/tests/scripts/test_measure_validation_perf.py`

**Interfaces:**
- `SheetColumnOut` adds min/max/required/pattern/pattern_hint.
- `SheetRowOut` adds `layer_sort_order` and `condition_index`.
- `SheetOut` adds applicable canonical relation rules and `validation_basis_hash`.
- Adds bodyless `POST /api/projects/{project_id}/validate` returning `summary`, deterministic `issues`, UTC `evaluated_at`, `basis_hash`, and `rule_versions`.
- Exposes a reusable service method `validate_project(project_id: int) -> ProjectValidationOut` for Phase 5 without self-HTTP.

- [ ] **Step 1: Add failing sheet, endpoint, hard/soft-boundary, and performance-script tests**

  Assert project identity filters are applied once while layer scope remains in SheetOut; choices include inactive options via deduplicated resources; endpoint requires no edit lock/body; missing project is 404; zero issues is 200; corrupted active configuration is a non-green stable failure; basis hash changes on parameter/ChoiceSet/rule definitions but not cell values; rule versions match applicable active rules; all condition rows participate; soft-invalid values persist while hard malformed number/new invalid choice batches remain atomic rejection.

- [ ] **Step 2: Run focused tests and verify RED**

  Run:

  ```bash
  cd backend
  .venv/bin/pytest -q tests/features/test_sheets_api.py tests/features/test_project_validation_api.py tests/features/test_cells_api.py tests/scripts/test_measure_validation_perf.py
  ```

  Expected: schema field and route assertions fail.

- [ ] **Step 3: Implement one-load orchestration and API translation**

  Load project tree, active parameters with choices, applicable active rules, and categories in bounded queries. Convert ORM values to immutable domain inputs, call `evaluate_project`, and translate only typed issue details. Do not require or acquire `edit_lock`. Compute the same basis payload for SheetOut and validation response.

  ```python
  @router.post("/projects/{project_id}/validate", response_model=ProjectValidationOut)
  async def validate_project(project_id: int, service: ServiceDep) -> ProjectValidationOut:
      return await service.validate_project(project_id)
  ```

- [ ] **Step 4: Verify focused suites, static checks, and measured script behavior**

  Run:

  ```bash
  cd backend
  .venv/bin/pytest -q tests/features/test_sheets_api.py tests/features/test_project_validation_api.py tests/features/test_cells_api.py tests/scripts/test_measure_validation_perf.py
  .venv/bin/ruff check app/features/sheets app/features/validation scripts/measure_validation_perf.py tests/features/test_project_validation_api.py tests/scripts/test_measure_validation_perf.py
  .venv/bin/pyright app/features/sheets app/features/validation scripts/measure_validation_perf.py
  .venv/bin/python scripts/measure_validation_perf.py --cells 20000 --rules 50 --samples 3
  ```

  Expected: focused tests/static checks pass and the script prints median/p95 plus issue counts without persisting results.

- [ ] **Step 5: Commit the server-authoritative validation seam**

  Commit Task 5 files with intent `Make committed project validation authoritative without coupling it to edits` and Lore trailers.

---

### Task 6: TypeScript mirror and byte-equivalent golden evaluation

**Files:**
- Create: `frontend/src/shared/domain/validation/types.ts`
- Create: `frontend/src/shared/domain/validation/pattern.ts`
- Create: `frontend/src/shared/domain/validation/evaluator.ts`
- Create: `frontend/src/shared/domain/validation/messages.ts`
- Create: `frontend/src/shared/domain/validation/index.ts`
- Create: `frontend/src/shared/domain/validation/pattern.test.ts`
- Create: `frontend/src/shared/domain/validation/evaluator.test.ts`
- Create: `frontend/src/shared/domain/validation/messages.test.ts`
- Modify: `frontend/src/shared/domain/validation/golden-cases.json`
- Modify: `frontend/src/api/types.ts`
- Modify: `frontend/src/features/sheets/sheetAdapter.ts`
- Modify: `frontend/src/features/sheets/sheetAdapter.test.ts`

**Interfaces:**
- Mirrors Task 1/2 public issue/rule/input types using readonly TypeScript structures.
- Produces `evaluateProject(input: ValidationInput): readonly ValidationIssue[]`.
- Produces `compilePortablePattern(source: string): PortablePattern` with JavaScript match-length equality protection.
- Produces `validationIssueMessage(issue, parameterNames): string` using typed details only and a safe unknown-code fallback.
- Extends adapted grid columns/rows with validation metadata and explicit ordering coordinates.

- [ ] **Step 1: Add failing mirror, golden, and safe-message tests**

  Import the single shared `golden-cases.json`; assert normalized issue arrays deep-equal its expected arrays for every vector. Assert the final-newline case fails even with JavaScript `$` semantics, overly long values skip regex execution and fail, raw pattern/server text never appears in messages, and an unknown issue maps to `입력 조건을 확인해 주세요.`.

- [ ] **Step 2: Run focused Vitest and verify RED**

  Run:

  ```bash
  cd frontend
  npm test -- src/shared/domain/validation/pattern.test.ts src/shared/domain/validation/evaluator.test.ts src/shared/domain/validation/messages.test.ts src/features/sheets/sheetAdapter.test.ts
  ```

  Expected: module/field failures because the mirror is absent.

- [ ] **Step 3: Implement the restricted parser mirror, evaluator, mapping, and adapter**

  Port the bounded scanner semantics rather than relying on arbitrary `RegExp` acceptance. Compile only validated source as `^(?:<source>)$`, call `exec`, and require `match?.[0].length === value.length`. Canonicalize numbers as arbitrary-precision decimal strings without `Number`; compare sign, integer length, and padded fractional digits. Keep issue key/sort/detail construction byte-equivalent to Python.

- [ ] **Step 4: Verify parity, type safety, and build**

  Run:

  ```bash
  cd frontend
  npm test -- src/shared/domain/validation src/features/sheets/sheetAdapter.test.ts
  npm run typecheck
  npm run build
  ```

  Expected: golden vectors pass, TypeScript reports zero errors, and Vite builds successfully.

- [ ] **Step 5: Commit the frontend domain mirror**

  Commit Task 6 files with intent `Give editors immediate feedback without diverging from server truth` and Lore trailers.

---

### Task 7: Validation generations, autosave coalescing, and composite grid status

**Files:**
- Create: `frontend/src/api/validation.ts`
- Create: `frontend/src/api/validation.test.ts`
- Create: `frontend/src/features/sheets/validationState.ts`
- Create: `frontend/src/features/sheets/validationState.test.ts`
- Create: `frontend/src/features/sheets/useSheetValidation.ts`
- Create: `frontend/src/features/sheets/useSheetValidation.test.ts`
- Modify: `frontend/src/features/sheets/editStore.ts`
- Modify: `frontend/src/features/sheets/editStore.test.ts`
- Modify: `frontend/src/features/sheets/useSheetEditing.ts`
- Modify: `frontend/src/features/sheets/useSheetEditing.test.ts`
- Modify: `frontend/src/grid/types.ts`
- Modify: `frontend/src/grid/GlideConditionGrid.tsx`
- Modify: `frontend/src/grid/GlideConditionGrid.test.tsx`
- Modify: `frontend/src/features/sheets/SheetView.tsx`
- Modify: `frontend/src/features/sheets/SheetView.test.tsx`

**Interfaces:**
- `validateProject(projectId, signal?)` calls bodyless POST and returns typed response.
- `useSheetValidation` receives display rows, definitions, dirty generation, persistence-idle state, and a sheet-refetch callback; it returns issues, summary, confirmation/failure state, `explicitlyValidate`, and retry.
- Replaces exclusive `CellStatus.state` with `{ validation?: { severity; count; message }; dirty: boolean; commentCount?: number }` while preserving all facts.
- Successful durable mutation schedules one server validation after 500ms idle; explicit validation waits for durable autosave and blocks with `저장 후 검증해 주세요.` after persistence failure.

- [ ] **Step 1: Write failing generation, coalescing, stale-response, and overlay-priority tests**

  Use fake timers and deferred promises to prove: local accepted edit/paste increments display generation and evaluates immediately; multiple persistence successes coalesce at 500ms; explicit validation waits for the autosave queue; responses are ignored after project/authority/persisted-generation change; abort is attempted; basis mismatch refetches sheet before adoption; latest successful authoritative issues survive network failure; local provisional issues still update; status retains dirty/comment while error wins surface priority and warning beats dirty.

- [ ] **Step 2: Run focused tests and verify RED**

  Run:

  ```bash
  cd frontend
  npm test -- src/api/validation.test.ts src/features/sheets/validationState.test.ts src/features/sheets/useSheetValidation.test.ts src/features/sheets/editStore.test.ts src/grid/GlideConditionGrid.test.tsx src/features/sheets/SheetView.test.tsx
  ```

  Expected: missing hook/API and exclusive-status assertions fail.

- [ ] **Step 3: Implement separate display, persisted, and validation generations**

  Keep monotonic generations outside resettable maps. Capture project ID, mounted authority token, and persisted generation per request. Abort obsolete controllers but always compare capture before adoption. Run local evaluator from committed display rows only, not editor keystrokes. Merge dirty and issue maps into aggregate statuses by `conditionId/parameterCode`.

  ```ts
  export interface CellStatus {
    conditionId: string
    parameterCode: string
    validation?: { severity: 'error' | 'warning'; count: number; message: string }
    dirty: boolean
    commentCount?: number
  }
  ```

- [ ] **Step 4: Verify orchestration, grid behavior, types, and build**

  Run:

  ```bash
  cd frontend
  npm test -- src/api/validation.test.ts src/features/sheets/validationState.test.ts src/features/sheets/useSheetValidation.test.ts src/features/sheets/editStore.test.ts src/grid/GlideConditionGrid.test.tsx src/features/sheets/SheetView.test.tsx
  npm run typecheck
  npm run build
  ```

  Expected: all focused tests pass; no stale response can clear newer local issues; build succeeds.

- [ ] **Step 5: Commit safe validation orchestration**

  Commit Task 7 files with intent `Fence server confirmation from newer edits while preserving immediate feedback` and Lore trailers.

---

### Task 8: Content-gated accessible validation workbench and cell navigation

**Files:**
- Create: `frontend/src/features/sheets/ValidationWorkbench.tsx`
- Create: `frontend/src/features/sheets/ValidationWorkbench.test.tsx`
- Create: `frontend/src/features/sheets/validationWorkbenchState.ts`
- Create: `frontend/src/features/sheets/validationWorkbenchState.test.ts`
- Modify: `frontend/src/features/sheets/SheetFocusFrame.tsx`
- Modify: `frontend/src/features/sheets/SheetFocusFrame.test.tsx`
- Modify: `frontend/src/features/sheets/SheetView.tsx`
- Modify: `frontend/src/features/sheets/SheetView.test.tsx`
- Modify: `frontend/src/grid/types.ts`
- Modify: `frontend/src/grid/GlideConditionGrid.tsx`
- Create: `docs/evidence/phase-3-validation-browser-checklist.md`

**Interfaces:**
- Workbench mounts only with at least one issue or after one explicit validation in the mounted sheet session.
- Collapsed summary shows error/warning counts, confirmation state, and retry; expanded view filters and renders accessible issue tiles.
- Focusable `role="separator"` supports arrow-key resizing and current value semantics.
- Tile activation reveals a hidden category, then calls the grid adapter with domain coordinates and focuses/selects the target cell without exposing Glide coordinates.

- [ ] **Step 1: Write failing lifecycle, accessibility, resize, filter, and navigation tests**

  Assert no host height before activity; a zero-issue explicit result shows a success strip; errors/warnings filter independently; Enter and Space activate tiles; `aria-expanded`, full accessible description, severity text, retry, and visible focus exist; arrow keys clamp panel size; category reveal happens before `scrollToCell`; responsive classes encode 3/4/5 columns at 1024/1440/1920; configuration failure cannot show a green state.

- [ ] **Step 2: Run focused tests and verify RED**

  Run:

  ```bash
  cd frontend
  npm test -- src/features/sheets/ValidationWorkbench.test.tsx src/features/sheets/validationWorkbenchState.test.ts src/features/sheets/SheetFocusFrame.test.tsx src/features/sheets/SheetView.test.tsx
  ```

  Expected: missing workbench modules and lifecycle assertions fail.

- [ ] **Step 3: Implement the content gate, panel, tiles, and navigation handshake**

  Preserve `SheetFocusFrame`'s absent-workbench no-host contract. Put resizing state in sheet-feature code, not the grid adapter. Use deterministic issue keys for React keys and activation. Render safe mapped messages and explicit `오류`/`경고` labels. On activation, set category state, publish a pending domain-coordinate jump, and perform the grid call after the newly visible column commits.

- [ ] **Step 4: Verify UI tests, types, build, and browser checklist**

  Run:

  ```bash
  cd frontend
  npm test -- src/features/sheets/ValidationWorkbench.test.tsx src/features/sheets/validationWorkbenchState.test.ts src/features/sheets/SheetFocusFrame.test.tsx src/features/sheets/SheetView.test.tsx
  npm run typecheck
  npm run build
  ```

  Then execute the documented Chromium checklist against the local app when browser/runtime infrastructure is available and record 1024/1440/1920, keyboard-only, console, and network evidence. If the environment cannot launch the full stack, keep the checklist executable and report that gap explicitly.

- [ ] **Step 5: Commit the validation workbench**

  Commit Task 8 files with intent `Make validation findings navigable without reserving idle sheet space` and Lore trailers.

---

### Task 9: Full-stack regression, contract audit, and rollout evidence

**Files:**
- Modify: `plan/phase-3-tasks.md`
- Modify: `docs/evidence/phase-3-validation-browser-checklist.md`
- Create: `docs/evidence/phase-3-validation-verification.md`
- Modify only if a regression is reproduced first: affected implementation and its focused test file.

**Interfaces:**
- Consumes every previous task and produces release-quality evidence, not new architecture.
- Confirms the Phase 4 backbone baseline-diff follow-up remains planned but is not accidentally implemented as a live-source comparison in Phase 3.

- [ ] **Step 1: Run backend unit/API/static verification**

  Run:

  ```bash
  cd backend
  .venv/bin/pytest -q --ignore=tests/migrations --ignore=tests/scripts/test_seed_dev_pg.py
  .venv/bin/ruff check app tests scripts
  .venv/bin/pyright app tests scripts
  .venv/bin/alembic upgrade head --sql >/tmp/phase3-upgrade.sql
  ```

  Expected: zero failures/errors. If `APP_TEST_DATABASE_URL` exists, additionally run all PostgreSQL migration/seed tests and record their counts.

- [ ] **Step 2: Run frontend unit/static/build verification**

  Run:

  ```bash
  cd frontend
  npm test
  npm run lint
  npm run build
  ```

  Expected: all Vitest files pass, TypeScript reports zero errors, and Vite exits zero.

- [ ] **Step 3: Audit design coverage and security/safety invariants**

  Re-read all 22 design sections and record evidence for each exit criterion. Search the diff for persisted validation-result models, per-cell validation routes, raw exception rendering, unrestricted regex acceptance, `Number(` inside validation comparison code, and nested earlier-layer scans. Any finding requires a focused failing regression test before repair.

- [ ] **Step 4: Record reproducible evidence and complete the task ledger**

  In `docs/evidence/phase-3-validation-verification.md`, record exact commands, timestamps, pass counts, performance samples, PostgreSQL/browser availability, and remaining risks. Mark Phase 3 checklist entries only when backed by this evidence.

- [ ] **Step 5: Commit verification artifacts and any test-first fixes**

  Commit with intent `Make Phase 3 completion reproducible instead of relying on implementation claims` and Lore trailers listing every full-suite command and every environment-limited check.

