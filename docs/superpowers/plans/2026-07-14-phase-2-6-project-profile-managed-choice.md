# Phase 2.6 Project Profile + Managed Choice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 프로젝트 생성 시 한 번 복사되고 이후 잠금 아래 독립 편집되는 고정 Project Profile과, Profile·파라미터·조건표가 공유하는 버전형 ChoiceSet을 완성한다.

**Architecture:** backend는 `ChoiceSet`을 독립 aggregate로 두고 `parameter.choice_set_id`와 고정 Profile set code가 이를 참조하며, Project Profile은 기존 Project aggregate와 project lock 트랜잭션 안에서 관리한다. frontend는 ChoiceSet summary와 전체 option aggregate를 `(setCode, version, includeInactive)`로 캐시하고, 공용 문자열 decimal 정규화기와 접근 가능한 searchable combobox를 Project·Parameter·Glide 경계에서 재사용한다. 파괴적 Alembic 전환은 실제 PostgreSQL preflight로 보호하고 backend cutover 묶음 전체가 green이 된 뒤에만 main에 병합한다.

**Tech Stack:** Python 3.13, FastAPI, Pydantic 2, SQLAlchemy 2 async ORM, Alembic, PostgreSQL 16, SQLite test fixtures, React 18.3, TypeScript 5.7 strict, React Router 7.1, TanStack Query 5, Zustand 5, Glide Data Grid 6, Tailwind CSS 4, Vitest 4

## Global Constraints

- 정본은 [`2026-07-14-phase-2-6-project-profile-managed-choice-design.md`](../specs/2026-07-14-phase-2-6-project-profile-managed-choice-design.md)와 [`DESIGN.md`](../../../DESIGN.md)다.
- 자동 초기화는 Project Profile 생성에만 존재한다. 모든 `cell_value`는 수동 입력이며 source/automatic/override 컬럼을 추가하지 않는다.
- `device_ref`는 모델, API, 타입, 화면, 시드에 만들지 않는다.
- 프로젝트 identity `(line_id, process_id, part_id)`와 기존 Process/backbone/layer/lock/autosave/paste/condition/POR 계약을 보존한다.
- Profile은 고정 스키마다. EAV, JSON field registry, 동적 Profile field UI를 만들지 않는다.
- 실제 PARTID 원천 DB 연결은 제외하고 `ManualProjectMetadataProvider`만 등록한다.
- 런타임 값 타입은 `text | number | choice`뿐이다. `date`, `boolean`, 자동 셀 타입, 쉼표 기반 choice option은 제거한다.
- decimal은 binary float/JavaScript `Number`를 거치지 않고 승인된 문법·256자·128 digit 제한으로 canonical string을 저장한다.
- 업무 choice는 관리형 `ChoiceSet`; 저장값은 stable option code, 화면값은 mutable label이다.
- 기존 known inactive choice는 읽기·경고·승인 가능, 신규 inactive/unknown write는 422다.
- ChoiceSet mutation은 `expected_version`, row lock, transaction당 version `+1`로 lost update를 막는다.
- options page는 서로 다른 version을 섞지 않는다. stale page aggregate는 전부 폐기하고 page 1부터 다시 읽는다.
- Project Profile PATCH는 기존 `X-Lock-Token` fencing을 사용하고 omitted/null을 구분한다.
- fresh-start 전환이며 legacy backfill/dual-read compatibility layer를 만들지 않는다.
- `0004` preflight는 첫 schema-changing DDL 전에 9개 mutable table을 검사하고, online DB query가 불가능한 `alembic upgrade --sql`은 명시적으로 실패한다.
- migration은 fixed set `device_type`, `project_category`, `active_direction`, `gate_direction`만 만들고 business option은 만들지 않는다.
- 새 dependency, package, font, icon library, WebSocket/SSE를 추가하지 않는다.
- frontend Vitest는 node 환경이다. reducer/view-model/API/SSR markup은 자동화하고 실제 focus/keyboard/canvas/route 동작은 격리 browser QA로 증명한다.
- 시각 변경 Task 9~14는 아래의 executable Visual Ralph verdict 절차를 각 iteration의 다음 edit 전에 실행하고 task별 runtime/tracked JSON을 갱신한다.
- 모든 commit은 Lore trailer를 포함한다.

## Locked Implementation Decisions

1. Parameter CSV는 `options` 열을 명시적으로 거부하고 `choice_set_code`를 사용한다. 신규 choice row는 active set code가 필수다. 기존 choice row는 이 열을 생략하거나 현재 code와 정확히 같아야 하며 변경은 거부한다.
2. `ProjectMetadataProvider`는 audit에 필요한 `identifier: str`을 `load_seed()`와 함께 노출한다. manual provider identifier는 `manual`이다.
3. Process display snapshot은 create request가 아니라 새 `IngestReader.get_process(line_id, process_id)`에서 얻는다.
4. 모든 create는 `PROJECT_CREATE`를 기록한다. backbone을 썼다면 같은 transaction에 별도 `BACKBONE_COPY`도 기록한다.
5. 새 mutation schema는 `ConfigDict(extra="forbid")`를 사용해 immutable code나 Profile identity field를 조용히 무시하지 않고 422로 돌려준다.
6. `ChoiceValueOut.is_active`는 set과 option이 모두 active일 때만 true다.
7. inactive option의 명시적 no-op은 허용하지만, 다른 값에서 inactive code로 바꾸는 것은 거부한다. unknown code의 명시적 write는 no-op처럼 보여도 거부한다.
8. Wizard comment는 untouched면 payload에서 생략해 provider seed를 살리고, 사용자가 입력 후 비웠다면 explicit `null`을 보내 seed를 지울 수 있게 한다.
9. Profile fixed usage output은 `device_type`, `project_category`, `active_direction`, `gate_direction`이라는 resolved API field name을 사용한다.
10. Snapshot v2의 범위는 pure deterministic serializer와 tests까지다. 승인본 persistence, Revision, live/frozen route 분기는 Phase 5에 남긴다.
11. ChoiceSet/option code는 path identity이므로 trim 후 ASCII URL-segment-safe grammar `^[A-Za-z0-9][A-Za-z0-9._-]*$`를 공유한다(set 최대 64자, option 최대 128자). `/`, `%`, whitespace, Unicode, 그리고 dot-segment `.`/`..`는 거부한다. 정확한 대소문자 identity와 case-only 경고는 그대로다. 이는 승인된 path API가 모든 허용 code를 실제로 round-trip하기 위한 transport invariant다.

## Cutover and Merge Rule

Task 2~7은 각각 reviewer가 거절할 수 있는 독립 단위지만 하나의 backend cutover cluster다. 구현 branch 안에서는 각 Task가 명시된 테스트로 green이어야 하며, `ParameterOption` 제거부터 Alembic/seed 검증까지 Task 7이 통과하기 전에는 이 cluster 일부를 main에 cherry-pick하거나 배포하지 않는다. Task 2는 additive ChoiceSet 기반을 먼저 만들고, Task 3이 legacy ParameterOption 호출자를 한 번에 제거하며, Task 7이 최종 ORM과 migration schema 일치를 닫는다.

## Disposable PostgreSQL Test Service

Before the first PostgreSQL-only gate, start one volume-free test server; never reuse the default Compose app database:

```bash
docker rm -f pcm-phase26-test-db >/dev/null 2>&1 || true
docker run --rm -d --name pcm-phase26-test-db \
  --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_DB=pcm_test \
  -e POSTGRES_USER=pcm_user \
  -e POSTGRES_PASSWORD=pcm_pass \
  -p 15442:5432 postgres:16-alpine
until docker exec pcm-phase26-test-db pg_isready -U pcm_user -d pcm_test >/dev/null 2>&1; do sleep 1; done
export APP_TEST_DATABASE_URL=postgresql+asyncpg://pcm_user:pcm_pass@localhost:15442/pcm_test
export APP_DATABASE_URL="$APP_TEST_DATABASE_URL"
```

All local PG commands below use port 15442 and database `pcm_test`. Migration tests derive credentials but create/drop only guarded `pcm_phase26_test_<uuid>` databases. At the final cleanup run `docker rm -f pcm-phase26-test-db`; the container owns no named volume. CI continues to use its isolated service URL from workflow environment rather than this local port.

## Executable Visual Verdict Procedure

The installed workflow is `$visual-ralph`; there is no standalone `$visual-verdict` skill in this workspace. For Tasks 9~14, use the Visual Ralph Step 5 verdict with a role-specific `vision` subagent against the approved `DESIGN.md`, Phase 2.6 spec, and captured current-state screenshots. Before any next visual edit, require JSON with `score`, `verdict`, `category_match`, `differences[]`, `suggestions[]`, and `reasoning`; pass requires score at least 90 and no blocking finding. Capture at the task's listed viewports/routes/states.

Write runtime state to disjoint ignored paths `.omx/state/phase-2-6/task-<NN>-visual.json`, and copy the exact final JSON into tracked `docs/superpowers/evidence/visual/2026-07-14-phase-2-6-task-<NN>.json`. Only the tracked task file is committed. This keeps parallel Tasks 10, 12, and 14 from overwriting one shared OMX state file. Task 15 verifies all six tracked verdicts and incorporates them into the browser evidence.

## File and Ownership Map

### Backend domain and persistence

| File | Responsibility |
|---|---|
| `backend/app/domain/decimal_values.py` | decimal grammar, normalization, Decimal comparison |
| `backend/app/domain/choices/constants.py` | four fixed Profile set codes and usage-field mapping |
| `backend/app/domain/choices/rules.py` | set/option validation, full reorder validation |
| `backend/app/domain/choices/cursor.py` | opaque versioned option cursor |
| `backend/app/domain/choices/csv_import.py` | side-effect-free Choice option CSV preview plan |
| `backend/app/domain/parameters/snapshot.py` | deterministic snapshot v2 serializer |
| `backend/app/models/choice.py` | `ChoiceSet`, `ChoiceOption` ORM models |
| `backend/app/models/parameter.py` | category/parameter model, Numeric bounds, ChoiceSet relation |
| `backend/app/models/project.py` | Project aggregate, fixed `ProjectProfile`, events, sheet/lock models |
| `backend/alembic/versions/0004_project_profile_managed_choices.py` | reset-only final schema transition and fixed set bootstrap |

### Backend vertical slices

| File | Responsibility |
|---|---|
| `backend/app/features/choice_sets/schema.py` | exact ChoiceSet request/response contracts |
| `backend/app/features/choice_sets/repository.py` | aggregate summaries, locked mutations, indexed option lookup |
| `backend/app/features/choice_sets/service.py` | version checks, lifecycle rules, cursor, import transactions |
| `backend/app/features/choice_sets/router.py` | ten `/api/choice-sets` endpoints |
| `backend/app/project_metadata/provider.py` | provider Protocol and complete nullable seed value object |
| `backend/app/project_metadata/manual.py` | empty manual provider dependency |
| `backend/app/features/projects/{schema,repository,service,router}.py` | create/list/detail/Profile read+locked patch |
| `backend/app/features/parameters/{schema,repository,service,router}.py` | ChoiceSet-backed parameter administration |
| `backend/app/features/sheets/{schema,repository,service}.py` | sheet column ChoiceSet code/version projection |
| `backend/app/features/cells/{repository,service}.py` | atomic canonical decimal/managed choice writes and label audit |

### Frontend shared and API

| File | Responsibility |
|---|---|
| `frontend/src/shared/domain/decimal.ts` | string-only decimal normalization/comparison |
| `frontend/src/api/choiceSets.ts` | ChoiceSet HTTP client, query keys, restartable full-page loader |
| `frontend/src/shared/components/searchableChoiceState.ts` | local filter and keyboard state reducer |
| `frontend/src/shared/components/SearchableChoice.tsx` | accessible reusable DOM combobox |
| `frontend/src/features/choiceSets/choiceQueries.ts` | summary/version/option query policies and cache invalidation |
| `frontend/src/api/types.ts` | exact snake_case API contracts; no compatibility fields after cutover |

### Frontend features

| File | Responsibility |
|---|---|
| `frontend/src/features/choiceSets/*` | parameter subnav, set list/detail/edit/option/import flows |
| `frontend/src/features/parameters/*` | ChoiceSet selector and decimal-string parameter form |
| `frontend/src/features/projects/ProjectCreateWizard.tsx` | short core Profile capture without route regression |
| `frontend/src/features/projects/ProjectTable.tsx` | approved eight-column responsive project list |
| `frontend/src/features/projects/profileForm.ts` | full Profile hydrate/diff/validation contract |
| `frontend/src/features/projects/useProjectProfileLock.ts` | acquire/heartbeat/loss/release session for drawer |
| `frontend/src/features/projects/ProjectProfileDrawer.tsx` | grouped locked Profile editor |
| `frontend/src/features/sheets/useSheetChoiceSets.ts` | one versioned resource per distinct sheet set |
| `frontend/src/grid/decimalCell.tsx` | string-preserving Glide decimal cell |
| `frontend/src/grid/choiceCell.tsx` | label-rendering, code-saving searchable Glide choice cell |
| `frontend/src/grid/cellValue.ts` | common single edit and paste validator |

## Dependency Graph and Parallel Ownership

```text
Task 1 -> Tasks 3, 6, 11, 12, 13, 14
Task 2 -> Tasks 3, 4, 6, 7
Task 3 -> Tasks 4, 7, 11, 14
Task 5 -> Task 6
Tasks 2-6 -> Task 7
Task 7 -> Task 8 -> Task 9
Task 9 -> Tasks 10, 12, 14
Task 10 -> Task 11
Task 12 -> Task 13
Tasks 7, 10-14 -> Task 15
```

After Task 9, Task 10 (Choice admin), Task 12 (Project create/list), and Task 14 (Sheet/grid) may run in parallel only with disjoint file ownership. Task 11 waits for Task 10's subnav and Task 13 waits for Task 12's final Project types. One integration owner serializes edits to `backend/app/models/*`, `backend/app/main.py`, `backend/tests/conftest.py`, `frontend/src/api/types.ts`, `frontend/src/app/routes.tsx`, and `frontend/src/shared/layout/AppLayout.tsx`.

---

### Task 1: Language-neutral decimal contract and 409 error discrimination

**Files:**
- Create: `backend/app/domain/decimal_values.py`
- Create: `backend/tests/domain/test_decimal_values.py`
- Create: `frontend/src/shared/domain/decimal.ts`
- Create: `frontend/src/shared/domain/decimal.test.ts`
- Modify: `frontend/src/api/client.ts:27-53`
- Modify: `frontend/src/api/client.test.ts`

**Interfaces:**
- Produces: `normalize_decimal(raw: str) -> str`
- Produces: `normalize_optional_decimal(raw: str | None) -> str | None`
- Produces: `compare_canonical_decimals(left: str, right: str) -> int`
- Produces: `normalizeDecimalInput(raw: string): DecimalInputResult`
- Produces: `compareCanonicalDecimals(left: string, right: string): -1 | 0 | 1`
- Produces: `isLockConflict(error): boolean` requiring status 409 **and** code `lock_conflict`
- Produces: `isChoiceSetChanged(error): boolean` and untyped `getChoiceSetChangedDetails(error)` for Task 8

- [ ] **Step 1: Record the green baseline**

Run:

```bash
cd backend
uv run ruff check .
uv run pyright
uv run pytest -q
cd ../frontend
npm run lint
npm test
npm run build
```

Expected: backend Ruff/Pyright pass and 147 tests pass with 3 PostgreSQL-dependent skips; frontend typecheck passes, 43 files/339 tests pass, and the production build succeeds. Record count drift if main has advanced, but stop on any actual failure.

- [ ] **Step 2: Add failing Python golden-vector and boundary tests**

Create `backend/tests/domain/test_decimal_values.py`:

```python
import pytest

from app.domain.decimal_values import (
    compare_canonical_decimals,
    normalize_decimal,
    normalize_optional_decimal,
)
from app.domain.errors import RuleViolationError


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (" 001.5000 ", "1.5"),
        (".5", "0.5"),
        ("1.", "1"),
        ("-0.000", "0"),
        ("-.5000", "-0.5"),
        ("000", "0"),
    ],
)
def test_normalize_decimal_golden_vectors(raw: str, expected: str) -> None:
    assert normalize_decimal(raw) == expected


@pytest.mark.parametrize(
    "raw",
    ["+1", "1e3", "1,000", "1_000", "NaN", "Infinity", "--1", ".", "١", "１"],
)
def test_normalize_decimal_rejects_non_contract_spellings(raw: str) -> None:
    with pytest.raises(RuleViolationError, match="소수") as raised:
        normalize_decimal(raw)
    assert raised.value.code == "invalid_decimal"


def test_decimal_length_digit_and_optional_boundaries() -> None:
    assert normalize_decimal("9" * 128) == "9" * 128
    with pytest.raises(RuleViolationError):
        normalize_decimal("9" * 129)
    with pytest.raises(RuleViolationError):
        normalize_decimal("0" * 256 + ".1")
    assert normalize_optional_decimal("  ") is None
    assert normalize_optional_decimal(None) is None


@pytest.mark.parametrize(
    ("left", "right", "expected"),
    [("-10", "-2", -1), ("0.5", "0.50", 0), ("99.9", "100", -1), ("2", "-1", 1)],
)
def test_compare_canonical_decimals(left: str, right: str, expected: int) -> None:
    assert compare_canonical_decimals(left, right) == expected
```

- [ ] **Step 3: Add failing TypeScript parity and error-classification tests**

Create `frontend/src/shared/domain/decimal.test.ts` with the same accepted/rejected arrays and explicit comparison assertions:

```ts
import { describe, expect, it } from 'vitest'

import { compareCanonicalDecimals, normalizeDecimalInput } from './decimal'

describe('decimal contract', () => {
  it.each([
    [' 001.5000 ', '1.5'],
    ['.5', '0.5'],
    ['1.', '1'],
    ['-0.000', '0'],
    ['-.5000', '-0.5'],
    ['000', '0'],
  ])('normalizes %s to %s', (raw, expected) => {
    expect(normalizeDecimalInput(raw)).toEqual({ kind: 'valid', value: expected })
  })

  it.each(['+1', '1e3', '1,000', '1_000', 'NaN', 'Infinity', '--1', '.', '١', '１'])(
    'rejects %s',
    (raw) => expect(normalizeDecimalInput(raw).kind).toBe('invalid'),
  )

  it('distinguishes clear, digit limit, and ordering without Number', () => {
    expect(normalizeDecimalInput('   ')).toEqual({ kind: 'empty', value: null })
    expect(normalizeDecimalInput('9'.repeat(128)).kind).toBe('valid')
    expect(normalizeDecimalInput('9'.repeat(129)).toEqual({ kind: 'invalid', reason: 'too_many_digits' })
    expect(compareCanonicalDecimals('-10', '-2')).toBe(-1)
    expect(compareCanonicalDecimals('0.5', '0.50')).toBe(0)
    expect(compareCanonicalDecimals('99.9', '100')).toBe(-1)
  })
})
```

Extend `frontend/src/api/client.test.ts` so a 409 `choice_set_changed` is not a lock conflict and a 409 `lock_conflict` is:

```ts
it('does not classify every 409 as a lock conflict', () => {
  const changed = makeAxiosError(409, { code: 'choice_set_changed', message: 'changed' })
  const locked = makeAxiosError(409, { code: 'lock_conflict', message: 'locked' })

  expect(isLockConflict(changed)).toBe(false)
  expect(isChoiceSetChanged(changed)).toBe(true)
  expect(isLockConflict(locked)).toBe(true)
})
```

- [ ] **Step 4: Run focused tests and confirm the intended failures**

Run:

```bash
cd backend
uv run pytest tests/domain/test_decimal_values.py -q
cd ../frontend
npm test -- src/shared/domain/decimal.test.ts src/api/client.test.ts
```

Expected: Python fails because `app.domain.decimal_values` does not exist; TypeScript fails because the decimal module and `isChoiceSetChanged` do not exist and the old `isLockConflict` returns true for a generic 409.

- [ ] **Step 5: Implement the backend normalizer**

Use one regex and manual canonical formatting, with `Decimal` only for comparison:

```python
# backend/app/domain/decimal_values.py
import re
from decimal import Decimal

from app.domain.errors import RuleViolationError

_DECIMAL_PATTERN = re.compile(r"^-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$")
MAX_DECIMAL_INPUT_LENGTH = 256
MAX_DECIMAL_DIGITS = 128


def normalize_decimal(raw: str) -> str:
    text = raw.strip()
    if not text or len(text) > MAX_DECIMAL_INPUT_LENGTH or not _DECIMAL_PATTERN.fullmatch(text):
        raise RuleViolationError("허용된 소수 형식이 아니다", code="invalid_decimal")
    if sum("0" <= char <= "9" for char in text) > MAX_DECIMAL_DIGITS:
        raise RuleViolationError("소수 자릿수 제한을 초과했다", code="invalid_decimal")

    negative = text.startswith("-")
    unsigned = text[1:] if negative else text
    integer, dot, fraction = unsigned.partition(".")
    integer = (integer or "0").lstrip("0") or "0"
    fraction = fraction.rstrip("0") if dot else ""
    canonical = integer if fraction == "" else f"{integer}.{fraction}"
    if canonical == "0":
        return "0"
    return f"-{canonical}" if negative else canonical


def normalize_optional_decimal(raw: str | None) -> str | None:
    if raw is None or raw.strip() == "":
        return None
    return normalize_decimal(raw)


def compare_canonical_decimals(left: str, right: str) -> int:
    left_value = Decimal(normalize_decimal(left))
    right_value = Decimal(normalize_decimal(right))
    return (left_value > right_value) - (left_value < right_value)
```

- [ ] **Step 6: Implement the frontend normalizer and strict 409 helpers**

Use a discriminated result and string magnitude comparison:

```ts
// frontend/src/shared/domain/decimal.ts
export type DecimalInputResult =
  | { kind: 'empty'; value: null }
  | { kind: 'valid'; value: string }
  | { kind: 'invalid'; reason: 'format' | 'too_long' | 'too_many_digits' }

const DECIMAL_PATTERN = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/

export function normalizeDecimalInput(raw: string): DecimalInputResult {
  const text = raw.trim()
  if (text === '') return { kind: 'empty', value: null }
  if (text.length > 256) return { kind: 'invalid', reason: 'too_long' }
  if (!DECIMAL_PATTERN.test(text)) return { kind: 'invalid', reason: 'format' }
  if ([...text].filter((char) => char >= '0' && char <= '9').length > 128) {
    return { kind: 'invalid', reason: 'too_many_digits' }
  }

  const negative = text.startsWith('-')
  const unsigned = negative ? text.slice(1) : text
  const [rawInteger = '', rawFraction = ''] = unsigned.split('.', 2)
  const integer = rawInteger.replace(/^0+(?=\d)/, '') || '0'
  const fraction = rawFraction.replace(/0+$/, '')
  const canonical = fraction === '' ? integer : `${integer}.${fraction}`
  return { kind: 'valid', value: canonical === '0' ? '0' : negative ? `-${canonical}` : canonical }
}

export function compareCanonicalDecimals(left: string, right: string): -1 | 0 | 1 {
  const a = requireCanonical(left)
  const b = requireCanonical(right)
  if (a.negative !== b.negative) return a.negative ? -1 : 1
  const magnitude = compareMagnitude(a.integer, a.fraction, b.integer, b.fraction)
  return a.negative ? invert(magnitude) : magnitude
}

function requireCanonical(raw: string) {
  const result = normalizeDecimalInput(raw)
  if (result.kind !== 'valid') throw new Error(`Invalid decimal: ${raw}`)
  const negative = result.value.startsWith('-')
  const [integer, fraction = ''] = (negative ? result.value.slice(1) : result.value).split('.', 2)
  return { negative, integer, fraction }
}

function compareMagnitude(ai: string, af: string, bi: string, bf: string): -1 | 0 | 1 {
  if (ai.length !== bi.length) return ai.length < bi.length ? -1 : 1
  if (ai !== bi) return ai < bi ? -1 : 1
  const width = Math.max(af.length, bf.length)
  const left = af.padEnd(width, '0')
  const right = bf.padEnd(width, '0')
  return left === right ? 0 : left < right ? -1 : 1
}

function invert(value: -1 | 0 | 1): -1 | 0 | 1 {
  return value === 0 ? 0 : value === 1 ? -1 : 1
}
```

