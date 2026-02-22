# SPEC-REFACTOR-002: Acceptance Criteria

- **SPEC ID**: SPEC-REFACTOR-002
- **Methodology**: DDD (behavior preservation)

---

## Quality Gates

- [x] TypeScript 빌드 에러 0건 (`npm run build` 통과)
- [x] 기존 테스트 전체 통과 (`npm run test`)
- [x] ESLint 경고 감소 (eslint-disable 제거 반영)
- [x] `window.confirm` / `window.alert` 사용 0건
- [x] `useUserStore` import 0건
- [x] 프론트엔드 전체 `export default` 사용 admin 컴포넌트 0건

---

## Milestone 1: Critical Issues

### AC-1.1: CRIT-001 - VersionHistory 소유권 통합

**Given** ConditionEditorPage가 프로젝트 편집 화면을 로드할 때
**When** 버전 히스토리 버튼을 클릭하면
**Then** VersionHistoryPanel이 열리고 버전 목록이 표시된다

**Given** VersionHistoryPanel이 열려 있을 때
**When** 두 버전을 선택하여 diff를 요청하면
**Then** 버전 간 diff가 정상적으로 표시된다

**Given** Archived 버전을 보고 있을 때
**When** "현재 버전으로 돌아가기" 버튼을 클릭하면
**Then** 최신 프로젝트 편집 화면으로 네비게이션된다

**Verification**:
- `ConditionEditorPage`에서 `useVersionHistory(pid)` 호출이 존재하지 않는다
- `useEditorNavigation` 훅에 `versionData` props가 존재하지 않는다
- `VersionHistoryPanel` 내부에서 자체적으로 데이터를 관리한다

### AC-1.2: CRIT-002 - eslint-disable 제거

**Given** ConditionEditorPage가 프로젝트를 로드할 때
**When** 프로젝트 데이터가 fetch 완료되면
**Then** 서버 검증이 자동 실행되고 ValidationPanel에 에러가 표시된다

**Given** 프로젝트가 로드된 상태에서
**When** 다른 프로젝트로 네비게이션하면
**Then** 새 프로젝트에 대한 검증이 다시 실행된다

**Verification**:
- `ConditionEditorPage.tsx`에 `eslint-disable` 주석이 0건이다
- `useEffect` dependency array가 ESLint `react-hooks/exhaustive-deps` 규칙을 통과한다

---

## Milestone 2: Major Issues

### AC-2.1: MAJ-001 - ConfirmDialog + useConfirm

**Given** 사용자가 레이어 삭제 버튼을 클릭할 때
**When** ConfirmDialog가 표시되면
**Then** 프로젝트 스타일에 맞는 커스텀 모달이 나타나고, "확인"/"취소" 버튼이 있다

**Given** ConfirmDialog에서 "확인"을 클릭할 때
**When** 삭제 동작이 실행되면
**Then** 기존 `window.confirm` 사용 시와 동일한 비즈니스 로직이 실행된다

**Given** ConfirmDialog에서 "취소"를 클릭할 때
**When** 모달이 닫히면
**Then** 삭제 동작이 실행되지 않는다

**Given** 파괴적 동작 (삭제 등)의 ConfirmDialog가 표시될 때
**When** variant가 `destructive`로 설정되면
**Then** 확인 버튼이 빨간색 계열로 표시되어 위험 동작임을 시각적으로 나타낸다

**Verification**:
- `frontend/src/` 전체에서 `window.confirm` 검색 결과 0건
- `frontend/src/` 전체에서 `window.alert` 검색 결과 0건
- `@/components/ui/confirm-dialog.tsx` 파일이 존재한다
- `@/hooks/useConfirm.ts` 파일이 존재한다
- 6개 소비 파일에서 `useConfirm` 훅을 import한다

### AC-2.2: MAJ-002 - useUserStore 레거시 브릿지 제거

**Given** JWT 인증된 사용자가 편집기 페이지에 접근할 때
**When** currentUserId가 필요한 컴포넌트가 렌더링되면
**Then** `useAuthStore`에서 직접 사용자 ID를 가져온다

**Given** 인증되지 않은 사용자가 접근할 때
**When** ProtectedRoute에 의해 리다이렉트되면
**Then** 기존과 동일하게 로그인 페이지로 이동한다

**Verification**:
- `frontend/src/stores/useUserStore.ts` 파일이 존재하지 않는다
- `frontend/src/stores/__tests__/useUserStore.test.ts` 파일이 존재하지 않는다
- `frontend/src/` 전체에서 `useUserStore` import가 0건이다 (테스트 포함)
- 모든 소비처에서 `useAuthStore`를 통해 user ID를 접근한다

### AC-2.3: MAJ-003 - setTimeout(fn, 0) 타이밍 해킹 제거

**Given** ValidationPanel에서 에러 항목을 클릭할 때
**When** 해당 셀이 다른 카테고리 탭에 있으면
**Then** 카테고리 탭이 전환되고 해당 셀이 포커싱된다

