# SPEC-REFACTOR-001: 수용 기준

## 메타데이터

| 항목 | 값 |
|------|-----|
| SPEC ID | SPEC-REFACTOR-001 |
| 형식 | Given-When-Then (Gherkin) |

---

## Milestone 1: Critical

### AC-R001: ValueError에서 HTTPException으로 전환

```gherkin
Feature: ExportService 예외 처리 정상화

  Scenario: 존재하지 않는 프로젝트로 export 요청
    Given 프로젝트 ID 99999가 DB에 존재하지 않음
    When ExportService._get_project(99999)를 호출하면
    Then HTTPException(status_code=404)가 발생해야 한다
    And detail 메시지에 프로젝트 ID가 포함되어야 한다

  Scenario: 알 수 없는 format_type으로 export 생성
    Given 유효한 프로젝트와 export 시스템이 존재함
    And export 시스템의 format_type이 "unknown_format"임
    When ExportService.generate()를 호출하면
    Then HTTPException(status_code=422)가 발생해야 한다
    And detail 메시지에 format_type 정보가 포함되어야 한다

  Scenario: 존재하지 않는 export 시스템으로 요청
    Given export system ID 99999가 DB에 존재하지 않음
    When ExportService._get_system(99999)를 호출하면
    Then HTTPException(status_code=404)가 발생해야 한다

Feature: AdminService 예외 처리 정상화

  Scenario: 잘못된 value_transform으로 매핑 생성
    Given export 컬럼 매핑 생성 요청에 value_transform이 "invalid_func"임
    When AdminService.create_export_mapping()을 호출하면
    Then HTTPException(status_code=422)가 발생해야 한다
    And detail 메시지에 잘못된 value_transform 값이 포함되어야 한다

  Scenario: 잘못된 rule_type으로 검증 규칙 저장
    Given 검증 규칙의 rule_type이 "nonexistent_rule"임
    When AdminService.replace_validations()를 호출하면
    Then HTTPException(status_code=422)가 발생해야 한다
    And detail 메시지에 허용된 rule_type 목록이 포함되어야 한다

  Scenario: range 규칙에 min/max 누락
    Given 검증 규칙의 rule_type이 "range"이고 rule_config에 "min"이 없음
    When AdminService.replace_validations()를 호출하면
    Then HTTPException(status_code=422)가 발생해야 한다

  Scenario: 서비스에서 ValueError가 발생하지 않음
    Given 모든 서비스 파일을 검색함
    When "raise ValueError"를 grep으로 검색하면
    Then export_service.py와 admin_service.py에서 결과가 0건이어야 한다
```

---

### AC-R002: UNION ALL 쿼리 타임라인

```gherkin
Feature: 타임라인 서버 측 페이지네이션

  Scenario: 타임라인 조회 시 서버 측 페이지네이션
    Given 프로젝트에 change_log 50건, status_log 5건이 존재함
    When 타임라인을 limit=10, offset=0으로 조회하면
    Then 결과는 10건이어야 한다
    And changed_at 내림차순으로 정렬되어야 한다
    And change_log와 status_log가 혼합되어 있어야 한다

  Scenario: 타임라인 2페이지 조회
    Given 프로젝트에 change_log 50건, status_log 5건이 존재함
    When 타임라인을 limit=10, offset=10으로 조회하면
    Then 결과는 10건이어야 한다
    And 1페이지와 중복되는 항목이 없어야 한다

  Scenario: in-memory unbounded fetch 제거 확인
    Given change_log_service.py 파일을 검색함
    When "limit=10_000_000" 또는 "limit=10000000"을 grep으로 검색하면
    Then 결과가 0건이어야 한다

  Scenario: UNION ALL 쿼리 사용 확인
    Given change_log_repository.py 파일을 검색함
    When "UNION ALL" 또는 "union_all"을 grep으로 검색하면
    Then 결과가 1건 이상이어야 한다
```

---

## Milestone 2: Major

### AC-R003 + AC-R008: 중복 권한 검사 및 User fetch 제거

