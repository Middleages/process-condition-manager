# SPEC-EXPORT-001 수용 기준

**SPEC ID**: SPEC-EXPORT-001
**추적 태그**: SPEC-EXPORT-001

---

## M1: Export Admin UI

### AC-M1-01: Export 시스템 목록 조회

```gherkin
Given admin 역할의 사용자가 로그인한 상태이고
  And 전산 출력 시스템이 3개 존재할 때 (active 2개, inactive 1개)
When '/admin/export-systems' 페이지에 접근하면
Then 3개의 시스템이 테이블에 표시되고
  And 각 시스템의 system_name, format_type, description, is_active, column_count가 표시되고
  And inactive 시스템은 시각적으로 구분(회색 배경 또는 뱃지)되어야 한다
```

### AC-M1-02: Export 시스템 생성

```gherkin
Given admin 사용자가 Export 시스템 관리 페이지에 있을 때
When '시스템 추가' 버튼을 클릭하고
  And system_name: "NEW-SYSTEM", format_type: "TYPE_A", description: "테스트 시스템"을 입력하고
  And '저장' 버튼을 클릭하면
Then POST /api/admin/export-systems API가 호출되고
  And 201 응답과 함께 새 시스템이 생성되고
  And 시스템 목록이 자동 갱신되어 새 시스템이 표시된다
```

### AC-M1-03: 중복 system_name 방지

```gherkin
Given "MES-TRACK"이라는 시스템이 이미 존재할 때
When admin이 동일한 system_name "MES-TRACK"으로 시스템 생성을 시도하면
Then 409 Conflict 응답이 반환되고
  And "이미 존재하는 시스템 이름입니다" 오류 메시지가 표시된다
```

### AC-M1-04: Export 시스템 수정

```gherkin
Given 기존 시스템 "MES-TRACK" (TYPE_A, active)이 존재할 때
When admin이 수정 버튼을 클릭하고
  And description을 "수정된 설명"으로 변경하고 저장하면
Then PUT /api/admin/export-systems/{id} API가 호출되고
  And 200 응답과 함께 수정된 데이터가 반환되고
  And 목록에 수정된 description이 반영된다
```

### AC-M1-05: Export 시스템 삭제

```gherkin
Given 시스템 "TEST-SYSTEM"이 컬럼 매핑 5개와 함께 존재할 때
When admin이 삭제 버튼을 클릭하면
Then "시스템과 연관된 컬럼 매핑 5개가 함께 삭제됩니다" 확인 다이얼로그가 표시되고
When '확인' 버튼을 클릭하면
Then DELETE /api/admin/export-systems/{id} API가 호출되고
  And 시스템과 연관 매핑이 모두 삭제되고
  And 목록에서 해당 시스템이 제거된다
```

### AC-M1-06: 컬럼 매핑 관리

```gherkin
Given 시스템 "MES-TRACK"이 선택된 상태에서
When 컬럼 매핑 관리 영역을 확인하면
Then 해당 시스템의 매핑 목록이 sort_order 순서로 표시되고
  And 각 매핑의 target_column_name, 원본 column_name, is_required 상태가 표시된다
```

### AC-M1-07: 컬럼 매핑 추가

```gherkin
Given 시스템 "MES-TRACK"의 매핑 관리 화면에서
When '매핑 추가' 버튼을 클릭하고
  And 카테고리 "SP" 필터를 선택하고
  And column_definition에서 "SP_PR_TYPE"을 선택하고
  And target_column_name: "RESIST_CODE", is_required: true로 설정하고
  And '저장' 버튼을 클릭하면
Then POST /api/admin/export-systems/{id}/mappings API가 호출되고
  And 새 매핑이 목록 끝에 추가된다
```

### AC-M1-08: 매핑 순서 변경

```gherkin
Given 시스템의 매핑 3개가 [A, B, C] 순서로 존재할 때
When admin이 B 매핑의 '위로' 버튼을 클릭하면
Then PUT /api/admin/export-systems/{id}/mappings/reorder API가 호출되고
  And 매핑 순서가 [B, A, C]로 변경된다
```

### AC-M1-09: 비인가 접근 차단

```gherkin
Given editor 역할의 사용자가 로그인한 상태일 때
When GET /api/admin/export-systems API를 호출하면
Then 403 Forbidden 응답이 반환된다
```

---

## M2: Equipment Assignment UI

### AC-M2-01: 설비 목록 조회

