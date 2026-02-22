# SPEC-REFACTOR-003: 구현 계획

## 메타데이터

| 항목 | 값 |
|------|-----|
| SPEC ID | SPEC-REFACTOR-003 |
| 제목 | 코드 품질 개선 (Minor 통합) |
| 접근 방식 | DDD (ANALYZE-PRESERVE-IMPROVE) |
| 위험도 | Low |

---

## Milestone 1: Backend Naming & Consistency

**우선순위: Primary Goal**

### 태스크 목록

#### T1-1: HTTPException 키워드 인자 통일 (REQ-R3-002)

- [ ] `backend/app/routers/products.py` - 위치형 1건 -> 키워드 형식 전환
- [ ] `backend/app/routers/project_lifecycle.py` - 위치형 1건 -> 키워드 형식 전환
- [ ] `backend/app/services/change_log_service.py` - 위치형 4건 -> 키워드 형식 전환
- [ ] `backend/app/services/condition_service.py` - 위치형 4건 -> 키워드 형식 전환
- [ ] `backend/app/services/project_service.py` - 위치형 9건 -> 키워드 형식 전환
- [ ] `backend/app/services/project_analytics_service.py` - 위치형 2건 -> 키워드 형식 전환
- [ ] `backend/app/services/backbone_service.py` - 위치형 14건 -> 키워드 형식 전환
- [ ] `backend/app/services/validation_service.py` - 위치형 1건 -> 키워드 형식 전환
- [ ] `backend/app/services/recipe_service.py` - 위치형 5건 -> 키워드 형식 전환
- [ ] `backend/app/services/admin_service.py` - 위치형 8건 -> 키워드 형식 전환
- 변환 패턴: `HTTPException(404, "msg")` -> `HTTPException(status_code=404, detail="msg")`

#### T1-2: Comments router trailing slash 제거 (REQ-R3-006)

- [ ] `backend/app/routers/comments.py:19` - `@router.post("/")` -> `@router.post("")`
- [ ] `backend/app/routers/comments.py:31` - `@router.get("/")` -> `@router.get("")`

#### T1-3: Export router prefix 표준화 (REQ-R3-005)

- [ ] `backend/app/routers/export.py:25` - `APIRouter(tags=["export"])` -> `APIRouter(prefix="/api/export", tags=["export"])`
- [ ] 모든 `@router.get("/api/export/...")` -> `@router.get("/...")` (상대 경로)로 수정
- [ ] `@router.get("/api/projects/...")` 패턴 확인 후 필요 시 별도 라우터 분리 또는 prefix 조정
- [ ] 프론트엔드 API 클라이언트 경로 영향 확인

#### T1-4: response_model 스키마 정의 (REQ-R3-003)

- [ ] `backend/app/schemas/` 에 `ValidationRulesReplaceResponse` Pydantic 모델 정의
  - 필드: `column_id: int`, `validation_count: int`, `message: str`
- [ ] `backend/app/routers/admin.py:113` - `response_model=dict` -> `response_model=ValidationRulesReplaceResponse`
- [ ] 서비스 반환값이 새 스키마와 호환되는지 확인

#### T1-5: 페이지네이션 통일 (REQ-R3-004)

- [ ] `backend/app/routers/project_conditions.py:49` - `offset` Query 파라미터 제거
- [ ] `backend/app/routers/project_conditions.py:54` - `page` 파라미터만 유지
- [ ] `backend/app/services/change_log_service.py` - `offset` 인자 제거, `page`와 `limit`으로 내부 offset 계산
- [ ] 라우터에서 서비스 호출 시 `offset` 인자 제거

#### T1-6: 서비스 함수 네이밍 표준화 (REQ-R3-001)