Change `isLockConflict` to:

```ts
export function isLockConflict(error: unknown): boolean {
  return (
    isApiError(error) &&
    error.response?.status === 409 &&
    error.response.data?.code === 'lock_conflict'
  )
}

export function isChoiceSetChanged(error: unknown): boolean {
  return (
    isApiError(error) &&
    error.response?.status === 409 &&
    error.response.data?.code === 'choice_set_changed'
  )
}
```

Task 8 adds the typed summary extractor after `ChoiceSetSummaryOut` exists; for this task return the raw details object through an internal-safe helper named `getChoiceSetChangedDetails` and test that non-object details return null.

- [ ] **Step 7: Run focused and static verification**

Run:

```bash
cd backend
uv run pytest tests/domain/test_decimal_values.py -q
uv run ruff check app/domain/decimal_values.py tests/domain/test_decimal_values.py
uv run pyright app/domain/decimal_values.py tests/domain/test_decimal_values.py
cd ../frontend
npm test -- src/shared/domain/decimal.test.ts src/api/client.test.ts
npm run typecheck
```

Expected: all focused tests and both static checks pass.

- [ ] **Step 8: Commit the foundation**

```bash
git add \
  backend/app/domain/decimal_values.py \
  backend/tests/domain/test_decimal_values.py \
  frontend/src/shared/domain/decimal.ts \
  frontend/src/shared/domain/decimal.test.ts \
  frontend/src/api/client.ts \
  frontend/src/api/client.test.ts
git commit -F - <<'MSG'
Make numeric values reproducible before adding new editors

Python and TypeScript now share the approved decimal spelling and comparison behavior, and frontend 409 handling no longer mistakes registry conflicts for lock loss.

Constraint: Numeric values must never pass through binary float or JavaScript Number
Rejected: Native number inputs and parseFloat | they accept exponent spellings and lose decimal text identity
Confidence: high
Scope-risk: narrow
Tested: Python and TypeScript golden vectors, limits, ordering, and 409 classification
MSG
```

---

### Task 2: ChoiceSet backend aggregate, pagination, import, and concurrency

**Files:**
- Create: `backend/app/domain/choices/__init__.py`
- Create: `backend/app/domain/choices/constants.py`
- Create: `backend/app/domain/choices/rules.py`
- Create: `backend/app/domain/choices/cursor.py`
- Create: `backend/app/domain/choices/csv_import.py`
- Create: `backend/app/models/choice.py`
- Create: `backend/app/features/choice_sets/__init__.py`
- Create: `backend/app/features/choice_sets/schema.py`
- Create: `backend/app/features/choice_sets/repository.py`
- Create: `backend/app/features/choice_sets/service.py`
- Create: `backend/app/features/choice_sets/router.py`
- Create: `backend/tests/domain/test_choice_rules.py`
- Create: `backend/tests/domain/test_choice_csv_import.py`
- Create: `backend/tests/features/test_choice_sets_api.py`
- Create: `backend/tests/features/test_choice_sets_pg.py`
- Modify: `backend/app/models/parameter.py:48-87` add nullable ChoiceSet relation while retaining legacy option relation until Task 3
- Modify: `backend/app/models/__init__.py`
- Modify: `backend/app/main.py`
- Modify: `backend/tests/test_boundaries.py`

**Interfaces:**
- Produces: `PROFILE_CHOICE_SET_FIELDS: dict[str, str]`
- Produces: `ChoiceSetRepository` locked mutation and aggregate summary methods
- Produces: `ChoiceSetService` methods matching all ten approved endpoints
- Produces: `ChoiceSetSummaryOut`, `ChoiceOptionOut`, `ChoiceOptionPageOut`, import schemas
- Produces: `ResolvedChoice` with set/option active flags and `effective_is_active`
- Produces: indexed `resolve_options(keys, include_inactive=True, for_write=False) -> dict[(set_code, option_code), ResolvedChoice]`
- Produces: `resolve_active_options(keys, for_write=True)` validation wrapper for write consumers
- Produces: `lock_active_sets_for_write(codes)` for Parameter create/CSV binding without an option code
- Produces: `summaries_by_ids(set_ids: Collection[int]) -> dict[int, ChoiceSetSummaryOut]` for Task 3
- Preserves: current ParameterOption API only until Task 3 replaces every caller

- [ ] **Step 1: Add domain rule, cursor, and CSV tests**

Use uppercase option codes to prove option validation does not reuse lowercase parameter-code grammar:

```python
# backend/tests/domain/test_choice_rules.py
import pytest

from app.domain.choices.cursor import ChoiceCursor, decode_choice_cursor, encode_choice_cursor
from app.domain.choices.rules import (
    normalize_choice_option,
    validate_complete_order,
)
from app.domain.errors import RuleViolationError


def test_option_code_is_trimmed_exact_and_uppercase_is_valid() -> None:
    assert normalize_choice_option(" FOUNDRY ", " Foundry ") == ("FOUNDRY", "Foundry")


@pytest.mark.parametrize("code", ["", " ", "X" * 129])
def test_option_code_must_be_non_empty_and_bounded(code: str) -> None:
    with pytest.raises(RuleViolationError):
        normalize_choice_option(code, "Label")


@pytest.mark.parametrize("code", ["A/B", "A%2FB", ".", "..", "한글", "A B"])
def test_path_unsafe_codes_are_rejected_consistently(code: str) -> None:
    with pytest.raises(RuleViolationError):
        normalize_choice_option(code, "Label")


def test_reorder_requires_every_code_once() -> None:
    validate_complete_order(["A", "B"], {"A", "B"})
    with pytest.raises(RuleViolationError, match="모든"):
        validate_complete_order(["A", "A"], {"A", "B"})


def test_cursor_round_trips_version_and_position() -> None:
    cursor = ChoiceCursor(version=7, sort_order=20, code="SPECIAL")
    assert decode_choice_cursor(encode_choice_cursor(cursor)) == cursor
    with pytest.raises(RuleViolationError):
        decode_choice_cursor("not-a-cursor")
```

Create `backend/tests/domain/test_choice_csv_import.py` with concrete create/update/error expectations:

```python
from app.domain.choices.csv_import import build_choice_import_plan


CSV = """code,label,sort_order,is_active
FOUNDRY,Foundry,10,true
SPECIAL,Special customer,20,false
"""


def test_choice_csv_preview_classifies_create_and_update() -> None:
    plan = build_choice_import_plan(
        CSV,
        existing={"FOUNDRY": {"label": "Old", "sort_order": 0, "is_active": True}},
    )
    assert [(row.line, row.code, row.action) for row in plan.rows] == [
        (2, "FOUNDRY", "update"),
        (3, "SPECIAL", "create"),
    ]
    assert (plan.created_count, plan.updated_count, plan.error_count) == (1, 1, 0)


def test_choice_csv_duplicate_and_bad_bool_are_row_errors() -> None:
    plan = build_choice_import_plan(
        "code,label,sort_order,is_active\nA,Alpha,1,true\nA,Again,2,yes\n",
        existing={},
    )
    assert plan.error_count == 1
    assert plan.rows[1].action == "error"
```

- [ ] **Step 2: Add API and PostgreSQL lost-update tests**

Create `backend/tests/features/test_choice_sets_api.py` around this reusable creator:

```python
async def create_set(client, code: str = "device_type") -> dict:
    response = await client.post(
        "/api/choice-sets",
        json={"code": code, "display_name": code.replace("_", " ").title()},
    )
    assert response.status_code == 201, response.text
    return response.json()
```

The file must include executable tests with these exact assertions:

```python
async def test_option_mutation_bumps_once_and_stale_write_is_atomic(db_client) -> None:
    created = await create_set(db_client)
    option = await db_client.post(
        "/api/choice-sets/device_type/options",
        json={"expected_version": created["version"], "code": "FOUNDRY", "label": "Foundry"},
    )
    assert option.status_code == 201
    assert option.json()["choice_set"]["version"] == 2

    stale = await db_client.patch(
        "/api/choice-sets/device_type/options/FOUNDRY",
        json={"expected_version": 1, "label": "Overwrite"},
    )
    assert stale.status_code == 409
    assert stale.json()["code"] == "choice_set_changed"
    assert stale.json()["details"]["actual_version"] == 2

    page = await db_client.get(
        "/api/choice-sets/device_type/options",
        params={"include_inactive": True},
    )
    assert page.json()["items"][0]["label"] == "Foundry"


async def test_page_cursor_rejects_version_mixing(db_client) -> None:
    summary = await create_set(db_client, "large_set")
    version = summary["version"]
    for code in ["A", "B", "C"]:
        response = await db_client.post(
            "/api/choice-sets/large_set/options",
            json={"expected_version": version, "code": code, "label": code},
        )
        version = response.json()["choice_set"]["version"]

    first = await db_client.get(
        "/api/choice-sets/large_set/options",
        params={"version": version, "limit": 1, "include_inactive": True},
    )
    cursor = first.json()["next_cursor"]
    changed = await db_client.patch(
        "/api/choice-sets/large_set/options/A",
        json={"expected_version": version, "label": "Alpha"},
    )
    assert changed.status_code == 200
    second = await db_client.get(
        "/api/choice-sets/large_set/options",
        params={"cursor": cursor, "include_inactive": True},
    )
    assert second.status_code == 409
    assert second.json()["code"] == "choice_set_changed"
```

Add tests in the same file for:

- exact 201/200 response status table;
- sequential duplicate set code returns 409 `choice_set_exists`, not 500, with exactly one set and zero unexpected options;
- list default excluding inactive and `include_inactive=true` including it;
- summary total/active/parameter usage counts and four fixed `profile_usage_fields` mappings;
- set code and option code immutable via `extra="forbid"` 422;
- option code exact case comparison plus no hard-delete route;
- valid `A.B-_1` set/option API round-trip and 422 for slash/percent/dot-segment/Unicode/space in set create, option create, and CSV rows;
- inactive set rejecting new/activated option;
- `q` matching code and label case-insensitively;
- default limit 100, maximum 500, malformed cursor 422;
- reorder requiring active and inactive codes exactly once and version bump exactly once;
- preview no side effect, import error/stale apply no side effect, valid apply one version bump;
- existing CSV-absent option unchanged.

In `backend/tests/features/test_choice_sets_pg.py`, create two sessions with the same expected version and assert exactly one succeeds while the other raises `ConflictError(code="choice_set_changed")`. Use an `asyncio.Event` before each service call so both tasks begin with version 1; the repository's `SELECT FOR UPDATE` must serialize the actual check. Add two concrete race variants: competing full reorders with different order arrays must leave exactly the winner's complete order and one version increment; competing imports with distinct labels must leave exactly one complete CSV result, no labels from the loser, and one version increment. Also race two `POST`-equivalent service creates for the same new set code: unique-index `IntegrityError` is translated to 409 `choice_set_exists`, exactly one transaction succeeds, and the third-session query sees one set. All tests query final rows after both transactions settle.

- [ ] **Step 3: Run tests and confirm missing aggregate failures**

Run:

```bash
cd backend
uv run pytest \
  tests/domain/test_choice_rules.py \
  tests/domain/test_choice_csv_import.py \
  tests/features/test_choice_sets_api.py -q
```

Expected: collection fails because choice domain/model/feature modules do not exist.

- [ ] **Step 4: Implement fixed constants, models, and request schemas**

Use these constants exactly:

```python
# backend/app/domain/choices/constants.py
PROFILE_CHOICE_SET_FIELDS = {
    "device_type": "device_type",
    "project_category": "project_category",
    "active_direction": "active_direction",
    "gate_direction": "gate_direction",
}
FIXED_PROFILE_CHOICE_SET_CODES = frozenset(PROFILE_CHOICE_SET_FIELDS)
```

Define the ORM aggregate in `backend/app/models/choice.py`:

```python
class ChoiceSet(Base):
    __tablename__ = "choice_set"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(128))
    description: Mapped[str | None] = mapped_column(String(512), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    options: Mapped[list["ChoiceOption"]] = relationship(
        back_populates="choice_set",
        cascade="all, delete-orphan",
        order_by=lambda: (ChoiceOption.sort_order, ChoiceOption.code),
    )


class ChoiceOption(Base):
    __tablename__ = "choice_option"
    __table_args__ = (UniqueConstraint("choice_set_id", "code", name="uq_choice_option_set_code"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    choice_set_id: Mapped[int] = mapped_column(
        ForeignKey("choice_set.id", ondelete="CASCADE"), index=True
    )
    code: Mapped[str] = mapped_column(String(128))
    label: Mapped[str] = mapped_column(String(128))
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    choice_set: Mapped[ChoiceSet] = relationship(back_populates="options")
```

Add nullable `choice_set_id` and `choice_set` to `Parameter` now so summary usage queries are real. Keep `ParameterOption` only until Task 3 removes all callers.

Define the resolver DTO in `domain/choices/rules.py` (or a focused `types.py`) rather than returning ORM rows:

```python
@dataclass(frozen=True, slots=True)
class ResolvedChoice:
    set_code: str
    option_code: str
    label: str
    set_is_active: bool
    option_is_active: bool

    @property
    def effective_is_active(self) -> bool:
        return self.set_is_active and self.option_is_active
```

`resolve_options()` accepts a collection of exact `(set_code, option_code)` keys and resolves them in one indexed join; missing keys are absent from the result. With `for_write=True`, it first locks every referenced ChoiceSet row with `SELECT ... FOR UPDATE` in sorted set-code order, then resolves options and holds those locks through the caller's transaction commit. This serializes consumer writes against option/set deactivation, whose mutations already lock the same set row. `resolve_active_options()` uses that mode and raises one domain error for any missing or ineffective key. `lock_active_sets_for_write()` applies the same sorted lock/active check when a Parameter binds only a set code. Parameter, Project, Profile, and cell services never loop through singular resolver queries or validate a new choice outside this locked boundary.

Every create/patch/import/order schema in `choice_sets/schema.py` uses `ConfigDict(extra="forbid")`, exact field lengths, and the spec's field names. `ChoiceOptionPageOut.next_cursor` is `str | None`; `ChoiceImportRowOut.action` is `Literal["create", "update", "error"]`.

Register this exact route/status/output matrix; `expected_version` is always in JSON and never a header:

| Method and path | Success | Output |
|---|---:|---|
| `GET /api/choice-sets?include_inactive=` | 200 | `ChoiceSetSummaryOut[]` |
| `POST /api/choice-sets` | 201 | `ChoiceSetSummaryOut` |
| `GET /api/choice-sets/{set_code}` | 200 | `ChoiceSetSummaryOut` |
| `PATCH /api/choice-sets/{set_code}` | 200 | `ChoiceSetSummaryOut` |
| `GET /api/choice-sets/{set_code}/options?q=&version=&cursor=&limit=&include_inactive=` | 200 | `ChoiceOptionPageOut` |
| `POST /api/choice-sets/{set_code}/options` | 201 | `ChoiceOptionMutationOut` |
| `PATCH /api/choice-sets/{set_code}/options/{option_code}` | 200 | `ChoiceOptionMutationOut` |
| `PUT /api/choice-sets/{set_code}/option-order` | 200 | `ChoiceSetSummaryOut` |
| `POST /api/choice-sets/{set_code}/import/preview` | 200 | `ChoiceImportPreviewOut` |
| `POST /api/choice-sets/{set_code}/import` | 200 | `ChoiceImportApplyOut` |

- [ ] **Step 5: Implement cursor, CSV plan, repository, and service transaction rules**

Set/option create and CSV import use the same `normalize_choice_code(raw, max_length)` ASCII grammar; never rely on `encodeURIComponent` to make an otherwise invalid path identity usable. Cursor payload is URL-safe base64 JSON containing `v`, `o`, and `c`; invalid shape raises `RuleViolationError(code="invalid_cursor")`. Repository list pagination uses:

```python
if cursor is not None:
    stmt = stmt.where(
        or_(
            ChoiceOption.sort_order > cursor.sort_order,
            and_(
                ChoiceOption.sort_order == cursor.sort_order,
                ChoiceOption.code > cursor.code,
            ),
        )
    )
stmt = stmt.order_by(ChoiceOption.sort_order, ChoiceOption.code).limit(limit + 1)
```

All existing-set operations call `get_set_for_update(code)` before checking version. The version helper is:

```python
async def _require_expected_version(self, set_code: str, expected: int) -> ChoiceSet:
    choice_set = await self.repo.get_set_for_update(set_code)
    if choice_set is None:
        raise NotFoundError(f"선택지 집합을 찾을 수 없다: {set_code}")
    if choice_set.version != expected:
        summary = await self.repo.summary_by_id(choice_set.id)
        raise ConflictError(
            "선택지 집합이 다른 관리자에 의해 변경되었습니다.",
            code="choice_set_changed",
            details={
                "set_code": choice_set.code,
                "expected_version": expected,
                "actual_version": choice_set.version,
                "choice_set": summary.model_dump(mode="json"),
            },
        )
    return choice_set
```

Mutation code changes option/set fields first, then performs exactly one:

```python
choice_set.version += 1
await self.repo.flush()
```

Set create has no row to lock. Perform an early duplicate check for normal UX, but treat the unique index as authoritative: catch only its set-code `IntegrityError` at flush, roll back the failed unit of work, and raise `ConflictError(code="choice_set_exists", details={"set_code": code})`. Never turn an unrelated integrity error into this conflict.

List options locks the set row, checks a supplied first-page version or decoded cursor version before reading items, then returns the same locked version. Aggregate summary methods use correlated count subqueries or grouped subqueries in one SQL statement; never issue one count query per set. `resolve_option` joins on indexed `ChoiceSet.code`, `ChoiceOption.choice_set_id`, and exact `ChoiceOption.code` and can include inactive rows.

Import preview checks `expected_version` but does not mutate. Apply rejects any row error before changing options, applies every valid create/update, leaves absent existing codes unchanged, and bumps once.

- [ ] **Step 6: Register the router and run the complete ChoiceSet gate**

Register `choice_sets_router` under `/api` in `app/main.py`. Run:

```bash
cd backend
uv run ruff check .
uv run pyright
uv run pytest \
  tests/domain/test_choice_rules.py \
  tests/domain/test_choice_csv_import.py \
  tests/features/test_choice_sets_api.py \
  tests/test_boundaries.py -q
APP_TEST_DATABASE_URL=postgresql+asyncpg://pcm_user:pcm_pass@localhost:15442/pcm_test \
  uv run pytest tests/features/test_choice_sets_pg.py -q
```

Expected: domain/API/boundary tests pass; when the PostgreSQL URL is available the concurrent test reports one success and one `choice_set_changed`, never two successes.

- [ ] **Step 7: Commit the ChoiceSet aggregate**

```bash
git add backend/app/domain/choices backend/app/models backend/app/features/choice_sets \
  backend/app/features/parameters backend/app/main.py backend/tests/domain \
  backend/tests/features/test_choice_sets_api.py \
  backend/tests/features/test_choice_sets_pg.py backend/tests/test_boundaries.py
git commit -F - <<'MSG'
Make business choices reusable without sacrificing concurrent admin safety

ChoiceSet now owns stable option codes, mutable labels, versioned pages, atomic import, and aggregate usage summaries behind one API boundary.

Constraint: Existing inactive codes remain resolvable while new inactive writes are forbidden
Rejected: Per-parameter option copies | label changes and validation would diverge across consumers
Confidence: high
Scope-risk: moderate
Directive: Every existing-set mutation must lock and compare expected_version before changing rows
Tested: Domain rules, cursor, import, API lifecycle, stale pages, and PostgreSQL concurrent mutation
MSG
```

---

### Task 3: Parameter, sheet, and cell registry cutover

**Files:**
- Modify: `backend/app/models/parameter.py` remove `ParameterOption`; change bounds to `Decimal`/`Numeric`
- Modify: `backend/app/models/__init__.py`
- Modify: `backend/app/domain/parameters/rules.py`
- Modify: `backend/app/domain/parameters/csv_import.py`
- Modify: `backend/app/domain/parameters/__init__.py`
- Modify: `backend/app/features/parameters/schema.py`
- Modify: `backend/app/features/parameters/repository.py`
- Modify: `backend/app/features/parameters/service.py`
- Modify: `backend/app/features/parameters/router.py`
- Modify: `backend/app/features/sheets/schema.py`
- Modify: `backend/app/features/sheets/repository.py`
- Modify: `backend/app/features/sheets/service.py`
- Modify: `backend/app/features/cells/repository.py`
- Modify: `backend/app/features/cells/service.py`
- Create: `backend/tests/factories.py`
- Modify: `backend/tests/domain/test_parameter_csv_import.py`
- Modify: `backend/tests/domain/test_parameter_rules.py`
- Modify: `backend/tests/features/test_parameters_api.py`
- Modify: `backend/tests/features/test_sheets_api.py`
- Modify: `backend/tests/features/test_cells_api.py`
- Create: `backend/tests/features/test_choice_consumers_pg.py`
- Modify: `backend/tests/features/test_conditions_api.py`

**Interfaces:**
- Consumes: Task 1 decimal normalizer and Task 2 ChoiceSet repository/summary schemas
- Produces: `ParameterCreate.choice_set_code: str | None`
- Produces: `ParameterOut.choice_set: ChoiceSetSummaryOut | None`
- Produces: canonical string `min_value`/`max_value`
- Produces: `SheetColumnOut.choice_set_code` and `choice_set_version`, no inline options
- Produces: canonical cell PATCH response; managed-choice hard validation and label audit
- Removes: `ParameterOption`, `OptionIn`, `OptionOut`, `PUT /parameters/{id}/options`, and parameter CSV `options`

- [ ] **Step 1: Add centralized test factories before changing the model**

Create `backend/tests/factories.py` with explicit opt-in helpers, not autouse fixtures:

```python
from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.choices.constants import PROFILE_CHOICE_SET_FIELDS
from app.domain.parameters.types import ValueType
from app.models.choice import ChoiceOption, ChoiceSet
from app.models.parameter import Parameter, ParameterCategory


async def seed_choice_set(
    session: AsyncSession,
    *,
    code: str,
    options: tuple[tuple[str, str, bool], ...] = (),
    is_active: bool = True,
) -> ChoiceSet:
    choice_set = ChoiceSet(code=code, display_name=code, is_active=is_active)
    choice_set.options.extend(
        ChoiceOption(code=value, label=label, is_active=active, sort_order=index * 10)
        for index, (value, label, active) in enumerate(options, start=1)
    )
    session.add(choice_set)
    await session.flush()
    return choice_set


async def seed_required_profile_choice_sets(session: AsyncSession) -> dict[str, ChoiceSet]:
    result: dict[str, ChoiceSet] = {}
    for code in PROFILE_CHOICE_SET_FIELDS:
        result[code] = await seed_choice_set(
            session,
            code=code,
            options=(("DEFAULT", f"{code} default", True),),
        )
    return result


async def seed_parameter(
    session: AsyncSession,
    *,
    code: str,
    value_type: ValueType,
    choice_set: ChoiceSet | None = None,
) -> Parameter:
    category = ParameterCategory(code=f"cat_{code}", display_name=code)
    parameter = Parameter(
        code=code,
        display_name=code,
        value_type=value_type,
        category=category,
        choice_set=choice_set,
        min_value=Decimal("0") if value_type is ValueType.NUMBER else None,
        max_value=Decimal("1000") if value_type is ValueType.NUMBER else None,
    )
    session.add(parameter)
    await session.flush()
    return parameter
```

