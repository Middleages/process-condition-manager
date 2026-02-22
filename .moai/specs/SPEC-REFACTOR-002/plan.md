# SPEC-REFACTOR-002: Implementation Plan

- **SPEC ID**: SPEC-REFACTOR-002
- **Methodology**: DDD (ANALYZE-PRESERVE-IMPROVE)
- **Scope**: Frontend only (`frontend/src/`)

---

## Development Methodology

DDD (ANALYZE-PRESERVE-IMPROVE) 방식을 적용한다.

1. **ANALYZE**: 각 리팩토링 대상의 현재 동작과 의존 관계를 파악한다.
2. **PRESERVE**: 기존 동작을 보존하는 characterization test 또는 수동 테스트 시나리오를 준비한다.
3. **IMPROVE**: 코드를 개선하고, 기존 동작이 보존되었는지 검증한다.

---

## Milestone 1: Critical Issues (Primary Goal)

기존 동작에 잠재적 버그를 유발할 수 있는 즉시 수정 대상.

### Task 1.1: CRIT-001 - VersionHistory 소유권 통합

**ANALYZE**:
- `ConditionEditorPage.tsx`에서 `useVersionHistory(pid)` 호출 위치와 데이터 사용처 확인
- `EditorHeader.tsx`의 `VersionHistoryPanel` 렌더링 구조와 props 흐름 분석
- `useEditorNavigation.ts`의 `versionData` 의존성 범위 파악
- `VersionHistoryPanel.tsx` 내부의 `useVersionDiff` 호출 구조 확인

**PRESERVE**:
- 버전 히스토리 패널 열기/닫기 동작 확인
- 버전 간 diff 뷰 정상 작동 확인
- "현재 버전으로 돌아가기" 네비게이션 동작 확인

**IMPROVE**:
- `ConditionEditorPage`에서 `useVersionHistory(pid)` 제거
- `useEditorNavigation` 훅에서 `versionData` prop 제거, `handleBackToCurrent`를 `VersionHistoryPanel` 내부로 이동
- `EditorHeader`에서 `VersionHistoryPanel` 렌더링 유지 (자체 데이터 관리)
- `ConditionEditorPage`의 `versionData` 관련 코드 정리

**변경 파일**:
- `frontend/src/pages/ConditionEditorPage.tsx`
- `frontend/src/components/editor/EditorHeader.tsx`
- `frontend/src/hooks/useEditorNavigation.ts`
- `frontend/src/components/editor/VersionHistoryPanel.tsx`

### Task 1.2: CRIT-002 - eslint-disable 제거

**ANALYZE**:
- `useValidateProjectMutation()`의 참조 안정성 확인 (React Query 내부 구현)
- `setValidationErrors` Zustand selector의 참조 안정성 확인
- useEffect 실행 의도 파악 (초기 로드 시 1회 검증)

**PRESERVE**:
- 프로젝트 로드 시 자동 검증 실행 확인
- 검증 에러가 ValidationPanel에 정상 표시되는지 확인

**IMPROVE**:
- `useRef`로 `mutateAsync` 최신 참조 유지
- `setValidationErrors`를 dependency array에 추가
- `project`를 dependency array에 추가 (project 로드 완료 후 실행 보장)
- eslint-disable 주석 제거

**변경 파일**:
- `frontend/src/pages/ConditionEditorPage.tsx`

---

## Milestone 2: Major Issues (Secondary Goal)

코드 품질과 유지보수성에 직접적 영향을 주는 주요 개선 사항.

### Task 2.1: MAJ-001 - ConfirmDialog + useConfirm 생성 및 적용

**ANALYZE**:
- 6개 파일의 `window.confirm()` 사용 컨텍스트 분석
- 각 사용처의 확인 메시지, 동작, 에러 핸들링 패턴 파악
- 기존 UI 컴포넌트 (`@/components/ui/`) 패턴 참조

**PRESERVE**:
- 각 삭제/파괴적 동작의 확인-취소 흐름 보존
- 확인 후 실행되는 비즈니스 로직 동일하게 유지

