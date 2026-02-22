# SPEC-REFACTOR-001: Backend Critical/Major 리팩토링

## 메타데이터

| 항목 | 값 |
|------|-----|
| SPEC ID | SPEC-REFACTOR-001 |
| 제목 | Backend Critical/Major 리팩토링 |
| 생성일 | 2026-02-21 |
| 상태 | Planned |
| 우선순위 | High |
| 담당 | expert-backend |
| 관련 SPEC | SPEC-005, SPEC-EXPORT-001, SPEC-004, SPEC-003 |
| 방법론 | DDD (ANALYZE-PRESERVE-IMPROVE) |

---

## 개요

코드 리뷰에서 발견된 백엔드 10건의 Critical/Major 이슈를 체계적으로 수정한다. 모든 변경은 DDD 방법론(ANALYZE-PRESERVE-IMPROVE)을 따르며, 기존 동작을 보존하면서 코드 품질, 안정성, 일관성을 개선한다.

### 배경

PCM 백엔드는 Phase 1~4를 거치며 빠르게 성장했으나, 서비스 분리/라우터 분리 과정에서 다음과 같은 기술 부채가 누적되었다:

- **예외 처리 불일치**: 일부 서비스에서 `ValueError`를 발생시키나, 글로벌 예외 핸들러가 이를 HTTP 500으로 변환하여 클라이언트에 오해를 유발
- **메모리 안전성 문제**: 타임라인 조회 시 천만 건 한도의 in-memory fetch로 OOM 위험
- **아키텍처 규칙 위반**: 라우터에서 직접 DB 쿼리, 지연 import, 중복 권한 검사 등
- **상태 머신 불완전**: `rejected` 상태 전이가 상태 머신에 미등록

### 범위

- **포함**: 백엔드 Python 코드 (services, routers, constants, repositories)
- **제외**: 프론트엔드, DB 스키마 변경, API 응답 형태 변경 (동작 보존)

---

## 환경 (Environment)

- **런타임**: Python 3.11+, FastAPI, SQLAlchemy 2.x (async), PostgreSQL 16
- **영향 파일**: 약 8~10개 파일 (services 4, routers 3, constants 1, repositories 1~2)
- **의존 관계**: 프론트엔드 API 호출 패턴은 변경하지 않음 (HTTP 상태 코드만 정확해짐)

## 가정 (Assumptions)

- A-01: 글로벌 예외 핸들러(`main.py`)는 `Exception`을 500으로 변환하는 현재 동작이 유지된다
- A-02: `ChangeLogRepository.fetch_status_logs()`는 이미 JOIN + ORDER BY + pagination을 지원한다
- A-03: 프론트엔드는 HTTP 상태 코드(404, 422 등)를 정상적으로 처리하며, 기존 500 → 404/422 전환이 breaking change가 아니다
- A-04: 현재 테스트 커버리지가 낮으므로, 리팩토링 시 characterization test를 먼저 작성한다

---

## 마일스톤

### Milestone 1: Critical - 즉시 수정 (Primary Goal)

런타임 오류와 메모리 안전성에 직접 영향을 주는 2건.

### Milestone 2: Major - 조기 수정 (Secondary Goal)

아키텍처 규칙 위반, 중복 로직, 상태 머신 불완전성 등 6건.

### Milestone 3: Cross-Cutting - 백엔드 품질 통일 (Final Goal)

라우터 전반의 일관성 개선 4건.

---

## 요구사항 (Requirements) - EARS 형식

### Milestone 1: Critical

#### REQ-R001: ValueError에서 HTTPException으로 전환 (C-01/P-02)

**대상 파일**:
- `backend/app/services/export_service.py` (라인 79, 114, 156, 165)
- `backend/app/services/admin_service.py` (라인 117, 147, 331, 336, 342)

**WHEN** ExportService._get_project()에서 프로젝트를 찾지 못할 때,
**THEN** 시스템은 `HTTPException(status_code=404)`를 발생시켜야 한다.

**WHEN** ExportService.generate()에서 알 수 없는 format_type을 받을 때,
**THEN** 시스템은 `HTTPException(status_code=422)`를 발생시켜야 한다.

**WHEN** ExportService에서 export system을 찾지 못할 때,
**THEN** 시스템은 `HTTPException(status_code=404)`를 발생시켜야 한다.

**WHEN** AdminService에서 잘못된 value_transform 값을 받을 때,
**THEN** 시스템은 `HTTPException(status_code=422)`를 발생시켜야 한다.

**WHEN** AdminService에서 잘못된 rule_type 또는 불완전한 rule_config를 받을 때,
**THEN** 시스템은 `HTTPException(status_code=422)`를 발생시켜야 한다.

시스템은 서비스 레이어에서 `ValueError`를 발생시키지 **않아야 한다**. 모든 클라이언트 대면 오류는 적절한 HTTP 상태 코드를 가진 `HTTPException`이어야 한다.

#### REQ-R002: Unbounded in-memory timeline fetch 제거 (C-02)

**대상 파일**: `backend/app/services/change_log_service.py` (라인 122)