```gherkin
Given 프로젝트 "P1"의 레이어 "L1"에 설비 2개가 할당되어 있을 때
When 편집 페이지에서 레이어 "L1"을 선택하고 설비 할당 패널을 열면
Then GET /api/projects/{id}/layers/{layer_id}/equipment API가 호출되고
  And 2개의 설비가 sort_order 순으로 표시되고
  And 각 설비의 equipment_id와 equipment_params 키 목록이 표시된다
```

### AC-M2-02: 설비 추가

```gherkin
Given 프로젝트가 draft 상태이고 레이어 "L1"이 선택된 상태에서
When '설비 추가' 버튼을 클릭하고
  And equipment_id: "SCANNER-01"을 입력하고
  And equipment_params에 {"SC_EXPOSE_ENERGY_mJ": "25.0"} 키-값 쌍을 추가하고
  And '저장' 버튼을 클릭하면
Then POST /api/projects/{id}/layers/{layer_id}/equipment API가 호출되고
  And 201 응답과 함께 설비가 생성되고
  And 설비 목록이 갱신된다
```

### AC-M2-03: 설비 파라미터 수정

```gherkin
Given 설비 "SCANNER-01"이 equipment_params: {"SC_EXPOSE_ENERGY_mJ": "25.0"}을 갖고 있을 때
When 수정 버튼을 클릭하고
  And SC_EXPOSE_ENERGY_mJ 값을 "26.5"로 변경하고 저장하면
Then PUT API가 호출되고
  And equipment_params가 {"SC_EXPOSE_ENERGY_mJ": "26.5"}로 업데이트되고
  And Type B 출력 시 해당 레이어의 SCANNER-01 행에 26.5가 반영된다
```

### AC-M2-04: 설비 삭제

```gherkin
Given 설비 "SCANNER-01"이 존재할 때
When 삭제 버튼을 클릭하면
Then "설비 SCANNER-01을 삭제하시겠습니까?" 확인 다이얼로그가 표시되고
When '확인'을 클릭하면
Then DELETE API가 호출되고
  And 설비 목록에서 해당 항목이 제거된다
```

### AC-M2-05: 읽기 전용 모드

```gherkin
Given 프로젝트 상태가 "approved"일 때
When 설비 할당 패널을 열면
Then 설비 목록은 조회 가능하지만
  And '추가', '수정', '삭제' 버튼은 비활성화되거나 숨겨진다
```

### AC-M2-06: 설비 순서 변경

```gherkin
Given 레이어에 설비 [A, B, C]가 순서대로 존재할 때
When 설비 B의 '위로' 버튼을 클릭하면
Then PUT /reorder API가 호출되고
  And 설비 순서가 [B, A, C]로 변경되고
  And Type B 출력 시 해당 순서로 행이 생성된다
```

---

## M3: Export Validation Report

### AC-M3-01: 검증 성공 (오류/경고 없음)

```gherkin
Given 프로젝트의 모든 required 컬럼에 유효한 값이 있고
  And 매핑된 모든 컬럼이 존재할 때
When 전산 출력 다운로드를 요청하면
Then 검증이 자동 실행되고
  And 검증 결과 "문제 없음"이 표시되고
  And 다운로드가 즉시 진행된다
```

### AC-M3-02: ERROR 발생 시 다운로드 차단

```gherkin
Given 시스템 "MES-TRACK"의 매핑에서 is_required=true인 "SP_PR_TYPE" 컬럼이 있고
  And 레이어 "L3"의 SP_PR_TYPE 값이 null일 때
When 다운로드를 요청하면
Then 검증이 실행되고
  And ERROR: "레이어 L3: 필수 컬럼 SP_PR_TYPE 값이 비어있습니다" 오류가 표시되고
  And 다운로드 버튼이 비활성화되고
  And 오류 건수 뱃지가 표시된다
```

### AC-M3-03: WARNING만 있을 때 다운로드 허용

```gherkin
Given 숫자 타입 컬럼 "SP_COAT_SPEED_rpm"에 "N/A" 문자열이 들어있을 때
When 다운로드를 요청하면
Then 검증이 실행되고
  And WARNING: "레이어 L2: SP_COAT_SPEED_rpm에 비숫자 값 'N/A'가 있습니다" 경고가 표시되고
  And "경고를 확인하고 다운로드" 버튼이 활성화된다
```

### AC-M3-04: 검증 결과 그룹핑 표시