Migrate direct option setup in parameter/sheet/cell tests to these helpers while the old model still exists. Do not make the fixed-set fixture autouse because empty-set project-create tests need a truly empty registry.

- [ ] **Step 2: Rewrite failing parameter contract and CSV tests**

Use requests like:

```python
async def test_choice_parameter_requires_active_choice_set(db_client, db_session) -> None:
    await seed_choice_set(
        db_session,
        code="equipment_mode",
        options=(("AUTO", "Automatic", True),),
    )
    await db_session.commit()

    response = await db_client.post(
        "/api/parameters",
        json={
            "code": "mode",
            "display_name": "Mode",
            "value_type": "choice",
            "choice_set_code": "equipment_mode",
        },
    )
    assert response.status_code == 201
    assert response.json()["choice_set"]["code"] == "equipment_mode"
    assert "options" not in response.json()

    inactive = await db_client.patch(
        "/api/choice-sets/equipment_mode",
        json={"expected_version": 1, "is_active": False},
    )
    assert inactive.status_code == 200
    rejected = await db_client.post(
        "/api/parameters",
        json={
            "code": "mode_2",
            "display_name": "Mode 2",
            "value_type": "choice",
            "choice_set_code": "equipment_mode",
        },
    )
    assert rejected.status_code == 422
```

Add exact tests for non-choice + set rejection, missing set, immutable set after create, removed legacy option route 404/405, canonical min/max response, `min > max` 422, and list response summary without N+1 behavior.

Add a metadata test asserting `Parameter.__table__.c.value_type.type.enums == ["number", "text", "choice"]` and that the ORM table contains `ck_parameter_choice_set_binding`. The persisted spelling is the lowercase `ValueType.value`, never Python enum member names such as `NUMBER`.

Update `test_parameter_csv_import.py` with this final header:

```python
CSV_HEADER = (
    "code,display_name,value_type,category,unit,min_value,max_value,"
    "choice_set_code,description,sort_order"
)
```

Assert an `options` header raises `CsvImportError` with an instruction to use `choice_set_code`; new choice without active set is a row error; existing choice with omitted/same set updates; a different set is an immutable-field error; `001.5000`/`10.000` become `1.5`/`10`.

- [ ] **Step 3: Rewrite failing sheet and cell behavior tests**

Update the sheet assertion:

```python
choice_column = next(column for column in response.json()["columns"] if column["value_type"] == "choice")
assert choice_column["choice_set_code"] == "equipment_mode"
assert choice_column["choice_set_version"] == 1
assert "choice_options" not in choice_column
```

Add these concrete cell assertions:

```python
async def test_number_write_returns_and_stores_canonical_value(locked_project_client) -> None:
    response = await locked_project_client.patch_cells(
        [{"condition_id": 1, "parameter_code": "pitch", "value": " 001.5000 "}]
    )
    assert response.status_code == 200
    assert response.json()["cells"][0]["value"] == "1.5"
    assert await locked_project_client.cell_value(1, "pitch") == "1.5"


async def test_choice_event_snapshots_labels(locked_project_client) -> None:
    response = await locked_project_client.patch_cells(
        [{"condition_id": 1, "parameter_code": "mode", "value": "AUTO"}]
    )
    assert response.status_code == 200
    event = await locked_project_client.latest_cell_event()
    assert event.old_value is None
    assert event.new_value == "AUTO"
    assert event.payload["old_label"] is None
    assert event.payload["new_label"] == "Automatic"
```

The cell suite must also cover malformed number, unknown choice, inactive new choice, inactive set new choice, known inactive stored-value no-op, changed-away-then-back-to-inactive rejection, clear, text trim, mixed batch with one invalid rolling back every value/event, and identical validation for `origin=manual` and `origin=paste`.

`test_choice_consumers_pg.py` runs real two-session deactivate-versus-write races for parameter create/CSV apply and cell batch. If the consumer acquires the sorted ChoiceSet write lock first, its complete write commits before deactivation and becomes a valid historical inactive value. If deactivation commits first, the consumer returns 422 and stores nothing. Use barriers around lock acquisition and query final rows in a third session; no interleaving may store a newly inactive code after deactivation.

- [ ] **Step 4: Run the rewritten tests and verify legacy-contract failures**

Run:

```bash
cd backend
uv run pytest \
  tests/domain/test_parameter_csv_import.py \
  tests/domain/test_parameter_rules.py \
  tests/features/test_parameters_api.py \
  tests/features/test_sheets_api.py \
  tests/features/test_cells_api.py -q
```

Expected: failures show embedded `options`, float bounds, inline `choice_options`, and non-canonical cell values are still returned.

- [ ] **Step 5: Cut Parameter and Parameter CSV to the final contract**

In `models/parameter.py`, use unbounded Numeric and a ChoiceSet relation:

```python
value_type: Mapped[ValueType] = mapped_column(
    Enum(
        ValueType,
        native_enum=False,
        length=16,
        values_callable=lambda members: [member.value for member in members],
    )
)
choice_set_id: Mapped[int | None] = mapped_column(
    ForeignKey("choice_set.id"), nullable=True, index=True
)
min_value: Mapped[Decimal | None] = mapped_column(Numeric(), nullable=True)
max_value: Mapped[Decimal | None] = mapped_column(Numeric(), nullable=True)
choice_set: Mapped[ChoiceSet | None] = relationship(back_populates="parameters", lazy="selectin")
```

Add `CheckConstraint("(value_type = 'choice' AND choice_set_id IS NOT NULL) OR (value_type <> 'choice' AND choice_set_id IS NULL)", name="ck_parameter_choice_set_binding")` to ORM metadata. Delete `ParameterOption` and its exports. Add `ChoiceSet.parameters` with `back_populates="choice_set"`.

Replace `validate_choice_options` with:

```python
def validate_choice_set_binding(value_type: ValueType, choice_set_code: str | None) -> None:
    if value_type is ValueType.CHOICE and choice_set_code is None:
        raise RuleViolationError("choice 타입은 ChoiceSet이 필요하다", code="choice_set_required")
    if value_type is not ValueType.CHOICE and choice_set_code is not None:
        raise RuleViolationError("choice가 아닌 타입은 ChoiceSet을 가질 수 없다", code="choice_set_not_allowed")
```

Normalize bounds to canonical strings, compare with Task 1, and store `Decimal(canonical)`. Build every `ParameterOut` explicitly so Numeric output is normalized string and `choice_set` comes from `summaries_by_ids`, not ORM coercion.

Parameter create and CSV apply collect every new binding code and call `lock_active_sets_for_write()` before constructing/updating Parameters; preview remains side-effect free and may use unlocked summaries. The CSV parser recognizes `choice_set_code`, explicitly rejects any normalized `options` header, accepts active-set context and existing `{value_type, choice_set_code}` context, and never constructs an option row. Remove `replace_options` repository/service/router code.

- [ ] **Step 6: Cut sheet projection and cell validation atomically**

`SheetColumnOut` becomes:

```python
class SheetColumnOut(BaseModel):
    parameter_code: str
    display_name: str
    value_type: ValueType
    category_code: str | None
    unit: str | None
    description: str | None
    choice_set_code: str | None = None
    choice_set_version: int | None = None
    sort_order: int
```

`_build_live_columns` emits the related set code/version only. A choice parameter missing its set raises a domain validation error rather than emitting a broken column.

In `CellService.patch_cells`, load existing cells before type validation. Build a normalized candidate list without mutating ORM rows:

```python
@dataclass(frozen=True, slots=True)
class NormalizedCellUpdate:
    condition_id: int
    parameter_code: str
    value: str | None
    old_value: str | None
    old_label: str | None = None
    new_label: str | None = None
```

For number, call `normalize_optional_decimal`. For choice, trim/clear, resolve old and new codes in one indexed `resolve_options(..., for_write=True)` query, allow a known inactive value only when it equals the simulated current value, and require set+option active for any actual new value. Hold the sorted ChoiceSet locks through commit. Collect every violation, then raise one 422 before `_apply_change` or `add_event`. Only after the list is valid should the service mutate rows and add events. Choice event payload is:

```python
{
    "batch_id": batch_id,
    "origin": data.origin,
    "old_label": update.old_label,
    "new_label": update.new_label,
}
```

Keep `old_value` and `new_value` as stable codes in structured event columns.

- [ ] **Step 7: Run the cutover gate and source-removal scan**

Run:

```bash
cd backend
uv run ruff check .
uv run pyright
uv run pytest \
  tests/domain/test_parameter_csv_import.py \
  tests/domain/test_parameter_rules.py \
  tests/features/test_parameters_api.py \
  tests/features/test_sheets_api.py \
  tests/features/test_cells_api.py \
  tests/features/test_conditions_api.py -q
if grep -R "ParameterOption\|choice_options\|replace_options" app --exclude-dir='__pycache__'; then
  echo 'legacy parameter option reference remains' >&2
  exit 1
fi
```

Expected: focused suites and static checks pass; the scan produces no matches. Do not scan `.venv`.

With the isolated PostgreSQL URL available, also run:

```bash
APP_TEST_DATABASE_URL=postgresql+asyncpg://pcm_user:pcm_pass@localhost:15442/pcm_test \
  uv run pytest tests/features/test_choice_consumers_pg.py -q
```

Expected: both lock-order outcomes pass and no new inactive consumer write is observed.

- [ ] **Step 8: Commit the registry cutover**

```bash
git add backend/app/models backend/app/domain/parameters backend/app/features/parameters \
  backend/app/features/sheets backend/app/features/cells backend/tests
git commit -F - <<'MSG'
Make every sheet choice resolve through one managed registry

Parameters now bind immutable ChoiceSets, sheets publish only code/version references, and cell writes normalize decimals and validate stable choice codes atomically.

Constraint: Existing inactive codes are readable but cannot be newly written
Rejected: A dual-read ParameterOption bridge | the database is reset-only and a bridge would preserve two competing truths
Confidence: high
Scope-risk: broad
Directive: Keep canonical server response values as the source of truth for frontend autosave caches
Tested: Parameter API/CSV, sheet projection, cell batch atomicity, inactive lifecycle, and label audit
MSG
```

---

### Task 4: Deterministic parameter snapshot version 2

**Files:**
- Create: `backend/app/domain/parameters/snapshot.py`
- Create: `backend/tests/domain/test_parameter_snapshot.py`
- Modify: `backend/app/domain/parameters/rules.py:17,87-144` remove the v1 serializer
- Modify: `backend/app/domain/parameters/__init__.py`
- Modify: `backend/tests/domain/test_parameter_rules.py`

**Interfaces:**
- Consumes: canonical decimal strings and ChoiceSet code/option mappings from Tasks 1~3
- Produces: `SNAPSHOT_VERSION = 2`
- Produces: `snapshot(categories, parameters, choice_sets) -> dict[str, Any]`
- Produces: deterministic top-level `choice_sets` union of active choice-parameter refs plus all four fixed Profile sets
- Excludes: approved-project persistence, Revision, and runtime live/frozen selection

- [ ] **Step 1: Add a permutation-resistant snapshot test**

Create `backend/tests/domain/test_parameter_snapshot.py`:

```python
from copy import deepcopy

import pytest

from app.domain.errors import RuleViolationError
from app.domain.parameters.snapshot import snapshot


FIXED = [
    {"code": "device_type", "display_name": "Device Type", "version": 1, "options": []},
    {"code": "project_category", "display_name": "Project Category", "version": 1, "options": []},
    {"code": "active_direction", "display_name": "Active Direction", "version": 1, "options": []},
    {"code": "gate_direction", "display_name": "Gate Direction", "version": 1, "options": []},
]


def test_snapshot_v2_deduplicates_and_keeps_inactive_labels() -> None:
    categories = [{"code": "photo", "display_name": "Photo", "sort_order": 10, "is_active": True}]
    parameters = [
        {
            "code": "mode_b",
            "display_name": "Mode B",
            "value_type": "choice",
            "category_code": "photo",
            "choice_set_code": "equipment_mode",
            "sort_order": 20,
            "is_active": True,
        },
        {
            "code": "pitch",
            "display_name": "Pitch",
            "value_type": "number",
            "category_code": "photo",
            "min_value": "0.1",
            "max_value": "1000",
            "sort_order": 10,
            "is_active": True,
        },
        {
            "code": "mode_a",
            "display_name": "Mode A",
            "value_type": "choice",
            "category_code": "photo",
            "choice_set_code": "equipment_mode",
            "sort_order": 15,
            "is_active": True,
        },
    ]
    sets = FIXED + [
        {
            "code": "equipment_mode",
            "display_name": "Equipment Mode",
            "version": 7,
            "options": [
                {"code": "OLD", "label": "Old label", "sort_order": 20, "is_active": False},
                {"code": "AUTO", "label": "Automatic", "sort_order": 10, "is_active": True},
            ],
        },
        {"code": "unused", "display_name": "Unused", "version": 1, "options": []},
    ]

    result = snapshot(categories=categories, parameters=parameters, choice_sets=sets)

    assert result["version"] == 2
    assert [row["code"] for row in result["parameters"]] == ["pitch", "mode_a", "mode_b"]
    assert [row["code"] for row in result["choice_sets"]] == [
        "active_direction",
        "device_type",
        "equipment_mode",
        "gate_direction",
        "project_category",
    ]
    equipment = next(row for row in result["choice_sets"] if row["code"] == "equipment_mode")
    assert equipment["options"] == [
        {"code": "AUTO", "label": "Automatic", "sort_order": 10, "is_active": True},
        {"code": "OLD", "label": "Old label", "sort_order": 20, "is_active": False},
    ]
    assert "options" not in next(row for row in result["parameters"] if row["code"] == "mode_a")
    assert result == snapshot(
        categories=list(reversed(deepcopy(categories))),
        parameters=list(reversed(deepcopy(parameters))),
        choice_sets=list(reversed(deepcopy(sets))),
    )


def test_snapshot_rejects_a_missing_fixed_or_referenced_set() -> None:
    with pytest.raises(RuleViolationError) as raised:
        snapshot(categories=[], parameters=[], choice_sets=FIXED[:-1])
    assert raised.value.code == "snapshot_choice_set_missing"
```

Also test inactive parameters/categories are excluded, an inactive referenced set is still included, min/max strings are unchanged, a shared set appears once, and a non-referenced ordinary set is excluded.

- [ ] **Step 2: Run the new test and confirm v1 contract failures**

Run:

```bash
cd backend
uv run pytest tests/domain/test_parameter_snapshot.py tests/domain/test_parameter_rules.py -q
```

Expected: collection fails because `snapshot.py` is absent or assertions see version 1 and nested options.

- [ ] **Step 3: Move the serializer to a focused module and implement the v2 union**

Implement this exact boundary:

```python
# backend/app/domain/parameters/snapshot.py
from collections.abc import Iterable, Mapping
from typing import Any

from app.domain.choices.constants import FIXED_PROFILE_CHOICE_SET_CODES
from app.domain.errors import RuleViolationError

SNAPSHOT_VERSION = 2


def snapshot(
    *,
    categories: Iterable[Mapping[str, Any]],
    parameters: Iterable[Mapping[str, Any]],
    choice_sets: Iterable[Mapping[str, Any]],
) -> dict[str, Any]:
    active_categories = sorted(
        (row for row in categories if row.get("is_active", True)),
        key=lambda row: (int(row.get("sort_order", 0)), str(row["code"])),
    )
    active_parameters = sorted(
        (row for row in parameters if row.get("is_active", True)),
        key=lambda row: (int(row.get("sort_order", 0)), str(row["code"])),
    )
    required_set_codes = set(FIXED_PROFILE_CHOICE_SET_CODES)
    required_set_codes.update(
        str(row["choice_set_code"])
        for row in active_parameters
        if _value_type(row["value_type"]) == "choice"
    )
    set_by_code = {str(row["code"]): row for row in choice_sets}
    missing = sorted(required_set_codes - set(set_by_code))
    if missing:
        raise RuleViolationError(
            f"snapshot ChoiceSet이 없다: {', '.join(missing)}",
            code="snapshot_choice_set_missing",
        )

    return {
        "version": SNAPSHOT_VERSION,
        "categories": [_category_out(row) for row in active_categories],
        "parameters": [_parameter_out(row) for row in active_parameters],
        "choice_sets": [
            _choice_set_out(set_by_code[code]) for code in sorted(required_set_codes)
        ],
    }
```

`_parameter_out` includes existing code/display/value_type/category/unit/min/max/sort fields and `choice_set_code` only for choice. `_choice_set_out` includes `code`, `display_name`, integer `version`, and **all** options sorted by `(sort_order, code)` without filtering inactive. Re-export `snapshot` and `SNAPSHOT_VERSION` from `domain/parameters/__init__.py` so existing import sites remain stable.

- [ ] **Step 4: Verify deterministic output and commit**

Run:

```bash
cd backend
uv run pytest tests/domain/test_parameter_snapshot.py tests/domain/test_parameter_rules.py -q
uv run ruff check app/domain/parameters tests/domain
uv run pyright app/domain/parameters tests/domain
```

Expected: all snapshot/rule/static checks pass.

```bash
git add backend/app/domain/parameters backend/tests/domain
git commit -F - <<'MSG'
Give future approvals one deterministic registry boundary

Snapshot version 2 deduplicates managed choices, preserves inactive labels, and always captures the fixed Profile sets without taking on Phase 5 persistence.

Constraint: Approved persistence and Revision remain outside Phase 2.6
Rejected: Nested options per parameter | shared sets would be duplicated and could disagree
Confidence: high
Scope-risk: narrow
Tested: Input permutations, fixed/ref set union, inactive labels, deduplication, and missing-set failure
MSG
```

---

### Task 5: Project metadata provider and exact Process display snapshot seam

**Files:**
- Create: `backend/app/project_metadata/__init__.py`
- Create: `backend/app/project_metadata/provider.py`
- Create: `backend/app/project_metadata/manual.py`
- Create: `backend/tests/project_metadata/__init__.py`
- Create: `backend/tests/project_metadata/test_manual_provider.py`
- Modify: `backend/app/ingest/reader.py`
- Modify: `backend/app/ingest/fixture_reader.py`
- Modify: `backend/app/ingest/pg_reader.py`
- Modify: `backend/app/features/processes/service.py`
- Modify: `backend/tests/ingest/test_fixture_reader.py`
- Modify: `backend/tests/ingest/test_pg_reader.py`
- Modify: `backend/tests/features/test_processes_api.py`

**Interfaces:**
- Produces: complete `ProjectProfileSeed` dataclass containing every nullable Profile seed field except identity and process name
- Produces: `ProjectMetadataProvider.identifier: str`
- Produces: `ProjectMetadataProvider.load_seed(*, line_id, process_id, part_id)` Protocol
- Produces: `ManualProjectMetadataProvider(identifier="manual")`
- Produces: FastAPI dependency `get_project_metadata_provider()`
- Produces: `IngestReader.get_process(line_id, process_id) -> ProcessInfo`

- [ ] **Step 1: Add failing provider and reader-contract tests**

Create `backend/tests/project_metadata/test_manual_provider.py`:

```python
from dataclasses import asdict

from app.project_metadata.manual import ManualProjectMetadataProvider


async def test_manual_provider_has_auditable_identifier_and_empty_seed() -> None:
    provider = ManualProjectMetadataProvider()
    seed = await provider.load_seed(line_id="L1", process_id="PROC_ALPHA", part_id="PART-1")

    assert provider.identifier == "manual"
    assert all(value is None for value in asdict(seed).values())
    assert "line_id" not in asdict(seed)
    assert "process_id" not in asdict(seed)
    assert "part_id" not in asdict(seed)
    assert "process_name" not in asdict(seed)
```

Add to both ingest reader tests:

```python
async def test_get_process_returns_catalog_display_snapshot(reader) -> None:
    process = await reader.get_process("L1", "PROC_ALPHA")
    assert process.key == "L1::PROC_ALPHA"
    assert process.display_name == "L1 / PROC_ALPHA"


async def test_get_process_missing_raises(reader) -> None:
    with pytest.raises(NotFoundError):
        await reader.get_process("L9", "MISSING")
```

Update `test_processes_api.py` so detail display name is asserted from the reader's `ProcessInfo`, not reconstructed text.

- [ ] **Step 2: Run focused tests and verify missing seam failures**

Run:

```bash
cd backend
uv run pytest \
  tests/project_metadata/test_manual_provider.py \
  tests/ingest/test_fixture_reader.py \
  tests/ingest/test_pg_reader.py \
  tests/features/test_processes_api.py -q
```

Expected: provider modules and `get_process` are absent.

- [ ] **Step 3: Define the full seed value object and manual dependency**

`ProjectProfileSeed` has these fields, all `str | None = None`:

```python
@dataclass(frozen=True, slots=True)
class ProjectProfileSeed:
    device_type_code: str | None = None
    project_category_code: str | None = None
    comment: str | None = None
    active_direction_code: str | None = None
    gate_direction_code: str | None = None
    gross_die: str | None = None
    pitch_x: str | None = None
    pitch_y: str | None = None
    shot_x: str | None = None
    shot_y: str | None = None
    slit_occupancy: str | None = None
    lens_occupancy: str | None = None
    map_offset_x: str | None = None
    map_offset_y: str | None = None
    scribe_lane_x: str | None = None
    scribe_lane_y: str | None = None
    shot_count: str | None = None
    full_shot: str | None = None
    layer_total: str | None = None
    euv: str | None = None
    imm: str | None = None
    arf: str | None = None
    krf: str | None = None
    iline: str | None = None
    soh: str | None = None
    pspi: str | None = None
    metal_layer_count: str | None = None
```

The Protocol includes `identifier: str`; the manual implementation returns `ProjectProfileSeed()` and its dependency yields one stateless instance.

- [ ] **Step 4: Add `get_process` without duplicating query rules**

Fixture reader indexes and returns `_ProcessFixture.info`. Pg reader performs one bound query:

```python
async def get_process(self, line_id: str, process_id: str) -> ProcessInfo:
    stmt = text(
        "SELECT DISTINCT line_id, process_id "
        f"FROM {self._ref} "
        "WHERE line_id = :line_id AND process_id = :process_id"
    )
    row = (
        await self._session.execute(stmt, {"line_id": line_id, "process_id": process_id})
    ).one_or_none()
    if row is None:
        raise NotFoundError(f"process를 찾을 수 없다: {line_id}/{process_id}")
    return ProcessInfo(
        key=process_key(row.line_id, row.process_id),
        line_id=row.line_id,
        process_id=row.process_id,
        display_name=f"{row.line_id} / {row.process_id}",
    )
```

`ProcessService.get_process_detail()` calls `reader.get_process()` for `display_name` and `reader.get_layers()` for layers; it no longer builds the display string itself.

