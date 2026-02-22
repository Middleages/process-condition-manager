# SPEC-REFACTOR-002: Frontend Critical/Major Refactoring

- **SPEC ID**: SPEC-REFACTOR-002
- **Status**: Planned
- **Priority**: High
- **Created**: 2026-02-21
- **Lifecycle**: spec-first
- **Methodology**: DDD (ANALYZE-PRESERVE-IMPROVE)

---

## Overview

PCM 프론트엔드 코드 리뷰에서 발견된 Critical 2건, Major 6건의 코드 품질 이슈를 체계적으로 리팩토링한다.
DDD 방식으로 기존 동작을 보존하면서 코드 소유권 혼선, ESLint 억제, 브라우저 네이티브 다이얼로그,
레거시 스토어 브릿지, 타이밍 해킹, 타입 도메인 불일치, 스테일 검증, export 컨벤션 불일치를 해결한다.

**영향 범위**: 프론트엔드 전체 (`frontend/src/`)
**주요 의존성**: AG Grid Community, Zustand, React Query, React Router

---

## Environment

- React 18 + TypeScript + Vite
- AG Grid Community Edition
- Zustand (상태 관리)
- React Query / TanStack Query (서버 상태)
- 기존 `useToastStore`를 통한 알림 시스템 존재
- 기존 `useAuthStore`를 통한 JWT 인증 시스템 운영 중

---

## Assumptions

1. 모든 리팩토링은 기존 사용자 동작(UX)을 변경하지 않는다 (behavior preservation).
2. AG Grid Community API (`onFirstDataRendered`, `onColumnVisible`, `ensureColumnVisible` 등)를 활용 가능하다.
3. `useAuthStore`가 사용자 ID를 안정적으로 제공하며, `useUserStore` 제거 후에도 인증 흐름에 문제가 없다.
4. `window.confirm`을 사용하는 모든 위치에서 비동기 확인 다이얼로그로의 전환이 가능하다.
5. `ConfirmDialog` 컴포넌트는 프로젝트 기존 UI 컴포넌트 (`@/components/ui/`) 패턴을 따른다.

---

## Milestones

### Milestone 1: Critical Issues (Immediate Fix)

즉시 수정이 필요한 구조적 문제 2건.

### Milestone 2: Major Issues (Early Fix)

코드 품질과 유지보수성에 직접적 영향을 주는 주요 문제 5건.

### Milestone 3: Consistency & Cleanup

Export 컨벤션 통일과 부수적 개선 사항 정리.

---

## Requirements (EARS Format)

### M1: Critical Issues

#### CRIT-001: VersionHistory 상태/렌더링 소유권 통합

**문제 분석**:
- `ConditionEditorPage.tsx:49`에서 `useVersionHistory(pid)`로 `versionData`를 fetch한다.
- `ConditionEditorPage.tsx:61-62`에서 `isVersionHistoryOpen` / `toggleVersionHistory` 상태를 EditorStore에서 관리한다.
- `EditorHeader.tsx:135-140`에서 `VersionHistoryPanel`을 렌더링하며, 해당 패널 내부에서 `useVersionDiff`를 통해 `useVersionHistory`를 재호출한다.
- **부모(Page)가 상태를 소유하고, 자식(Header)이 UI를 렌더링하는 분리된 소유권 모델**이 혼선을 야기한다.

**WHEN** VersionHistory 기능이 사용될 때, **THEN** 상태 관리와 UI 렌더링은 단일 컴포넌트에서 소유해야 한다.

- [HARD] `VersionHistoryPanel`의 렌더링 위치를 `ConditionEditorPage`로 이동하거나, `EditorHeader`가 상태와 렌더링 모두를 소유하도록 통합한다.
  WHY: 상태와 렌더링의 분리 소유는 데이터 흐름 추적을 어렵게 하고 중복 fetch를 유발한다.
  IMPACT: 유지보수 시 상태 변경 추적에 2개 파일을 동시 확인해야 하며, 불필요한 API 호출이 발생한다.

- [HARD] `ConditionEditorPage`에서 `versionData`를 직접 fetch하지 않고, `VersionHistoryPanel`이 자체적으로 데이터를 관리하도록 캡슐화한다 (또는 반대 방향으로 통합).
  WHY: 동일 데이터에 대한 이중 fetch는 네트워크 낭비이며 캐시 불일치 가능성을 만든다.
  IMPACT: React Query 캐시가 동일 키를 공유하여 현재는 실제 중복 호출이 아니지만, 키가 변경되면 즉시 문제가 된다.