```gherkin
Given 여러 레이어에서 3개의 ERROR와 5개의 WARNING이 발생했을 때
When 검증 리포트를 확인하면
Then 시스템별 그룹으로 먼저 표시되고
  And 각 그룹 내에서 ERROR가 WARNING보다 먼저 표시되고
  And 레이어별로 그룹핑되어 표시되고
  And 총 ERROR 수와 WARNING 수가 상단에 요약 표시된다
```

### AC-M3-05: 벌크 다운로드 시 다중 시스템 검증

```gherkin
Given 3개 시스템을 선택하여 벌크 다운로드를 요청했을 때
When 검증이 실행되면
Then 3개 시스템 각각에 대해 검증이 수행되고
  And 어느 하나라도 ERROR가 있으면 전체 벌크 다운로드가 차단되고
  And 시스템별로 검증 결과가 구분되어 표시된다
```

---

## M4: Export History Logging

### AC-M4-01: 출력 이력 자동 기록

```gherkin
Given 인증된 사용자 "user1"이 프로젝트 "P1"의 시스템 "MES-TRACK" 출력을 수행할 때
When 다운로드가 성공하면
Then export_histories 테이블에 다음 레코드가 생성된다:
  | 필드 | 값 |
  | project_id | P1의 ID |
  | export_system_id | MES-TRACK의 ID |
  | exported_by | user1의 ID |
  | export_type | single |
  | file_count | 1 |
  | total_rows | (실제 행 수) |
  And exported_at에 현재 시각이 기록된다
```

### AC-M4-02: 벌크 출력 이력 기록

```gherkin
Given 사용자가 3개 시스템으로 벌크 출력을 수행할 때
When 다운로드가 성공하면
Then 3개의 이력 레코드가 각 시스템별로 생성되고
  And 각 레코드의 export_type이 "bulk"이고
  And file_count가 1이다 (각 시스템별 1파일)
```

### AC-M4-03: 프로젝트별 출력 이력 조회

```gherkin
Given 프로젝트 "P1"에 출력 이력 15건이 존재할 때
When GET /api/projects/{id}/export/history?limit=10 API를 호출하면
Then 최근 10건의 이력이 시간 역순으로 반환되고
  And 각 항목에 사용자 이름, 시스템 이름, 출력 일시, 출력 타입이 포함된다
```

### AC-M4-04: 출력 이력 UI 표시

```gherkin
Given 프로젝트의 ExportPanel이 열린 상태에서
When 하단의 '출력 이력' 섹션을 확인하면
Then 최근 5건의 출력 이력이 표시되고
  And 각 항목에 "user1 | MES-TRACK | 2026-02-20 14:30 | 단건" 형식으로 표시되고
  And '더 보기' 버튼을 클릭하면 추가 이력이 로딩된다
```

### AC-M4-05: Admin 전체 이력 조회 (Optional)

```gherkin
Given admin 사용자가 전체 출력 이력 페이지에 접근할 때
When GET /api/admin/export-history API를 호출하면
Then 전체 프로젝트의 출력 이력이 시간 역순으로 반환되고
  And 프로젝트 이름 컬럼이 추가로 포함된다
```

---

## 품질 게이트 기준

### Definition of Done

- [ ] 모든 EARS 요구사항(REQ-EXT-001~033)이 구현됨
- [ ] 모든 Acceptance Criteria(AC-M1~M4)가 통과됨
- [ ] Backend: 각 서비스에 대한 단위 테스트 작성 (핵심 로직 커버)
- [ ] Frontend: 각 컴포넌트의 정상 렌더링 검증
- [ ] Admin 엔드포인트에 require_admin 인증 적용 확인
- [ ] 프로젝트 상태 기반 접근 제어 검증 (M2 읽기 전용)
- [ ] Alembic 마이그레이션 정상 실행 확인 (M4)
- [ ] 기존 전산 출력 기능 (SPEC-005)의 정상 동작 유지 (회귀 테스트)

### 검증 방법

| 항목 | 방법 |
|------|------|
| API 정상 동작 | pytest + httpx AsyncClient |
| 인증/인가 | 역할별 접근 테스트 (admin/editor/anonymous) |
| UI 렌더링 | 수동 확인 (브라우저 테스트) |
| 데이터 무결성 | CASCADE 삭제 검증, UNIQUE 제약 검증 |
| 성능 | 60 레이어 x 매핑 컬럼 기준 검증 응답 2초 이내 |