**Given** ChangeHistory에서 변경 항목을 클릭할 때
**When** 해당 셀로 네비게이션하면
**Then** 셀이 정확하게 포커싱된다 (setTimeout 없이)

**Given** CommentPanel에서 코멘트를 클릭할 때
**When** 해당 레이어/컬럼으로 이동하면
**Then** 셀이 정확하게 포커싱된다

**Verification**:
- `useEditorNavigation.ts`에서 `setTimeout` 사용 0건
- `CommentPanel.tsx`에서 `setTimeout` 사용 0건
- 셀 네비게이션 기능이 Chrome, Firefox, Edge에서 정상 동작한다

### AC-2.4: MAJ-005 - RecipeApplyRequest 타입 도메인 이동

**Given** Recipe XML 적용 기능을 사용할 때
**When** RecipeApplyRequest 타입이 필요하면
**Then** `types/project.ts`에서 import된다

**Verification**:
- `types/admin.ts`에 `RecipeApplyRequest`, `RecipeApplyItem`, `RecipeApplyResponse`가 존재하지 않는다
- `types/project.ts`에 해당 인터페이스 3개가 정의되어 있다
- `types/index.ts`의 re-export가 정상 작동한다
- TypeScript 빌드 에러 0건

### AC-2.5: MAJ-006 - conditional_required 검증 시 dirty cell 반영

**Given** 사용자가 조건 컬럼 A를 "Y"로 변경하고 (아직 저장 안 함)
**When** 컬럼 B가 A="Y"일 때 필수인 conditional_required 규칙이 있으면
**Then** 컬럼 B의 required 검증이 즉시 dirty 값 기준으로 실행된다

**Given** 사용자가 조건 컬럼 A를 "N"으로 변경하고 (아직 저장 안 함)
**When** 컬럼 B가 A="Y"일 때 필수인 conditional_required 규칙이 있으면
**Then** 컬럼 B의 required 에러가 즉시 해제된다

**Verification**:
- `useEditorCellEdit.ts`에서 `validateCellValue` 호출 시 dirty cell이 머지된 conditions가 전달된다
- 다중 셀 편집 시나리오에서 conditional_required 검증이 올바르게 동작한다

---

## Milestone 3: Consistency & Cleanup

### AC-3.1: CONSIST-001 - Admin 컴포넌트 named export 전환

**Verification**:
- `components/admin/` 디렉토리에서 `export default function` 사용 0건
- 모든 admin 컴포넌트가 `export function ComponentName` 패턴을 사용한다
- 소비처의 import가 `{ ComponentName }` 형태로 변경되었다
- TypeScript 빌드 에러 0건

### AC-3.2: CONSIST-002 - setActiveLayerId 초기화 로직 개선

**Given** 사용자가 3번째 레이어를 편집 중일 때
**When** 저장(Save) 버튼을 클릭하면
**Then** 저장 완료 후에도 3번째 레이어가 활성 상태로 유지된다

**Given** 프로젝트를 처음 로드할 때
**When** activeLayerId가 아직 설정되지 않았으면
**Then** 첫 번째 레이어가 활성화된다

**Given** 활성 레이어가 삭제된 후
**When** project 데이터가 갱신되면
**Then** 첫 번째 레이어로 폴백된다

**Verification**:
- 저장 후 `activeLayerId`가 `layers[0]`으로 리셋되지 않는다
- 프로젝트 초기 로드 시 첫 번째 레이어가 정상 선택된다

### AC-3.3: CONSIST-003 - React Query 키 팩토리 일관성

**Verification**:
- `useProjects.ts`에서 `queryKey` 값이 모두 `projectKeys` 팩토리를 통해 생성된다
- raw string array 키 (`['product-revisions', ...]`, `['versionDiff', ...]`) 사용 0건
- `projectKeys` 객체에 `productRevisions`와 `versionDiff` 키가 존재한다

### AC-3.4: CONSIST-004 - formatDate 유틸 통합

**Verification**:
- `lib/utils.ts`에 `formatDate` 함수가 정의되어 있다
- `frontend/src/` 전체에서 `function formatDate` 로컬 정의가 `lib/utils.ts`를 제외하고 0건이다
- 5개 소비 파일에서 `import { formatDate } from '@/lib/utils'`를 사용한다
- 날짜 포맷 출력이 기존과 동일하다

---

## Definition of Done

- [ ] TypeScript 빌드 에러 0건
- [ ] 기존 단위 테스트 전체 통과
- [ ] ESLint `react-hooks/exhaustive-deps` 관련 disable 주석 0건 (해당 파일 기준)
- [ ] `window.confirm` / `window.alert` 사용 0건
- [ ] `useUserStore` import 0건
- [ ] `setTimeout(fn, 0)` AG Grid 타이밍 해킹 0건 (대상 파일 기준)
- [ ] 코드 리뷰 완료
- [ ] 수동 UI 테스트: 주요 플로우 (편집, 저장, 삭제, 검증, 버전 히스토리, 코멘트) 정상 동작 확인