- [SOFT] `useEditorNavigation` 훅의 `versionData` 의존성을 제거하거나 필요 최소한으로 줄인다.
  WHY: navigation 훅이 version 데이터에 의존하는 것은 관심사 분리 위반이다.
  IMPACT: version 관련 변경이 navigation 로직에 불필요한 리렌더링을 유발한다.

#### CRIT-002: eslint-disable로 숨겨진 실제 의존성 누락

**문제 분석**:
- `ConditionEditorPage.tsx:163-171`에서 `validateMutation`과 `setValidationErrors`가 `useEffect` 클로저에 캡처되지만 dependency array에서 제외된다.
- `// eslint-disable-next-line react-hooks/exhaustive-deps`로 ESLint 경고를 억제한다.
- `validateMutation`은 `useValidateProjectMutation()` 반환값으로 매 렌더마다 새 참조가 생성될 수 있어 stale closure 위험이 있다.

**WHEN** React 컴포넌트가 useEffect를 사용할 때, **THEN** eslint-disable 없이 올바른 dependency array를 유지해야 한다.

- [HARD] `validateMutation.mutateAsync`를 `useCallback`으로 안정화하거나 `useRef`로 최신 참조를 유지하여 dependency array에 안전하게 포함한다.
  WHY: eslint-disable는 실제 stale closure 버그를 숨기며, mutation 객체의 참조 안정성이 보장되지 않는다.
  IMPACT: 향후 React Query 업데이트 시 mutation 참조 동작이 변경되면 silent bug가 발생한다.

- [HARD] `setValidationErrors`는 Zustand selector로 이미 안정적이므로 dependency array에 포함한다.
  WHY: Zustand의 selector 반환값은 참조 안정적이며, dependency에 포함해도 불필요한 재실행이 없다.
  IMPACT: 의존성 완전성이 보장되어 향후 ESLint 규칙 변경에도 안전하다.

- [HARD] `eslint-disable-next-line react-hooks/exhaustive-deps` 주석을 제거한다.
  WHY: ESLint 규칙 억제는 정당한 이유가 있을 때만 사용해야 하며, 여기서는 코드 수정으로 해결 가능하다.
  IMPACT: 코드 리뷰 시 eslint-disable가 존재하면 실제 문제를 간과하는 관행이 형성된다.

---

### M2: Major Issues

#### MAJ-001: window.confirm/alert을 재사용 가능한 ConfirmDialog로 대체

**문제 분석**:
- 현재 6개 파일에서 `window.confirm()` 사용이 확인됨:
  - `ConditionEditorPage.tsx` (2회: 레이어 삭제, 비저장 이탈)
  - `ExportSystemsPage.tsx` (시스템 삭제)
  - `ExportDataSourcesPage.tsx` (데이터 소스 삭제)
  - `ExportMappingManager.tsx` (매핑 삭제)
  - `EquipmentPanel.tsx` (설비 삭제)
  - `CommentThread.tsx` (댓글 삭제)
- 네이티브 브라우저 다이얼로그는 JS 스레드를 블로킹하고, 스타일링 불가하며, 자동화 테스트가 어렵다.
- 프로젝트에 이미 `useToastStore`를 통한 알림 패턴이 존재한다.

시스템은 **항상** 사용자 확인이 필요한 파괴적 동작에 대해 커스텀 ConfirmDialog를 사용해야 한다.

- [HARD] `ConfirmDialog` 컴포넌트를 `@/components/ui/confirm-dialog.tsx`에 생성한다.
  WHY: 네이티브 다이얼로그는 스타일링, 테스트, 접근성 측면에서 프로덕션 앱에 부적합하다.
  IMPACT: UI 일관성 훼손, E2E 테스트 작성 곤란, 사용자 경험 저하.

- [HARD] `useConfirm` 훅을 `@/hooks/useConfirm.ts`에 생성하여 Promise 기반 확인 패턴을 제공한다.
  WHY: 각 컴포넌트에서 모달 open/close 상태를 개별 관리하면 boilerplate가 증가한다.
  IMPACT: Promise 기반 패턴은 기존 `window.confirm`의 동기적 사용 패턴을 최소한의 변경으로 대체 가능하다.

