# SPEC-REFACTOR-001: 구현 계획

## 메타데이터

| 항목 | 값 |
|------|-----|
| SPEC ID | SPEC-REFACTOR-001 |
| 방법론 | DDD (ANALYZE-PRESERVE-IMPROVE) |
| 영향 파일 수 | ~10개 |
| 방식 | 기존 동작 보존 리팩토링 |

---

## Milestone 1: Critical - 즉시 수정 (Primary Goal)

### M1-1: ValueError에서 HTTPException으로 전환 (REQ-R001)

**ANALYZE**:
- `export_service.py`의 `_get_project()` (라인 156), `_get_system()` (라인 165), `generate()` (라인 79, 114)에서 `ValueError` 사용 확인
- `admin_service.py`의 `create_export_mapping()` (라인 117), `update_export_mapping()` (라인 147), `replace_validations()` (라인 331, 336, 342)에서 `ValueError` 사용 확인
- 글로벌 예외 핸들러가 `ValueError`를 500으로 변환하는 현재 동작 확인
- 프론트엔드 호출 패턴 확인 (Axios interceptor가 404/422를 이미 처리)

**PRESERVE**:
- 각 `ValueError` 발생 경로에 대한 characterization test 작성
- 현재 500 응답을 반환하는 동작을 캡처

**IMPROVE**:
- `export_service.py`:
  - `_get_project()`: `ValueError` → `HTTPException(status_code=404, detail=...)`
  - `_get_system()`: `ValueError` → `HTTPException(status_code=404, detail=...)`
  - `generate()` format_type 검증: `ValueError` → `HTTPException(status_code=422, detail=...)`
- `admin_service.py`:
  - `value_transform` 검증: `ValueError` → `HTTPException(status_code=422, detail=...)`
  - `rule_type` 검증: `ValueError` → `HTTPException(status_code=422, detail=...)`
  - `rule_config` 검증: `ValueError` → `HTTPException(status_code=422, detail=...)`

**영향 파일**: `export_service.py`, `admin_service.py`

---

### M1-2: UNION ALL 쿼리로 타임라인 개선 (REQ-R002)

**ANALYZE**:
- `change_log_service.py:122`의 `limit=10_000_000` in-memory fetch 패턴 분석
- `change_logs`와 `project_status_logs` 테이블의 공통 필드 식별
- 현재 merge/sort 로직의 메모리 사용량 및 성능 특성 분석
- `ChangeLogRepository`의 기존 메서드 구조 확인

**PRESERVE**:
- 현재 타임라인 응답 형태(정렬 순서, 필드 구성)를 캡처하는 characterization test
- 소규모 데이터셋에서 현재와 동일한 결과를 반환하는지 검증

**IMPROVE**:
- `ChangeLogRepository`에 UNION ALL 기반 `fetch_timeline()` 메서드 추가:
  ```sql
  SELECT id, 'change' as type, changed_at, ...
  FROM change_logs WHERE project_id = :pid
  UNION ALL
  SELECT id, 'status' as type, changed_at, ...
  FROM project_status_logs WHERE project_id = :pid
  ORDER BY changed_at DESC
  LIMIT :limit OFFSET :offset
  ```
- `change_log_service.py`에서 새 repository 메서드를 호출하도록 변경
- 기존 in-memory merge 로직 제거

**영향 파일**: `change_log_service.py`, `change_log_repository.py`

---

## Milestone 2: Major - 조기 수정 (Secondary Goal)

### M2-1: 중복 권한 검사 및 User DB fetch 제거 (REQ-R003 + REQ-R008)

**ANALYZE**:
- `project_lifecycle.py:92-96`의 라우터 권한 검사 패턴 분석
- `project_status_service.py:77-86`의 서비스 내 중복 검사 분석
- `update_project_status(changed_by: int)` 시그니처의 호출자 목록 확인

**PRESERVE**:
- 승인/반려 시 비권한 사용자 거부 동작 테스트
- 정상 상태 전환 동작 테스트