- [ ] **Step 5: Verify and commit the provider seam**

Run:

```bash
cd backend
uv run pytest \
  tests/project_metadata/test_manual_provider.py \
  tests/ingest/test_fixture_reader.py \
  tests/ingest/test_pg_reader.py \
  tests/features/test_processes_api.py -q
uv run ruff check app/project_metadata app/ingest app/features/processes tests/project_metadata tests/ingest
uv run pyright app/project_metadata app/ingest app/features/processes tests/project_metadata tests/ingest
```

Expected: all focused/static checks pass.

```bash
git add backend/app/project_metadata backend/app/ingest backend/app/features/processes \
  backend/tests/project_metadata backend/tests/ingest backend/tests/features/test_processes_api.py
git commit -F - <<'MSG'
Keep creation-time metadata replaceable without coupling projects to a source database

Project creation can now obtain an auditable empty seed and an exact Process Catalog display snapshot through explicit protocols.

Constraint: Phase 2.6 must not connect to the future PARTID source
Rejected: Accept process_name from the browser | the catalog alone owns the display snapshot
Confidence: high
Scope-risk: narrow
Tested: Manual seed contract and fixture/SQL reader process lookup
MSG
```

---

### Task 6: Project Profile creation, list, read, and locked atomic patch

**Files:**
- Modify: `backend/app/models/project.py`
- Modify: `backend/app/models/__init__.py`
- Modify: `backend/app/features/projects/schema.py`
- Modify: `backend/app/features/projects/repository.py`
- Modify: `backend/app/features/projects/service.py`
- Modify: `backend/app/features/projects/router.py`
- Create: `backend/tests/features/test_project_profiles_api.py`
- Modify: `backend/tests/factories.py`
- Modify: `backend/tests/features/test_projects_api.py`
- Modify: `backend/tests/features/test_projects_pg_ingest.py`
- Modify: `backend/tests/features/test_locks_api.py`
- Modify: `backend/tests/features/test_locks_pg.py`
- Modify: `backend/tests/features/test_conditions_api.py`
- Modify: `backend/tests/features/test_sheets_api.py`
- Modify: `backend/tests/features/test_cells_api.py`
- Modify: `backend/tests/features/test_choice_consumers_pg.py`

**Interfaces:**
- Consumes: Task 1 decimal, Task 2 option resolver, Task 5 provider/process reader
- Produces: exactly one `ProjectProfile` row per created Project
- Produces: `ProjectProfileOut`, `ProjectProfilePatchIn`, `ChoiceValueOut`
- Produces: `GET/PATCH /api/projects/{project_id}/profile`
- Produces: Project create core fields and `ProjectOut.profile`
- Produces: list filters/search/resolved summary without N+1
- Produces: `PROJECT_PROFILE_UPDATE` and complete `PROJECT_CREATE` provenance
- Removes: `Project.description` and all API/UI-facing description contracts on the backend

- [ ] **Step 1: Add the fixed model/output and transactional creation tests**

Create `backend/tests/features/test_project_profiles_api.py` with a fake provider dependency:

```python
class SeedProvider:
    identifier = "test-seed"

    async def load_seed(self, *, line_id: str, process_id: str, part_id: str) -> ProjectProfileSeed:
        assert (line_id, process_id, part_id) == ("L1", "PROC_ALPHA", "PART-1")
        return ProjectProfileSeed(comment="provider comment", pitch_x="001.5000", gross_die=" 20 ")
```

The create test seeds active `device_type` and `project_category` options, overrides the provider dependency, posts:

```python
payload = {
    "line_id": "L1",
    "process_id": "PROC_ALPHA",
    "part_id": "PART-1",
    "name": "Alpha",
    "device_type_code": "FOUNDRY",
    "project_category_code": "LOGIC",
    "comment": "explicit comment",
}
```

and asserts:

```python
assert body["profile"]["process_name"] == "L1 / PROC_ALPHA"
assert body["profile"]["device_type"] == {
    "code": "FOUNDRY", "label": "Foundry", "is_active": True
}
assert body["profile"]["comment"] == "explicit comment"
assert body["profile"]["pitch_x"] == "1.5"
assert body["profile"]["gross_die"] == "20"
assert "description" not in body
```

Add identity normalization cases: surrounding whitespace is trimmed once; blank and overlength LINE/Process/PARTID/name return 422; duplicate lookup with padded input finds the existing canonical identity; the same canonical locals are observed by `get_process`, `get_layers`, provider arguments, events, and stored Project.

Read the two creation events by type and assert `PROJECT_CREATE.payload` includes:

```python
{
    "metadata_provider": "test-seed",
    "profile_seed": {"comment": "provider comment", "pitch_x": "001.5000", "gross_die": " 20 "},
    "profile_final": {"comment": "explicit comment", "pitch_x": "1.5", "gross_die": "20"},
}
```

The actual payload also contains every nullable Profile key with null, plus `process_name`, required choice codes, and a batch id; assert credentials/query/connection keys are absent. Backbone creation must have exactly one `PROJECT_CREATE` and one `BACKBONE_COPY`.

- [ ] **Step 2: Add failure rollback, list, and Profile PATCH tests**

Add executable cases for:

- no active required option or inactive set/option -> 422 and zero Project/Profile/event rows;
- provider exception -> no visible rows;
- provider Device/Category defaults lose to required explicit request fields;
- untouched comment omission keeps provider comment, explicit null clears it;
- all direct `Project(...)` test factories attach a Profile;
- list exact device/category filters;
- free query matching comment and resolved choice code/label;
- one SQL page path without per-row option queries;
- inactive stored Profile choice resolves with `is_active=false`.

Use this patch test to lock omitted/null behavior:

```python
async def test_profile_patch_distinguishes_omitted_set_and_clear(project_with_lock) -> None:
    response = await project_with_lock.patch_profile(
        {"comment": None, "pitch_x": " 0010.5000 ", "device_type_code": "SPECIAL"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["comment"] is None
    assert body["pitch_x"] == "10.5"
    assert body["device_type"]["code"] == "SPECIAL"
    assert body["gross_die"] == "20"

    event = await project_with_lock.latest_profile_event()
    assert event.payload["changes"]["device_type_code"] == {
        "old": {"code": "FOUNDRY", "label": "Foundry"},
        "new": {"code": "SPECIAL", "label": "Special customer"},
    }
    assert event.payload["changes"]["pitch_x"] == {"old": "1.5", "new": "10.5"}
```

Also assert missing/wrong/expired token 409, required null/blank 422, identity extra field 422, invalid decimal 422 with no partial changes/event, known inactive same-code explicit no-op allowed, different inactive/unknown code rejected, one event for multiple changes, no event for empty/no-op patch, and `Project.updated_at` increases.

Extend `test_choice_consumers_pg.py` with Project create and locked Profile PATCH versus set/option deactivation. Use the same deterministic ChoiceSet row-lock protocol as parameter/cell tests: consumer-first commits completely before deactivate; deactivate-first yields 422 with no Project/Profile/event or Profile change/event.

- [ ] **Step 3: Run rewritten project/profile tests and confirm contract failures**

Run:

```bash
cd backend
uv run pytest \
  tests/features/test_projects_api.py \
  tests/features/test_project_profiles_api.py \
  tests/features/test_projects_pg_ingest.py \
  tests/features/test_locks_api.py -q
```

Expected: failures show missing Profile model/endpoints/core choice inputs and old description/event behavior.

- [ ] **Step 4: Add the fixed `ProjectProfile` model and strict schemas**

Add `PROJECT_PROFILE_UPDATE = "project_profile_update"` and one-to-one Project relationship. `ProjectProfile` has `project_id` PK/FK cascade, non-null `process_name`, required `device_type_code`/`project_category_code` as `String(128)`, nullable `active_direction_code`/`gate_direction_code` as `String(128)`, every non-choice value from the approved table as nullable `Text`, and timezone `created_at`/`updated_at`. Add model/migration parity assertions for all four code-column lengths/nullability. Add `Project.events` / `ChangeEvent.project` relationships so create events can reference the pending Project object and receive its key during the same flush. Remove `Project.description`.

Define `ProjectProfilePatchIn` with every approved field and `ConfigDict(extra="forbid")`; every field defaults to `None`, and service uses `data.model_fields_set` to distinguish omission. Identity fields are absent. Define `ProjectCreate` with `ConfigDict(extra="forbid")`, required core choice codes, optional comment, existing backbone fields, and no description/process_name.

Use this output shape verbatim:

```python
class ChoiceValueOut(BaseModel):
    code: str
    label: str
    is_active: bool


class ProjectProfileOut(BaseModel):
    project_id: int
    process_name: str
    device_type: ChoiceValueOut
    project_category: ChoiceValueOut
    comment: str | None
    active_direction: ChoiceValueOut | None
    gate_direction: ChoiceValueOut | None
    gross_die: str | None
    pitch_x: str | None
    pitch_y: str | None
    shot_x: str | None
    shot_y: str | None
    slit_occupancy: str | None
    lens_occupancy: str | None
    map_offset_x: str | None
    map_offset_y: str | None
    scribe_lane_x: str | None
    scribe_lane_y: str | None
    shot_count: str | None
    full_shot: str | None
    layer_total: str | None
    euv: str | None
    imm: str | None
    arf: str | None
    krf: str | None
    iline: str | None
    soh: str | None
    pspi: str | None
    metal_layer_count: str | None
    created_at: datetime
    updated_at: datetime
```

- [ ] **Step 5: Implement create merge/provenance and resolved output**

Inject provider in `projects/router.get_service`. Creation first normalizes `line_id`, `process_id`, `part_id`, and `name` into validated non-empty/max-length locals, then uses only those locals for duplicate lookup and every downstream call. Creation order is fixed:

```python
process = await self.reader.get_process(line_id, process_id)
required_choices = await self.choice_repo.resolve_active_options(
    {
        ("device_type", data.device_type_code.strip()),
        ("project_category", data.project_category_code.strip()),
    }
)
seed = await self.metadata_provider.load_seed(
    line_id=line_id, process_id=process_id, part_id=part_id
)
raw_seed = asdict(seed)
final_values = normalize_profile_seed(seed)
final_values["device_type_code"] = data.device_type_code.strip()
final_values["project_category_code"] = data.project_category_code.strip()
if "comment" in data.model_fields_set:
    final_values["comment"] = normalize_optional_text(data.comment)
```

The create resolver call uses `for_write=True` and retains the sorted fixed-set row locks through transaction commit, so concurrent deactivation either follows the completed create or makes create fail before any row/event exists.

Assign `process_name=process.display_name` separately. Validate all optional provider choice codes and decimal fields before adding the Project. Attach Profile, layers, and `ChangeEvent(project=project, ...)` objects to one Project, add `PROJECT_CREATE`; if backbone exists add `BACKBONE_COPY`; flush once through the existing duplicate-conflict handler. Do not construct an event with an unavailable pre-flush `project_id`.

Repository list uses one Profile join plus aliased fixed ChoiceSet/ChoiceOption joins. It returns resolved code/label/effective-active and layer/cell counts in the page query. Add exact code filters and free-text `ilike` for Project identity/name, Profile comment, and both resolved choice code/label. Do not render comment in summary, but include `updated_at` and `layer_total`.

- [ ] **Step 6: Implement all-before-mutation Profile PATCH under the existing lock**

Register:

```python
@router.get("/{project_id}/profile", response_model=ProjectProfileOut)
async def get_profile(project_id: int, service: ServiceDep) -> ProjectProfileOut:
    return await service.get_profile_out(project_id)


@router.patch(
    "/{project_id}/profile",
    response_model=ProjectProfileOut,
    dependencies=[Depends(require_edit_lock)],
)
async def patch_profile(
    project_id: int,
    data: ProjectProfilePatchIn,
    service: ServiceDep,
    user: UserDep,
) -> ProjectProfileOut:
    return await service.patch_profile(project_id, data, actor=user.id)
```

The service builds a candidate dict only from `model_fields_set`, trims required text, maps optional blank text to null, canonicalizes all ten decimal-spin fields, resolves all changed choice candidates with `for_write=True` before assigning, and holds those sorted ChoiceSet locks through commit. It then computes a changes payload, assigns changed fields, sets `project.updated_at = utcnow()`, appends exactly one event, flushes, and returns a fully resolved Profile. If the changes dict is empty, it returns without event/timestamp touch.

- [ ] **Step 7: Update every direct Project fixture and run the backend profile gate**

Search and update all direct project constructors:

```bash
cd backend
grep -R "Project(" -n tests scripts --include='*.py'
```

Each test/project seed either uses the API or attaches `ProjectProfile` with required seeded codes. Then run:

```bash
uv run ruff check .
uv run pyright
uv run pytest \
  tests/features/test_projects_api.py \
  tests/features/test_project_profiles_api.py \
  tests/features/test_projects_pg_ingest.py \
  tests/features/test_locks_api.py \
  tests/features/test_locks_pg.py \
  tests/features/test_conditions_api.py \
  tests/features/test_sheets_api.py \
  tests/features/test_cells_api.py \
  tests/features/test_choice_consumers_pg.py -q
```

Expected: all focused/static tests pass; PG-only tests skip only when their environment variable is absent.

- [ ] **Step 8: Commit the Project aggregate**

```bash
git add backend/app/models backend/app/features/projects backend/tests
git commit -F - <<'MSG'
Make project facts durable without keeping a live source dependency

Every project now owns a fixed Profile copied once at creation, resolved through managed choices, and edited atomically under the existing project lock.

Constraint: Project identity is immutable and process_name comes only from the Process Catalog
Rejected: JSON Profile fields | fixed searchable columns are required for list filters and later validation
Confidence: high
Scope-risk: broad
Directive: Backbone creates must retain both PROJECT_CREATE provenance and BACKBONE_COPY detail
Tested: Provider precedence/rollback, Profile CRUD/null semantics, lock fencing, events, list filters/search, and inactive reads
MSG
```

---

### Task 7: Reset-only Alembic transition, seed, performance, and operator path

**Files:**
- Create: `backend/alembic/versions/0004_project_profile_managed_choices.py`
- Create: `backend/tests/migrations/__init__.py`
- Create: `backend/tests/migrations/test_phase_2_6_migration_pg.py`
- Create: `backend/tests/postgres_database.py`
- Create: `backend/tests/scripts/__init__.py`
- Create: `backend/tests/scripts/test_seed_dev_pg.py`
- Create: `backend/tests/scripts/test_reset_dev_app_db.py`
- Create: `backend/scripts/reset_dev_app_db.sh`
- Modify: `backend/alembic/env.py`
- Modify: `backend/scripts/seed_dev.py`
- Modify: `backend/scripts/measure_sheet_perf.py`
- Modify: `backend/tests/test_boundaries.py`
- Modify: `.github/workflows/ci.yml`
- Modify: `docker-compose.yml`
- Modify: `README.md`

**Interfaces:**
- Consumes: final ORM from Tasks 2~6
- Produces: revision `0004`, down revision `0003`
- Produces: online-only nine-table preflight before first DDL
- Produces: UUID-named `pcm_phase26_test_*` databases for every destructive migration/seed test; never downgrades the configured database itself
- Produces: four fixed version-1 sets with zero migration-provided options
- Produces: explicit app-DB-only destructive reset script requiring `--confirm-disposable`
- Produces: environment-overridable host ports so isolated QA never reuses default Compose volumes or ports
- Produces: representative active/inactive managed choices and Project Profile dev seed
- Proves: every Phase 2.6-owned table/column/type/index/constraint matches ORM metadata; no legacy table/column remains

- [ ] **Step 1: Add PostgreSQL migration tests before the revision**

`backend/tests/postgres_database.py` uses `APP_TEST_DATABASE_URL` only to derive server credentials. A context manager connects to the `postgres` maintenance database, creates a UUID-named database whose name must match `^pcm_phase26_test_[0-9a-f]+$`, yields its sync/async URLs, terminates only that database's connections in `finally`, and drops it. It refuses create/drop for any other name. `test_phase_2_6_migration_pg.py` creates a fresh such database per destructive case, converts its URL to psycopg2 with SQLAlchemy `make_url`, creates an Alembic `Config`, and passes an opened sync connection through `config.attributes["connection"]`. It never resets `public` or runs downgrade against the configured `pcm_test` database.

Add these tests:

```python
def test_empty_0003_upgrades_to_final_schema(migration_db) -> None:
    migration_db.upgrade("0003")
    migration_db.upgrade("head")
    inspector = sa.inspect(migration_db.connection)

    assert migration_db.current_revision() == "0004"
    assert {"choice_set", "choice_option", "project_profile"} <= set(inspector.get_table_names())
    assert "parameter_option" not in inspector.get_table_names()
    assert "description" not in {column["name"] for column in inspector.get_columns("project")}
    fixed = migration_db.connection.execute(
        sa.text("SELECT code, version FROM choice_set ORDER BY code")
    ).all()
    assert fixed == [
        ("active_direction", 1),
        ("device_type", 1),
        ("gate_direction", 1),
        ("project_category", 1),
    ]
    assert migration_db.connection.scalar(sa.text("SELECT count(*) FROM choice_option")) == 0


@pytest.mark.parametrize("table_name", MUTABLE_TABLES)
def test_any_mutable_row_blocks_before_ddl(migration_db, table_name: str) -> None:
    migration_db.upgrade("0003")
    migration_db.insert_guard_row(table_name)

    with pytest.raises(RuntimeError, match="disposable app DB"):
        migration_db.upgrade("head")

    inspector = sa.inspect(migration_db.connection)
    assert migration_db.current_revision() == "0003"
    assert "choice_set" not in inspector.get_table_names()
    assert "parameter_option" in inspector.get_table_names()
    assert "description" in {column["name"] for column in inspector.get_columns("project")}
```

`insert_guard_row()` uses explicit minimal SQL for each of the nine tables and temporarily disables FK triggers for child-only rows in this disposable superuser test database, then re-enables them before running Alembic. Also add fresh `base -> head`, `upgrade --sql` rejection, final check constraint, index, Numeric type, and Phase 2.6-owned ORM/migration parity assertions. Do not claim full inherited-schema nullability parity for columns created by earlier revisions. After migrating, open an ORM session and insert one lowercase `ValueType.CHOICE` Parameter bound to a ChoiceSet plus one `ValueType.TEXT` Parameter with a null set; both must commit under `ck_parameter_choice_set_binding`, while an invalid raw insert fails.

- [ ] **Step 2: Run the migration test and confirm revision absence**

Run:

```bash
cd backend
APP_TEST_DATABASE_URL=postgresql+asyncpg://pcm_user:pcm_pass@localhost:15442/pcm_test \
  uv run pytest tests/migrations/test_phase_2_6_migration_pg.py -q
```

Expected: tests fail because revision 0004 does not exist. Do not substitute SQLite for this gate.

- [ ] **Step 3: Make Alembic accept an injected test connection and reject offline 0004**

Refactor `alembic/env.py` to use this branch without changing normal CLI behavior:

```python
def _run_with_connection(connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    supplied = config.attributes.get("connection")
    if supplied is not None:
        _run_with_connection(supplied)
        return
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        _run_with_connection(connection)
```

Normal CLI still sets the settings sync URL. In revision `upgrade()`, the first lines are:

```python
if op.get_context().as_sql:
    raise RuntimeError("Phase 2.6 reset preflight requires an online database connection")
bind = op.get_bind()
_assert_disposable_database(bind)
```

No `create_table`, `add_column`, `alter_column`, `drop_column`, `drop_table`, `bulk_insert`, or raw DDL occurs before `_assert_disposable_database` returns.

- [ ] **Step 4: Implement final DDL in dependency order**

Use `MUTABLE_TABLES` exactly:

```python
MUTABLE_TABLES = (
    "parameter_category",
    "parameter",
    "parameter_option",
    "project",
    "sheet_layer",
    "layer_condition",
    "cell_value",
    "change_event",
    "edit_lock",
)
```

`_assert_disposable_database` executes `SELECT EXISTS (SELECT 1 FROM <validated constant> LIMIT 1)` for each and raises with the non-empty names. Then perform:

1. create `choice_set` and unique code index;
2. create `choice_option`, composite unique constraint, and set index;
3. insert fixed sets with display names `Device Type`, `Project Category`, `Active Direction`, `Gate Direction`, version 1, active true;
4. add `parameter.choice_set_id` FK/index;
5. alter both bounds from Float to unbounded Numeric with PostgreSQL `USING`;
6. add `ck_parameter_choice_set_binding` for choice/non-choice nullability;
7. create `project_profile` with the exact final columns, including four `VARCHAR(128)` choice-code columns with only Device/Category non-null, PK/FK cascade, and timestamps;
8. drop `project.description`;
9. drop `parameter_option`.

Implement downgrade in reverse dependency order for local recovery. Downgrade recreates the old column/table shape but does not promise data preservation.

- [ ] **Step 5: Rewrite development seed and performance seed**

`seed_dev.py` first loads the migration-created fixed sets, adds representative active and inactive options, and creates one shared `equipment_mode` set with several hundred options for cache/search evidence. Then it creates categories/parameters; every choice parameter shares `equipment_mode`; numeric bounds use `Decimal("0")`/`Decimal("1000")`; Project creation attaches a complete Profile using fixed option codes.

`measure_sheet_perf.py` continues to use SQLite `Base.metadata.create_all`, so it must explicitly seed the four fixed set identities/options before creating any Project/Profile; it cannot assume Alembic bootstrap ran. It reports:

```text
distinct choice sets
choice options in SheetOut payload (must be 0)
columns sharing the large set
serialized bytes
elapsed milliseconds
```

Keep the existing 200-column/100-layer gate and assert one set is reused rather than making one set per parameter.

`test_seed_dev_pg.py` uses the guarded random-database context, runs `alembic upgrade head` and `python -m scripts.seed_dev` in subprocesses with `APP_DATABASE_URL` set only to that random URL, then queries and asserts: four fixed sets plus the reusable business set exist; every Project has one Profile; at least one active and one inactive option exist; numeric bounds/cells read back canonically; and a Sheet service smoke response has 200 columns, 100 layers, and zero embedded option arrays. The context drops the random database even if seed assertions fail.

- [ ] **Step 6: Add an app-DB-only reset script and update operator docs/CI**

`backend/scripts/reset_dev_app_db.sh` begins:

```bash
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" != "--confirm-disposable" ]]; then
  echo "usage: backend/scripts/reset_dev_app_db.sh --confirm-disposable" >&2
  exit 2
fi
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$repo_root"
docker compose stop backend app-db
container="$(docker compose ps -aq app-db)"
if [[ -z "$container" ]]; then
  docker compose create app-db >/dev/null
  container="$(docker compose ps -aq app-db)"
fi
volume="$(docker inspect "$container" --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}')"
if [[ -z "$volume" ]] || [[ "$(docker volume inspect "$volume" --format '{{index .Labels "com.docker.compose.volume"}}')" != "app-db-data" ]]; then
  echo "refusing to remove an unverified app-db volume" >&2
  exit 1
fi
docker compose rm -f app-db
docker volume rm "$volume"
docker compose up -d app-db
docker compose up -d backend
```

The script must never stop/remove `ingest-db` or the frontend node_modules volume. Parameterize the four host mappings in `docker-compose.yml` without changing defaults:

```yaml
ports:
  - "${APP_DB_PORT:-5432}:5432"       # app-db
  - "${INGEST_DB_PORT:-5433}:5432"    # ingest-db
  - "${BACKEND_PORT:-8000}:8000"      # backend
  - "${FRONTEND_PORT:-5173}:5173"     # frontend
```

