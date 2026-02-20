# SPEC-EXPORT-002 수용 기준

**SPEC ID**: SPEC-EXPORT-002
**추적 태그**: SPEC-EXPORT-002

---

## M1: External Data Source Registration

### AC-M1-01: 데이터 소스 목록 조회

```gherkin
Given admin 역할의 사용자가 로그인한 상태이고
  And 외부 데이터 소스가 3개 존재할 때 (active 2개, inactive 1개)
When '/admin/data-sources' 페이지에 접근하면
Then 3개의 데이터 소스가 테이블에 표시되고
  And 각 소스의 source_name, table_name, description, join_keys, is_active가 표시되고
  And inactive 소스는 시각적으로 구분(회색 배경 또는 비활성 뱃지)되어야 한다
```

### AC-M1-02: 데이터 소스 등록 (유효한 테이블)

```gherkin
Given admin 사용자가 데이터 소스 관리 페이지에 있고
  And PostgreSQL에 'ext_mes_data' 테이블이 존재할 때
When '데이터 소스 추가' 버튼을 클릭하고
  And source_name: "MES Production Data"
  And table_name: "ext_mes_data"
  And description: "MES 시스템 생산 데이터"
  And join_keys: ["product_id", "step_seq"]
  And '저장' 버튼을 클릭하면
Then POST /api/admin/data-sources API가 호출되고
  And 테이블 존재 검증이 통과되고
  And 201 응답과 함께 새 데이터 소스가 생성되고
  And 데이터 소스 목록이 자동 갱신되어 새 소스가 표시된다
```

### AC-M1-03: 존재하지 않는 테이블 등록 차단

```gherkin
Given admin 사용자가 데이터 소스 추가 폼에서
When table_name에 존재하지 않는 "nonexistent_table"을 입력하고
  And '저장' 버튼을 클릭하면
Then 400 Bad Request 응답이 반환되고
  And "테이블 'nonexistent_table'이 데이터베이스에 존재하지 않습니다" 오류 메시지가 표시된다
```

### AC-M1-04: 중복 source_name 방지

```gherkin
Given "MES Production Data"라는 데이터 소스가 이미 존재할 때
When admin이 동일한 source_name으로 데이터 소스 등록을 시도하면
Then 409 Conflict 응답이 반환되고
  And "이미 존재하는 데이터 소스 이름입니다" 오류 메시지가 표시된다
```

### AC-M1-05: 동적 컬럼 목록 조회

```gherkin
Given 데이터 소스 "MES Production Data" (table_name: ext_mes_data)가 등록되어 있고
  And ext_mes_data 테이블에 product_id(integer), step_seq(integer), ppid(varchar), measure_value(numeric) 컬럼이 있을 때
When GET /api/admin/data-sources/{id}/columns API를 호출하면
Then 4개의 컬럼 정보가 반환되고
  And 각 항목에 column_name과 data_type이 포함되어야 한다
```

### AC-M1-06: 데이터 소스 수정

```gherkin
Given 기존 데이터 소스 "MES Production Data"가 존재할 때
When admin이 수정 버튼을 클릭하고
  And description을 "MES 시스템 생산 데이터 (v2)"로 변경하고
  And join_keys를 ["product_id", "step_seq", "ppid"]로 변경하고 저장하면
Then PUT /api/admin/data-sources/{id} API가 호출되고
  And 200 응답과 함께 수정된 데이터가 반환되고
  And 목록에 수정된 내용이 반영된다
```

### AC-M1-07: 데이터 소스 삭제 (참조 매핑 없음)

```gherkin
Given 데이터 소스 "OLD-SOURCE"에 연관된 export_column_mappings가 없을 때
When admin이 삭제 버튼을 클릭하고 확인하면
Then DELETE /api/admin/data-sources/{id} API가 호출되고
  And 204 응답과 함께 데이터 소스가 삭제되고
  And 목록에서 해당 소스가 제거된다
```

### AC-M1-08: 데이터 소스 삭제 (참조 매핑 존재 - Soft Delete)

```gherkin
Given 데이터 소스 "MES Production Data"에 연관된 매핑이 3개 존재할 때
When admin이 삭제 버튼을 클릭하면
Then "이 데이터 소스를 참조하는 컬럼 매핑 3개가 있습니다. 비활성 처리됩니다." 안내 메시지가 표시되고
When '확인' 버튼을 클릭하면
Then 데이터 소스의 is_active가 false로 변경되고 (soft delete)
  And 목록에서 비활성 상태로 시각적 구분되어 표시된다
```

### AC-M1-09: 비인가 접근 차단

```gherkin
Given editor 역할의 사용자가 로그인한 상태일 때
When GET /api/admin/data-sources API를 호출하면
Then 403 Forbidden 응답이 반환된다
```

---

## M2: Export Column Mapping Extension

### AC-M2-01: source_type='condition' 매핑 (기존 방식)

