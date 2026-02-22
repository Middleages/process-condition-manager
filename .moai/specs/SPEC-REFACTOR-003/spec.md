# SPEC-REFACTOR-003: 코드 품질 개선 (Minor 통합)

## 메타데이터

| 항목 | 값 |
|------|-----|
| SPEC ID | SPEC-REFACTOR-003 |
| 제목 | 코드 품질 개선 (Minor 통합) |
| 상태 | Planned |
| 우선순위 | Low |
| 생성일 | 2026-02-21 |
| 선행 SPEC | 없음 (독립적 리팩토링) |
| Phase | Maintenance |

---

## 1. Environment (환경)

### 1.1 현재 시스템 상태

- **Phase 4 완료**: 인증/권한, Cross-layer 검증, 전산 출력 확장, 대시보드 모두 완료
- **SPEC-ADMIN-001 완료**: User CRUD, Enum 관리, Master Data 관리, Audit Log 조회
- **SPEC-EXPORT-002 완료**: 외부 데이터 소스 연동 Export Pipeline
- **코드 리뷰 수행**: 전체 코드베이스에 대한 품질 리뷰에서 11건의 Minor/Suggestion 발견사항 도출

### 1.2 발견 사항 요약

코드 리뷰에서 도출된 11건의 Minor 수준 개선 항목:

- **Backend (6건)**: 네이밍 불일치, HTTPException 호출 스타일 혼재, response_model 미정의, 이중 페이지네이션, 라우터 prefix 불일치, trailing slash
- **Frontend (5건)**: 인라인 스타일, 레이어 ID 리셋, 쿼리 키 불일치, 유틸 중복, 타입 중복
- **TypeScript/접근성 (4건)**: string 타입 강화, 접근성 속성 누락

### 1.3 기술 스택

- Backend: FastAPI + SQLAlchemy 2.x (async) + Pydantic v2
- Frontend: React 18 + TypeScript + Zustand + AG Grid Community
- 현재 HTTPException 위치형 인자 49건, 키워드 인자 57건 혼재 확인
- 서비스 함수명: `get_*` (단건/컬렉션 혼용), `list_*` (컬렉션), `fetch_*` (리포지토리) 혼재
- `formatDate` 함수: 5개 파일에서 독립적으로 중복 정의

---

## 2. Assumptions (가정)

| ID | 가정 | 신뢰도 | 근거 |
|----|------|--------|------|
| A1 | 모든 항목은 기존 동작을 변경하지 않는 순수 리팩토링이다 | High | 네이밍, 스타일, 타입 개선만 포함 |
| A2 | 접근성 속성 추가는 기존 UI 동작에 영향을 주지 않는다 | High | ARIA 속성은 스크린 리더용 보조 정보 |
| A3 | HTTPException 키워드 인자 전환은 런타임 동작이 동일하다 | High | FastAPI 공식 문서 확인, 위치/키워드 모두 동일 동작 |
| A4 | Export router prefix 변경 시 프론트엔드 API 호출도 함께 수정 필요하다 | Medium | 프론트엔드 API 클라이언트에서 경로 하드코딩 여부 확인 필요 |
| A5 | Comments router trailing slash 제거 시 기존 API 호출에 영향이 없다 | High | 프론트엔드는 trailing slash 없이 호출하고 있음 |

---

## 3. Requirements (요구사항)

### Milestone 1: Backend Naming & Consistency

#### REQ-R3-001: 서비스 함수 네이밍 표준화 (N-01)

**WHILE** 서비스 레이어에서 데이터 조회 함수가 존재할 때,

- 시스템은 **항상** 다음 네이밍 규칙을 따라야 한다:
  - `get_*`: 단일 엔티티 반환 (예: `get_project_detail`, `get_dashboard_overview`)
  - `list_*`: 컬렉션(목록) 반환 (예: `list_comments`, `list_users`)
  - Repository 메서드는 기존 `fetch_*` 패턴 유지
- 현재 `get_change_logs`, `get_projects_list`, `get_product_revisions` 등 컬렉션 반환 함수의 prefix를 `list_*`로 변경