**WHEN** 타임라인 데이터를 조회할 때,
**THEN** 시스템은 `change_logs`와 `project_status_logs`를 SQL `UNION ALL` 쿼리로 결합하고, 서버 측 `ORDER BY + LIMIT/OFFSET`으로 페이지네이션해야 한다.

시스템은 페이지네이션을 위해 `limit=10_000_000`과 같은 unbounded in-memory fetch를 사용**하지 않아야 한다**.

---

### Milestone 2: Major

#### REQ-R003: 중복 권한 검사 제거 (C-03)

**대상 파일**:
- `backend/app/routers/project_lifecycle.py` (라인 92~96)
- `backend/app/services/project_status_service.py` (라인 77~86)

**WHEN** 프로젝트 상태 전환 요청을 처리할 때,
**THEN** 라우터에서 1회만 권한 검사를 수행하고, 서비스에는 User 객체(또는 role)를 직접 전달해야 한다.

시스템은 동일한 권한 검사를 라우터와 서비스에서 중복 수행**하지 않아야 한다**. 서비스에서 user_id로 User를 재조회하는 불필요한 DB 쿼리를 제거한다.

#### REQ-R004: 트랜잭션 경계 - commit 순서 수정 (C-04)

**대상 파일**: `backend/app/services/comment_service.py` (라인 68~76, 184~192)

**WHEN** 코멘트를 생성하거나 수정(resolve/unresolve)할 때,
**THEN** 시스템은 `db.commit()`을 repository read 쿼리(`fetch_comment_with_joins`) **이전에** 수행해야 한다.

`db.flush()` → `db.refresh()` → `fetch_comment_with_joins()` → `db.commit()` 순서에서, `db.flush()` → `db.commit()` → `fetch_comment_with_joins()` 순서로 변경한다. 불필요한 `db.refresh()` 호출을 제거한다.

#### REQ-R005: 라우터 내 직접 DB 쿼리 제거 (A-01)

**대상 파일**: `backend/app/routers/project_lifecycle.py` (라인 107~139)

**WHEN** `GET /{project_id}/status-history` 엔드포인트가 호출될 때,
**THEN** 시스템은 라우터에서 직접 SQLAlchemy 쿼리를 실행하지 않고, `change_log_service` (또는 `project_analytics_service`) → `ChangeLogRepository.fetch_status_logs()`를 통해 데이터를 조회해야 한다.

시스템은 라우터 핸들러에서 직접 `db.execute(select(...))` 쿼리를 실행**하지 않아야 한다**.

#### REQ-R006: 지연 import를 모듈 최상위로 이동 (A-02)

**대상 파일**:
- `backend/app/routers/project_lifecycle.py` (라인 51, 114~115)
- `backend/app/routers/project_layers.py` (라인 33, 72)

시스템은 **항상** 모든 import 문을 모듈 최상위에 배치해야 한다.

**IF** 순환 의존성이 발생하면, **THEN** import 구조를 재설계하여 해결해야 한다 (예: 공통 모델을 별도 모듈로 분리하거나, TYPE_CHECKING 가드 사용).

함수 본문 내부에 `from app.models import ...` 또는 `from sqlalchemy import select`와 같은 지연 import를 배치**하지 않아야 한다**.

#### REQ-R007: rejected 상태를 상태 머신에 추가 (P-03)

**대상 파일**: `backend/app/constants.py` (라인 13~17)

시스템은 **항상** `VALID_STATUS_TRANSITIONS`에 `"rejected": ["draft"]` 항목을 포함해야 한다.

**WHEN** rejected 상태의 프로젝트에서 상태 전환을 시도할 때,
**THEN** 시스템은 `VALID_STATUS_TRANSITIONS`를 참조하여 draft로의 전환을 허용해야 한다.

`project_status_service.py`의 rejected 특수 처리 로직을 상태 머신 기반으로 통합하고, 이중 로그(rejected→draft) 요구사항은 상태 머신 내에서 처리한다.

#### REQ-R008: 중복 User DB fetch 제거 (P-04)

**대상 파일**: `backend/app/services/project_status_service.py` (라인 78~86)

**WHEN** `update_project_status` 함수가 호출될 때,
**THEN** 시스템은 `changed_by: int` 대신 `User` 객체 또는 `(user_id, role)` 튜플을 인수로 받아야 한다.

이 요구사항은 REQ-R003과 함께 해결된다. 라우터가 이미 보유한 `current_user` 객체를 서비스로 전달하여 불필요한 DB 재조회를 제거한다.

---

### Milestone 3: Cross-Cutting Backend Quality

#### REQ-R009: Export 라우터 경로 prefix 정리

**대상 파일**: `backend/app/routers/export.py` (라인 30, 39 등)

시스템은 **항상** 라우터 경로를 `APIRouter(prefix=...)` 또는 `main.py`의 `include_router(prefix=...)` 에서 관리해야 한다.

**IF** export 라우터에 `/api/export/systems`, `/api/projects/{project_id}/export`와 같이 하드코딩된 전체 경로가 존재하면,
**THEN** 시스템은 `APIRouter(prefix="/api")`를 설정하거나, `main.py`에서 prefix를 지정하고 라우터 내부 경로는 상대 경로로 변환해야 한다.

