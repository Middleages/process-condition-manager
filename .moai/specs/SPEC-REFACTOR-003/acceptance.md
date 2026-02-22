# SPEC-REFACTOR-003: 인수 기준

## 메타데이터

| 항목 | 값 |
|------|-----|
| SPEC ID | SPEC-REFACTOR-003 |
| 제목 | 코드 품질 개선 (Minor 통합) |

---

## Milestone 1: Backend Naming & Consistency

### AC-001: 서비스 함수 네이밍 표준화

**Given** 백엔드 서비스 레이어가 존재할 때
**When** 컬렉션을 반환하는 서비스 함수를 검색하면
**Then** 모든 컬렉션 반환 함수는 `list_*` prefix를 사용한다
**And** 모든 단일 엔티티 반환 함수는 `get_*` prefix를 사용한다
**And** Repository 메서드는 `fetch_*` prefix를 유지한다
**And** 기존 모든 라우터에서 변경된 함수명으로 정상 호출된다

검증 방법:
- `grep -r "async def get_.*list\|async def get_.*logs\|async def get_.*history" backend/app/services/` 결과가 0건
- 서버 시작 시 import 오류 없음
- 기존 테스트 전체 통과

### AC-002: HTTPException 호출 스타일 통일

**Given** 백엔드 코드베이스 전체를 검색할 때
**When** `HTTPException` 호출 패턴을 확인하면
**Then** 위치형 인자 `HTTPException(404, "msg")` 패턴은 0건이다
**And** 모든 HTTPException은 `HTTPException(status_code=..., detail=...)` 키워드 형식을 사용한다

검증 방법:
- `grep -rn "HTTPException([0-9]" backend/app/` 결과가 0건
- 기존 테스트 전체 통과

### AC-003: response_model 스키마 정의

**Given** `/api/admin/columns/{column_id}/validations` PUT 엔드포인트가 존재할 때
**When** 엔드포인트의 response_model을 확인하면
**Then** `dict` 대신 Pydantic 스키마가 지정되어 있다
**And** 응답 데이터가 스키마 검증을 통과한다

검증 방법:
- `response_model=dict` 패턴이 해당 라우터에 없음
- OpenAPI 문서(`/docs`)에서 응답 스키마가 표시됨

### AC-004: 페이지네이션 통일

**Given** `GET /api/projects/{id}/change-logs` 엔드포인트가 존재할 때
**When** 쿼리 파라미터를 확인하면
**Then** `offset` 파라미터는 존재하지 않는다
**And** `page` + `limit` 조합만 사용된다
**And** `page=2, limit=50` 요청 시 51번째~100번째 항목이 반환된다

검증 방법:
- `/docs`에서 offset 파라미터가 없음
- `page=1`과 `page=2` 응답이 중복 없이 순차적임

### AC-005: Export router prefix 표준화

**Given** export 라우터가 존재할 때
**When** 라우터 정의를 확인하면
**Then** `APIRouter(prefix="/api/export", ...)` 형식으로 prefix가 설정되어 있다
**And** 개별 엔드포인트에 `/api/export/` 하드코딩이 없다
**And** 프론트엔드에서 export API 호출이 정상 동작한다

검증 방법:
- `grep "/api/export" backend/app/routers/export.py` 결과가 prefix 정의 1건만 존재
- 프론트엔드 export 기능 수동 확인 (시스템 목록 조회, 다운로드)

### AC-006: Comments router trailing slash 제거

**Given** comments 라우터가 존재할 때
**When** collection 엔드포인트 경로를 확인하면
**Then** `@router.post("")`과 `@router.get("")` 형식으로 trailing slash가 없다
**And** 댓글 생성, 조회 API가 정상 동작한다

검증 방법:
- `grep 'router\.\(post\|get\)("/"' backend/app/routers/comments.py` 결과가 0건

---

## Milestone 2: Frontend Minor Fixes

### AC-007: 인라인 스타일 Tailwind 전환

**Given** EditorHeader 컴포넌트가 렌더링될 때
**When** 색상 범례(legend) 영역을 확인하면
**Then** 인라인 `style` 속성이 없다
**And** Tailwind CSS 클래스로 동일한 색상이 표현된다
**And** 변경/수정/backbone/오류 색상이 기존과 시각적으로 동일하다

검증 방법:
- `grep "style=" frontend/src/components/editor/EditorHeader.tsx` 결과가 0건
- 브라우저에서 EditorHeader 범례 색상이 기존과 동일

### AC-008: activeLayerId 리셋 방지

**Given** 사용자가 특정 레이어를 선택한 상태에서
**When** 저장 버튼을 클릭하여 프로젝트 데이터가 재조회되면
**Then** 선택된 레이어(activeLayerId)가 유지된다
**And** 첫 번째 레이어로 리셋되지 않는다

**Given** 프로젝트를 처음 열 때 (activeLayerId가 null)
**When** 프로젝트 데이터가 로드되면
**Then** 첫 번째 레이어가 자동 선택된다

검증 방법:
- 레이어 3번째를 선택 후 저장 -> 3번째 레이어 유지 확인
- 새 프로젝트 진입 시 첫 번째 레이어 자동 선택 확인