**영향 범위:**
- `backend/app/services/change_log_service.py`: `get_change_logs` -> `list_change_logs`, `get_timeline` -> `list_timeline`, `get_cell_history` -> `get_cell_history` (단건이므로 유지)
- `backend/app/services/project_service.py`: `get_projects_list` -> `list_projects`, `get_product_revisions` -> `list_product_revisions`
- `backend/app/services/project_analytics_service.py`: `get_version_history` -> `list_version_history`
- `backend/app/services/export_service.py`: `get_systems` -> `list_systems`
- `backend/app/services/export_history_service.py`: `get_project_history` -> `list_project_history`, `get_all_history` -> `list_all_history`
- 각 서비스 함수를 호출하는 라우터도 함께 수정

#### REQ-R3-002: HTTPException 호출 스타일 통일 (C-05)

시스템은 **항상** `HTTPException(status_code=..., detail=...)` 키워드 인자 형식을 사용해야 한다.

- 위치형 인자 `HTTPException(404, "msg")` 패턴(약 49건)을 키워드 형식으로 전환
- 대상 파일: `routers/products.py`, `routers/project_lifecycle.py`, `services/change_log_service.py`, `services/condition_service.py`, `services/project_service.py`, `services/project_analytics_service.py`, `services/backbone_service.py`, `services/validation_service.py`, `services/recipe_service.py`, `services/admin_service.py`

#### REQ-R3-003: response_model 스키마 정의 (C-06)

**WHEN** `/api/admin/columns/{column_id}/validations` PUT 엔드포인트가 호출되면,

**THEN** `response_model=dict` 대신 적절한 Pydantic 응답 스키마를 반환해야 한다.

- 위치: `backend/app/routers/admin.py:113`
- `ValidationRulesReplaceResponse` 또는 유사 스키마를 정의하여 적용

#### REQ-R3-004: 페이지네이션 전략 통일 (API-01)

시스템은 **항상** 단일 페이지네이션 전략을 사용해야 한다.

- 위치: `backend/app/routers/project_conditions.py:43-62` (change-logs 엔드포인트)
- 현재 `offset` 파라미터와 `page` 파라미터가 동시에 존재
- `page` 기반 페이지네이션으로 통일하고 `offset` 파라미터를 제거
- 내부적으로 `offset = (page - 1) * limit`으로 계산

#### REQ-R3-005: Export router prefix 표준화 (API-02)

시스템은 **항상** APIRouter의 `prefix` 파라미터로 경로를 정의해야 한다.

- 현재: `router = APIRouter(tags=["export"])` + 각 엔드포인트에 `/api/export/...` 하드코딩
- 수정: `router = APIRouter(prefix="/api/export", tags=["export"])` + 엔드포인트에서 상대 경로 사용
- 프론트엔드 API 클라이언트의 호출 경로 영향 확인 및 수정

#### REQ-R3-006: Comments router trailing slash 제거 (API-03)

시스템은 Comments 라우터의 collection 엔드포인트에서 trailing slash를 사용**하지 않아야 한다**.

- 위치: `backend/app/routers/comments.py:19,31`
- `@router.post("/")` -> `@router.post("")`
- `@router.get("/")` -> `@router.get("")`
- 다른 라우터와의 일관성 확보

### Milestone 2: Frontend Minor Fixes

#### REQ-R3-007: 인라인 스타일 Tailwind 전환 (MIN-002)

시스템은 EditorHeader의 색상 표시 범례에서 인라인 `style` 대신 Tailwind 클래스를 사용**해야 한다**.

- 위치: `frontend/src/components/editor/EditorHeader.tsx:78,82,86,90`
- 4개의 인라인 `backgroundColor` 스타일을 Tailwind CSS 클래스로 교체
- `#fef9c3` -> `bg-yellow-100`, `#fecaca` -> `bg-red-200`, `#bbf7d0` -> `bg-green-200`, `#fef2f2 + border #fca5a5` -> `bg-red-50 border border-red-300`

#### REQ-R3-008: activeLayerId 리셋 방지 (MIN-003)

**WHEN** 프로젝트 데이터가 재조회(re-fetch)되면,

**THEN** 시스템은 `activeLayerId`가 이미 설정된 경우 첫 번째 레이어로 리셋**하지 않아야 한다**.