- [HARD] 기존 `window.confirm()` 사용처 6개 파일 전부를 `useConfirm` 훅으로 교체한다.
  WHY: 일부만 교체하면 두 가지 패턴이 공존하여 일관성이 떨어진다.
  IMPACT: 전체 교체 시 코드 리뷰와 새 기능 개발에서 단일 패턴을 따를 수 있다.

#### MAJ-002: useUserStore 레거시 브릿지 제거

**문제 분석**:
- `useUserStore.ts`는 `useAuthStore`로의 backward compatibility 브릿지이다.
- getter + subscribe 패턴으로 동일한 값(`currentUserId`)에 대해 두 개의 메커니즘을 생성한다.
- 7개 컴포넌트에서 `useUserStore`를 import하고 있음:
  - `ConditionEditorPage.tsx`, `AdminLayout.tsx`, `RecipeUploadModal.tsx`, `CommentThread.tsx`, `ApprovalButtons.tsx`, `ReviewRequestModal.tsx`, `BackboneReplaceModal.tsx`, `LayerAddModal.tsx`, `ProjectCreateModal.tsx`
- 이미 마이그레이션 노트에서 "use useAuthStore directly"라고 명시되어 있다.

시스템은 사용자 ID에 대해 **항상** `useAuthStore`를 단일 진실 소스(single source of truth)로 사용해야 한다.

- [HARD] `useUserStore`를 import하는 모든 컴포넌트(9개 파일)에서 `useAuthStore.getState().user?.id` 또는 `useAuthStore((s) => s.user?.id)` 패턴으로 교체한다.
  WHY: 동일 값에 두 개의 접근 경로가 존재하면 데이터 동기화 타이밍 이슈가 발생할 수 있다.
  IMPACT: subscribe 기반 브릿지는 authStore 업데이트와 userStore 반영 사이에 1-tick 지연이 존재한다.

- [HARD] `useUserStore.ts` 파일과 관련 테스트 파일 (`useUserStore.test.ts`)을 삭제한다.
  WHY: 레거시 브릿지가 코드베이스에 남아 있으면 신규 개발자가 잘못된 패턴을 참조할 수 있다.
  IMPACT: 삭제하지 않으면 두 스토어 패턴이 영구적으로 공존한다.

#### MAJ-003: setTimeout(fn, 0) 타이밍 해킹 제거

**문제 분석**:
- `useEditorNavigation.ts:33,54`에서 `setTimeout(() => setActiveColumnName(...), 0)` 사용.
- `CommentPanel.tsx:61`에서 동일 패턴 사용.
- AG Grid DOM 렌더링 타이밍을 맞추기 위한 zero-delay timeout으로, microtask/macrotask 순서에 의존하는 불안정한 패턴이다.

**WHEN** AG Grid에서 셀 포커싱이 필요할 때, **THEN** AG Grid 내장 이벤트 또는 React의 `useEffect` 의존성 추적을 사용해야 한다.

- [HARD] `useEditorNavigation.ts`의 `setTimeout` 2건을 AG Grid API 또는 `requestAnimationFrame`으로 교체한다.
  WHY: `setTimeout(fn, 0)`은 브라우저 엔진 구현에 따라 실행 순서가 달라질 수 있다.
  IMPACT: 특정 브라우저 버전이나 저사양 기기에서 셀 포커싱이 실패할 수 있다.

- [HARD] `CommentPanel.tsx:61`의 `setTimeout` 1건을 동일 방식으로 교체한다.
  WHY: 동일 패턴은 동일 솔루션을 적용해야 일관성이 유지된다.
  IMPACT: 패턴이 혼재하면 유지보수 시 어떤 방식이 올바른지 판단하기 어렵다.

- [SOFT] AG Grid `gridApiRef`를 활용하여 `ensureColumnVisible` 같은 공식 API로 셀 네비게이션을 구현한다.
  WHY: AG Grid 공식 API는 내부 렌더링 사이클을 고려하여 안정적으로 동작한다.
  IMPACT: 공식 API 사용 시 AG Grid 버전 업그레이드에도 안전하다.

#### MAJ-005: RecipeApplyRequest 타입 도메인 불일치

**문제 분석**:
- `RecipeApplyRequest`, `RecipeApplyItem`, `RecipeApplyResponse`가 `types/admin.ts:81-96`에 정의되어 있다.
- 실제 소비처는 `api/projects.ts:16`, `hooks/useProjects.ts:27,161`로 project 도메인이다.
- admin 타입 파일에 project 도메인 타입이 존재하면 import 경로가 직관적이지 않다.