### AC-009: 쿼리 키 팩토리 통합

**Given** `hooks/useProjects.ts`의 쿼리 키를 검색할 때
**When** `product-revisions` 또는 `versionDiff` 키를 확인하면
**Then** 모든 키가 `projectKeys` 팩토리를 통해 생성된다
**And** 인라인 배열 리터럴 `['product-revisions', ...]`이 없다

검증 방법:
- `grep "\['product-revisions'\|'versionDiff'" frontend/src/hooks/useProjects.ts` 결과가 0건
- `projectKeys.productRevisions`와 `projectKeys.versionDiff` 키가 존재

### AC-010: formatDate 유틸리티 통합

**Given** 프로젝트의 날짜 포맷팅 코드를 검색할 때
**When** `function formatDate` 정의를 찾으면
**Then** `frontend/src/lib/utils.ts`에 1건만 존재한다
**And** 기존 5개 파일에 로컬 정의가 없다
**And** 모든 사용처에서 `@/lib/utils`에서 import한다

검증 방법:
- `grep -rn "function formatDate" frontend/src/` 결과가 `lib/utils.ts` 1건만 존재
- DashboardPage, ExportHistoryPanel, StatusTimeline, VersionHistoryPanel, CommentThread 모두 정상 렌더링

### AC-011: AuthUser 타입 통합

**Given** `AuthUser` 타입 정의를 검색할 때
**When** 프로젝트 전체를 확인하면
**Then** `stores/useAuthStore.ts`에 `interface AuthUser` 정의가 없다
**And** `types/user.ts`에서 `AuthUser`가 `Pick<User, ...>` 또는 동등한 형태로 정의된다
**And** `AuthUser.role`이 리터럴 유니온 타입이다 (`string`이 아님)
**And** TypeScript 컴파일 오류가 없다 (`tsc --noEmit` 통과)

검증 방법:
- `grep "interface AuthUser" frontend/src/stores/useAuthStore.ts` 결과가 0건
- `tsc --noEmit` 성공

---

## Milestone 3: TypeScript & Accessibility

### AC-012: TypeScript 타입 강화

**Given** TypeScript 타입 정의를 확인할 때

**When** `ValidationError.rule_type`을 확인하면
**Then** `string`이 아닌 구체적인 리터럴 유니온 타입이다

**When** `EditorState.activeCategory`를 확인하면
**Then** `string`이 아닌 `CategoryCode` 타입이다 (`'SP' | 'SC' | 'OVL' | 'DEV'`)

**When** `CategoryCode` 타입 정의를 검색하면
**Then** `types/column.ts`에 1건 정의되어 있다
**And** `admin/ValidationRulesPage.tsx`에 로컬 정의가 없다

**When** conditions 타입 가드를 확인하면
**Then** `lib/utils.ts`에 `isConditionValue`와 `getConditionValue` 헬퍼가 존재한다

검증 방법:
- `tsc --noEmit` 성공
- `grep "activeCategory: string" frontend/src/stores/useEditorStore.ts` 결과가 0건
- `grep "rule_type: string" frontend/src/types/project.ts` 결과가 0건

### AC-013: 접근성 개선

**Given** 프론트엔드 UI 컴포넌트가 렌더링될 때

**When** GridContextMenu가 열리면
**Then** 메뉴 컨테이너에 `role="menu"` 속성이 존재한다
**And** 각 메뉴 항목에 `role="menuitem"` 속성이 존재한다

**When** DashboardPage의 클릭 가능한 카드를 확인하면
**Then** `role="button"`, `tabIndex={0}` 속성이 존재한다
**And** Enter 또는 Space 키로 클릭과 동일한 동작이 실행된다

**When** ProjectListPage의 상태 필터 버튼을 확인하면
**Then** 활성 필터에 `aria-pressed="true"` 속성이 존재한다
**And** 비활성 필터에 `aria-pressed="false"` 속성이 존재한다

**When** AG Grid 조건표를 확인하면
**Then** 테이블 영역에 `aria-label` 속성이 존재한다

검증 방법:
- 브라우저 개발자 도구 접근성 탭에서 ARIA 속성 확인
- 키보드 Tab + Enter로 대시보드 카드 클릭 동작 확인

---

## Quality Gate

### Definition of Done

- [ ] 모든 기존 테스트 통과 (backend pytest + frontend vitest)
- [ ] TypeScript 컴파일 오류 없음 (`tsc --noEmit`)
- [ ] Backend linter 통과 (`ruff check`)
- [ ] 위치형 HTTPException 0건 (`grep "HTTPException([0-9]" backend/app/` 결과 없음)
- [ ] 인라인 style 제거 확인 (EditorHeader)
- [ ] formatDate 중복 정의 0건 (lib/utils.ts 외)
- [ ] 모든 쿼리 키가 projectKeys 팩토리 사용
- [ ] AuthUser가 types/user.ts 기반으로 통합
- [ ] ARIA 접근성 속성 추가 (4개 컴포넌트)
- [ ] 브라우저 수동 확인: 색상 범례, 레이어 선택 유지, export 동작