Each line belongs under its existing service rather than one shared list. README explains that a non-empty 0003 DB intentionally prevents backend startup, shows this explicit reset, migration, seed, and health sequence, documents isolated QA port overrides, and replaces obsolete API paths with `/api/...` ChoiceSet/Profile routes. CI exports both `APP_TEST_DATABASE_URL` and `APP_DATABASE_URL` to the isolated `pcm_test` service so normal CLI and injected migration tests cannot touch a developer database.

`test_reset_dev_app_db.py` runs the script without confirmation and asserts exit 2 before a fake Docker executable is called. With `--confirm-disposable`, a PATH-injected fake Docker records commands and returns a labeled app-db volume; assert the script stops/removes only `backend`/`app-db`, never emits `down -v`, never names `ingest-db` or the frontend volume in a destructive command, and refuses an unexpected volume label.

- [ ] **Step 7: Run migration, seed, performance, and full backend gates**

Run in an isolated PostgreSQL test database:

```bash
cd backend
uv run ruff check .
uv run pyright
APP_TEST_DATABASE_URL=postgresql+asyncpg://pcm_user:pcm_pass@localhost:15442/pcm_test \
APP_DATABASE_URL=postgresql+asyncpg://pcm_user:pcm_pass@localhost:15442/pcm_test \
  uv run pytest
uv run python -m scripts.measure_sheet_perf
```

Then verify both migration paths and the real seed inside UUID-named databases created and destroyed by the guarded fixture:

```bash
APP_TEST_DATABASE_URL=postgresql+asyncpg://pcm_user:pcm_pass@localhost:15442/pcm_test \
  uv run pytest -q \
    tests/migrations/test_phase_2_6_migration_pg.py \
    tests/scripts/test_seed_dev_pg.py
```

Expected: all gates pass; both empty-0003 and fresh-base reach 0004; the seed smoke proves Profile/ChoiceSet/sheet output; every temporary database is dropped; default developer Compose databases and volumes are untouched.

- [ ] **Step 8: Commit and close the backend cutover cluster**

```bash
git add backend/alembic backend/scripts backend/tests/migrations backend/tests/postgres_database.py \
  backend/tests/scripts backend/tests/test_boundaries.py \
  .github/workflows/ci.yml docker-compose.yml README.md
git commit -F - <<'MSG'
Prevent a reset-only schema change from silently destroying real rows

The final Phase 2.6 schema now refuses non-empty app databases before DDL, bootstraps only fixed set identities, and has an isolated reset/seed/performance path.

Constraint: No production data migration is approved for this phase
Rejected: Automatic startup deletion | a misconfigured environment could erase non-disposable data
Confidence: high
Scope-risk: broad
Directive: Do not weaken or move the nine-table preflight behind any schema-changing operation
Tested: PostgreSQL base/0003 upgrades, all guarded tables, offline rejection, seed, performance, and full backend gates
MSG
```

At this point, review Tasks 2~7 as one green backend cutover cluster before any main merge.

---

### Task 8: Frontend API contracts and version-safe ChoiceSet loader

**Files:**
- Modify: `frontend/src/api/types.ts`
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/api/client.test.ts`
- Create: `frontend/src/api/choiceSets.ts`
- Create: `frontend/src/api/choiceSets.test.ts`
- Create: `frontend/src/features/choiceSets/choiceQueries.ts`
- Create: `frontend/src/features/choiceSets/choiceQueries.test.ts`

**Interfaces:**
- Consumes: backend contract frozen by Tasks 2~7
- Produces: exact ChoiceSet request/response TypeScript interfaces
- Produces: `choiceSetKeys.list`, `.summary`, `.optionsPrefix`, `.options`
- Produces: all ten ChoiceSet HTTP functions
- Produces: `fetchAllChoiceOptions(setCode, knownVersion, includeInactive, signal?) -> ChoiceOptionAggregate`
- Produces: maximum two automatic version restarts; partial pages are never returned or cached
- Produces: guarded option-query factory that publishes a version-advanced aggregate only under its response version, never the stale request key
- Produces: typed `getChoiceSetChangedSummary(error) -> ChoiceSetSummaryOut | null`
- Preserves temporarily: existing Parameter/Project/Sheet legacy fields until their consuming Tasks replace them greenly

- [ ] **Step 1: Add failing API path/body/status tests**

Define all approved types in `api/types.ts`, including:

```ts
export interface ChoiceSetSummaryOut {
  code: string
  display_name: string
  description: string | null
  is_active: boolean
  version: number
  option_count: number
  active_option_count: number
  parameter_usage_count: number
  profile_usage_fields: string[]
  created_at: string
  updated_at: string
}

export interface ChoiceOptionOut {
  code: string
  label: string
  sort_order: number
  is_active: boolean
}

export interface ChoiceOptionPageOut {
  set_code: string
  version: number
  items: ChoiceOptionOut[]
  next_cursor: string | null
}

export interface ChoiceOptionAggregate {
  set_code: string
  version: number
  items: ChoiceOptionOut[]
}
```

Add every create/patch/order/import request and mutation output exactly as the spec. In `choiceSets.test.ts`, spy on `apiClient` and assert the valid punctuation code `A.B-_1` is passed through path-segment encoding, query params, `expected_version` in JSON body, no custom version header, and 201/200 data handling. Unsafe slash/percent/dot-segment/Unicode/space identities are rejected before an API request rather than treated as values that encoding can make routable.

Add a paged loader race test:

```ts
it('discards partial pages and restarts from page one after a version change', async () => {
  mockedGet
    .mockResolvedValueOnce({
      data: { set_code: 'equipment_mode', version: 3, items: [option('A')], next_cursor: 'v3-next' },
    })
    .mockRejectedValueOnce(choiceSetChangedError(3, 4))
    .mockResolvedValueOnce({
      data: { set_code: 'equipment_mode', version: 4, items: [option('B')], next_cursor: null },
    })

  const result = await fetchAllChoiceOptions('equipment_mode', 3, true)

  expect(result).toEqual({ set_code: 'equipment_mode', version: 4, items: [option('B')] })
  expect(mockedGet).toHaveBeenNthCalledWith(
    3,
    '/choice-sets/equipment_mode/options',
    expect.objectContaining({ params: expect.objectContaining({ version: 4, cursor: undefined }) }),
  )
})
```

Also assert a first-page mismatch restarts, later pages always stay on the returned first-page version, duplicate page codes are rejected as malformed response, and a third rapid version conflict surfaces rather than loops forever.

- [ ] **Step 2: Add failing query-key/cache-policy tests**

`choiceQueries.test.ts` asserts:

```ts
expect(choiceSetKeys.options('equipment_mode', 7, true)).toEqual([
  'choice-sets', 'options', 'equipment_mode', 7, true,
])
expect(choiceSetKeys.options('equipment_mode', 8, true)).not.toEqual(
  choiceSetKeys.options('equipment_mode', 7, true),
)
expect(summaryQueryOptions('equipment_mode').refetchOnWindowFocus).toBe('always')
expect(sheetSummaryQueryOptions('equipment_mode').refetchInterval).toBe(60_000)
```

Test `invalidateChoiceSetMutation(queryClient, code)` invalidates list+summary and removes option aggregates for the mutated code, without touching another set.

Add a real `QueryClient` test for the cache-key race: a query started for version 3 that observes and completes version 4 must leave `choiceSetKeys.options(code, 3, true)` without data, prime only the version-4 key, and invalidate/refetch the summary before consumers switch keys.

Configure that test client with the production retry policy and assert `ChoiceSetVersionAdvanced` is never retried under the stale key. Ordinary transient failures may use the existing retry policy; this typed cache transition always returns `false` from the query-level retry predicate.

Add a deferred-request cancellation test. Start a multi-page version-3 load, run mutation invalidation, resolve the old HTTP promise, and assert the request observed an aborted `signal` and neither old nor new option cache was repopulated by that canceled loader.

- [ ] **Step 3: Run focused tests and verify missing client failures**

Run:

```bash
cd frontend
npm test -- src/api/client.test.ts src/api/choiceSets.test.ts src/features/choiceSets/choiceQueries.test.ts
```

Expected: missing ChoiceSet functions/types/query options fail collection.

- [ ] **Step 4: Implement exact API functions and restartable aggregate loading**

`api/choiceSets.ts` exposes these names:

```ts
listChoiceSets(includeInactive?: boolean)
createChoiceSet(payload: ChoiceSetCreateIn)
getChoiceSet(setCode: string)
patchChoiceSet(setCode: string, payload: ChoiceSetPatchIn)
listChoiceOptions(setCode: string, params: ListChoiceOptionsParams)
createChoiceOption(setCode: string, payload: ChoiceOptionCreateIn)
patchChoiceOption(setCode: string, optionCode: string, payload: ChoiceOptionPatchIn)
reorderChoiceOptions(setCode: string, payload: ChoiceOptionOrderIn)
previewChoiceImport(setCode: string, payload: ChoiceImportIn)
applyChoiceImport(setCode: string, payload: ChoiceImportIn)
fetchAllChoiceOptions(
  setCode: string,
  knownVersion: number | undefined,
  includeInactive: boolean,
  signal?: AbortSignal,
)
```

The loader keeps page items in a local array. On `choice_set_changed`, it discards the array, extracts `actual_version`, increments a restart counter, and restarts with `cursor=undefined`. It returns only after `next_cursor=null`; React Query sees no partial value. Validate that every page's `set_code` and `version` equal the aggregate version. Accept an `AbortSignal` and pass the same signal to every Axios page request and restart. Do not use this raw loader directly as a query function keyed by `knownVersion`, because a completed newer aggregate would otherwise be cached under the old key.

Extend `client.ts` with a structural summary guard, not an unchecked assertion:

```ts
export function getChoiceSetChangedSummary(error: unknown): ChoiceSetSummaryOut | null {
  const raw = getChoiceSetChangedDetails(error)?.choice_set
  if (!isChoiceSetSummary(raw)) return null
  return raw
}
```

- [ ] **Step 5: Implement query factories and mutation invalidation**

Use:

```ts
export const choiceSetKeys = {
  all: ['choice-sets'] as const,
  list: (includeInactive: boolean) => ['choice-sets', 'list', includeInactive] as const,
  summary: (code: string) => ['choice-sets', 'summary', code] as const,
  optionsPrefix: (code: string) => ['choice-sets', 'options', code] as const,
  options: (code: string, version: number, includeInactive: boolean) =>
    ['choice-sets', 'options', code, version, includeInactive] as const,
}
```

Summary queries use `refetchOnWindowFocus: 'always'`; sheet summary options add `refetchInterval: 60_000`. A combobox open calls the query's `refetch()`. Mutation invalidation first awaits `cancelQueries({queryKey: choiceSetKeys.optionsPrefix(code)})`, then invalidates list/summary and removes every option key under the set prefix so a late old request cannot repopulate a stale version.

`choiceOptionQueryOptions(queryClient, code, summaryVersion, includeInactive)` owns the key guard. Its query function passes TanStack's `QueryFunctionContext.signal` to `fetchAllChoiceOptions`; when `aggregate.version === summaryVersion` it returns normally. When the loader completes a newer version, it first writes the aggregate to `choiceSetKeys.options(code, aggregate.version, includeInactive)`, invalidates the summary, and throws a typed `ChoiceSetVersionAdvanced` transition. The option query's `retry` predicate returns `false` for `ChoiceSetVersionAdvanced` so the production QueryClient cannot repeat work under the stale key; it delegates ordinary failures to the existing bounded retry rule. The old version query therefore has error state but no data. Task 9 recognizes that transition, keeps the last complete/raw display, waits for the summary refetch, and switches to the already primed new key. Never call `setQueryData` for the old key in this branch.

- [ ] **Step 6: Run frontend contract gates and commit**

Run:

```bash
cd frontend
npm test -- src/api/client.test.ts src/api/choiceSets.test.ts src/features/choiceSets/choiceQueries.test.ts
npm run typecheck
```

Expected: focused tests/typecheck pass; existing screens remain green because their legacy fields have not yet been removed.

```bash
git add frontend/src/api frontend/src/features/choiceSets/choiceQueries.ts \
  frontend/src/features/choiceSets/choiceQueries.test.ts
git commit -F - <<'MSG'
Keep option pages from crossing registry versions

The frontend now has an exact ChoiceSet client and only publishes a complete option aggregate after every page agrees on one version.

Constraint: A stale first page must never populate a newer version's cache key
Rejected: Cache pages independently | consumers could combine labels from different registry versions
Confidence: high
Scope-risk: moderate
Tested: Endpoint contracts, conflict typing, page restart/discard, key isolation, and invalidation
MSG
```

---

### Task 9: Reusable accessible searchable choice and query consumer

**Files:**
- Create: `docs/superpowers/evidence/visual/2026-07-14-phase-2-6-task-09.json`
- Create: `frontend/src/shared/components/searchableChoiceState.ts`
- Create: `frontend/src/shared/components/searchableChoiceState.test.ts`
- Create: `frontend/src/shared/components/SearchableChoice.tsx`
- Create: `frontend/src/shared/components/SearchableChoice.test.tsx`
- Create: `frontend/src/features/choiceSets/useChoiceSetOptions.ts`
- Create: `frontend/src/features/choiceSets/useChoiceSetOptions.test.ts`

**Interfaces:**
- Consumes: `ChoiceOptionOut`, summary/options keys, and full aggregate loader from Task 8
- Produces: `SearchableChoiceItem {code, label, is_active}` and `filterChoiceOptions(options, query)`
- Produces: keyboard reducer supporting open/input/up/down/home/end/commit/cancel
- Produces: dependency-free maximum-60-row result window that always contains the active descendant
- Produces: `SearchableChoice` for Wizard/Profile/Parameter/Glide DOM overlay
- Produces: `useChoiceSetOptions(setCode, {includeInactive, sheetFocused})`
- Guarantees: raw stored code remains readable on unknown/load failure; inactive set/option current value is shown but no value from an inactive set is newly selectable

- [ ] **Step 1: Add failing pure keyboard/filter tests**

Create `searchableChoiceState.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { filterChoiceOptions, initialChoiceState, reduceChoiceState } from './searchableChoiceState'

const options = [
  { code: 'FOUNDRY', label: 'Foundry', sort_order: 10, is_active: true },
  { code: 'SPECIAL', label: 'Special customer', sort_order: 20, is_active: true },
  { code: 'OLD', label: 'Legacy', sort_order: 30, is_active: false },
]

it('searches code and label case-insensitively and excludes inactive writes by default', () => {
  expect(filterChoiceOptions(options, 'found').map((item) => item.code)).toEqual(['FOUNDRY'])
  expect(filterChoiceOptions(options, 'special customer').map((item) => item.code)).toEqual(['SPECIAL'])
  expect(filterChoiceOptions(options, '').map((item) => item.code)).toEqual(['FOUNDRY', 'SPECIAL'])
  expect(filterChoiceOptions(options, '', { includeInactive: true }).map((item) => item.code)).toEqual([
    'FOUNDRY', 'SPECIAL', 'OLD',
  ])
})

it('wraps arrows and supports Home, End, Escape', () => {
  let state = reduceChoiceState(initialChoiceState, { type: 'open', resultCount: 2 })
  state = reduceChoiceState(state, { type: 'move', delta: -1, resultCount: 2 })
  expect(state.activeIndex).toBe(1)
  expect(reduceChoiceState(state, { type: 'home' }).activeIndex).toBe(0)
  expect(reduceChoiceState(state, { type: 'end', resultCount: 2 }).activeIndex).toBe(1)
  expect(reduceChoiceState(state, { type: 'cancel' }).open).toBe(false)
})
```

Add `getVisibleChoiceWindow(resultCount, activeIndex, 60)` tests with 500 results. Assert at most 60 indexes are returned, the active index is always inside the window after Home/End/Arrow transitions, and boundary windows remain contiguous. The filter still searches all 500 items; rendering is the only bounded layer.

Add async-open generation tests around a deferred `prepareToOpen`: Escape while refresh is pending increments/cancels the generation, and its late resolve cannot reopen or enable the list; rejection settles into an error/retry state without an unhandled promise; a later retry owns a new generation and only its resolution enables selection. While already open, changing `selectionReady` from true to false invalidates the active commit generation immediately: stale rows may remain visible for diagnosis, but Enter/click cannot commit until a matching current aggregate makes readiness true again.

- [ ] **Step 2: Add failing SSR accessibility/state tests**

`SearchableChoice.test.tsx` uses `renderToStaticMarkup` and asserts `role="combobox"`, `aria-expanded`, `aria-controls`, listbox/option IDs, selected `code · label`, `사용 중지됨` for a current inactive code, raw `MISSING` fallback, error retry button, and a disabled empty state. Add resource-adapter tests proving `setIsActive=null` maps to `sourceActive=false` and `selectionReady=false`: even cached active options remain display-only and Enter/click cannot commit until current summary state is known. Seed cached summary/options, make the mandatory open summary refresh reject, and assert `prepareToOpen` rejects into retry-only state rather than resolving from cache or enabling a commit. Reducer tests own actual keyboard transitions because Vitest has no DOM environment; Task 15 browser QA owns real focus return.

Add a pure hook-policy helper test verifying normal consumers refetch summary on `open`, and sheet consumers use 60 seconds while focused.

- [ ] **Step 3: Run tests and verify missing component failures**

Run:

```bash
cd frontend
npm test -- \
  src/shared/components/searchableChoiceState.test.ts \
  src/shared/components/SearchableChoice.test.tsx \
  src/features/choiceSets/useChoiceSetOptions.test.ts
```

Expected: all new modules are missing.

- [ ] **Step 4: Implement the pure reducer and ARIA component**

Use this public component contract:

```ts
export interface SearchableChoiceItem {
  code: string
  label: string
  is_active: boolean
}

export interface SearchableChoiceProps {
  id: string
  label: string
  value: string | null
  options: readonly SearchableChoiceItem[]
  loading?: boolean
  error?: string | null
  disabled?: boolean
  sourceActive?: boolean
  selectionReady?: boolean
  allowInactiveSelection?: boolean
  required?: boolean
  allowClear?: boolean
  autoFocus?: boolean
  openOnMount?: boolean
  onOpen?: () => Promise<void>
  onRetry?: () => void
  onChange: (code: string | null) => void
  onCancel?: () => void
}
```

The input owns `role="combobox"`, `aria-autocomplete="list"`, `aria-expanded`, `aria-controls`, and conditional `aria-activedescendant`. Opening increments an internal generation, renders a refreshing shell, and awaits `onOpen`; cached options remain display-only and Enter/click cannot commit until the same generation confirms `selectionReady=true` from a summary plus same-version aggregate. Escape/close or any true-to-false readiness transition invalidates that generation, so late resolve/reject cannot resurrect or authorize stale state. Rejection is caught and rendered as retryable error. Results then own `role="listbox"`; rows own `role="option"` and `aria-selected`. Arrow/Home/End updates active descendant and scrolls it into view; Enter commits only when `selectionReady`, an active option, and an active source all agree, unless `allowInactiveSelection` is explicitly true for a non-mutating filter control; Escape closes, clears transient query, calls `onCancel`, and focuses the input/trigger. Write editors never set that escape hatch. The current inactive set/option is displayed in the selected-value status with `사용 중지됨` but is not in default selectable results. Missing/error display uses raw code and a retry control.

Filter against the full cached array, then render a contiguous window of at most 60 rows around the active result with top/bottom spacers. Each row exposes full-result `aria-posinset`/`aria-setsize`; the active result is mounted before assigning `aria-activedescendant`, including Home/End jumps. A 500-option SSR/reducer test asserts no more than 60 option nodes while the first, middle, and last active IDs remain present.

- [ ] **Step 5: Implement one version-aware option consumer**

`useChoiceSetOptions` runs the summary query first, then enables Task 8's guarded aggregate query with `summary.version`. Its returned shape is:

```ts
export interface ChoiceSetOptionsResource {
  setCode: string
  version: number | null
  setIsActive: boolean | null
  displayOptions: readonly ChoiceOptionOut[]
  selectableOptions: readonly ChoiceOptionOut[]
  selectionReady: boolean
  loading: boolean
  refreshing: boolean
  error: string | null
  prepareToOpen: () => Promise<void>
  refetchSummary: () => Promise<void>
  retryOptions: () => Promise<void>
}
```

Set `setIsActive` from the summary and adapt it at every write-capable component boundary as `sourceActive={resource.setIsActive ?? false}` plus `selectionReady={resource.selectionReady}`; unknown/loading is fail-closed, so cached active options cannot authorize a commit. A false set likewise yields no selectable result even when an individual option remains active. `displayOptions` may retain the last complete aggregate solely for current-label/read-only diagnosis; `selectableOptions` is empty and `selectionReady=false` unless the current summary is active and its version exactly equals the complete aggregate version.

`prepareToOpen()` performs the mandatory summary refresh with `refetch({throwOnError: true})` (or `fetchQuery`) and uses the returned fresh summary object, never the pre-refetch closure/cache version. It then awaits the guarded aggregate for that exact returned version; if a typed version transition occurs, it repeats the summary/aggregate pair within the loader's bounded restart budget. It resolves only after matching current summary+aggregate state is established (an inactive set resolves display-only with `selectionReady=false`) and rejects into retry-only state on either refresh/load failure. When a background summary version changes while the combobox is already open, synchronously set `selectionReady=false` and `selectableOptions=[]`, invalidate the component generation/active descendant, cancel/remove old option keys for that code, and request page 1 under the new version. Treat `ChoiceSetVersionAdvanced` as a non-user-facing cache transition: keep `displayOptions`/stored raw code/last label visible only as display fallback, refetch summary, and switch to the response-version key that Task 8 already primed. If the new aggregate fails, never use the older aggregate for validation or selection. Other errors expose retry. Do not copy either options array per component; return React Query cached references or the shared empty constant.

- [ ] **Step 6: Verify, run visual verdict for the rendered primitive, and commit**

Render the component in an existing dev-only harness or a temporary test branch of `GridDemoPage`; run the Visual Ralph verdict procedure, record `docs/superpowers/evidence/visual/2026-07-14-phase-2-6-task-09.json`, then remove any temporary harness code before commit.

Run:

```bash
cd frontend
npm test -- \
  src/shared/components/searchableChoiceState.test.ts \
  src/shared/components/SearchableChoice.test.tsx \
  src/features/choiceSets/useChoiceSetOptions.test.ts
npm run typecheck
```

Expected: reducer/SSR/policy tests and typecheck pass; visual verdict has no blocking accessibility/layout finding.

```bash
git add frontend/src/shared/components frontend/src/features/choiceSets \
  docs/superpowers/evidence/visual/2026-07-14-phase-2-6-task-09.json
git commit -F - <<'MSG'
Make long choice lists usable without hiding their stable codes

A package-free combobox now searches code and label, preserves raw/inactive values, and exposes complete keyboard and assistive semantics.