```gherkin
Given 시스템 "MES-TRACK"의 매핑 관리 화면에서
When '매핑 추가' 버튼을 클릭하고
  And source_type을 "조건표"로 선택하고
  And 카테고리 "SP" 필터에서 "SP_PR_TYPE" 컬럼을 선택하고
  And target_column_name: "RESIST_CODE", is_required: true로 설정하고 저장하면
Then 매핑이 source_type='condition', column_id=(SP_PR_TYPE의 ID)로 생성되고
  And data_source_id와 source_column_name은 null이다
```

### AC-M2-02: source_type='external' 매핑

```gherkin
Given 시스템 "MES-TRACK"의 매핑 관리 화면에서
  And 외부 데이터 소스 "MES Production Data"가 활성 상태로 등록되어 있을 때
When '매핑 추가' 버튼을 클릭하고
  And source_type을 "외부 소스"로 선택하면
Then 활성 데이터 소스 드롭다운이 표시되고
When "MES Production Data"를 선택하면
Then 해당 소스의 컬럼 목록이 동적으로 로드되고
When source_column_name으로 "measure_value"를 선택하고
  And target_column_name: "MES_VALUE", is_required: false로 설정하고 저장하면
Then 매핑이 source_type='external', data_source_id=(MES Production Data의 ID), source_column_name='measure_value'로 생성되고
  And column_id는 null이다
```

### AC-M2-03: 잘못된 external 매핑 차단

```gherkin
Given source_type을 "external"로 선택한 상태에서
When data_source_id를 선택하지 않고 저장을 시도하면
Then 400 Bad Request 응답이 반환되고
  And "외부 소스 매핑에는 데이터 소스와 소스 컬럼명이 필수입니다" 오류 메시지가 표시된다
```

### AC-M2-04: 잘못된 condition 매핑 차단

```gherkin
Given source_type을 "condition"으로 선택한 상태에서
When column_id를 선택하지 않고 저장을 시도하면
Then 400 Bad Request 응답이 반환되고
  And "조건표 매핑에는 컬럼 선택이 필수입니다" 오류 메시지가 표시된다
```

### AC-M2-05: 기존 매핑 하위 호환성

```gherkin
Given 마이그레이션 전에 생성된 기존 매핑이 10개 존재할 때
When 마이그레이션 실행 후 매핑 목록을 조회하면
Then 기존 10개 매핑 모두 source_type='condition'으로 설정되어 있고
  And data_source_id와 source_column_name은 null이고
  And column_id는 기존 값이 유지되고
  And 기존 매핑의 동작이 변경 전과 동일하다
```

### AC-M2-06: 매핑 목록에서 소스 타입 구분 표시

```gherkin
Given 시스템의 매핑 목록에 condition 매핑 3개와 external 매핑 2개가 있을 때
When 매핑 목록을 확인하면
Then condition 매핑에는 "조건표" 뱃지와 column_name이 표시되고
  And external 매핑에는 "외부" 뱃지와 "소스명 > 컬럼명" 형식으로 표시된다
```

### AC-M2-07: 비활성 데이터 소스 필터링

```gherkin
Given 데이터 소스 "OLD-SOURCE"가 is_active=false 상태이고
  And "ACTIVE-SOURCE"가 is_active=true 상태일 때
When 외부 매핑 추가 시 데이터 소스 드롭다운을 열면
Then "ACTIVE-SOURCE"만 표시되고
  And "OLD-SOURCE"는 드롭다운에 나타나지 않는다
```

---

## M3: Export Builder Integration

### AC-M3-01: 조건표 + 외부 데이터 혼합 출력 (Type A)

```gherkin
Given 시스템 "MES-TRACK" (TYPE_A)에 다음 매핑이 있을 때:
  | target_column | source_type | source |
  | RESIST_CODE | condition | SP_PR_TYPE |
  | MES_VALUE | external | MES Production Data > measure_value |
  And 레이어 "L1"의 conditions에 {"SP_PR_TYPE": "POS"} 데이터가 있고
  And ext_mes_data 테이블에 해당 레이어의 measure_value=42.5 데이터가 있을 때
When Type A 출력을 생성하면
Then 레이어 "L1" 행에 RESIST_CODE="POS"와 MES_VALUE="42.5"가 모두 포함된다
```

### AC-M3-02: 외부 데이터 미존재 시 NULL 안전 처리

```gherkin
Given external 매핑에 해당하는 외부 데이터가 없는 레이어 "L5"가 있을 때
When 출력을 생성하면
Then 레이어 "L5"의 외부 매핑 컬럼 값은 빈 문자열("")로 출력되고
  And 오류 없이 정상 생성된다
```

### AC-M3-03: Type B 출력에서 외부 데이터 통합

```gherkin
Given 시스템 (TYPE_B)에 condition + external 매핑이 혼합되어 있고
  And 레이어에 설비 2개 (SCANNER-01, SCANNER-02)가 할당되어 있을 때
When Type B 출력을 생성하면
Then 각 설비 행마다 외부 데이터 컬럼 값이 동일하게 포함되고
  And 설비 equipment_params override는 condition 매핑에만 적용된다
```

### AC-M3-04: Type C 출력에서 외부 데이터 통합

