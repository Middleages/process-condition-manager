# Phase 3 Task 6 Report

## Outcome

Implemented the strict TypeScript validation mirror, safe Korean message mapping, exact Sheet/validation
API response types, and the Project/Sheet/ChoiceSet adapter seam. The shared
`frontend/src/shared/domain/validation/golden-cases.json` was imported unchanged by Vitest; no backend
behavior or fixture was modified.

## RED evidence

1. Initial focused command:
   - `cd frontend && npm test -- src/shared/domain/validation/pattern.test.ts src/shared/domain/validation/evaluator.test.ts src/shared/domain/validation/messages.test.ts src/features/sheets/sheetAdapter.test.ts`
   - Expected RED: three validation suites could not resolve the absent modules; eight new adapter
     assertions failed while eleven pre-existing adapter assertions still passed.
   - Raw log: `/tmp/phase3-task6-red.log`.
2. Incremental RED regressions captured before their fixes:
   - Empty Project layer preservation and stale `condition_count` join checks:
     `/tmp/phase3-task6-adapter-red2.log`.
   - Shared ChoiceSet canonical choices reference/mapping-once check:
     `/tmp/phase3-task6-choice-cache-red.log`.
   - Python-versus-JavaScript decimal strip semantics:
     `/tmp/phase3-task6-decimal-strip-red.log`.
   - Python dot semantics for CR/U+2028/U+2029:
     `/tmp/phase3-task6-dot-red.log`.

## GREEN implementation

### New validation domain

- `frontend/src/shared/domain/validation/types.ts`
  - Readonly parameter/project/layer/condition/rule inputs.
  - Closed known issue union plus future-compatible safe transport payload.
- `frontend/src/shared/domain/validation/pattern.ts`
  - Bounded code-point scanner mirroring Python limits and overlap checks.
  - Host regex is reached only after scanner validation and compiled in Unicode mode.
  - Full-match length guard rejects JavaScript `$` final-newline behavior.
  - Host-only normalization preserves approved escaped hyphens and Python dot semantics.
- `frontend/src/shared/domain/validation/evaluator.ts`
  - Standalone and relation semantics, cumulative prior-POR set, exact scope behavior, stable issue
    construction, and Python code-point sorting.
  - Decimal validation/canonicalization is string-only, including Python whitespace, 256 input, 128
    digit, grammar, and negative-zero semantics; no Number/parseFloat/BigInt coercion.
- `frontend/src/shared/domain/validation/messages.ts`
  - Stable code plus allowlisted typed-detail mapping only.
  - Exact unknown fallback: `입력 조건을 확인해 주세요.`.
- `frontend/src/shared/domain/validation/index.ts`
  - Public pure-domain exports.
- Tests import the single shared JSON fixture and compare both deep equality and `JSON.stringify`
  byte order for every evaluation vector.

### API and adapter boundary

- `frontend/src/api/types.ts`
  - Required Sheet validation metadata/order/rules/basis fields.
  - Project validation response, summary, issues, evaluated time, basis, and rule versions.
  - Sheet rule scope deliberately exposes layer scope only; project filters are already consumed.
- `frontend/src/features/sheets/sheetAdapter.ts`
  - Preserves column validation metadata and row ordering coordinates in adapted grid values.
  - Joins every Project layer to Sheet rows by stable key, retains empty layers, and fails closed on
    missing/duplicate metadata, sort mismatch, or condition-count mismatch.
  - Validates exact ChoiceSet code/version/activity and complete aggregate state.
  - Reuses one frozen canonical choices array for all parameters bound to the same set/version.
  - Converts Project identity, Sheet definitions/rules, complete layer metadata, and deduplicated
    choice resources to one `ValidationInput` without embedding options in `SheetOut`.
- Required existing typed test fixtures were minimally extended in:
  - `frontend/src/api/sheets.test.ts`
  - `frontend/src/features/sheets/SheetView.test.tsx`
  - `frontend/src/features/sheets/persistenceReconciliation.test.ts`
  - `frontend/src/features/sheets/useSheetChoiceSets.test.ts`

## Simplifications

- Reused the existing frontend decimal canonicalizer after an exact Python-compatible validation
  boundary instead of adding a decimal dependency or binary numeric representation.
- Used one cumulative typed candidate set per prior-POR rule; no nested earlier-layer scans.
- Reused one canonical choices array per ChoiceSet rather than copying option arrays per column/cell.
- Kept Task 7 hooks, state, validation requests, and UI out of this commit.
- Kept choice options out of Sheet transport and joined existing Project metadata instead of adding
  backend fields.

## Verification

- Focused exact command: 4 files, 87 tests passed.
  - Log: `/tmp/phase3-task6-focused-green.log`.
- Validation-directory command: 4 files, 87 tests passed.
  - Log: `/tmp/phase3-task6-scope-green.log`.
- `npm run typecheck`: passed with zero errors.
  - Log: `/tmp/phase3-task6-typecheck.log`.
- `npm run lint`: passed (repository lint delegates to typecheck).
- `npm run build`: passed; 2,185 modules transformed.
  - Log: `/tmp/phase3-task6-build.log`.
- Full `npm test`: 70 files, 761 tests passed.
- `git diff --check`: passed.
- Static search confirmed no `Number(`, `parseFloat(`, or `BigInt(` in validation code.
- Python sources were compared line-by-line for scanner limits, decimal behavior, preparation,
  standalone/relation evaluation, cumulative POR order, keys/details, and deterministic sort.
- Backend golden suite was not rerun because the shared fixture and all backend files are unchanged.

## Remaining risks

- Task 7 still must call the new pure adapter only after Project, Sheet, and exact-version choice
  resources are ready. The seam intentionally fails closed and requests refetch on mismatched pairs.
- No browser/UI flow was exercised because Task 6 contains no hook/state/UI integration.
- Vite reports the repository's existing Glide annotation and large-chunk warnings; build output is
  successful and this task does not change bundling.