Constraint: Canvas remains the sheet's semantic owner; the DOM component is only the edit overlay
Rejected: Native select | hundreds of options cannot be searched effectively
Confidence: high
Scope-risk: moderate
Tested: Filter/reducer/SSR contracts, version-aware option resource, typecheck, and visual verdict
MSG
```

---

### Task 10: ChoiceSet administration routes, list, detail, reorder, and import

**Files:**
- Create: `docs/superpowers/evidence/visual/2026-07-14-phase-2-6-task-10.json`
- Create: `frontend/src/features/choiceSets/ParameterSectionNav.tsx`
- Create: `frontend/src/features/choiceSets/ParameterSectionNav.test.tsx`
- Create: `frontend/src/features/choiceSets/choiceSetUrlState.ts`
- Create: `frontend/src/features/choiceSets/choiceSetUrlState.test.ts`
- Create: `frontend/src/features/choiceSets/choiceSetAdminState.ts`
- Create: `frontend/src/features/choiceSets/choiceSetAdminState.test.ts`
- Create: `frontend/src/features/choiceSets/ChoiceSetListPage.tsx`
- Create: `frontend/src/features/choiceSets/ChoiceSetListPage.test.tsx`
- Create: `frontend/src/features/choiceSets/ChoiceSetEditorDrawer.tsx`
- Create: `frontend/src/features/choiceSets/ChoiceSetEditorDrawer.test.tsx`
- Create: `frontend/src/features/choiceSets/ChoiceOptionEditorDialog.tsx`
- Create: `frontend/src/features/choiceSets/ChoiceOptionEditorDialog.test.tsx`
- Create: `frontend/src/features/choiceSets/ChoiceSetDetailPage.tsx`
- Create: `frontend/src/features/choiceSets/ChoiceSetDetailPage.test.tsx`
- Create: `frontend/src/features/choiceSets/ChoiceImportDialog.tsx`
- Create: `frontend/src/features/choiceSets/ChoiceImportDialog.test.tsx`
- Modify: `frontend/src/app/routes.tsx`
- Modify: `frontend/src/app/routes.test.tsx`

**Interfaces:**
- Consumes: Tasks 8~9 client/cache/combobox
- Produces: `/parameters/choice-sets` and `/parameters/choice-sets/:setCode` normal-shell routes
- Produces: URL-owned list/detail search and active filters
- Produces: metadata/option drafts that survive `choice_set_changed`
- Produces: full-code reorder and `{csvText, baseVersion}` preview fingerprint
- Produces: non-blocking case-only near-duplicate warning while preserving exact case-sensitive codes
- Preserves: `/parameters` as the global primary navigation target; adds horizontal section navigation inside parameter pages

- [ ] **Step 1: Add failing route and URL-state tests**

Extend `routes.test.tsx` to assert both new leaves are under the normal shell and direct detail ownership uses `:setCode`. Add `choiceSetUrlState.test.ts`:

```ts
expect(parseChoiceSetListSearch(new URLSearchParams('q=mode&active=all'))).toEqual({
  query: 'mode', active: 'all',
})
expect(serializeChoiceSetListSearch({ query: '', active: 'active' }).toString()).toBe('')
expect(parseChoiceSetDetailSearch(new URLSearchParams('q=auto&active=inactive'))).toEqual({
  query: 'auto', active: 'inactive',
})
```

Unknown filter values normalize to approved defaults. Set code is path-owned, never duplicated into query state.

- [ ] **Step 2: Add failing conflict, reorder, and import state tests**

`choiceSetAdminState.test.ts` asserts:

```ts
it('moves a visible unfiltered row but sends every code once', () => {
  const moved = moveOption(allOptions, 'B', -1)
  expect(moved.map((option) => option.code)).toEqual(['B', 'A', 'C'])
  expect(toOrderPayload(7, moved)).toEqual({ expected_version: 7, ordered_codes: ['B', 'A', 'C'] })
})

it('invalidates preview when csv text or base version changes', () => {
  const preview = { csvText: 'A,Alpha,1,true', baseVersion: 3 }
  expect(isCurrentChoicePreview(preview, preview.csvText, 3)).toBe(true)
  expect(isCurrentChoicePreview(preview, preview.csvText, 4)).toBe(false)
  expect(isCurrentChoicePreview(preview, 'B,Beta,1,true', 3)).toBe(false)
})
```

Add SSR page/dialog tests for usage/blast-radius text, draft preservation copy on conflict, apply disabled when `error_count > 0`, and inactive rows visible.

Add `findCaseOnlyCodeCollision(options, draftCode)` tests: existing `FOO` plus draft `foo` returns `FOO`, exact edit of `FOO` returns null, unrelated `BAR` returns null. The warning is advisory; it must not disable save because option identity remains exact and case-sensitive.

Add shared create-form validation tests for the transport grammar: `A.B-_1` is valid, while slash, percent, whitespace, Unicode, `.` and `..` are invalid for both set and option codes. Invalid drafts show the inline URL-safe-code explanation and never invoke a mutation; this client check mirrors, but does not replace, the backend 422 rule.

Add reducer/mutation-seam tests for both metadata and option editors. Each draft captures `baseVersion`; submit serializes that exact `expected_version`; a 409 stores the latest summary while preserving every typed field, open state, and validation message; explicit reload is the only action that replaces the draft/baseVersion; retry then sends the new version once. SSR tests prove pending controls, conflict summary, reload/retry actions, immutable code, and focus return. These tests live in the two dedicated component test files rather than relying on copy assertions in the detail page.

- [ ] **Step 3: Run focused tests and verify missing routes/pages**

Run:

```bash
cd frontend
npm test -- \
  src/app/routes.test.tsx \
  src/features/choiceSets/choiceSetUrlState.test.ts \
  src/features/choiceSets/choiceSetAdminState.test.ts \
  src/features/choiceSets/ChoiceSetListPage.test.tsx \
  src/features/choiceSets/ChoiceSetEditorDrawer.test.tsx \
  src/features/choiceSets/ChoiceOptionEditorDialog.test.tsx \
  src/features/choiceSets/ChoiceSetDetailPage.test.tsx \
  src/features/choiceSets/ChoiceImportDialog.test.tsx