- 위치: `frontend/src/pages/ConditionEditorPage.tsx:154-158`
- 현재: `project` 변경 시마다 `setActiveLayerId(project.layers[0].layer_id)` 무조건 실행
- 수정: `activeLayerId`가 null이거나 현재 프로젝트 레이어 목록에 없는 경우에만 초기값 설정

#### REQ-R3-009: 쿼리 키 팩토리 통합 (MIN-006)

시스템은 **항상** `projectKeys` 팩토리를 통해 React Query 캐시 키를 관리해야 한다.

- `useProductRevisions`: `['product-revisions', productId]` -> `projectKeys.productRevisions(productId)`
- `useVersionDiff`: `['versionDiff', projectId, compareProjectId]` -> `projectKeys.versionDiff(projectId, compareProjectId)`
- `projectKeys` 객체에 `productRevisions`, `versionDiff` 키 추가

#### REQ-R3-010: formatDate 유틸리티 통합 (SUG-001)

시스템은 날짜 포맷팅에 **항상** 공유 유틸리티 함수를 사용해야 한다.

- 현재 5개 파일에서 독립적으로 `formatDate` 정의:
  - `ExportHistoryPanel.tsx`
  - `DashboardPage.tsx`
  - `StatusTimeline.tsx`
  - `VersionHistoryPanel.tsx`
  - `CommentThread.tsx`
- `frontend/src/lib/utils.ts`에 공용 `formatDate` 함수 추출
- 5개 파일에서 로컬 정의 제거하고 import로 교체

#### REQ-R3-011: AuthUser 타입 통합 (SUG-002)

시스템은 **항상** 사용자 타입을 단일 소스에서 관리해야 한다.

- 현재: `stores/useAuthStore.ts`에 `AuthUser { id, username, display_name, role: string }` 별도 정의
- 현재: `types/user.ts`에 `User { id, username, display_name, role: 'editor'|'reviewer'|'admin', is_active }` 정의
- 수정: `AuthUser`를 `Pick<User, 'id' | 'username' | 'display_name' | 'role'>` 또는 `User` 직접 사용으로 변경
- `AuthUser.role`이 `string`에서 리터럴 유니온 타입으로 강화되는 부수 효과

### Milestone 3: TypeScript & Accessibility

#### REQ-R3-012: TypeScript 타입 강화

시스템은 다음 타입을 **항상** 구체적인 리터럴/유니온 타입으로 정의해야 한다:

- **ValidationError.rule_type**: `string` -> `'required' | 'min' | 'max' | 'pattern' | 'enum' | 'custom' | 'cross_layer'` 등 실제 사용되는 rule_type 리터럴 유니온
  - 위치: `frontend/src/types/project.ts:106`
- **EditorState.activeCategory**: `string` (주석: `"SP" | "SC" | "OVL" | "DEV"`) -> `CategoryCode` 타입으로 교체
  - 위치: `frontend/src/stores/useEditorStore.ts:10`
  - `CategoryCode` 타입을 `types/column.ts` 또는 공용 위치에 정의하고 재사용
  - 현재 `admin/ValidationRulesPage.tsx`에 로컬 정의된 `CategoryCode`를 공유 타입으로 이동
- **ProjectLayerData.conditions**: `Record<string, unknown>` 타입에 대한 타입 가드 헬퍼 함수 제공
  - 위치: `frontend/src/types/project.ts:12-13`
  - `isConditionValue(value: unknown): value is string | number | null` 유틸 제공

#### REQ-R3-013: 접근성(Accessibility) 개선

시스템은 **항상** 적절한 ARIA 속성과 키보드 접근성을 제공해야 한다:

- **AG Grid 조건표**: `aria-label="공정조건 데이터 테이블"` 추가
  - ConditionGrid 컴포넌트의 AG Grid 래퍼에 적용
- **Dashboard 클릭 가능 div**: `role="button"`, `tabIndex={0}`, `onKeyDown` (Enter/Space) 추가
  - DashboardPage의 프로젝트 카드, 검토 대기 항목 등
- **ProjectListPage 상태 필터**: `aria-pressed` 속성 추가
  - 현재 활성화된 필터 버튼에 `aria-pressed="true"` 적용
- **GridContextMenu**: `role="menu"`, 메뉴 항목에 `role="menuitem"` 추가
  - `frontend/src/components/editor/GridContextMenu.tsx`