- [ ] `change_log_service.py`: `get_change_logs` -> `list_change_logs`
- [ ] `change_log_service.py`: `get_timeline` -> `list_timeline`
- [ ] `project_service.py`: `get_projects_list` -> `list_projects`
- [ ] `project_service.py`: `get_product_revisions` -> `list_product_revisions`
- [ ] `project_analytics_service.py`: `get_version_history` -> `list_version_history`
- [ ] `export_service.py`: `get_systems` -> `list_systems`
- [ ] `export_history_service.py`: `get_project_history` -> `list_project_history`
- [ ] `export_history_service.py`: `get_all_history` -> `list_all_history`
- [ ] 각 함수를 호출하는 라우터 파일 동기 수정
- 주의: `get_project_detail`, `get_dashboard_overview`, `get_cell_history` 등 단건 반환 함수는 `get_*` 유지

---

## Milestone 2: Frontend Minor Fixes

**우선순위: Secondary Goal**

### 태스크 목록

#### T2-1: formatDate 유틸리티 통합 (REQ-R3-010)

- [ ] `frontend/src/lib/utils.ts`에 공용 `formatDate(dateStr: string | null): string` 함수 작성
  - null 처리 포함 (DashboardPage 버전이 null 허용)
  - ISO 8601 -> `YYYY-MM-DD HH:mm` 형식 반환
- [ ] `ExportHistoryPanel.tsx` - 로컬 formatDate 제거, import로 교체
- [ ] `DashboardPage.tsx` - 로컬 formatDate 제거, import로 교체
- [ ] `StatusTimeline.tsx` - 로컬 formatDate 제거, import로 교체
- [ ] `VersionHistoryPanel.tsx` - 로컬 formatDate 제거, import로 교체
- [ ] `CommentThread.tsx` - 로컬 formatDate 제거, import로 교체

#### T2-2: 인라인 스타일 Tailwind 전환 (REQ-R3-007)

- [ ] `EditorHeader.tsx:78` - `style={{ backgroundColor: '#fef9c3' }}` -> `className="... bg-yellow-100"`
- [ ] `EditorHeader.tsx:82` - `style={{ backgroundColor: '#fecaca' }}` -> `className="... bg-red-200"`
- [ ] `EditorHeader.tsx:86` - `style={{ backgroundColor: '#bbf7d0' }}` -> `className="... bg-green-200"`
- [ ] `EditorHeader.tsx:90` - `style={{ backgroundColor: '#fef2f2', border: '1px solid #fca5a5' }}` -> `className="... bg-red-50 border border-red-300"`

#### T2-3: activeLayerId 리셋 방지 (REQ-R3-008)

- [ ] `ConditionEditorPage.tsx:154-158` useEffect 수정:
  ```
  // Before:
  if (project?.layers.length) {
    setActiveLayerId(project.layers[0].layer_id)
  }

  // After:
  if (project?.layers.length) {
    const currentLayerExists = project.layers.some(l => l.layer_id === activeLayerId)
    if (!activeLayerId || !currentLayerExists) {
      setActiveLayerId(project.layers[0].layer_id)
    }
  }
  ```
- [ ] useEditorStore에서 `activeLayerId` 상태를 deps로 추가하지 않도록 ref 패턴 고려

#### T2-4: 쿼리 키 팩토리 통합 (REQ-R3-009)

- [ ] `hooks/useProjects.ts`의 `projectKeys` 객체에 추가:
  - `productRevisions: (productId: number) => [...projectKeys.all, 'product-revisions', productId] as const`
  - `versionDiff: (projectId: number, compareProjectId: number) => [...projectKeys.all, 'versionDiff', projectId, compareProjectId] as const`
- [ ] `useProductRevisions` 훅: `queryKey: ['product-revisions', productId]` -> `queryKey: projectKeys.productRevisions(productId!)`
- [ ] `useVersionDiff` 훅: `queryKey: ['versionDiff', ...]` -> `queryKey: projectKeys.versionDiff(...)`

#### T2-5: AuthUser 타입 통합 (REQ-R3-011)