시스템은 **항상** 타입 정의를 해당 도메인 파일에 배치해야 한다.

- [HARD] `RecipeApplyRequest`, `RecipeApplyItem`, `RecipeApplyResponse` 3개 인터페이스를 `types/admin.ts`에서 `types/project.ts`로 이동한다.
  WHY: 타입의 도메인 소속과 파일 위치가 불일치하면 코드 탐색 시 혼란을 야기한다.
  IMPACT: 새 개발자가 Recipe 관련 타입을 찾을 때 project.ts가 아닌 admin.ts를 확인해야 한다.

- [HARD] import 경로를 업데이트한다 (`api/projects.ts`, `hooks/useProjects.ts`, `types/index.ts`).
  WHY: 타입 이동 후 import 경로를 갱신하지 않으면 빌드 에러가 발생한다.
  IMPACT: re-export hub(`types/index.ts`)도 함께 업데이트해야 외부 참조가 끊기지 않는다.

#### MAJ-006: conditional_required 검증 시 dirty cell 미반영

**문제 분석**:
- `lib/validation.ts:57-115`의 `validateCellValue` 함수는 세 번째 인자로 `_rowConditions`를 받는다.
- `hooks/useEditorCellEdit.ts:59`에서 `layer.conditions` (서버 커밋 값)을 `rowConditions`로 전달한다.
- 사용자가 A 컬럼을 수정하고 아직 저장하지 않은 상태에서 B 컬럼의 `conditional_required` 검증이 실행되면, A 컬럼의 dirty 값이 아닌 서버 값 기준으로 조건 판단이 이루어진다.

**IF** 사용자가 다중 필드를 편집 중일 때, **THEN** 클라이언트 검증은 dirty cell 값을 포함하여 조건부 필수 검증을 수행해야 한다.

- [HARD] `useEditorCellEdit`에서 `validateCellValue` 호출 시 `layer.conditions`에 해당 레이어의 dirty cell 값을 머지하여 전달한다.
  WHY: 서버 커밋 값만 참조하면 편집 중인 다른 셀의 변경이 검증에 반영되지 않는다.
  IMPACT: 사용자가 조건 컬럼을 변경한 직후 의존 컬럼의 required 상태가 즉시 갱신되지 않아 잘못된 에러 표시/미표시가 발생한다.

- [SOFT] dirty cell 머지 로직을 `validation.ts` 내부 유틸로 추출하여 재사용성을 높인다.
  WHY: 머지 로직이 훅에 인라인되면 테스트와 재사용이 어렵다.
  IMPACT: 별도 유틸로 분리하면 단위 테스트 작성이 용이하다.

---

### M3: Consistency & Cleanup

#### CONSIST-001: Export 컨벤션 통일 (named export)

**문제 분석**:
- `components/admin/` 디렉토리: `export default` 사용 (11개 컴포넌트)
- `components/editor/`, `components/export/` 디렉토리: `export function` (named export) 사용
- 두 가지 패턴이 혼재하면 import 시 자동완성 일관성이 떨어지고, tree-shaking 효율이 낮아진다.

시스템은 **항상** 컴포넌트 export에 named export 패턴을 사용해야 한다.

- [HARD] `components/admin/`의 `export default function` 11건을 `export function`으로 변경한다.
  WHY: default export는 import 시 이름을 자유롭게 바꿀 수 있어 일관성을 해친다.
  IMPACT: named export는 리팩토링 도구의 rename 지원이 더 정확하고, 검색이 용이하다.

- [HARD] 변경된 컴포넌트의 import 경로를 모든 소비처에서 갱신한다.
  WHY: `export default` -> `export function` 변경 시 import 구문도 `{ ComponentName }` 형태로 변경해야 한다.
  IMPACT: import 갱신 누락 시 빌드 에러 또는 런타임 에러가 발생한다.

#### CONSIST-002: setActiveLayerId 초기화 로직 개선 (MIN-003)

**문제 분석**:
- `ConditionEditorPage.tsx:154-158`에서 `[project, setActiveLayerId]`를 의존성으로 가지는 useEffect가 있다.
- 저장(save) 후 `project` 객체가 React Query 캐시 갱신으로 새 참조를 받으면, effect가 재실행되어 `layers[0]`으로 리셋된다.
- 사용자가 3번째 레이어를 편집 중 저장하면 1번째 레이어로 강제 이동하는 UX 문제 발생.

