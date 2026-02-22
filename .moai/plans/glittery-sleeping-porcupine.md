# Critical Issues Fix Plan

## Context

SPEC-REFACTOR-003 완료 후 전체 코드 리뷰에서 도출된 Critical 이슈 수정.
조사 결과 C-03(App.tsx useEffect)은 의도적 설계로 확인되어 제외, 나머지 3건 수정.

## Issues

### C-01: N+1 Query in recipe_service.py (Critical)

**Problem**: `parse_recipe_xml()` 루프 내에서 매핑당 ColumnDefinition 개별 쿼리
- Line 139-144: 초기 JOIN이 category 관계를 로드하지 않음
- Line 206-212: 루프 내에서 같은 ColumnDefinition을 category와 함께 재쿼리
- N개 매핑 → N+1 쿼리

**Fix**:
- `backend/app/services/recipe_service.py`
- 초기 쿼리에 `.options(selectinload(ColumnDefinition.category))` 추가
- 루프 내 개별 쿼리(lines 206-212) 제거
- `col_def.category` 직접 참조로 변경

### C-02: Stale Closure in useAutoSave.ts (Medium-High)

**Problem**: `addToast`가 훅 최상위에서 `getState()`로 캡처되어 stale 참조
- Line 18: `const addToast = useToastStore.getState().addToast`
- 콜백 내부가 아닌 외부에서 호출 → stale reference

**Fix**:
- `frontend/src/hooks/useAutoSave.ts`
- Line 18의 top-level `addToast` 변수 제거
- 콜백 내부에서 `useToastStore.getState().addToast(...)` 직접 호출
- `useCallback` 의존성 배열에서 `addToast` 제거

### C-04: StatusTransitionRequest API Contract Mismatch (Critical)

**Problem**: Frontend `changed_by` 필드를 전송하지만 Backend 스키마에 없고 무시됨
- Frontend: `{ new_status, changed_by, comment }` 전송
- Backend schema: `{ new_status, comment }` 만 정의
- Backend router: JWT `current_user`를 사용, `changed_by` 무시

**Fix** (Option B - Backend JWT 기반 유지):
- `frontend/src/types/project.ts`: `changed_by` 필드 제거
- `frontend/src/components/editor/ReviewRequestModal.tsx`: `changed_by` 프로퍼티 제거
- `frontend/src/components/editor/ApprovalButtons.tsx`: `changed_by` 프로퍼티 제거 (2곳)

### C-03: App.tsx useEffect (의도적 설계 - 수정 불필요)

조사 결과 마운트 전용 세션 복원으로 의도적 설계 확인.
eslint-disable 주석 존재. fetchCurrentUser가 deps에 포함되면 무한 루프 위험.
수정하지 않음.

## Files to Modify

| File | Change |
|------|--------|
| `backend/app/services/recipe_service.py` | selectinload 추가, 루프 내 쿼리 제거 |
| `frontend/src/hooks/useAutoSave.ts` | stale closure 수정 |
| `frontend/src/types/project.ts` | StatusTransitionRequest에서 changed_by 제거 |
| `frontend/src/components/editor/ReviewRequestModal.tsx` | changed_by 전송 제거 |
| `frontend/src/components/editor/ApprovalButtons.tsx` | changed_by 전송 제거 (2곳) |

## Verification

1. Backend import: `cd backend && python -c "from app.main import app; print('OK')"`
2. TypeScript: `cd frontend && npx tsc --noEmit`
3. Grep: `grep -rn "changed_by" frontend/src/components/editor/` → ReviewRequestModal/ApprovalButtons에서 0건
4. Grep: `grep -n "cat_result" backend/app/services/recipe_service.py` → 0건 (개별 쿼리 제거 확인)