---

## 4. Specifications (상세 사양)

### 4.1 Milestone 1 구현 순서 (Backend)

1. **HTTPException 통일 (REQ-R3-002)**: 전체 파일 대상 일괄 치환, 리스크 최소
2. **Comments trailing slash 제거 (REQ-R3-006)**: 단순 문자열 변경
3. **Export router prefix 표준화 (REQ-R3-005)**: 라우터 prefix 추가 + 엔드포인트 경로 수정
4. **response_model 스키마 정의 (REQ-R3-003)**: Pydantic 스키마 1건 추가
5. **페이지네이션 통일 (REQ-R3-004)**: offset 파라미터 제거 + 내부 계산 변경
6. **서비스 네이밍 표준화 (REQ-R3-001)**: 함수명 변경 + 호출부 수정 (영향 범위 넓음, 마지막)

### 4.2 Milestone 2 구현 순서 (Frontend)

1. **formatDate 유틸리티 통합 (REQ-R3-010)**: 공용 함수 생성 후 5개 파일 교체
2. **인라인 스타일 전환 (REQ-R3-007)**: Tailwind 클래스 매핑 단순 교체
3. **activeLayerId 리셋 방지 (REQ-R3-008)**: 조건문 추가
4. **쿼리 키 팩토리 통합 (REQ-R3-009)**: projectKeys 확장 + 2개 훅 수정
5. **AuthUser 타입 통합 (REQ-R3-011)**: 타입 참조 변경

### 4.3 Milestone 3 구현 순서 (TypeScript/Accessibility)

1. **CategoryCode 공유 타입 정의**: types/column.ts에 추가
2. **ValidationError.rule_type 리터럴 유니온**: types/project.ts 수정
3. **EditorState.activeCategory 타입 강화**: useEditorStore.ts 수정
4. **conditions 타입 가드**: lib/utils.ts에 헬퍼 추가
5. **접근성 속성 추가**: GridContextMenu, DashboardPage, ProjectListPage, ConditionGrid 순서

### 4.4 Risk & Mitigation

| 리스크 | 영향도 | 완화 전략 |
|--------|--------|----------|
| 서비스 함수명 변경 시 호출부 누락 | Medium | IDE 리팩토링 또는 grep 기반 전수 검색, TypeScript 컴파일 오류 확인 |
| Export router prefix 변경 시 API 경로 불일치 | Medium | 프론트엔드 API 클라이언트 동시 수정, E2E 수동 확인 |
| 페이지네이션 파라미터 제거 시 기존 클라이언트 호환성 | Low | 프론트엔드만 사용하므로 동시 수정으로 해결 |
| Tailwind 클래스 매핑 오차 | Low | 브라우저에서 시각적 확인 |

---

## 5. Traceability

| 요구사항 | 코드 리뷰 항목 | Milestone | 파일 |
|----------|---------------|-----------|------|
| REQ-R3-001 | N-01 | M1 | services/*.py, routers/*.py |
| REQ-R3-002 | C-05 | M1 | routers/*.py, services/*.py (10 files, ~49 occurrences) |
| REQ-R3-003 | C-06 | M1 | routers/admin.py, schemas/ |
| REQ-R3-004 | API-01 | M1 | routers/project_conditions.py, services/change_log_service.py |
| REQ-R3-005 | API-02 | M1 | routers/export.py, frontend api client |
| REQ-R3-006 | API-03 | M1 | routers/comments.py |
| REQ-R3-007 | MIN-002 | M2 | components/editor/EditorHeader.tsx |
| REQ-R3-008 | MIN-003 | M2 | pages/ConditionEditorPage.tsx |
| REQ-R3-009 | MIN-006 | M2 | hooks/useProjects.ts |
| REQ-R3-010 | SUG-001 | M2 | lib/utils.ts + 5 consumer files |
| REQ-R3-011 | SUG-002 | M2 | stores/useAuthStore.ts, types/user.ts |
| REQ-R3-012 | TypeScript | M3 | types/project.ts, stores/useEditorStore.ts, types/column.ts |
| REQ-R3-013 | Accessibility | M3 | GridContextMenu, DashboardPage, ProjectListPage, ConditionGrid |