**IMPROVE**:
- `@/components/ui/confirm-dialog.tsx` 컴포넌트 생성
- `@/hooks/useConfirm.ts` 훅 생성
- 6개 파일에서 `window.confirm()` -> `useConfirm` 교체:
  1. `ConditionEditorPage.tsx` (2건)
  2. `ExportSystemsPage.tsx`
  3. `ExportDataSourcesPage.tsx`
  4. `ExportMappingManager.tsx`
  5. `EquipmentPanel.tsx`
  6. `CommentThread.tsx`

**변경 파일**:
- `frontend/src/components/ui/confirm-dialog.tsx` (신규)
- `frontend/src/hooks/useConfirm.ts` (신규)
- 6개 소비 파일

### Task 2.2: MAJ-002 - useUserStore 레거시 브릿지 제거

**ANALYZE**:
- `useUserStore`를 import하는 9개 파일 목록 확인
- 각 파일에서 `useUserStore((s) => s.currentUserId)` 사용 패턴 확인
- `useAuthStore`의 user 객체 구조 확인

**PRESERVE**:
- 각 컴포넌트에서 currentUserId가 올바르게 제공되는지 확인
- 인증 후 사용자 ID 접근이 정상 동작하는지 확인

**IMPROVE**:
- 9개 파일의 import를 `useAuthStore`로 교체
- `useUserStore.ts` 파일 삭제
- `useUserStore.test.ts` 파일 삭제
- TypeScript 빌드 검증

**변경 파일**:
- `frontend/src/stores/useUserStore.ts` (삭제)
- `frontend/src/stores/__tests__/useUserStore.test.ts` (삭제)
- 9개 소비 파일 (import 교체)

### Task 2.3: MAJ-003 - setTimeout(fn, 0) 타이밍 해킹 제거

**ANALYZE**:
- `useEditorNavigation.ts:33,54`에서 setTimeout 사용 목적 (AG Grid 셀 포커싱 타이밍)
- `CommentPanel.tsx:61`에서 setTimeout 사용 목적 (코멘트 클릭 시 셀 이동)
- AG Grid API 중 `ensureColumnVisible`, `setFocusedCell` 사용 가능성 확인

**PRESERVE**:
- ValidationPanel 에러 클릭 시 해당 셀로 이동 동작
- ChangeHistory 항목 클릭 시 해당 셀로 이동 동작
- Comment 클릭 시 해당 셀로 이동 동작

**IMPROVE**:
- `setTimeout(fn, 0)` -> `requestAnimationFrame(fn)` 교체 (최소 변경)
- 또는 AG Grid `onModelUpdated` 이벤트 기반 구현 (근본적 해결)

**변경 파일**:
- `frontend/src/hooks/useEditorNavigation.ts`
- `frontend/src/components/editor/CommentPanel.tsx`

### Task 2.4: MAJ-005 - RecipeApplyRequest 타입 이동

**ANALYZE**:
- `types/admin.ts:81-96`의 Recipe 관련 인터페이스 3개 확인
- `types/index.ts`의 re-export 구조 확인
- 소비처 (`api/projects.ts`, `hooks/useProjects.ts`) import 경로 확인

**PRESERVE**:
- Recipe 적용 기능의 정상 동작

**IMPROVE**:
- `RecipeApplyRequest`, `RecipeApplyItem`, `RecipeApplyResponse`를 `types/project.ts`로 이동
- `types/admin.ts`에서 해당 인터페이스 제거
- `types/index.ts` re-export 경로 갱신
- `api/projects.ts`, `hooks/useProjects.ts` import 경로 갱신

**변경 파일**:
- `frontend/src/types/admin.ts`
- `frontend/src/types/project.ts`
- `frontend/src/types/index.ts`
- `frontend/src/api/projects.ts`
- `frontend/src/hooks/useProjects.ts`

### Task 2.5: MAJ-006 - conditional_required 검증 시 dirty cell 반영

**ANALYZE**:
- `validateCellValue` 함수의 `_rowConditions` 파라미터 사용처 분석
- `useEditorCellEdit.ts:59`에서 `layer.conditions` 전달 로직 확인
- dirty cell 저장 구조 (Zustand `dirtyCells` Map) 확인