```gherkin
Feature: 단일 권한 검사

  Scenario: 비권한 사용자의 승인 시도 거부
    Given 현재 사용자의 role이 "editor"임
    When 프로젝트 상태를 "approved"로 변경 요청하면
    Then HTTP 403이 반환되어야 한다

  Scenario: reviewer의 승인 처리
    Given 현재 사용자의 role이 "reviewer"이고 프로젝트 상태가 "review"임
    When 프로젝트 상태를 "approved"로 변경 요청하면
    Then HTTP 200이 반환되어야 한다
    And 프로젝트 상태가 "approved"로 변경되어야 한다

  Scenario: 서비스 시그니처 변경 확인
    Given project_status_service.py의 update_project_status 함수를 확인함
    When 함수 시그니처를 검사하면
    Then changed_by 파라미터가 int 타입이 아니어야 한다 (User 객체 또는 적절한 타입)

  Scenario: 중복 DB 조회 제거 확인
    Given project_status_service.py를 검색함
    When "await db.get(User, changed_by)"를 검색하면
    Then 결과가 0건이어야 한다
```

---

### AC-R004: 트랜잭션 경계 수정

```gherkin
Feature: 코멘트 트랜잭션 순서 정상화

  Scenario: 코멘트 생성 시 commit이 read 전에 실행
    Given 새 코멘트 생성 요청이 있음
    When comment_service.create_comment()이 실행되면
    Then db.commit()이 fetch_comment_with_joins() 호출 전에 실행되어야 한다
    And 생성된 코멘트 데이터가 올바르게 반환되어야 한다

  Scenario: 코멘트 수정 시 commit이 read 전에 실행
    Given 기존 코멘트의 resolve 상태 변경 요청이 있음
    When comment_service.update_comment()이 실행되면
    Then db.commit()이 fetch_comment_with_joins() 호출 전에 실행되어야 한다
    And 수정된 코멘트 데이터가 올바르게 반환되어야 한다

  Scenario: 불필요한 refresh 제거 확인
    Given comment_service.py에서 create_comment, update_comment 함수를 확인함
    When db.refresh() 호출을 검색하면
    Then create/update 함수 내에서 불필요한 refresh 호출이 없어야 한다
```

---

### AC-R005: 라우터 내 직접 DB 쿼리 제거

```gherkin
Feature: status-history 서비스 위임

  Scenario: status-history 응답 동일성
    Given 프로젝트에 status_log 3건이 존재함
    When GET /{project_id}/status-history를 호출하면
    Then 응답에 history 배열이 포함되어야 한다
    And 각 항목에 id, from_status, to_status, changed_by, changer_name, comment, changed_at이 포함되어야 한다
    And changed_at 내림차순으로 정렬되어야 한다

  Scenario: 라우터에서 직접 쿼리 제거 확인
    Given project_lifecycle.py를 검사함
    When get_status_history 핸들러에서 "db.execute" 호출을 검색하면
    Then 결과가 0건이어야 한다

  Scenario: 서비스 레이어 위임 확인
    Given project_lifecycle.py의 get_status_history 핸들러를 확인함
    When 핸들러 코드를 검사하면
    Then change_log_service 또는 project_analytics_service 함수를 호출해야 한다
```

---

### AC-R006: 지연 import 모듈 최상위 이동

```gherkin
Feature: 모듈 최상위 import

  Scenario: project_lifecycle.py 지연 import 제거
    Given project_lifecycle.py 파일을 검사함
    When 함수 본문 내부의 "from app.models" import를 검색하면
    Then 결과가 0건이어야 한다
    And 모듈 최상위(라인 1~20 부근)에 필요한 import가 있어야 한다

  Scenario: project_layers.py 지연 import 제거
    Given project_layers.py 파일을 검사함
    When 함수 본문 내부의 "from app.models" import를 검색하면
    Then 결과가 0건이어야 한다
    And 모듈 최상위에 필요한 import가 있어야 한다

  Scenario: 순환 의존성 미발생
    Given 모든 import가 최상위로 이동됨
    When 백엔드 서버를 시작하면
    Then ImportError나 순환 의존성 오류가 발생하지 않아야 한다
```

---

### AC-R007: rejected 상태 머신 등록