- [ ] `stores/useAuthStore.ts`에서 `AuthUser` 인터페이스 정의 제거
- [ ] `types/user.ts`에서 export: `export type AuthUser = Pick<User, 'id' | 'username' | 'display_name' | 'role'>`
- [ ] `useAuthStore.ts`에서 `import { AuthUser } from '@/types/user'` 추가
- [ ] AuthUser 사용처 컴파일 오류 확인 (`role`이 `string` -> 리터럴 유니온으로 강화됨)

---

## Milestone 3: TypeScript & Accessibility

**우선순위: Final Goal**

### 태스크 목록

#### T3-1: CategoryCode 공유 타입 정의 (REQ-R3-012)

- [ ] `frontend/src/types/column.ts`에 `export type CategoryCode = 'SP' | 'SC' | 'OVL' | 'DEV'` 추가
- [ ] `types/index.ts` re-export hub에 CategoryCode 추가
- [ ] `admin/ValidationRulesPage.tsx`의 로컬 `CategoryCode` 정의 제거, import로 교체
- [ ] `stores/useEditorStore.ts`의 `activeCategory: string` -> `activeCategory: CategoryCode`
- [ ] `setActiveCategory` 시그니처도 함께 타입 강화

#### T3-2: ValidationError.rule_type 리터럴 유니온 (REQ-R3-012)

- [ ] Backend `constants.py`에서 실제 rule_type 값 목록 확인
- [ ] `frontend/src/types/project.ts:106` - `rule_type: string` -> `rule_type: RuleType`
- [ ] `RuleType` 리터럴 유니온 정의 (예: `'required' | 'min' | 'max' | 'pattern' | 'enum' | 'custom' | 'reference_exists' | 'compare_layers' | 'equipment_compatibility'`)

#### T3-3: conditions 타입 가드 (REQ-R3-012)

- [ ] `frontend/src/lib/utils.ts`에 타입 가드 헬퍼 추가:
  - `isConditionValue(value: unknown): value is string | number | null`
  - `getConditionValue(conditions: Record<string, unknown>, key: string): string | number | null`
- [ ] 사용 가이드 JSDoc 주석 추가

#### T3-4: 접근성 속성 추가 (REQ-R3-013)

- [ ] `GridContextMenu.tsx` - 메뉴 컨테이너에 `role="menu"`, 각 항목에 `role="menuitem"` 추가
- [ ] `DashboardPage.tsx` - 클릭 가능한 div에 `role="button"`, `tabIndex={0}`, `onKeyDown` 핸들러 추가
- [ ] `ProjectListPage.tsx` - 상태 필터 버튼에 `aria-pressed` 속성 추가
- [ ] `ConditionGrid.tsx` 또는 AG Grid wrapper - `aria-label="공정조건 데이터 테이블"` 추가

---

## 기술적 접근 방식

### DDD 방법론 적용

이 SPEC은 순수 리팩토링이므로 DDD의 PRESERVE 단계가 핵심이다:

1. **ANALYZE**: 각 변경 대상의 현재 동작과 호출 관계 파악
2. **PRESERVE**: 기존 동작이 유지되는지 확인 (기존 테스트 통과 + 컴파일 성공)
3. **IMPROVE**: 네이밍, 스타일, 타입 일관성 개선 적용

### 변경 검증 전략

- **Backend**: `ruff check`, `mypy` (있는 경우), 기존 pytest 통과 확인
- **Frontend**: `tsc --noEmit` TypeScript 컴파일 확인, 기존 Vitest 통과 확인
- **시각적 확인**: Tailwind 클래스 전환 후 브라우저에서 색상 일치 확인
- **접근성 확인**: 스크린 리더 시뮬레이션 또는 브라우저 접근성 검사 도구 활용

### 구현 원칙

- 한 Milestone 내에서도 가능한 한 작은 단위로 커밋
- 각 태스크 완료 후 기존 테스트 실행하여 regression 없음 확인
- 네이밍 변경(REQ-R3-001)은 마지막에 수행 (영향 범위가 가장 넓으므로)
- 프론트엔드/백엔드 동시 수정이 필요한 항목(REQ-R3-005)은 한 번에 처리