#### REQ-R010: Comments 라우터 trailing slash 일관성

**대상 파일**: `backend/app/routers/comments.py`

시스템은 **항상** 라우터 엔드포인트에서 일관된 trailing slash 정책을 유지해야 한다.

현재 `@router.post("/")`, `@router.get("/")`에서 trailing slash가 포함되어 있으나, 다른 라우터들(`project_lifecycle.py`, `project_conditions.py` 등)은 trailing slash를 사용하지 않는다. 프로젝트 전체의 일관성을 위해 통일한다.

#### REQ-R011: Admin 검증 엔드포인트 response_model 개선

**대상 파일**: `backend/app/routers/admin.py` (라인 113)

**WHEN** `PUT /columns/{column_id}/validations` 엔드포인트가 응답을 반환할 때,
**THEN** 시스템은 `response_model=dict` 대신 적절한 Pydantic 스키마를 사용해야 한다.

`response_model=dict`는 응답 형태를 문서화하지 않으며, OpenAPI 스키마에서 무의미하다.

#### REQ-R012: HTTPException keyword-arg 스타일 통일

시스템은 **항상** `HTTPException(status_code=XXX, detail="...")` 형태의 keyword-argument 스타일로 HTTPException을 생성해야 한다.

모든 라우터/서비스에서 일관된 스타일을 사용하여 가독성과 유지보수성을 보장한다.

---

## 기술적 접근 방식

### DDD 방법론 적용 (ANALYZE-PRESERVE-IMPROVE)

**ANALYZE 단계**:
1. 각 대상 파일의 현재 동작을 분석
2. 호출 체인을 추적하여 변경 영향 범위 파악
3. 프론트엔드에서 해당 API를 호출하는 패턴 확인

**PRESERVE 단계**:
1. 각 변경 대상에 대한 characterization test 작성
2. 현재 동작(잘못된 500 응답 포함)을 캡처하는 스냅샷 테스트
3. 변경 전 테스트가 green인지 확인

**IMPROVE 단계**:
1. 코드 변경 적용
2. Characterization test에서 예상 결과를 새로운 올바른 동작으로 업데이트
3. 모든 테스트 green 확인

### 변경 순서

1. **REQ-R001** (ValueError → HTTPException): 가장 독립적, 다른 변경에 의존하지 않음
2. **REQ-R002** (UNION ALL): change_log_service 단독 변경
3. **REQ-R007** (rejected 상태 머신): constants.py 변경 후 서비스 로직 수정
4. **REQ-R003 + REQ-R008** (중복 검사/fetch 제거): 함께 해결 - 서비스 시그니처 변경
5. **REQ-R004** (commit 순서): comment_service 단독 변경
6. **REQ-R005** (직접 DB 쿼리 제거): 서비스/리포지토리 위임
7. **REQ-R006** (지연 import): REQ-R005 완료 후 정리 (import 대상이 줄어듦)
8. **REQ-R009~R012** (Cross-cutting): 마지막에 일괄 적용

### 위험 요소

| 위험 | 심각도 | 대응 방안 |
|------|--------|----------|
| HTTP 상태 코드 변경으로 프론트엔드 오류 처리 영향 | Medium | 프론트엔드 Axios 인터셉터가 이미 404/422를 처리함. 기존 500→404/422는 개선임 |
| UNION ALL 쿼리 성능 | Low | 기존 in-memory 방식보다 확실히 개선. EXPLAIN ANALYZE로 검증 |
| 순환 의존성 (import 이동 시) | Medium | TYPE_CHECKING 가드 또는 별도 모듈 분리로 해결 |
| rejected 상태 전이 변경으로 기존 워크플로우 영향 | Low | 동작 자체는 동일, 코드 경로만 상태 머신으로 통합 |

---

## 추적성 태그

| TAG | 요구사항 | 파일 |
|-----|---------|------|
| SPEC-REFACTOR-001/R001 | ValueError → HTTPException | export_service.py, admin_service.py |
| SPEC-REFACTOR-001/R002 | UNION ALL 쿼리 | change_log_service.py |
| SPEC-REFACTOR-001/R003 | 중복 권한 검사 제거 | project_lifecycle.py, project_status_service.py |
| SPEC-REFACTOR-001/R004 | commit 순서 수정 | comment_service.py |
| SPEC-REFACTOR-001/R005 | 직접 DB 쿼리 제거 | project_lifecycle.py |
| SPEC-REFACTOR-001/R006 | 지연 import 이동 | project_lifecycle.py, project_layers.py |
| SPEC-REFACTOR-001/R007 | rejected 상태 머신 | constants.py, project_status_service.py |
| SPEC-REFACTOR-001/R008 | User DB fetch 제거 | project_status_service.py |
| SPEC-REFACTOR-001/R009 | Export 경로 prefix | export.py |
| SPEC-REFACTOR-001/R010 | Trailing slash 통일 | comments.py |
| SPEC-REFACTOR-001/R011 | response_model 개선 | admin.py |
| SPEC-REFACTOR-001/R012 | HTTPException 스타일 통일 | 전체 라우터 |