```

Expected: route imports and feature modules are absent.

- [ ] **Step 4: Build section navigation and compact set list**

`ParameterSectionNav` has two `NavLink`s: `파라미터` -> `/parameters`, `선택지 집합` -> `/parameters/choice-sets`. Use `end` on the parameter link so only one subnav item is current; global AppLayout still marks the parameter area active for nested paths.

List query uses `choiceSetKeys.list(true)` so UI can filter active/inactive locally. URL owns query/active. Table columns are code, display name, state, total/active options, parameter usage, Profile usage, version, updated time. Set create/edit uses the established Drawer; code is create-only/read-only afterward. The create form accepts the shared ASCII URL-safe code grammar and explains rejected characters inline before submit. A stale PATCH renders latest version and keeps every draft field until the user chooses reload.

- [ ] **Step 5: Build full-page option detail and conflict-safe mutations**

Detail loads summary plus the complete `includeInactive=true` aggregate, filters code+label locally, and renders at most 100 rows initially with `더 보기` increments of 100. Reorder is disabled while query or active filter hides rows; otherwise Up/Down sends every active+inactive code in one payload. Add/edit/deactivate dialogs always use the current summary version. Deactivation confirmation renders parameter usage count plus fixed Profile fields before enabling confirm.

While adding an option, validate the same URL-safe code grammar as set creation and show `대소문자만 다른 코드가 이미 있습니다: FOO` when the helper finds a collision. Keep Save enabled for only the advisory case-only warning and explain that codes compare exactly; invalid transport characters still disable Save, while backend duplicate/immutability rules remain authoritative.

On any mutation success call `invalidateChoiceSetMutation`; on 409 store `getChoiceSetChangedSummary(error)`, preserve form/CSV/order draft, and offer explicit `최신 버전 불러오기`.

- [ ] **Step 6: Build CSV preview/apply with atomic UI semantics**

The dialog owns raw CSV and a preview snapshot `{csvText, baseVersion, response}`. Preview sends current version. Apply requires:

```ts
preview.response.error_count === 0 &&
preview.baseVersion === currentVersion &&
preview.csvText === csvText
```

An edit/version change disables Apply until a new preview. 409 keeps raw CSV and preview visible with conflict guidance. Success invalidates list/summary/options and closes only after queries are invalidated.

- [ ] **Step 7: Run tests, browser/visual iteration, and commit**

Run:

```bash
cd frontend
npm test -- \
  src/app/routes.test.tsx \
  src/features/choiceSets/*.test.ts \
  src/features/choiceSets/*.test.tsx \
  src/api/choiceSets.test.ts
npm run typecheck
npm run build
```

Render list/detail/drawer/import at 1024 and 1440, run the Visual Ralph verdict procedure before each corrective edit, and save the final verdict state. Expected: tests/typecheck/build pass; no horizontal body overflow; compact rows, focus order, and conflict copy are usable.

```bash
git add frontend/src/features/choiceSets frontend/src/app/routes.tsx \
  frontend/src/app/routes.test.tsx docs/superpowers/evidence/visual/2026-07-14-phase-2-6-task-10.json
git commit -F - <<'MSG'
Let administrators change shared choices without blind overwrites

ChoiceSet list/detail routes now expose usage, compact option maintenance, complete reorder, CSV preview, and explicit version-conflict recovery.

Constraint: Admin drafts must survive every 409 and invalid import
Rejected: Editing hundreds of options in a Drawer | search, reorder, and import need a full-page work area
Confidence: high
Scope-risk: moderate
Tested: Route/URL state, list/detail markup, reorder/import state, typecheck, build, and visual verdict
MSG
```

---

### Task 11: Parameter administration ChoiceSet and decimal-string cutover

**Files:**
- Create: `docs/superpowers/evidence/visual/2026-07-14-phase-2-6-task-11.json`
- Modify: `frontend/src/api/types.ts`
- Modify: `frontend/src/api/parameters.ts`
- Modify: `frontend/src/api/parameters.test.ts`
- Modify: `frontend/src/features/parameters/ParameterAdminPage.tsx`
- Modify: `frontend/src/features/parameters/ParameterAdminPage.test.tsx`
- Modify: `frontend/src/features/parameters/ParameterEditorDrawer.tsx`
- Modify: `frontend/src/features/parameters/ParameterEditorDrawer.test.tsx`
- Modify: `frontend/src/features/parameters/form.ts`
- Modify: `frontend/src/features/parameters/form.test.ts`
- Modify: `frontend/src/features/parameters/parameterPersistence.ts`
- Modify: `frontend/src/features/parameters/parameterPersistence.test.ts`
- Modify: `frontend/src/features/parameters/registryState.ts`
- Modify: `frontend/src/features/parameters/registryState.test.ts`
- Modify: `frontend/src/features/parameters/CsvImportDialog.tsx`
- Modify: `frontend/src/features/parameters/CsvImportDialog.test.tsx`

**Interfaces:**
- Consumes: Task 1 decimal, Task 8 ChoiceSet types/client, Task 9 combobox, Task 10 subnav
- Produces: final frontend `ValueType = 'text' | 'number' | 'choice'`
- Produces: `ParameterCreate.choice_set_code`; `ParameterOut.choice_set`
- Produces: string/null parameter bounds
- Removes: `OptionIn`, `OptionOut`, `replaceParameterOptions`, comma editor, two-stage partial-failure/retry state

- [ ] **Step 1: Rewrite failing type/API/form tests**

Change types to:

```ts
export type ValueType = 'text' | 'number' | 'choice'

export interface ParameterOut {
  id: number
  code: string
  display_name: string
  description: string | null
  value_type: ValueType
  category_id: number | null
  unit: string | null
  min_value: string | null
  max_value: string | null
  choice_set: ChoiceSetSummaryOut | null
  sort_order: number
  is_active: boolean
}
```

Update form tests so `001.5000` yields `min_value: '1.5'`, `0.50` compares equal to `0.5`, no JS Number conversion occurs, choice create requires `choiceSetCode`, existing set is immutable/read-only, and no `optionsText/optionsDirty/partial-failure` fields exist. Drawer state tests cover active-set list loading, request error/retry, empty registry with `/parameters/choice-sets` action, and a selected set that becomes inactive: keep the raw draft, block create, and require explicit re-selection after refresh. Query-policy tests prove the create picker refetches the active-set list on every open and uses `refetchOnWindowFocus: 'always'`; trigger each path after external deactivation and assert the raw draft stays visible while submit becomes blocked.

API tests assert no `PUT /parameters/{id}/options` function remains. CSV dialog expected header/help uses `choice_set_code` and explicitly says `options` is rejected.

- [ ] **Step 2: Run focused tests and verify old comma/number behavior fails**

Run:

```bash
cd frontend
npm test -- \
  src/api/parameters.test.ts \
  src/features/parameters/form.test.ts \
  src/features/parameters/parameterPersistence.test.ts \
  src/features/parameters/registryState.test.ts \
  src/features/parameters/ParameterEditorDrawer.test.tsx \
  src/features/parameters/ParameterAdminPage.test.tsx \
  src/features/parameters/CsvImportDialog.test.tsx
```

Expected: old types/options textarea/two-call persistence and Number parser violate assertions.

- [ ] **Step 3: Simplify types, API, form, and persistence**

`ParameterFormState` becomes:

```ts
export interface ParameterFormState {
  code: string
  displayName: string
  valueType: ValueType
  description: string
  categoryId: string
  unit: string
  minValue: string
  maxValue: string
  choiceSetCode: string
}
```

Create validates and canonicalizes bounds with `normalizeDecimalInput`; compares with `compareCanonicalDecimals`; choice requires a selected active set; non-choice sends `choice_set_code: null`. Existing hydrate reads `parameter.choice_set?.code`; update payload contains no choice set field. Preserve the existing explicit unsupported-clear behavior for parameter nullable fields because Phase 2.6 does not expand that PATCH contract.

`persistParameter()` now performs exactly one create or update call and returns `ParameterOut`; delete `PersistResult` partial option branch and `retryParameterOptions`. Delete the option API function and imports.

- [ ] **Step 4: Replace UI comma options with managed set selection**

Add `ParameterSectionNav` above the page header. Registry type filter contains only three types. Table constraint cell shows the ChoiceSet code/name for choice, canonical range/unit for number, and no embedded option count.

The create drawer loads active sets and maps them into `SearchableChoice` option objects `{code, label: display_name, is_active}`. Its active-set query uses `refetchOnWindowFocus: 'always'`, and the combobox `onOpen` awaits an explicit list refetch before enabling selection. Loading disables submit without clearing draft; error exposes retry; empty state links to `/parameters/choice-sets`; and a set deactivated during either open or focus refetch remains visible as raw draft but cannot be submitted. Existing choice parameters show the set in a read-only field with a link to `/parameters/choice-sets/{code}` and copy explaining it is immutable in Phase 2.6. Remove every comma textarea and partial-save recovery banner.

Update Parameter CSV dialog sample to:

```csv
code,display_name,value_type,category,unit,min_value,max_value,choice_set_code,description,sort_order
mode,Mode,choice,photo,,,,equipment_mode,Equipment mode,10
pitch,Pitch,number,photo,nm,0.1,1000,,Pitch size,20
```

- [ ] **Step 5: Run deletion scan, tests, visual verdict, and commit**

Run:

```bash
cd frontend
if grep -R -E "export interface Option(In|Out)|replaceParameterOptions|optionsText|ValueType.*('date'|'boolean')" \
  -n src/api src/features/parameters --exclude='*.test.ts' --exclude='*.test.tsx'; then
  echo 'legacy parameter UI contract remains' >&2
  exit 1
fi
npm test -- \
  src/api/parameters.test.ts \
  src/features/parameters/*.test.ts \
  src/features/parameters/*.test.tsx
npm run typecheck
npm run build
```

Render create/edit/choice-link/CSV states, run the Visual Ralph verdict procedure before correcting any issue, and persist the final verdict. Expected: scan is empty and all gates pass.

```bash
git add frontend/src/api frontend/src/features/parameters \
  docs/superpowers/evidence/visual/2026-07-14-phase-2-6-task-11.json
git commit -F - <<'MSG'
Stop parameter edits from forking shared business choices

Parameter administration now selects one immutable managed set and uses canonical decimal strings in a single atomic save path.

Constraint: A parameter cannot switch ChoiceSet after creation in Phase 2.6
Rejected: Preserve the comma editor beside ChoiceSet | two editors would create contradictory sources of truth
Confidence: high
Scope-risk: moderate
Tested: API/form/persistence/registry/CSV tests, legacy scan, typecheck, build, and visual verdict
MSG
```

---

### Task 12: Project creation and list Profile-core cutover

**Files:**
- Create: `docs/superpowers/evidence/visual/2026-07-14-phase-2-6-task-12.json`
- Modify: `frontend/src/api/types.ts`
- Modify: `frontend/src/api/projects.ts`
- Modify: `frontend/src/api/projects.test.ts`
- Modify: `frontend/src/features/projects/wizardState.ts`
- Modify: `frontend/src/features/projects/wizardState.test.ts`
- Modify: `frontend/src/features/projects/urlState.ts`
- Modify: `frontend/src/features/projects/urlState.test.ts`
- Modify: `frontend/src/features/projects/ProjectCreateWizard.tsx`
- Modify: `frontend/src/features/projects/ProjectCreateWizard.test.tsx`
- Modify: `frontend/src/features/projects/ProjectListPage.tsx`
- Create: `frontend/src/features/projects/ProjectListPage.test.tsx`
- Create: `frontend/src/features/projects/projectListQuery.ts`
- Create: `frontend/src/features/projects/projectListQuery.test.ts`
- Modify: `frontend/src/features/projects/ProjectTable.tsx`
- Modify: `frontend/src/features/projects/ProjectTable.test.tsx`

**Interfaces:**
- Consumes: canonical decimal/error base from Task 1 and searchable fixed-set choices from Tasks 8~9
- Produces: complete `ChoiceValueOut`, `ProjectProfileOut`, `ProjectCreate`, `ProjectOut`, and `ProjectSummaryOut` contracts
- Produces: wizard-local `deviceTypeCode`, `projectCategoryCode`, `comment`, and `commentTouched`; only step/process/backbone remain in the URL
- Produces: exact Device Type and Category list filters in URL, query key, and API params
- Preserves: three-step W1 route restoration, dirty guarding, stale Process/backbone fingerprints, submit latch, list scroll/focus restoration, and direct detail links
- Guarantees: untouched Comment is omitted; touched blank Comment is sent as explicit `null`

- [ ] **Step 1: Add failing API type/path/query tests**

Replace the legacy project contracts in `api/types.ts`; define the complete fixed output once so Task 13 cannot invent a second shape:

```ts
export interface ChoiceValueOut {
  code: string
  label: string
  is_active: boolean
}

export interface ProjectProfileOut {
  project_id: number
  process_name: string
  device_type: ChoiceValueOut
  project_category: ChoiceValueOut
  comment: string | null
  active_direction: ChoiceValueOut | null
  gate_direction: ChoiceValueOut | null
  gross_die: string | null
  pitch_x: string | null
  pitch_y: string | null
  shot_x: string | null
  shot_y: string | null
  slit_occupancy: string | null
  lens_occupancy: string | null
  map_offset_x: string | null
  map_offset_y: string | null
  scribe_lane_x: string | null
  scribe_lane_y: string | null
  shot_count: string | null
  full_shot: string | null
  layer_total: string | null
  euv: string | null
  imm: string | null
  arf: string | null
  krf: string | null
  iline: string | null
  soh: string | null
  pspi: string | null
  metal_layer_count: string | null
  created_at: string
  updated_at: string
}
```

`ProjectCreate` removes `description` and requires `device_type_code` and `project_category_code`; `comment` remains optional/null. `ProjectOut` removes `description`, adds `profile`, and otherwise preserves the existing id/identity/name/status/layers shape. `ProjectSummaryOut` removes `description` and adds resolved `device_type`, resolved `project_category`, nullable `layer_total`, and `updated_at`.

In `api/projects.test.ts`, assert:

```ts
await listProjects({
  query: 'foundry',
  status: 'draft',
  deviceTypeCode: 'FOUNDRY',
  projectCategoryCode: 'LOGIC',
})
expect(mockedGet).toHaveBeenCalledWith('/projects', {
  params: {
    query: 'foundry',
    status: 'draft',
    device_type_code: 'FOUNDRY',
    project_category_code: 'LOGIC',
  },
})
```

Also assert create sends the two codes, omits an untouched Comment, sends `comment: null` for touched blank, never sends `description` or `process_name`, and still serializes backbone/manual overrides unchanged.

- [ ] **Step 2: Add failing wizard and list-state tests**

Extend `CreateDisabledReason` with explicit fixed-set states:

```ts
| 'device-types-loading'
| 'device-types-error'
| 'device-types-empty'
| 'device-types-inactive'
| 'categories-loading'
| 'categories-error'
| 'categories-empty'
| 'categories-inactive'
| 'profile-required-fields'
```

Tests prove that loading/error/no-active-option/inactive-set states block before submit, both codes are required, and a retry clears only the relevant query error. If a selected code becomes inactive during refetch, preserve its raw draft but block submission with the relevant admin link. Add a pure `toProjectCreatePayload()` test that distinguishes Comment:

```ts
expect(toProjectCreatePayload(baseDraft({ comment: '', commentTouched: false }))).not.toHaveProperty(
  'comment',
)
expect(toProjectCreatePayload(baseDraft({ comment: '', commentTouched: true }))).toMatchObject({
  comment: null,
})
expect(toProjectCreatePayload(baseDraft({ comment: '  note  ', commentTouched: true }))).toMatchObject({
  comment: 'note',
})
```

Update `urlState.test.ts` to prove:

- create state still round-trips only `step`, `process`, and `backbone`; Profile draft values never enter the URL;
- project list state round-trips `device_type` and `project_category` exact codes;
- empty/default filters are omitted;
- malformed duplicate query keys use the first deterministic value and are normalized on the next write.

Add `ProjectTable.test.tsx` assertions for the approved eight headers, inactive badges/raw-code fallback, and absence of Comment/Description. Put executable list behavior in `projectListQuery.ts`: `projectListQueryKey(routeState)` includes query/status/Device/Category, and `mergeDebouncedQuery(latestRouteState, debouncedQuery)` reads latest state when the 250 ms timer fires. Tests prove clearing one filter resets pagination without clearing the other, and that a pending query debounce cannot overwrite Device/Category/status changed after typing.

- [ ] **Step 3: Run focused tests and confirm legacy contract failures**

Run:

```bash
cd frontend
npm test -- \
  src/api/projects.test.ts \
  src/features/projects/wizardState.test.ts \
  src/features/projects/urlState.test.ts \
  src/features/projects/projectListQuery.test.ts \
  src/features/projects/ProjectCreateWizard.test.tsx \
  src/features/projects/ProjectListPage.test.tsx \
  src/features/projects/ProjectTable.test.tsx
```

Expected: tests fail on missing Profile fields, guards, filters, and table columns; the existing Process/backbone route tests remain green.

- [ ] **Step 4: Extend the final wizard step without changing the flow**

Keep the existing three W1 steps and add to the final information surface:

1. read-only LINE and Process;
2. PARTID and project name;
3. required `SearchableChoice` for `device_type`;
4. required `SearchableChoice` for `project_category`;
5. optional Comment textarea.

Use `useChoiceSetOptions(..., {includeInactive: false, sheetFocused: false})`. Each required set owns loading, retry, inactive-set, and empty-active-option states. Empty/inactive states explain that an administrator must configure or reactivate the set and link to `/parameters/choice-sets/device_type` or `/parameters/choice-sets/project_category`; never fall back to free text. A selected option that becomes inactive is preserved as raw draft but makes the guard non-submittable; a temporary request failure also preserves its raw code.

Include the three local Profile fields in dirty comparison and close/navigation guards. Preserve the existing route reconciliation and submit latch. Successful create navigates to the server-returned project and invalidates the same Process/backbone/list keys as before.

- [ ] **Step 5: Implement exact list filters and the approved compact table**

Extend `ProjectListRouteState` and `ListProjectsParams` with the two codes. Load fixed-set options with inactive values included so historical inactive projects remain filterable. These two non-mutating filter controls alone pass `allowInactiveSelection`; Wizard/Profile/Parameter/Sheet write editors never do. Both filters display `code · label`, retain raw code on request failure, and write normalized query params without disturbing `query` or `status`.

Render these columns in order:

1. Project name
2. LINE / Process
3. PARTID
4. Device Type
5. Category
6. Layer Total
7. Status
8. Updated

At the existing narrower desktop breakpoint, hide Layer Total first and Updated second; never hide identity or classification first. Device/Category show the resolved label and a non-blocking inactive badge. Comment participates only in backend free-text search and is not rendered. Preserve row link state, Back/Forward restoration, session scroll, and focus return.

- [ ] **Step 6: Run regression/visual gates and commit**

Run:

```bash
cd frontend
npm test -- \
  src/api/projects.test.ts \
  src/features/projects/wizardState.test.ts \
  src/features/projects/urlState.test.ts \
  src/features/projects/projectListQuery.test.ts \
  src/features/projects/ProjectCreateWizard.test.tsx \
  src/features/projects/ProjectListPage.test.tsx \
  src/features/projects/ProjectTable.test.tsx
npm run typecheck
npm run build
```

Render wizard loading/error/empty/complete states and list filter/table states at 1024, 1440, and 1920. Run the Visual Ralph verdict procedure before each correction and persist the blocker-free result.

```bash
git add frontend/src/api frontend/src/features/projects \
  docs/superpowers/evidence/visual/2026-07-14-phase-2-6-task-12.json
git commit -F - <<'MSG'
Capture only the Profile facts needed to create and find projects

The existing three-step wizard now collects required managed classifications and Comment, while the compact project list exposes and filters the approved Profile summary.

Constraint: Core Profile fields must not lengthen or reroute the W1 creation flow
Rejected: Put the full Profile in the wizard | most fields are optional and belong in post-create editing
Confidence: high
Scope-risk: moderate
Directive: Keep untouched Comment omitted so a future provider seed retains precedence
Tested: API serialization, route state, guards, dirty/stale/submit regressions, list restoration, responsive table, build, and visual verdict
MSG
```

---

### Task 13: Full Project Profile detail and fenced Drawer editing

**Files:**
- Create: `docs/superpowers/evidence/visual/2026-07-14-phase-2-6-task-13.json`
- Modify: `frontend/src/api/types.ts`
- Modify: `frontend/src/api/projects.ts`
- Modify: `frontend/src/api/projects.test.ts`
- Create: `frontend/src/features/projects/profileForm.ts`
- Create: `frontend/src/features/projects/profileForm.test.ts`
- Create: `frontend/src/features/projects/profileLockState.ts`
- Create: `frontend/src/features/projects/profileLockState.test.ts`
- Create: `frontend/src/features/projects/useProjectProfileLock.ts`
- Create: `frontend/src/features/projects/ProjectProfileDrawer.tsx`
- Create: `frontend/src/features/projects/ProjectProfileDrawer.test.tsx`
- Modify: `frontend/src/features/projects/ProjectDetailPage.tsx`
- Modify: `frontend/src/features/projects/ProjectDetailPage.test.tsx`
- Modify: `frontend/src/shared/components/ModalSurface.tsx`
- Modify: `frontend/src/shared/components/ModalSurface.test.tsx`

**Interfaces:**
- Consumes: complete `ProjectProfileOut`, decimal normalizer, `SearchableChoice`, existing lock API, `ModalSurface`, and `useUnsavedChanges`
- Produces: exact `ProjectProfilePatchIn` with omitted-versus-null diff semantics
- Produces: `getProjectProfile(projectId)` and `patchProjectProfile(projectId, payload, lockToken)`
- Produces: `useProjectProfileLock` with acquire → refetch → heartbeat → loss/release sequencing
- Guarantees: detail remains readable on conflict; no editable stale draft exists before lock acquisition
- Excludes: `device_ref`, identity mutation, Profile URL edit state, provider refresh, and extra fields

- [ ] **Step 1: Add failing Profile contract and form tests**

Define `ProjectProfilePatchIn` with only the 28 approved mutable keys; identity fields and output-only resolved choice objects are absent. In `api/projects.test.ts`, assert:

```ts
await patchProjectProfile(42, { comment: null, pitch_x: '1.5' }, 'lock-abc')
expect(mockedPatch).toHaveBeenCalledWith(
  '/projects/42/profile',
  { comment: null, pitch_x: '1.5' },
  { headers: { 'X-Lock-Token': 'lock-abc' } },
)
```

Assert GET path, exact snake_case keys, and no identity/device-ref field. Create a string-only `ProfileFormState` whose choice inputs store codes and whose optional controls store editable strings.

`profileForm.test.ts` covers:

- hydrate resolved choice objects to their codes;
- unchanged fields omitted from `toProfilePatch()`;
- optional blank text/choice/decimal becomes explicit `null` only when changed;
- required `process_name`, Device Type, and Category reject blank/null;
- optional text trims outer whitespace;
- all ten decimal spin fields (`pitch_x/y`, `shot_x/y`, `slit_occupancy`, `lens_occupancy`, `map_offset_x/y`, `scribe_lane_x/y`) use the same canonicalizer and are enumerated individually in the test;
- `001.5000` emits `1.5`, invalid input keeps the draft and emits no request;
- inactive current choice may remain unchanged, but a newly selected inactive/unknown code fails local validation;
- all remaining text fields (`gross_die`, `shot_count`, `full_shot`, `layer_total`, `euv`, `imm`, `arf`, `krf`, `iline`, `soh`, `pspi`, `metal_layer_count`) round-trip exactly after outer trim.

- [ ] **Step 2: Add failing lock-state, Drawer markup, and detail tests**

`profileLockState.test.ts` models these transitions:

```text
closed -> acquiring -> loading-profile -> editable
acquiring -> conflict(holder) -> readable-retry
editable -> saving -> releasing -> closed
editable -> lock-lost(draft retained, read-only)
editable -> cancelling -> releasing -> closed
```

Prove double-open and double-release are idempotent; a late acquire response after close is released and cannot open an editor; heartbeat starts immediately after acquire while Profile GET is pending; a slow/failed GET therefore cannot expire the lock and exposes retry/close without leaking the held token; closing while GET is pending releases the token and a late GET cannot hydrate/open the draft. Save never releases before PATCH settles; a failed PATCH returns to editable with the same draft only while the same operation generation still owns an active token. Add deferred PATCH resolve and reject cases where heartbeat loss occurs in flight: `lock-lost` remains authoritative, the draft stays read-only, and the stale continuation cannot rehydrate, return to editable, close, or release. On heartbeat conflict during either GET or edit, assert the timer stops, the operation generation is invalidated, any late GET/PATCH is ignored, and later Save attempts issue zero PATCH requests. Reacquire tests must best-effort release the old token once, allocate a new generation/token, refetch and hydrate the server Profile, and keep the lost-session draft only as an explicit recovery copy; a late old PATCH cannot mutate or release the new session. Add a pure `createUnloadReleaseOnce()` test showing `pagehide` plus `beforeunload` invokes the beacon release callback exactly once for the held token.

Because Vitest runs in node, `ProjectProfileDrawer.test.tsx` uses SSR/view-model seams to assert grouped legends, labels, `aria-*`, conflict holder/retry, dirty confirmation copy, pending-disabled close, read-only lock-loss recovery text, raw inactive choice visibility, and absence of `device_ref`. `ProjectDetailPage.test.tsx` asserts every fixed field is grouped under Identity, Product, Direction, Die/Shot, Wafer Position, or Layer Summary before the layer table and that identity fields are read-only.

- [ ] **Step 3: Run focused tests and confirm missing Profile failures**

Run:

```bash
cd frontend
npm test -- \
  src/api/projects.test.ts \
  src/features/projects/profileForm.test.ts \
  src/features/projects/profileLockState.test.ts \
  src/features/projects/ProjectProfileDrawer.test.tsx \
  src/features/projects/ProjectDetailPage.test.tsx \
  src/shared/components/ModalSurface.test.tsx
```

Expected: missing API functions, form reducer, lock state machine, Drawer, and definition grid fail; existing layer/backbone detail assertions remain green.

- [ ] **Step 4: Implement exact Profile hydrate, validation, and diff**

Use explicit field lists rather than `Object.entries(profile)` so timestamps and identity cannot leak into PATCH:

```ts
export const DECIMAL_PROFILE_FIELDS = [
  'pitch_x', 'pitch_y', 'shot_x', 'shot_y',
  'slit_occupancy', 'lens_occupancy',
  'map_offset_x', 'map_offset_y',
  'scribe_lane_x', 'scribe_lane_y',
] as const

export const NULLABLE_TEXT_PROFILE_FIELDS = [
  'comment', 'gross_die', 'shot_count', 'full_shot', 'layer_total',
  'euv', 'imm', 'arf', 'krf', 'iline', 'soh', 'pspi', 'metal_layer_count',
] as const
```

Maintain separate lists for required strings and optional choice codes. Normalize every candidate first; if any validation fails, return errors and no payload. Diff canonical candidate values against canonical hydrated values. Unchanged inactive codes remain omitted. A changed optional blank emits `null`; a changed required blank is an error. The backend remains authoritative and its complete response rehydrates the form after save.

The Drawer loads `device_type`, `project_category`, `active_direction`, and `gate_direction` through `useChoiceSetOptions(..., {includeInactive: true, sheetFocused: false})`. The shared combobox filters inactive rows from new selection while retaining the current inactive code for display. A temporary option-query failure leaves the hydrated raw code in the draft and disables changing that field until retry; it never converts the value to blank.

- [ ] **Step 5: Implement the project-lock session and Drawer lifecycle**

Reuse the existing lock API and the acquire/heartbeat/release timing pattern from `useSheetEditing`; do not extract cell autosave behavior. The hook owns an operation generation/session token so every GET, PATCH, invalidation, close, and release continuation proves it still owns the current live session before changing state.

Exact open/save/close order:

1. capture trigger focus and request the project lock;
2. immediately after acquire succeeds, start heartbeat for the held token;
3. fetch the latest Profile and hydrate draft only if the same generation still owns the token;
4. validate and PATCH with `X-Lock-Token`;
5. replace local Profile with the complete server response;
6. invalidate `['project', id]`, `['project-profile', id]`, and all project lists;
7. stop heartbeat and release after the pending PATCH/invalidation settles;
8. close and return focus.

On acquire conflict, show holder and retry while detail stays readable. A failed Profile GET keeps heartbeat running and the token owned in a retryable load-error state; retry reuses that live session, while close stops heartbeat and releases exactly once. On heartbeat/fencing loss during GET, editing, or an in-flight PATCH, increment/invalidate the operation generation before freezing controls read-only, retain any hydrated unsaved draft for copy/recovery, stop further PATCH attempts, and offer close/reacquire. A late PATCH success/failure from the invalid generation has no authority to rehydrate, return to editable, close, invalidate queries, or release; ordinary validation, network, or 422 responses keep the editable draft only when the generation is still current. Reacquire first closes the lost session and best-effort releases its token once, then creates a new generation/token and hydrates the latest server Profile; never silently merge the recovery draft into the new live form. Use `useUnsavedChanges({when: dirty, freezeWhen: pending})`; Escape, backdrop, cancel, and route navigation share the same dirty decision. Extend `ModalSurface` with an optional `closeDisabled` prop that disables its close button and ignores Escape/backdrop while PATCH/release is pending; add shared-component regression tests. Register one-shot `pagehide` and `beforeunload` handlers while a token is held and call existing `releaseLockOnUnload`, resetting the one-shot guard only for a newly acquired session. Do not encode Drawer open state in the URL.

- [ ] **Step 6: Render the full grouped definition grid and compact Drawer**

The detail groups:

- Identity: LINE, Process ID, PARTID
- Product: Process Name, Device Type, Category, Comment
- Direction: Active Direction, Gate Direction
- Die/Shot: Gross Die, Pitch X/Y, Shot X/Y, Slit/Lens Occupancy, Shot Count, Full Shot
- Wafer Position: Map Offset X/Y, Scribe Lane X/Y
- Layer Summary: Layer Total, EUV, IMM, ARF, KRF, I-line, SOH, PSPI, Metal Layer Count

Render resolved `code · label` diagnostics and inactive badges; raw codes remain readable on query failure. The right Drawer uses grouped two-column controls on desktop and one column below 1024px, with a full-width surface on narrow screens. Reuse `ModalSurface` focus trap/return and existing `Field`; no new overlay or icon package.

- [ ] **Step 7: Run regression/visual gates and commit**

Run:

```bash
cd frontend
if grep -R "device_ref\|deviceRef" -n src/api src/features/projects \
  --exclude='*.test.ts' --exclude='*.test.tsx'; then
  echo 'excluded Device Ref leaked into implementation' >&2
  exit 1
fi
npm test -- \
  src/api/projects.test.ts \
  src/api/locks.test.ts \
  src/features/projects/profileForm.test.ts \
  src/features/projects/profileLockState.test.ts \
  src/features/projects/ProjectProfileDrawer.test.tsx \
  src/features/projects/ProjectDetailPage.test.tsx \
  src/shared/components/ModalSurface.test.tsx \
  src/shared/navigation/useUnsavedChanges.test.ts
npm run typecheck
npm run build
```

Exercise read-only/conflict/edit/validation/lock-loss/success/dirty-close states at all three target widths. Run the Visual Ralph verdict procedure before each correction and persist a blocker-free result.

```bash
git add frontend/src/api frontend/src/features/projects frontend/src/shared/components/ModalSurface.tsx \
  frontend/src/shared/components/ModalSurface.test.tsx \
  docs/superpowers/evidence/visual/2026-07-14-phase-2-6-task-13.json
git commit -F - <<'MSG'
Keep Profile edits recoverable under the existing project fence

The project detail now exposes the complete fixed Profile and opens an atomic Drawer only after a fresh lock and refetch, preserving drafts across validation and lock loss.

Constraint: Profile identity remains outside the mutation schema
Rejected: Reuse the short-lived layer replacement lock | it cannot protect a multi-field editing session
Confidence: high
Scope-risk: broad
Directive: Never hydrate an editable Profile draft before lock acquisition succeeds
Tested: Exact diff/null semantics, decimal vectors, lock state races, error recovery, detail groups, build, and visual verdict
MSG
```

---

### Task 14: Sheet managed-choice resources and string-preserving decimal cells

**Files:**
- Create: `docs/superpowers/evidence/visual/2026-07-14-phase-2-6-task-14.json`
- Modify: `frontend/src/api/types.ts`
- Modify: `frontend/src/api/sheets.test.ts`
- Modify: `frontend/src/api/cells.test.ts`
- Modify: `frontend/src/grid/types.ts`
- Create: `frontend/src/grid/cellValue.ts`
- Create: `frontend/src/grid/cellValue.test.ts`
- Create: `frontend/src/grid/decimalCell.tsx`
- Create: `frontend/src/grid/decimalCell.test.tsx`
- Modify: `frontend/src/grid/choiceCell.tsx`
- Modify: `frontend/src/grid/choiceCell.test.ts`
- Modify: `frontend/src/grid/GlideConditionGrid.tsx`
- Modify: `frontend/src/grid/index.ts`
- Modify: `frontend/src/features/sheets/sheetAdapter.ts`
- Modify: `frontend/src/features/sheets/sheetAdapter.test.ts`
- Modify: `frontend/src/features/sheets/pasteStaging.ts`
- Modify: `frontend/src/features/sheets/pasteStaging.test.ts`
- Modify: `frontend/src/features/sheets/editStore.ts`
- Modify: `frontend/src/features/sheets/editStore.test.ts`
- Create: `frontend/src/features/sheets/persistenceReconciliation.ts`
- Create: `frontend/src/features/sheets/persistenceReconciliation.test.ts`
- Create: `frontend/src/features/sheets/useSheetChoiceSets.ts`
- Create: `frontend/src/features/sheets/useSheetChoiceSets.test.ts`
- Modify: `frontend/src/features/sheets/useSheetEditing.ts`
- Modify: `frontend/src/features/sheets/SheetView.tsx`
- Modify: `frontend/src/features/sheets/SheetView.test.tsx`

**Interfaces:**
- Consumes: Task 1 decimal contract, Task 8 versioned option loader, Task 9 filtering/keyboard semantics, and Task 3 sheet/cell API
- Produces: `SheetColumnOut.choice_set_code` and `.choice_set_version`; no embedded options
- Produces: one option aggregate per distinct `(setCode, version)` for the whole sheet
- Produces: `validateCellCandidate(column, raw, context)` shared by single edit and paste
- Produces: monotonic per-cell edit revisions so an in-flight A → B → A cycle remains dirty
- Produces: custom Glide decimal cell whose edit/copy/save representation is a string
- Produces: managed-choice cell that displays label, copies/saves code, and retains raw/inactive/error states
- Guarantees: server-returned canonical cell values, not request spellings, become the sheet cache truth

- [ ] **Step 1: Add failing final sheet type and resource-plan tests**

Change the sheet column contract to:

```ts
export interface SheetColumnOut {
  parameter_code: string
  display_name: string
  value_type: 'text' | 'number' | 'choice'
  category_code: string | null
  unit: string | null
  description: string | null
  choice_set_code: string | null
  choice_set_version: number | null
  sort_order: number
}
```

`api/sheets.test.ts` and `sheetAdapter.test.ts` assert there is no `choice_options` array; choice columns require a code/version pair and text/number columns require both null. Malformed half-pairs become an adapter error, not a silently empty choice list.

Create a pure `buildSheetChoiceResources(columns)` test:

```ts
expect(buildSheetChoiceResources([
  choiceColumn('mode_a', 'equipment_mode', 7),
  choiceColumn('mode_b', 'equipment_mode', 7),
  choiceColumn('direction', 'active_direction', 2),
])).toEqual([
  { setCode: 'active_direction', version: 2 },
  { setCode: 'equipment_mode', version: 7 },
])
```

Assert a later server sheet version replaces the resource key, duplicate columns never duplicate fetches, conflicting versions for the same set make the adapter request a Sheet refetch instead of choosing one, and resources are sorted deterministically for a stable `useQueries` call. Mock the loader and assert the first options request for `equipment_mode` sends `version=7`, `cursor=undefined`, and `include_inactive=true` from the Sheet column before any polled summary can replace it. Add the fail-closed stale-summary regression: cached active summary v6 plus Sheet target/aggregate v7 produces display data only, never a selectable resource, until a fresh v7 summary is loaded; a matching inactive v7 summary also remains non-selectable.

- [ ] **Step 2: Add failing common validation, decimal cell, and choice cell tests**

`cellValue.test.ts` enumerates text trim/current behavior, every decimal golden vector, active known choice, inactive current no-op, inactive changed rejection, active option inside an inactive set rejection, inactive-set current no-op, unknown rejection, and load-error raw preservation. Feed identical cases through both `validateSingleCellEdit()` and `validatePasteCell()` and assert identical result/error codes.

`decimalCell.test.tsx` asserts:

- cell data and `copyData` remain canonical strings;
- `.5` edits to `0.5`;
- `001.5000` edits to `1.5`;
- invalid/exponent/over-limit values return a validation result without creating `number` anywhere;
- empty optional cell produces `null`.

Update `choiceCell.test.ts` to assert label rendering, `copyData === code`, tooltip `code · label`, single-click/Enter activation, inactive stored badge, raw unknown/error text, retry action, and option filtering through the shared Task 9 reducer. The editor must not use native `<select>`.

- [ ] **Step 3: Add failing paste/autosave/cache authority tests**

Extend `pasteStaging.test.ts` with mixed text/decimal/choice matrices. One invalid inactive or unknown new choice must mark that staged cell invalid under the existing review flow; accepted decimal previews show canonical values. Prove paste and single edit return the same domain error identifier.

Split persisted and dirty shapes in `editStore.ts`:

```ts
export interface PersistedCell {
  conditionId: string
  parameterCode: string
  value: string | null
}

export interface DirtyCell extends PersistedCell {
  revision: number
}
```

Use an atomic allocator contract:

```ts
setCell(cell: PersistedCell): DirtyCell
setCells(cells: readonly PersistedCell[]): DirtyCell[]
```

Every assignment increments one store-wide monotonic counter, even when the value cycles back; `setCells` assigns strictly increasing revisions in input order, installs them atomically, and returns the exact revisioned snapshots that were stored. Paste validation/apply accepts unrevisioned `PersistedCell[]`, calls `setCells` once, and hands that returned `DirtyCell[]` to the persistence request/reconciliation path; it never reconstructs revisions from values or rereads a possibly newer map. A failed request leaves those entries dirty. `fromCellUpdateOut(cell): PersistedCell` converts API snake_case without inventing a client revision. `removeSavedCells()` compares the request snapshot revision to the current dirty revision, never value equality. `clearAll()` empties dirty entries but does not reset the store-wide counter, so a late response from a prior sheet/session cannot match and clear a same-key edit created after reset.

Create `reconcileSuccessfulPatch(response, requestSnapshot, commitCanonical, markSnapshotSaved)` as a pure seam. Its test makes the server return canonical `1.5` for a request containing `001.5000` and asserts:

```ts
expect(commitSaved).toHaveBeenCalledWith(
  expect.arrayContaining([expect.objectContaining({ value: '1.5' })]),
)
expect(markSaved).toHaveBeenCalledWith(
  expect.arrayContaining([expect.objectContaining({ value: '001.5000', revision: 1 })]),
)
```

The first call updates the query cache from the response; the second only clears the request snapshot's dirty generation. Also cover response ordering, partial network failure, and a canonical response that differs from more recent local input without erasing the newer dirty edit.

Add the ABA regression explicitly: snapshot revision 1 contains `A`; the user edits to `B` revision 2 and back to `A` revision 3 before response 1; reconciliation commits server `A` to cache but `markSaved(snapshot revision 1)` leaves revision 3 dirty. Add a paste allocator test proving unrevisioned inputs receive and return the exact installed revisions used by `markSaved`, plus a reset regression: after `clearAll`, a same-key edit receives a greater revision and a late pre-clear success cannot remove it.

- [ ] **Step 4: Run focused tests and confirm embedded-option/Number failures**

Run:

```bash
cd frontend
npm test -- \
  src/api/sheets.test.ts \
  src/api/cells.test.ts \
  src/grid/cellValue.test.ts \
  src/grid/decimalCell.test.tsx \
  src/grid/choiceCell.test.ts \
  src/features/sheets/sheetAdapter.test.ts \
  src/features/sheets/pasteStaging.test.ts \
  src/features/sheets/editStore.test.ts \
  src/features/sheets/persistenceReconciliation.test.ts \
  src/features/sheets/useSheetChoiceSets.test.ts \
  src/features/sheets/SheetView.test.tsx
```

Expected: legacy embedded arrays, `GridCellKind.Number`, separate paste regex, and request-value cache commits fail the new assertions.

- [ ] **Step 5: Implement distinct, version-safe sheet ChoiceSet resources**

`useSheetChoiceSets` derives the stable resource list once and calls TanStack `useQueries` for one summary/aggregate per distinct set. The bootstrap aggregate is keyed by and sends the `choice_set_version` from `SheetColumnOut` on its first page; the guarded Task 8 loader handles a 409/new version without mixing keys. It requests inactive options so current historical codes resolve. While the sheet focus frame is active:

- summary polls every 60,000 ms;
- window focus refetches immediately;
- opening any choice editor refetches its summary;
- a new summary version removes the old option aggregate and loads page 1 under the new key;
- a page conflict relies on Task 8's bounded full-aggregate restart;
- no partial aggregate reaches grid data.

Return a `Map<string, SheetChoiceResource>` shared by columns/cells rather than cloning option arrays. Use this exact typed transport from the hook through `SheetView`/grid to the choice editor:

```ts
export interface SheetChoiceResource {
  setCode: string
  targetVersion: number
  summaryVersion: number | null
  setIsActive: boolean | null
  displayAggregate: ChoiceOptionAggregate | null
  selectableAggregate: ChoiceOptionAggregate | null
  selectionReady: boolean
  isStale: boolean
  loading: boolean
  error: string | null
  prepareToOpen: () => Promise<void>
  retry: () => Promise<void>
}
```

`targetVersion` is `Math.max(columnVersion, summaryVersion ?? columnVersion)`, the latest monotonic version known from the Sheet column and current summary. `selectableAggregate` is non-null and `selectionReady=true` only when `summaryVersion === targetVersion === selectableAggregate.version` **and** the matching summary has `is_active === true`; a missing/stale summary is fail-closed even if a target-version aggregate is cached. `displayAggregate` may retain the previous label solely for read-only diagnostics. Once a newer target is known, validation/selection receive `selectableAggregate=null` until the exact matching summary and aggregate arrive. An error never blanks a stored raw code, but an old aggregate can never authorize a write.

`prepareToOpen()` is the editor's typed awaited path: refetch summary with `throwOnError: true` (or inspect the result), derive target from the returned fresh summary, and await the exact target aggregate before resolving; failure leaves `selectionReady=false` and exposes retry. `SheetView` passes the same resource object—not an options clone—to the grid cell, and the choice overlay passes `prepareToOpen`, fail-closed `sourceActive`, and `selectionReady` to Task 9's `SearchableChoice`. Pure query-plan tests prove two columns sharing a set produce one aggregate key; hook/grid transport tests prove the callback is awaited and stale summary v6/new column v7 cannot commit; Task 15 network evidence proves no request occurs per cell.

- [ ] **Step 6: Implement common cell validation and custom Glide cells**

Remove `date` and `boolean` from grid value types. `validateCellCandidate()` accepts the column, old stored value, raw candidate, and optional indexed resource `{setIsActive, selectionReady, selectableAggregate}`; it never receives `displayAggregate`. It returns either `{ok: true, value: string | null}` or a stable local error. It calls `normalizeDecimalInput` for number and requires `selectionReady`, active set, and active option for a changed choice. A known inactive set/option is allowed only as the unchanged old value. Both `GlideConditionGrid` single-edit and `pasteStaging` call it directly.

Replace `GridCellKind.Number` with `decimalCell`, a custom cell whose data/editor/copy path never converts through `Number`. Its editor owns the draft and validation message: invalid exponent/locale/over-limit input keeps the overlay open, renders `role="alert"`, and does not call `onCellEdit`; valid Enter commits canonical text, Escape restores the old value, and a subsequent valid edit clears the alert. Replace the native-select choice editor with a DOM overlay backed by Task 9 state. Canvas remains the semantic grid owner. Display label; copy/persist stable code; put `code · label` in tooltip/diagnostics; show `사용 중지됨` for current inactive; show raw code plus retry on request failure. Preserve existing one-click activation and grid keyboard navigation/focus return.

- [ ] **Step 7: Make server canonical responses authoritative without losing newer edits**

Change `useSheetEditing`'s callback to `onPersisted(response: CellsPatchOut, requestSnapshot: DirtyCell[])`. Single edits and paste begin as `PersistedCell`; the store allocator returns the exact `DirtyCell` snapshot that is queued, and that same snapshot travels with its `patchCells()` request through success/failure handling. Store the result of `patchCells()` and pass its canonical cells separately from the revisioned request snapshot. Call the tested `reconcileSuccessfulPatch` seam. In `SheetView`:

1. `commitSaved(response.cells.map(fromCellUpdateOut))` updates the React Query sheet cache with canonical server values;
2. `markSaved(requestSnapshot)` clears only dirty entries whose current revision still equals the request revision;
3. any newer local edit stays dirty and overlays the canonical cache;
4. audit/selection state uses stored codes, never resolved labels.

Update API tests so cell batch responses round-trip canonical strings and choice codes with no compatibility coercion.

- [ ] **Step 8: Run regression/performance/visual gates and commit**

Run:

```bash
cd frontend
if grep -R "choice_options\|GridCellKind.Number\|parseFloat" -n \
  src/features/sheets src/grid --exclude='*.test.ts' --exclude='*.test.tsx'; then
  echo 'embedded choice or binary-number sheet path remains' >&2
  exit 1
fi
npm test -- \
  src/api/sheets.test.ts \
  src/api/cells.test.ts \
  src/grid/*.test.ts \
  src/grid/*.test.tsx \
  src/features/sheets/*.test.ts \
  src/features/sheets/*.test.tsx
npm run typecheck
npm run build
```

Use the 200-column/100-layer seed with hundreds of shared options. Verify one network aggregate per distinct set, no option arrays in `SheetOut`, and no per-cell option clone. Exercise active/inactive/raw/error/retry, keyboard search, single edit, paste review, 60-second refresh, and canonical response states at 1024/1440/1920. Run the Visual Ralph verdict procedure before each correction and persist the blocker-free result.

```bash
git add frontend/src/api frontend/src/grid frontend/src/features/sheets \
  docs/superpowers/evidence/visual/2026-07-14-phase-2-6-task-14.json
git commit -F - <<'MSG'
Preserve stable choice codes and exact decimals through the sheet editor

The grid now loads each managed set once, shares one validator across edit and paste, and accepts canonical server strings without converting through binary numbers.

Constraint: Canvas remains the grid semantic owner and no option list is duplicated per cell
Rejected: Keep Glide number cells and round on save | validation and display would already have lost the original decimal
Confidence: high
Scope-risk: broad
Directive: Cache the server response but clear dirty generations from the matching request snapshot
Tested: Distinct resource loads, cache version changes, inactive/raw/error choices, decimal vectors, edit/paste equivalence, autosave races, build, performance, and visual verdict
MSG
```

---

### Task 15: Integrated migration, concurrency, browser, and completion evidence

**Files:**
- Modify: `docs/superpowers/evidence/visual/2026-07-14-phase-2-6-task-{09..14}.json`
- Create: `scripts/qa/serve_phase26_dist.mjs`
- Create: `scripts/qa/phase26_browser_qa.mjs`
- Create: `docs/superpowers/evidence/phase-2-6/` browser JSONL/ARIA/PNG artifacts
- Create: `docs/superpowers/evidence/2026-07-14-phase-2-6-browser-qa.md`
- Modify: `README.md`
- Modify: `plan/04-roadmap.md`
- Modify: `plan/README.md`
- Modify if implementation evidence requires correction: files owned by Tasks 1~14 only

**Interfaces:**
- Consumes: every green Task 1~14 commit; no partial backend cutover
- Produces: reproducible command/result evidence for clean schema, concurrency, regressions, performance, accessibility, and three viewports
- Produces: explicit Phase 2.6 completion status only after every acceptance criterion passes
- Preserves: default developer app/ingest volumes; all destructive checks run against an isolated Compose project/test database
- Guarantees: final QA is serial so shared DB, browser state, and evidence cannot race parallel workers

- [ ] **Step 1: Rebase/merge the task commits and prove a clean baseline**

Before integrated testing:

```bash
git status --short
git log --oneline --decorate -20
```

Expected: only the evidence document may be untracked; no task has unstaged source edits. Review Tasks 2~7 as one backend cutover cluster and reject the integration if any legacy `ParameterOption`, `project.description`, embedded sheet option, or float-number compatibility path remains.

Run repository scans:

```bash
if grep -R "ParameterOption\|parameter_option\|choice_options" -n \
  backend/app frontend/src --exclude-dir='__pycache__' \
  --exclude='*.test.ts' --exclude='*.test.tsx'; then
  echo 'legacy option contract remains' >&2
  exit 1
fi
if grep -R "device_ref\|deviceRef" -n backend/app frontend/src \
  --exclude='*.test.ts' --exclude='*.test.tsx'; then
  echo 'excluded Device Ref exists' >&2
  exit 1
fi
```

Migration files may mention `parameter_option` only to detect/drop/recreate it; tests may mention it only to prove absence/preflight behavior. Review those intentional occurrences separately.

- [ ] **Step 2: Run all static, unit, and integration gates from fresh processes**

Run backend gates serially against the isolated PostgreSQL test database:

```bash
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"
docker rm -f pcm-phase26-test-db >/dev/null 2>&1 || true
docker run --rm -d --name pcm-phase26-test-db \
  --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_DB=pcm_test -e POSTGRES_USER=pcm_user -e POSTGRES_PASSWORD=pcm_pass \
  -p 15442:5432 postgres:16-alpine
until docker exec pcm-phase26-test-db pg_isready -U pcm_user -d pcm_test >/dev/null 2>&1; do sleep 1; done
(
  cd backend
  uv run ruff check .
  uv run pyright
  APP_TEST_DATABASE_URL=postgresql+asyncpg://pcm_user:pcm_pass@localhost:15442/pcm_test \
  APP_DATABASE_URL=postgresql+asyncpg://pcm_user:pcm_pass@localhost:15442/pcm_test \
    uv run pytest -q
  uv run python -m scripts.measure_sheet_perf
)
(
  cd frontend
  npm ci
  npm run lint
  npm run typecheck
  npm test
  npm run build
)
```

Expected: zero failures/skips other than explicitly environment-gated ingest/PostgreSQL cases documented with reason; lock, backbone, layer, autosave, paste, condition, POR, route, dirty-navigation, and accessibility regressions remain green. Record exact test counts and elapsed performance numbers in the evidence document rather than copying counts from this plan.

- [ ] **Step 3: Prove both clean migration paths and destructive preflight**

Use the guarded test helper; every case creates and drops its own `pcm_phase26_test_<uuid>` database and refuses any other name:

```bash
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"
(
  cd backend
  APP_TEST_DATABASE_URL=postgresql+asyncpg://pcm_user:pcm_pass@localhost:15442/pcm_test \
    uv run pytest -q \
      tests/migrations/test_phase_2_6_migration_pg.py \
      tests/scripts/test_seed_dev_pg.py
)
```

This includes fresh base, empty 0003, parameterized nine-table preflight, offline rejection, and real seed smoke. Record revision/table/column evidence plus the temporary database names and confirmed cleanup. Never run bare `alembic downgrade` against `pcm_test`, and never run `docker compose down -v` in the repository's default Compose project.

- [ ] **Step 4: Run PostgreSQL lost-update and atomicity scenarios**

Run the dedicated real-PostgreSQL tests without parallelization:

```bash
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"
(
  cd backend
  APP_TEST_DATABASE_URL=postgresql+asyncpg://pcm_user:pcm_pass@localhost:15442/pcm_test \
  APP_DATABASE_URL=postgresql+asyncpg://pcm_user:pcm_pass@localhost:15442/pcm_test \
    uv run pytest -q \
      tests/features/test_choice_sets_pg.py \
      tests/features/test_choice_consumers_pg.py \
      tests/features/test_locks_pg.py \
      tests/migrations/test_phase_2_6_migration_pg.py \
      tests/features/test_project_profiles_api.py \
      tests/features/test_cells_api.py
)
```

Evidence must show two concurrent mutations with one `expected_version` produce one success and one `choice_set_changed`, exactly one version increment, and no partial reorder/import; consumer/deactivation races never store a newly inactive choice. The targeted API cases also record Profile fencing-token rejection, lock loss, cell batch rollback, inactive no-op/new-write distinction, and provider failure transaction rollback rather than relying only on the broad Step 2 run.

- [ ] **Step 5: Start an isolated seeded application for browser QA**

Use the Task 7 Compose port variables with a separate project name and non-default host ports/volumes:

```bash
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"
export COMPOSE_PROJECT_NAME=pcm-phase26-qa
export APP_DB_PORT=15432
export INGEST_DB_PORT=15433
export BACKEND_PORT=18000
export FRONTEND_PORT=15173
docker compose up -d --build app-db ingest-db backend frontend
docker compose exec -T backend python -m scripts.seed_dev
curl --fail http://localhost:18000/health
```

Confirm `docker volume ls` shows only `pcm-phase26-qa_*` volumes for this run. Cleanup is restricted to:

```bash
docker compose -p pcm-phase26-qa down -v
```

The default project name and its app/ingest/frontend volumes must never be targeted.

Build and serve the production artifact on a separate port using only Node built-ins:

```bash
cd frontend
npm run build
cd ..
node scripts/qa/serve_phase26_dist.mjs \
  --dist frontend/dist --port 15174 --api-target http://127.0.0.1:18000 \
  > /tmp/pcm-phase26-dist.log 2>&1 &
echo $! > /tmp/pcm-phase26-dist.pid
curl --fail http://127.0.0.1:15174/
```

`serve_phase26_dist.mjs` serves hashed files with correct MIME types, falls back to `index.html` for SPA routes, and proxies every `/api/*` method/body/status/header to the isolated backend. It binds only `127.0.0.1`. This avoids React dev StrictMode duplicating lock acquire/heartbeat/release during evidence while retaining the Vite container only as a smoke check.

- [ ] **Step 6: Execute the Project and Choice administration browser matrix**

Install the browser harness outside the repository and run the checked-in scenario script against the production static proxy:

```bash
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"
rm -rf /tmp/pcm-phase26-playwright
mkdir -p /tmp/pcm-phase26-playwright
cp scripts/qa/phase26_browser_qa.mjs /tmp/pcm-phase26-playwright/
(
  cd /tmp/pcm-phase26-playwright
  npm init -y >/dev/null
  npm install --no-save playwright@1.57.0
  npx playwright install chromium
  node phase26_browser_qa.mjs \
    --base-url http://127.0.0.1:15174 \
    --api-url http://127.0.0.1:18000/api \
    --output "$repo_root/docs/superpowers/evidence/phase-2-6"
)
```

The script fails nonzero on any scenario failure and writes `results.json`, network JSONL, accessibility snapshots, and named PNGs for 1024×768, 1440×900, and 1920×1080. Pin Playwright 1.57.0 and record its actual bundled Chromium version (expected baseline `145.0.7632.6`) rather than assuming it. The temporary install creates no repository package/lock change and is deleted after evidence. `phase26_browser_qa.mjs` owns two independent browser contexts, deterministic API setup, request interception for between-page mutation/network failures, 60-second fake-or-wall-clock observation, `locator.ariaSnapshot()` capture, focus assertions, body-overflow measurements, and screenshot naming. Use the exact SHA whose production build passed; do not run lock-lifecycle acceptance against the dev server.

Project matrix:

- wizard required-set loading, request error/retry, no-active-option admin links, valid create, untouched/touched-empty Comment, stale Process/backbone request, submit latch;
- list query/status/Device/Category URL restoration, inactive filter value, Back/Forward, direct detail URL, scroll/focus restoration, eight-column collapse order;
- detail every fixed field, no Device Ref, resolved/raw/inactive choice diagnostics;
- Profile acquire/refetch/edit/PATCH/release, explicit clear, decimal `001.5000 -> 1.5`, 422/network recovery, dirty close/navigation, focus return, holder conflict/retry, simulated lock loss retaining a read-only draft.

Choice administration matrix:

- list URL search/active state, direct set detail, option code+label search, add/edit/deactivate, inactive include, keyboard reorder of the complete collection;
- case-only option code near-duplicate warning is visible but does not block an otherwise valid create;
- blast-radius/usage copy before deactivation;
- CSV preview side-effect check, CSV edit invalidating preview, validation-blocked Apply, successful atomic Apply;
- two independent administrator browser contexts causing a version conflict; stale draft remains, latest summary appears, explicit reload/retry succeeds;
- hundreds-option pagination where a mutation between pages restarts at page 1 and never shows a mixed-version aggregate.

- [ ] **Step 7: Execute the sheet/accessibility/cache browser matrix**

On a seeded 200-column/100-layer Draft:

- active choice opens by click and Enter, input receives focus, code/label filter works, Arrow Up/Down/Home/End/Enter/Escape work, focus returns to the grid;
- with cached options, an intercepted mandatory summary-refresh failure on open leaves rows display-only/retryable and Enter/click sends no edit; a background version change while open immediately removes commit readiness until exact summary/target/aggregate versions agree;
- accessibility tree shows combobox/listbox/option ownership and current selection announcement without a duplicate HTML table;
- cell displays label, tooltip/diagnostic shows `code · label`, copy/save uses code;
- inactive stored code is readable with a non-blocking warning and absent from new choices; unchanged/no-op eligibility is proven by backend/domain tests, not a Phase 5 approval UI;
- unknown/raw and option-request error remain readable with retry;
- inactive/unknown values are absent and non-committable in the non-freeform single editor, rejected in paste review, and hostile direct single-edit candidates return the same error in shared-validator tests;
- exponent, locale-separated, and over-limit decimal drafts keep the editor open with an alert and send no cell PATCH; a corrected canonical value then saves;
- decimal vectors produce identical single-edit/paste canonical strings and the cache reflects the server response;
- two columns sharing one set perform one aggregate load and SheetOut contains zero embedded options;
- while the sheet stays focused, mutate a set in the second admin context and prove discovery on editor open, window focus, and within 60 seconds; verify network history starts the new version at page 1.

At every viewport record `document.body.scrollWidth === document.body.clientWidth`, Drawer width behavior, no clipped primary action, and no focus escape.

- [ ] **Step 8: Run visual verdict, document evidence, and correct blockers**

Follow the established structure in `docs/superpowers/evidence/2026-07-13-phase-2-5-browser-qa.md`. The new evidence file records:

- commit SHA and isolated environment/ports;
- exact backend/frontend/migration/concurrency/performance command results;
- scenario table with pass/fail and screenshot/log references;
- network proof for versioned pagination and one-resource-per-set;
- accessibility/focus observations;
- 1024/1440/1920 screenshots;
- the Visual Ralph verdict procedure JSON/result and any correction iteration;
- remaining risks and explicitly deferred Phase 2.6 items.

Run the Visual Ralph verdict procedure after every visual iteration before the next edit. Any blocker returns ownership to the relevant Task 9~14 commit boundary, adds a regression test, and reruns that task plus the full affected gate. Do not mark Phase 2.6 complete with an unresolved blocker or unexplained skip.

- [ ] **Step 9: Update completion docs and run the final clean proof**

Only after all evidence is green, update `README.md`, `plan/04-roadmap.md`, and `plan/README.md` to mark Phase 2.6 implemented and link the canonical spec/evidence. Document:

- app-DB-only reset command and non-empty preflight behavior;
- four fixed ChoiceSets with administrator-provided options;
- manual provider boundary and deferred external PARTID source;
- Project Profile lock/edit behavior;
- stable option codes, inactive lifecycle, and decimal grammar;
- Phase 3 dependency now satisfied;
- explicit deferrals from spec §14.

Run final proof from repository root:

```bash
git diff --check
cd backend
uv run ruff check .
uv run pyright
APP_TEST_DATABASE_URL=postgresql+asyncpg://pcm_user:pcm_pass@localhost:15442/pcm_test \
APP_DATABASE_URL=postgresql+asyncpg://pcm_user:pcm_pass@localhost:15442/pcm_test \
  uv run pytest -q
cd ../frontend
npm run lint
npm run typecheck
npm test
npm run build
cd ..
docker compose -p pcm-phase26-qa exec -T app-db \
  psql -U pcm_user -d pcm -tAc 'SELECT count(*) FROM edit_lock' | grep -qx '0'
if [[ -f /tmp/pcm-phase26-dist.pid ]] && kill -0 "$(cat /tmp/pcm-phase26-dist.pid)" 2>/dev/null; then
  kill "$(cat /tmp/pcm-phase26-dist.pid)"
fi
rm -f /tmp/pcm-phase26-dist.pid
rm -rf /tmp/pcm-phase26-playwright
APP_DB_PORT=15432 INGEST_DB_PORT=15433 BACKEND_PORT=18000 FRONTEND_PORT=15173 \
  docker compose -p pcm-phase26-qa down -v
docker rm -f pcm-phase26-test-db >/dev/null 2>&1 || true
git status --short
```

Expected: every gate passes, evidence contains no blocker, the named QA/test containers and `pcm-phase26-qa_*` volumes are gone, default Compose volumes still exist unchanged, and only intentional scripts/docs/evidence changes remain.

- [ ] **Step 10: Commit completion evidence**

```bash
git add scripts/qa docs/superpowers/evidence/phase-2-6 \
  docs/superpowers/evidence/2026-07-14-phase-2-6-browser-qa.md \
  README.md plan/04-roadmap.md plan/README.md \
  docs/superpowers/evidence/visual/2026-07-14-phase-2-6-task-{09..14}.json
git commit -F - <<'MSG'
Prove Phase 2.6 is safe to hand to choice validation

Migration, concurrency, Project/Profile, Choice administration, and sheet behavior now have reproducible full-stack evidence across the approved viewport and accessibility matrix.

Constraint: Completion requires a clean disposable schema and blocker-free browser evidence
Rejected: Mark complete after unit tests | canvas focus, lock loss, pagination races, and responsive collapse require runtime proof
Confidence: high
Scope-risk: broad
Directive: Keep the external metadata source and approved snapshot persistence deferred to their own designs
Tested: Full backend/frontend gates, PostgreSQL migration/concurrency, performance, isolated browser QA, accessibility, and visual verdict
MSG
```

## Specification Coverage Matrix

| Approved contract | Implementation task | Proof gate |
|---|---:|---|
| Decimal grammar and golden vectors across languages | 1, 3, 6, 11, 13, 14 | Python/TS vectors plus edit/paste browser matrix |
| Fixed Profile schema, provider copy-once precedence, Process snapshot | 5, 6 | provider/project/Profile API tests and create audit evidence |
| Project create/list/detail and lock-fenced atomic edit | 6, 12, 13 | API, reducer/view-model, lock race, and browser Project matrix |
| Reusable versioned ChoiceSet, lifecycle, CSV, conflict | 2, 8, 9, 10 | domain/API/PG/frontend tests and two-admin browser matrix |
| Parameter ChoiceSet binding and no comma editor | 3, 11 | API/CSV/form/deletion scans and visual verdict |
| Snapshot v2 deterministic deduplication | 4 | pure snapshot byte-equivalence tests |
| Sheet code/version projection, inactive/raw handling, one fetch per set | 3, 8, 9, 14 | sheet/cell tests, performance seed, and network evidence |
| String-preserving decimal and shared edit/paste validation | 1, 3, 14 | cell batch, grid, paste, autosave race, and browser tests |
| Reset-only schema and operator safety | 7, 15 | actual PostgreSQL base/0003 paths, nine-table preflight, offline rejection |
| No Device Ref, no external provider, no approval persistence | all | source scans, design review, and documented deferrals |

## Execution Handoff

- Implement Tasks 1~15 in numeric order unless the dependency graph explicitly permits disjoint frontend work after Task 9.
- Keep Tasks 2~7 on one integration branch until Task 7 closes the complete backend cutover.
- Treat every task commit and its listed commands as a reviewer stop point; do not batch several red tasks into one review.
- Task 15 is serial and owns the final integration SHA, isolated environment, browser evidence, and completion documentation.