```gherkin
Feature: rejected 상태 전이 통합

  Scenario: VALID_STATUS_TRANSITIONS에 rejected 항목 존재
    Given constants.py의 VALID_STATUS_TRANSITIONS를 확인함
    When "rejected" 키를 검색하면
    Then ["draft"] 값이 매핑되어 있어야 한다

  Scenario: rejected에서 draft로 전환
    Given 프로젝트 상태가 "rejected"임
    When 상태를 "draft"로 변경 요청하면
    Then 성공적으로 전환되어야 한다
    And status_log에 2건 (review→rejected, rejected→draft)이 기록되어야 한다

  Scenario: rejected에서 허용되지 않은 상태로 전환 시도
    Given 프로젝트 상태가 "rejected"임
    When 상태를 "approved"로 변경 요청하면
    Then HTTP 400이 반환되어야 한다
    And "Invalid status transition" 메시지가 포함되어야 한다
```

---

## Milestone 3: Cross-Cutting

### AC-R009: Export 라우터 경로 prefix

```gherkin
Feature: Export 라우터 경로 일관성

  Scenario: 하드코딩된 /api/ prefix 제거
    Given export.py를 검사함
    When 라우터 데코레이터의 경로를 검색하면
    Then "/api/export/systems"와 같은 전체 경로가 없어야 한다
    And 상대 경로("/export/systems" 또는 "/systems")로 정의되어야 한다

  Scenario: export API 정상 동작
    Given export 라우터의 prefix가 설정됨
    When GET /api/export/systems를 호출하면
    Then HTTP 200과 시스템 목록이 반환되어야 한다
```

---

### AC-R010: Comments trailing slash 통일

```gherkin
Feature: Trailing slash 일관성

  Scenario: trailing slash 제거 확인
    Given comments.py를 검사함
    When 라우터 데코레이터의 경로를 확인하면
    Then @router.post("/") 대신 @router.post("") 형태이거나
    And 프로젝트 전체 라우터의 trailing slash 정책과 일관되어야 한다
```

---

### AC-R011: Admin response_model 개선

```gherkin
Feature: 검증 엔드포인트 response_model

  Scenario: dict 대신 Pydantic 스키마 사용
    Given admin.py의 replace_column_validations 엔드포인트를 확인함
    When response_model을 검사하면
    Then response_model이 dict가 아닌 Pydantic 스키마여야 한다

  Scenario: OpenAPI 스펙 정상 반영
    Given 서버가 실행 중임
    When /docs 또는 /openapi.json을 확인하면
    Then 해당 엔드포인트의 응답 스키마가 명확히 정의되어야 한다
```

---

### AC-R012: HTTPException 스타일 통일

```gherkin
Feature: HTTPException keyword-arg 스타일

  Scenario: 전체 codebase에서 일관된 스타일 사용
    Given 전체 routers/ 및 services/ 디렉토리를 검색함
    When HTTPException 호출을 검사하면
    Then 모두 HTTPException(status_code=XXX, detail="...") keyword-arg 형태여야 한다
```

---

## 품질 게이트 (Quality Gates)

### Definition of Done

- [ ] 모든 Milestone의 수용 기준이 통과
- [ ] 기존 API 응답 형태 보존 (HTTP 상태 코드만 정확해짐)
- [ ] 서비스 레이어에서 `raise ValueError` 0건
- [ ] 라우터에서 직접 `db.execute()` 0건
- [ ] 함수 내부 지연 import 0건
- [ ] `VALID_STATUS_TRANSITIONS`에 "rejected" 포함
- [ ] `limit=10_000_000` 패턴 0건
- [ ] 백엔드 서버 정상 기동 (ImportError 없음)
- [ ] Characterization test 작성 및 통과

### 검증 방법

| 검증 항목 | 방법 | 도구 |
|-----------|------|------|
| ValueError 제거 | grep "raise ValueError" services/ | Grep |
| UNION ALL 적용 | grep "union_all\|UNION ALL" repositories/ | Grep |
| 지연 import 제거 | AST 분석 또는 함수 내 import 검색 | Grep |
| 상태 머신 완전성 | constants.py 직접 확인 | Read |
| 서버 기동 | docker-compose up backend | Docker |
| API 응답 검증 | pytest (characterization tests) | pytest |
| 트랜잭션 순서 | 코드 리뷰 + 테스트 | Read + pytest |