**PRESERVE**:
- 단일 셀 편집 시 검증 동작 보존
- 서버 검증 결과와의 일관성 유지

**IMPROVE**:
- `useEditorCellEdit.ts`에서 `validateCellValue` 호출 전 dirty cell 머지 로직 추가
- dependent column 검증 시에도 동일하게 머지된 conditions 사용

**변경 파일**:
- `frontend/src/hooks/useEditorCellEdit.ts`

---

## Milestone 3: Consistency & Cleanup (Tertiary Goal)

코드 일관성과 부수적 개선.

### Task 3.1: CONSIST-001 - Admin 컴포넌트 named export 전환

**ANALYZE**:
- `export default function`을 사용하는 admin 컴포넌트 11개 목록화
- 각 컴포넌트의 import 소비처 확인 (pages, 다른 컴포넌트)

**IMPROVE**:
- 11개 컴포넌트의 `export default function` -> `export function` 변경
- 소비처의 `import ComponentName from ...` -> `import { ComponentName } from ...` 변경

**변경 파일**:
- 11개 admin 컴포넌트 파일
- 소비처 import 갱신

### Task 3.2: CONSIST-002 - setActiveLayerId 초기화 로직 개선

**IMPROVE**:
- `ConditionEditorPage.tsx`의 useEffect에 조건부 초기화 로직 추가

**변경 파일**:
- `frontend/src/pages/ConditionEditorPage.tsx`

### Task 3.3: CONSIST-003 - React Query 키 팩토리 일관성

**IMPROVE**:
- `projectKeys`에 `productRevisions`와 `versionDiff` 키 추가
- `useProductRevisions`, `useVersionDiff` 훅에서 팩토리 키 사용

**변경 파일**:
- `frontend/src/hooks/useProjects.ts`

### Task 3.4: CONSIST-004 - formatDate 유틸 통합

**IMPROVE**:
- `lib/utils.ts`에 `formatDate` 유틸 정의
- 5개 파일의 로컬 `formatDate` 제거 후 import로 교체

**변경 파일**:
- `frontend/src/lib/utils.ts` (추가 또는 수정)
- `frontend/src/pages/DashboardPage.tsx`
- `frontend/src/components/export/ExportHistoryPanel.tsx`
- `frontend/src/components/editor/VersionHistoryPanel.tsx`
- `frontend/src/components/editor/CommentThread.tsx`
- `frontend/src/components/editor/StatusTimeline.tsx`

---

## Architecture Impact

- 신규 파일: 2개 (`confirm-dialog.tsx`, `useConfirm.ts`)
- 삭제 파일: 2개 (`useUserStore.ts`, `useUserStore.test.ts`)
- 수정 파일: 약 25-30개 (대부분 import 경로 변경)
- 공통 인프라 변경 없음 (Backend, DB, Docker 변경 없음)

---

## Dependencies

| Task | Depends On | Reason |
|------|-----------|--------|
| Task 1.1 | None | 독립적 |
| Task 1.2 | None | 독립적 |
| Task 2.1 | None | 독립적 (신규 컴포넌트 생성) |
| Task 2.2 | None | 독립적 |
| Task 2.3 | None | 독립적 |
| Task 2.4 | None | 독립적 |
| Task 2.5 | None | 독립적 |
| Task 3.1 | None | 독립적 |
| Task 3.2 | Task 1.1과 동일 파일 (순서 주의) | ConditionEditorPage.tsx 동시 수정 |
| Task 3.3 | None | 독립적 |
| Task 3.4 | None | 독립적 |

---

## Risks & Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| ConfirmDialog 비동기 전환 시 UX 변경 | Low | Medium | Promise 패턴으로 기존 flow 유지 |
| useUserStore 제거 후 누락 참조 | Low | Low | TypeScript 컴파일러가 즉시 감지 |
| setTimeout 제거 후 AG Grid 포커싱 실패 | Medium | Medium | 개별 변경 후 수동 테스트, 실패 시 requestAnimationFrame으로 fallback |
| Admin export default 변경 시 import 누락 | Low | Low | TypeScript 빌드로 즉시 감지 |
| dirty cell 머지 시 검증 결과 변경 | Low | Low | 개선된 결과이므로 의도된 변경 |