**WHEN** 프로젝트 데이터가 갱신될 때, **THEN** 현재 활성 레이어가 유효하면 유지하고, 유효하지 않을 때만 첫 번째 레이어로 폴백해야 한다.

- [HARD] useEffect 내에서 현재 `activeLayerId`가 `project.layers`에 존재하는지 확인 후, 존재하지 않을 때만 `layers[0]`으로 설정한다.
  WHY: 무조건 초기화는 사용자의 현재 작업 컨텍스트를 파괴한다.
  IMPACT: 편집 중 저장할 때마다 레이어가 리셋되면 사용성이 크게 저하된다.

#### CONSIST-003: React Query 키 팩토리 일관성 (MIN-006)

**문제 분석**:
- `useProjects.ts:183`에서 `useProductRevisions`는 `['product-revisions', productId]` 리터럴 키를 사용한다.
- `useProjects.ts:223`에서 `useVersionDiff`는 `['versionDiff', projectId, compareProjectId]` 리터럴 키를 사용한다.
- 동일 파일의 다른 훅들은 `projectKeys` 팩토리를 통해 키를 생성한다.

시스템은 **항상** React Query 키 생성 시 `projectKeys` 팩토리를 사용해야 한다.

- [HARD] `projectKeys` 팩토리에 `productRevisions`와 `versionDiff` 키를 추가한다.
  WHY: 팩토리 패턴 외부의 raw 키는 invalidation 시 누락되거나 오타가 발생할 수 있다.
  IMPACT: 캐시 무효화 로직에서 `projectKeys.all`을 사용해도 raw 키 훅은 무효화되지 않는다.

- [HARD] `useProductRevisions`와 `useVersionDiff`의 `queryKey`를 팩토리 키로 교체한다.

#### CONSIST-004: formatDate 유틸 중복 제거 (SUG-001)

**문제 분석**:
- 동일한 `formatDate` 함수가 5개 파일에 개별 정의되어 있음:
  - `DashboardPage.tsx:30`
  - `ExportHistoryPanel.tsx:10`
  - `VersionHistoryPanel.tsx:31`
  - `CommentThread.tsx:16`
  - `StatusTimeline.tsx:12`

시스템은 **항상** 공통 유틸리티 함수를 단일 소스에서 관리해야 한다.

- [HARD] `lib/utils.ts`에 `formatDate` 유틸리티 함수를 정의하고, 5개 파일에서 import로 교체한다.
  WHY: 동일 로직의 중복은 수정 시 누락 위험과 동작 불일치를 야기한다.
  IMPACT: 날짜 포맷 변경 시 5곳을 각각 수정해야 하며, 일부 파일에서 미세한 구현 차이가 존재할 수 있다.

---

## Technical Approach

### CRIT-001: VersionHistory 소유권 통합 전략

**권장 방향**: `VersionHistoryPanel`이 자체적으로 상태와 렌더링을 모두 소유하도록 캡슐화한다.

1. `ConditionEditorPage`에서 `useVersionHistory(pid)` 호출을 제거한다.
2. `isVersionHistoryOpen` / `toggleVersionHistory`는 EditorStore에 유지하되, 토글 버튼만 `EditorHeader`가 관리한다.
3. `VersionHistoryPanel` 내부에서 자체적으로 `useVersionHistory`를 호출하고 데이터를 관리한다.
4. `useEditorNavigation` 훅에서 `versionData` 의존성을 제거하고, `handleBackToCurrent`는 별도 훅이나 `VersionHistoryPanel` 내부로 이동한다.

### CRIT-002: eslint-disable 제거 전략

```tsx
// Before (문제)
const validateMutation = useValidateProjectMutation()
const setValidationErrors = useEditorStore((s) => s.setValidationErrors)
useEffect(() => {
  if (!pid || !project) return
  validateMutation.mutateAsync(pid).then(...)
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [pid])

// After (수정)
const validateMutation = useValidateProjectMutation()
const setValidationErrors = useEditorStore((s) => s.setValidationErrors)
const validateRef = useRef(validateMutation.mutateAsync)
validateRef.current = validateMutation.mutateAsync

useEffect(() => {
  if (!pid || !project) return
  validateRef.current(pid).then((validation) => {
    setValidationErrors(validation.errors)
  }).catch(() => {})
}, [pid, project, setValidationErrors])
```