**IMPROVE**:
- `update_project_status` 시그니처 변경: `changed_by: int` → `current_user: User`
- 서비스 내부의 `await db.get(User, changed_by)` 제거
- 서비스에서 `current_user.role`을 직접 참조하여 권한 검사
- 라우터의 중복 검사 제거 (서비스에서 단일 책임으로 처리)

**영향 파일**: `project_lifecycle.py`, `project_status_service.py`

---

### M2-2: 트랜잭션 경계 수정 (REQ-R004)

**ANALYZE**:
- `comment_service.py:68-76`의 create 흐름 분석
- `comment_service.py:184-192`의 update 흐름 분석
- `db.flush()` → `db.refresh()` → `fetch_comment_with_joins()` → `db.commit()` 순서 확인
- `db.refresh()`가 commit 전에 불필요하게 호출되는 이유 분석

**PRESERVE**:
- 코멘트 생성/수정 후 올바른 데이터 반환 테스트
- 트랜잭션 롤백 시 데이터 일관성 테스트

**IMPROVE**:
- create 흐름: `db.flush()` → `db.commit()` → `fetch_comment_with_joins()` 순서로 변경
- update 흐름: `db.flush()` → `db.commit()` → `fetch_comment_with_joins()` 순서로 변경
- 불필요한 `db.refresh()` 호출 제거 (commit 후 re-fetch로 대체)

**영향 파일**: `comment_service.py`

---

### M2-3: 라우터 내 직접 DB 쿼리 제거 (REQ-R005)

**ANALYZE**:
- `project_lifecycle.py:107-139`의 `get_status_history` 핸들러 분석
- `ChangeLogRepository.fetch_status_logs()` 기존 구현 확인
- 라우터의 인라인 쿼리와 repository 메서드의 결과 형태 비교

**PRESERVE**:
- `GET /{project_id}/status-history` 응답 형태 동일성 테스트

**IMPROVE**:
- `change_log_service` 또는 `project_analytics_service`에 `get_status_history()` 함수 추가
- `ChangeLogRepository.fetch_status_logs()`를 활용하여 데이터 조회
- 라우터는 서비스 호출 → 응답 변환만 담당
- 라우터 내부의 `from app.models import ...`, `from sqlalchemy import select` 지연 import 제거

**영향 파일**: `project_lifecycle.py`, `change_log_service.py` (또는 `project_analytics_service.py`), `change_log_repository.py`

---

### M2-4: 지연 import 모듈 최상위 이동 (REQ-R006)

**ANALYZE**:
- `project_lifecycle.py:51` - `from app.models import Product` (함수 내부)
- `project_lifecycle.py:114-115` - `from app.models import ProjectStatusLog, User` + `from sqlalchemy import select` (함수 내부)
- `project_layers.py:33` - `from app.models import Product` (함수 내부)
- `project_layers.py:72` - `from app.models import Layer, Product` (함수 내부)
- 순환 의존성 여부 확인

**PRESERVE**:
- 모든 엔드포인트가 정상적으로 import 되고 동작하는지 확인

**IMPROVE**:
- 모든 지연 import를 모듈 최상위로 이동
- REQ-R005 완료 후 `project_lifecycle.py`의 114-115행 import는 자연스럽게 제거됨
- 순환 의존성 발생 시 `TYPE_CHECKING` 가드 또는 모듈 구조 변경으로 해결

**영향 파일**: `project_lifecycle.py`, `project_layers.py`

---

### M2-5: rejected 상태 머신 등록 (REQ-R007)

**ANALYZE**:
- `constants.py:13-17` VALID_STATUS_TRANSITIONS 현재 구조 확인
- `project_status_service.py`의 rejected→draft 특수 처리 로직 분석
- 이중 로그(review→rejected + rejected→draft) 요구사항 분석

**PRESERVE**:
- rejected→draft 전환 시 이중 로그가 생성되는 현재 동작 테스트
- 비허용 전환(rejected→approved 등) 거부 동작 테스트