```gherkin
Given 시스템 (TYPE_C)에 external 매핑 "MES_VALUE"가 포함되어 있을 때
When Type C 출력을 생성하면
Then 각 레이어에 PARAM_KEY="MES_VALUE", PARAM_VALUE=(외부 데이터 값) 행이 생성된다
```

### AC-M3-05: 비활성 데이터 소스 매핑 처리

```gherkin
Given external 매핑이 참조하는 데이터 소스가 is_active=false 상태일 때
When 출력을 생성하면
Then 해당 매핑 컬럼의 값은 빈 문자열("")로 처리되고
  And 서버 로그에 "Data source {name} is inactive" 경고가 기록된다
```

### AC-M3-06: Export Validation - 외부 소스 검증

```gherkin
Given 시스템의 매핑에 is_required=true인 external 매핑이 있고
  And 해당 외부 데이터가 일부 레이어에 존재하지 않을 때
When POST /api/projects/{id}/export/validate API를 호출하면
Then 검증 결과에 ERROR 레벨 항목이 포함되고
  And "레이어 L3: 필수 외부 컬럼 MES_VALUE 데이터가 없습니다" 메시지가 포함된다
```

### AC-M3-07: Export Validation - 비활성 소스 경고

```gherkin
Given 시스템의 매핑에 비활성 데이터 소스를 참조하는 external 매핑이 있을 때
When 검증을 수행하면
Then WARNING 레벨 항목이 포함되고
  And "외부 데이터 소스 'OLD-SOURCE'가 비활성 상태입니다" 메시지가 포함된다
```

### AC-M3-08: Export Preview에 외부 데이터 표시

```gherkin
Given 시스템에 external 매핑이 포함되어 있을 때
When Preview API를 호출하면
Then 미리보기 행에 외부 데이터 컬럼 값이 포함되어 표시된다
```

### AC-M3-09: 외부 데이터만으로 구성된 매핑

```gherkin
Given 시스템의 모든 매핑이 source_type='external'일 때
When 출력을 생성하면
Then LAYER_ID, PRODUCT_ID와 함께 외부 데이터 컬럼만으로 구성된 Excel이 생성되고
  And 조건표 데이터(conditions JSONB) 참조 없이 정상 출력된다
```

### AC-M3-10: SQL Injection 방지

```gherkin
Given 데이터 소스의 table_name이 "ext_data; DROP TABLE projects;"일 때
When 데이터 소스 등록을 시도하면
Then information_schema.tables 검증에서 실패하여 등록이 차단되고
  And 악의적인 SQL이 실행되지 않는다
```

---

## 품질 게이트 기준

### Definition of Done

- [ ] 모든 EARS 요구사항(REQ-PIPE-001~027)이 구현됨
- [ ] 모든 Acceptance Criteria(AC-M1~M3)가 통과됨
- [ ] Backend: 각 서비스에 대한 단위 테스트 작성 (핵심 로직 커버)
  - ExportDataSourceService: CRUD + 테이블 검증 + 컬럼 감지
  - ExportAdminService (확장): source_type 분기 + 유효성 검증
  - ExportService (확장): 외부 데이터 조회 + 병합 로직
  - ExportBuilders (확장): external_data 처리 로직
- [ ] Frontend: 신규 컴포넌트(ExportDataSourcesPage, ExportDataSourceForm) 렌더링 검증
- [ ] Frontend: ExportMappingForm의 source_type 전환 + 동적 드롭다운 동작 검증
- [ ] Admin 엔드포인트에 require_admin 인증 적용 확인
- [ ] Alembic 마이그레이션 정상 실행 확인 (export_data_sources 테이블 + export_column_mappings 확장)
- [ ] 기존 전산 출력 기능 (SPEC-EXPORT-001)의 정상 동작 유지 (회귀 테스트)
- [ ] 기존 매핑 데이터의 하위 호환성 검증 (source_type='condition' 자동 설정)
- [ ] SQL Injection 방지 검증 (information_schema 화이트리스트 + 바인딩 파라미터)

### 검증 방법

| 항목 | 방법 |
|------|------|
| API 정상 동작 | pytest + httpx AsyncClient |
| 인증/인가 | 역할별 접근 테스트 (admin/editor/anonymous) |
| 테이블 존재 검증 | 존재/미존재 테이블에 대한 등록 테스트 |
| 동적 컬럼 감지 | 실제 외부 테이블에 대한 information_schema 조회 테스트 |
| 매핑 유효성 | source_type별 필수 필드 누락 시 400 응답 테스트 |
| 하위 호환성 | 마이그레이션 전후 기존 매핑 동작 비교 테스트 |
| 외부 데이터 병합 | 조건표 + 외부 혼합 데이터로 Type A/B/C 출력 생성 및 값 검증 |
| NULL 안전 처리 | 외부 데이터 미존재 레이어에 대한 출력 검증 |
| SQL 보안 | 악의적 table_name/column_name 입력 시 차단 검증 |
| UI 렌더링 | 수동 확인 (브라우저 테스트) |
| 성능 | 60 레이어 x 외부 매핑 컬럼 기준 출력 생성 5초 이내 |