**핵심**: `useRef`로 mutation의 최신 참조를 유지하면서, dependency array에는 안정적 참조만 포함한다.

### MAJ-001: ConfirmDialog 컴포넌트 API 설계

**ConfirmDialog Component (`@/components/ui/confirm-dialog.tsx`)**:

```tsx
interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmText?: string     // default: "확인"
  cancelText?: string      // default: "취소"
  variant?: 'default' | 'destructive'  // destructive: 빨간 확인 버튼
  onConfirm: () => void
  onCancel?: () => void
}
```

**useConfirm Hook (`@/hooks/useConfirm.ts`)**:

```tsx
interface UseConfirmOptions {
  title: string
  description: string
  confirmText?: string
  cancelText?: string
  variant?: 'default' | 'destructive'
}

interface UseConfirmReturn {
  confirm: () => Promise<boolean>  // true = 확인, false = 취소
  ConfirmDialogElement: React.ReactNode  // JSX에 렌더링
}

function useConfirm(options: UseConfirmOptions): UseConfirmReturn
```

**사용 예시**:
```tsx
function MyComponent() {
  const { confirm, ConfirmDialogElement } = useConfirm({
    title: '레이어 삭제',
    description: '이 레이어의 모든 조건 데이터가 삭제됩니다.',
    variant: 'destructive',
  })

  const handleDelete = async () => {
    if (await confirm()) {
      await deleteLayer()
    }
  }

  return (
    <>
      <button onClick={handleDelete}>삭제</button>
      {ConfirmDialogElement}
    </>
  )
}
```

### MAJ-002: useUserStore 마이그레이션 전략

1. 9개 소비 파일에서 `useUserStore` import를 `useAuthStore`로 교체한다.
2. `useUserStore((s) => s.currentUserId)` -> `useAuthStore((s) => s.user?.id ?? null)` 패턴으로 치환한다.
3. `stores/useUserStore.ts` 및 `stores/__tests__/useUserStore.test.ts` 삭제한다.
4. 프로젝트 전체 빌드 확인으로 누락 import를 검증한다.

### MAJ-003: setTimeout 대체 전략

- `requestAnimationFrame` 또는 AG Grid `onModelUpdated` 이벤트 활용.
- AG Grid `gridApiRef.current?.ensureColumnVisible(columnName)` 활용으로 DOM 타이밍 문제 회피.
- 최소 변경 원칙: `setTimeout(fn, 0)` -> `requestAnimationFrame(fn)`은 동작 동등하면서 의도가 명확.

### MAJ-006: Dirty Cell 머지 검증 전략

```tsx
// useEditorCellEdit.ts에서 dirty cell 머지
const dirtyCells = useEditorStore.getState().dirtyCells
const mergedConditions = { ...layer.conditions }
for (const [key, cell] of dirtyCells) {
  const [plId, colName] = key.split(':')
  if (Number(plId) === layer.id) {
    mergedConditions[colName] = cell.value
  }
}
const cellErrors = validateCellValue(newValue, colDef, mergedConditions)
```

---

## Constraints

- [HARD] 모든 리팩토링은 기존 사용자 동작을 변경하지 않아야 한다 (DDD behavior preservation).
- [HARD] 변경 전후 TypeScript 빌드 에러 0건을 유지해야 한다.
- [HARD] 기존 테스트가 존재하는 경우 모두 통과해야 한다.
- [SOFT] 각 Milestone은 독립적으로 배포 가능해야 한다.
- [SOFT] 변경 파일 수를 최소화하되 일관성을 우선한다.

---

## Risk Analysis

| Risk | Severity | Mitigation |
|------|----------|------------|
| MAJ-001 ConfirmDialog 전환 시 비동기 흐름 변경 | Medium | 기존 동기 `window.confirm` -> 비동기 `await confirm()` 전환 시 호출부 로직 검토 필수 |
| MAJ-002 useUserStore 제거 시 누락 참조 | Low | 빌드 타임 TypeScript 검증으로 확인 가능 |
| CRIT-001 VersionHistory 구조 변경 시 UI 깨짐 | Medium | 변경 전 수동 UI 테스트 시나리오 작성 |
| MAJ-003 setTimeout 제거 시 AG Grid 포커싱 실패 | Medium | 개별 변경 후 수동 셀 네비게이션 테스트 |
| MAJ-006 dirty cell 머지 시 성능 저하 | Low | dirty cell은 일반적으로 소수이므로 O(n) 머지 비용 무시 가능 |