**IMPROVE**:
- `VALID_STATUS_TRANSITIONS`에 `"rejected": ["draft"]` 추가
- `project_status_service.py`의 rejected 특수 처리 코드를 상태 머신 기반으로 리팩토링
- 이중 로그 요구사항은 rejected→draft 전환 시 서비스 로직 내에서 처리

**영향 파일**: `constants.py`, `project_status_service.py`

---

## Milestone 3: Cross-Cutting Backend Quality (Final Goal)

### M3-1: Export 라우터 경로 prefix 정리 (REQ-R009)

**작업 내용**:
- `export.py`의 `APIRouter(tags=["export"])` → `APIRouter(prefix="/api", tags=["export"])` 또는 `main.py`에서 prefix 지정
- 현재 하드코딩된 경로:
  - `@router.get("/api/export/systems", ...)` → 상대 경로로 변환
  - `@router.post("/api/projects/{project_id}/export")` → 상대 경로로 변환
- 다른 라우터들의 prefix 패턴과 일치시킴

**영향 파일**: `export.py`, `main.py`

---

### M3-2: Comments trailing slash 통일 (REQ-R010)

**작업 내용**:
- `comments.py`의 `@router.post("/")`, `@router.get("/")` → `@router.post("")`, `@router.get("")`
- 프로젝트 전체 라우터의 trailing slash 정책과 일치

**영향 파일**: `comments.py`

---

### M3-3: Admin 검증 엔드포인트 response_model 개선 (REQ-R011)

**작업 내용**:
- `admin.py:113`의 `response_model=dict` → 적절한 Pydantic 스키마 생성
- 예: `ValidationRulesResponse` 스키마 정의
- OpenAPI 문서에 응답 형태가 명확히 표시되도록 함

**영향 파일**: `admin.py`, `schemas/` (새 스키마)

---

### M3-4: HTTPException 스타일 통일 (REQ-R012)

**작업 내용**:
- 전체 라우터/서비스에서 `HTTPException(status_code=XXX, detail="...")` keyword-argument 스타일로 통일
- positional argument 사용 케이스 식별 및 수정

**영향 파일**: 전체 라우터, 서비스 파일

---

## 구현 순서 요약

| 순서 | 태스크 | 의존성 | 위험도 |
|------|--------|--------|--------|
| 1 | M1-1: ValueError → HTTPException | 없음 | Low |
| 2 | M1-2: UNION ALL 쿼리 | 없음 | Medium |
| 3 | M2-5: rejected 상태 머신 | 없음 | Low |
| 4 | M2-1: 중복 검사/fetch 제거 | 없음 | Medium |
| 5 | M2-2: commit 순서 수정 | 없음 | Low |
| 6 | M2-3: 직접 DB 쿼리 제거 | 없음 | Low |
| 7 | M2-4: 지연 import 이동 | M2-3 완료 후 | Low |
| 8 | M3-1~4: Cross-cutting | M1, M2 완료 후 | Low |

---

## 위험 및 대응 계획

### 위험 1: HTTP 상태 코드 변경 영향
- **심각도**: Medium
- **대응**: 프론트엔드 Axios 인터셉터가 이미 HTTP 에러 코드별 처리를 구현. 기존 500 → 404/422는 클라이언트에 더 정확한 정보를 제공하는 개선.

### 위험 2: UNION ALL 쿼리 복잡도
- **심각도**: Medium
- **대응**: 두 테이블의 공통 컬럼을 명확히 식별하고, 별칭(alias)으로 통합. EXPLAIN ANALYZE로 성능 검증.

### 위험 3: 순환 의존성
- **심각도**: Medium
- **대응**: `TYPE_CHECKING` 가드 사용 또는 공통 모듈 추출. 실제 순환 발생 시에만 적용.

### 위험 4: 서비스 시그니처 변경 (User 객체 전달)
- **심각도**: Low
- **대응**: `update_project_status`의 호출자는 `project_lifecycle.py` 라우터 1곳뿐. 변경 범위가 제한적.
