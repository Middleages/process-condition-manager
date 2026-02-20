# SPEC-CROSS-001: Acceptance Criteria

## Metadata

| Field   | Value            |
| ------- | ---------------- |
| SPEC ID | SPEC-CROSS-001   |
| Title   | Cross-Layer Validation Engine |

---

## M1: Backend Cross-Layer Validation Engine

### AC-M1-01: Reference Layer Existence Validation

**Scenario: 유효한 참조 레이어 존재**

```gherkin
Given 프로젝트에 "AA_PHOTO", "AB_PHOTO", "AC_PHOTO" 레이어가 존재하고
  And column_validations에 rule_type="cross_layer", rule_config={"check_type": "reference_exists", "source_column": "OVL_REF_LAYER", "target": "layer_names"} 규칙이 활성화되어 있고
  And "AB_PHOTO" 레이어의 OVL_REF_LAYER 값이 "AA_PHOTO"일 때
When POST /api/projects/{id}/validate를 호출하면
Then "AB_PHOTO" 레이어의 OVL_REF_LAYER에 대한 cross_layer 오류가 발생하지 않는다
```

**Scenario: 존재하지 않는 참조 레이어**

```gherkin
Given 프로젝트에 "AA_PHOTO", "AB_PHOTO" 레이어가 존재하고
  And reference_exists 규칙이 활성화되어 있고
  And "AB_PHOTO" 레이어의 OVL_REF_LAYER 값이 "ZZ_NONEXIST"일 때
When POST /api/projects/{id}/validate를 호출하면
Then ValidationResponse.errors에 다음 항목이 포함된다:
  | field        | value                                                                    |
  | layer_name   | AB_PHOTO                                                                 |
  | column_name  | OVL_REF_LAYER                                                            |
  | rule_type    | cross_layer                                                              |
  | message      | "AB_PHOTO의 OVL_REF_LAYER 값 'ZZ_NONEXIST'에 해당하는 레이어가 프로젝트에 존재하지 않습니다" |
```

**Scenario: 빈 참조 레이어 값은 건너뛰기**

```gherkin
Given reference_exists 규칙이 활성화되어 있고
  And "AA_PHOTO" 레이어의 OVL_REF_LAYER 값이 null 또는 ""일 때
When POST /api/projects/{id}/validate를 호출하면
Then reference_exists 관련 cross_layer 오류가 발생하지 않는다
```

### AC-M1-02: Layer Value Comparison Validation

**Scenario: 비교 통과 (threshold_ratio 미적용)**

```gherkin
Given 프로젝트에 "AA_PHOTO"(REF), "AB_PHOTO" 레이어가 존재하고
  And compare_layers 규칙: column="SC_EXPOSE_ENERGY_mJ", operator="<=", reference_layer_column="OVL_REF_LAYER"
  And "AB_PHOTO"의 OVL_REF_LAYER="AA_PHOTO"
  And "AB_PHOTO"의 SC_EXPOSE_ENERGY_mJ=100, "AA_PHOTO"의 SC_EXPOSE_ENERGY_mJ=150일 때
When POST /api/projects/{id}/validate를 호출하면
Then compare_layers 관련 cross_layer 오류가 발생하지 않는다
```

**Scenario: 비교 실패 (threshold_ratio 적용)**

```gherkin
Given compare_layers 규칙: column="SC_EXPOSE_ENERGY_mJ", operator="<=", reference_layer_column="OVL_REF_LAYER", threshold_ratio=1.5
  And "AB_PHOTO"의 OVL_REF_LAYER="AA_PHOTO"
  And "AB_PHOTO"의 SC_EXPOSE_ENERGY_mJ=200, "AA_PHOTO"의 SC_EXPOSE_ENERGY_mJ=100일 때
  (200 > 100 * 1.5 = 150)
When POST /api/projects/{id}/validate를 호출하면
Then ValidationResponse.errors에 다음 항목이 포함된다:
  | field        | value         |
  | layer_name   | AB_PHOTO      |
  | rule_type    | cross_layer   |
  And 에러 메시지에 현재 값(200), 참조 레이어(AA_PHOTO), 참조 값(100), 기준(<=, 1.5배)이 포함된다
```

**Scenario: 참조 레이어가 존재하지 않으면 compare 건너뛰기**

```gherkin
Given compare_layers 규칙이 활성화되어 있고
  And "AB_PHOTO"의 OVL_REF_LAYER="ZZ_NONEXIST" (존재하지 않는 레이어)일 때
When POST /api/projects/{id}/validate를 호출하면
Then compare_layers 관련 cross_layer 오류가 발생하지 않는다
  (reference_exists 규칙이 별도로 존재하면 해당 규칙이 오류를 보고)
```

**Scenario: 비교 대상 값이 null인 경우 건너뛰기**

```gherkin
Given compare_layers 규칙이 활성화되어 있고
  And "AB_PHOTO"의 SC_EXPOSE_ENERGY_mJ 값이 null일 때
When POST /api/projects/{id}/validate를 호출하면
Then compare_layers 관련 cross_layer 오류가 발생하지 않는다
```

### AC-M1-03: Equipment Compatibility Validation

**Scenario: 동일 설비, 동일 값 (호환)**

```gherkin
Given EquipmentAssignment에 "AA_PHOTO"와 "AB_PHOTO"가 동일 equipment_id="SCANNER_01"에 배정되어 있고
  And equipment_compatibility 규칙: column="SC_ILLUM_MODE", compatibility="same_value"
  And "AA_PHOTO"의 SC_ILLUM_MODE="Annular", "AB_PHOTO"의 SC_ILLUM_MODE="Annular"일 때
When POST /api/projects/{id}/validate를 호출하면
Then equipment_compatibility 관련 cross_layer 오류가 발생하지 않는다
```

**Scenario: 동일 설비, 다른 값 (비호환)**

```gherkin
Given EquipmentAssignment에 "AA_PHOTO"와 "AB_PHOTO"가 동일 equipment_id="SCANNER_01"에 배정되어 있고
  And equipment_compatibility 규칙: column="SC_ILLUM_MODE", compatibility="same_value"
  And "AA_PHOTO"의 SC_ILLUM_MODE="Annular", "AB_PHOTO"의 SC_ILLUM_MODE="Dipole"일 때
When POST /api/projects/{id}/validate를 호출하면
Then ValidationResponse.errors에 다음 항목이 포함된다:
  | field        | value                   |
  | rule_type    | cross_layer             |
  And 에러 메시지에 설비 ID(SCANNER_01), 충돌 레이어(AA_PHOTO, AB_PHOTO), 각 값(Annular, Dipole)이 포함된다
```

**Scenario: 설비 미배정 프로젝트에서 equipment_compatibility 건너뛰기**

```gherkin
Given EquipmentAssignment 테이블에 해당 프로젝트 레이어 데이터가 없고
  And equipment_compatibility 규칙이 활성화되어 있을 때
When POST /api/projects/{id}/validate를 호출하면
Then equipment_compatibility 관련 cross_layer 오류가 발생하지 않는다
```

**Scenario: within_range 호환성 검증 (통과)**

```gherkin
Given 동일 설비에 배정된 3개 레이어가 있고
  And equipment_compatibility 규칙: column="SC_FOCUS_OFFSET", compatibility="within_range", range_tolerance=0.1
  And "AA_PHOTO"의 SC_FOCUS_OFFSET=100, "AB_PHOTO"의 SC_FOCUS_OFFSET=108, "AC_PHOTO"의 SC_FOCUS_OFFSET=95일 때
  (mean=101, max deviation: |108-101|/101=6.9% < 10%)
When POST /api/projects/{id}/validate를 호출하면
Then equipment_compatibility 관련 cross_layer 오류가 발생하지 않는다
```

**Scenario: within_range 호환성 검증 (실패)**

```gherkin
Given 동일 설비에 배정된 레이어들이 있고
  And equipment_compatibility 규칙: column="SC_FOCUS_OFFSET", compatibility="within_range", range_tolerance=0.05
  And "AA_PHOTO"의 SC_FOCUS_OFFSET=100, "AB_PHOTO"의 SC_FOCUS_OFFSET=115일 때
  (mean=107.5, |115-107.5|/107.5=6.98% > 5%)
When POST /api/projects/{id}/validate를 호출하면
Then equipment_compatibility 관련 cross_layer 오류가 발생한다
```

### AC-M1-04: Admin Rule Config Validation

**Scenario: 유효한 cross_layer 규칙 생성**

```gherkin
Given admin 권한 사용자가 로그인되어 있고
When PUT /api/admin/columns/{id}/validations에 다음 규칙을 전송하면:
  {
    "rule_type": "cross_layer",
    "rule_config": {"check_type": "reference_exists", "source_column": "OVL_REF_LAYER", "target": "layer_names"},
    "error_message": "참조 레이어가 존재하지 않습니다",
    "is_active": true
  }
Then 200 OK 응답이 반환되고
  And column_validations 테이블에 규칙이 저장된다
```

**Scenario: 유효하지 않은 check_type**

```gherkin
Given admin 권한 사용자가 로그인되어 있고
When PUT /api/admin/columns/{id}/validations에 rule_config={"check_type": "invalid_type"}을 전송하면
Then 422 Unprocessable Entity 응답이 반환된다
  And 에러 메시지에 유효한 check_type 목록이 포함된다
```

**Scenario: compare_layers에 필수 필드 누락**

```gherkin
Given admin 권한 사용자가 로그인되어 있고
When PUT /api/admin/columns/{id}/validations에 다음 규칙을 전송하면:
  {
    "rule_type": "cross_layer",
    "rule_config": {"check_type": "compare_layers", "column": "SC_EXPOSE_ENERGY_mJ"},
    "error_message": "비교 오류"
  }
  (operator, reference_layer_column 누락)
Then 422 Unprocessable Entity 응답이 반환된다
  And 에러 메시지에 누락된 필드(operator, reference_layer_column)가 명시된다
```

**Scenario: equipment_compatibility with within_range에 range_tolerance 누락**

```gherkin
Given admin 권한 사용자가 로그인되어 있고
When PUT /api/admin/columns/{id}/validations에 다음 규칙을 전송하면:
  {
    "rule_type": "cross_layer",
    "rule_config": {"check_type": "equipment_compatibility", "column": "SC_FOCUS_OFFSET", "compatibility": "within_range"},
    "error_message": "호환성 오류"
  }
  (range_tolerance 누락)
Then 422 Unprocessable Entity 응답이 반환된다
  And 에러 메시지에 range_tolerance 필수를 명시한다
```

### AC-M1-05: Seed Data

```gherkin
Given seed 스크립트가 실행된 후
When column_validations 테이블에서 rule_type="cross_layer" 규칙을 조회하면
Then 최소 3건의 규칙이 존재한다:
  | check_type              | target column    |
  | reference_exists        | OVL_REF_LAYER    |
  | compare_layers          | SC_EXPOSE_ENERGY |
  | equipment_compatibility | SC_ILLUM_MODE    |
```

### AC-M1-06: 기존 검증 호환성

```gherkin
Given cross-layer 검증이 추가된 후
When 기존 단일 레이어 검증(required, range, conditional_required)이 실행되면
Then 기존 검증 결과와 동일한 오류가 반환된다
  And cross-layer 검증 추가로 인해 기존 오류가 누락되거나 변경되지 않는다
```

### AC-M1-07: 성능 요구사항

```gherkin
Given 60개 레이어, 300개 컬럼, 20개 cross-layer 규칙이 있는 프로젝트에서
When POST /api/projects/{id}/validate를 호출하면
Then 응답 시간이 2초 이내이다
```

### AC-M1-08: Cross-Layer 오류 시 Review 전환 차단

**Scenario: cross-layer 오류 존재 시 Review 전환 불가**

```gherkin
Given 프로젝트에 cross_layer 검증 오류가 1건 이상 존재할 때
When Draft → Review 상태 전환을 시도하면
Then 상태 전환이 거부된다
  And "검증 오류가 존재하여 Review 요청할 수 없습니다" 메시지가 반환된다
```

**Scenario: cross-layer 오류 해결 후 Review 전환 가능**

```gherkin
Given 프로젝트의 모든 검증 오류(단일 레이어 + cross-layer)가 0건일 때
When Draft → Review 상태 전환을 시도하면
Then 상태 전환이 성공한다
```

### AC-M1-09: ValidationErrorItem metadata 필드

**Scenario: cross-layer 오류에 metadata 포함**

```gherkin
Given cross_layer 검증에서 compare_layers 오류가 발생했을 때
When ValidationResponse를 확인하면
Then 해당 ValidationErrorItem의 metadata 필드에 다음 정보가 포함된다:
  | key               | example value   |
  | check_type        | compare_layers  |
  | referenced_layer  | AA_PHOTO        |
  | referenced_value  | 150             |
```

**Scenario: 단일 레이어 오류의 metadata는 null**

```gherkin
Given 기존 단일 레이어 검증(range, required 등)에서 오류가 발생했을 때
When ValidationResponse를 확인하면
Then 해당 ValidationErrorItem의 metadata 필드가 null이다
```

---

## M2: Cross-Layer Validation UI

### AC-M2-01: Cross-Layer Error Display

```gherkin
Given 프로젝트 검증 결과에 cross_layer rule_type 오류가 포함되어 있을 때
When ValidationPanel이 렌더링되면
Then cross-layer 오류에 "Cross" 배지 또는 링크 아이콘이 표시된다
  And 오류 메시지에 참조 레이어 정보가 포함되어 있다
  And 단일 레이어 오류와 cross-layer 오류가 시각적으로 구분된다
```

### AC-M2-02: Error Type Filter

```gherkin
Given ValidationPanel에 단일 레이어 오류 5건과 cross-layer 오류 3건이 표시되어 있을 때
When 사용자가 "Cross-Layer" 필터를 클릭하면
Then cross-layer 오류 3건만 표시된다
  And 필터 해제 시 전체 8건이 다시 표시된다
```

### AC-M2-03: Cross-Layer Error Navigation

```gherkin
Given ValidationPanel에 cross-layer 오류가 표시되어 있고
  And 오류의 layer_name="AB_PHOTO", column_name="OVL_REF_LAYER"일 때
When 사용자가 해당 오류를 클릭하면
Then AG Grid가 "AB_PHOTO" 레이어의 "OVL_REF_LAYER" 셀로 스크롤 및 포커스된다
```

### AC-M2-04: Cross-Layer Cell Highlighting

```gherkin
Given 프로젝트에 cross-layer 검증 오류가 있는 셀이 존재할 때
When ConditionEditorPage가 렌더링되면
Then cross-layer 오류 셀에 기존 validation error와 구별되는 시각적 표시(주황색 또는 좌측 테두리)가 적용된다
  And 해당 셀에 마우스를 올리면 cross-layer 오류 메시지가 툴팁으로 표시된다
```

### AC-M2-05: 복합 오류 셀

```gherkin
Given 하나의 셀에 단일 레이어 오류(range)와 cross-layer 오류가 동시에 존재할 때
When 해당 셀이 렌더링되면
Then 두 오류 유형의 스타일이 모두 적용된다 (또는 더 심각한 스타일이 우선)
  And 툴팁에 모든 오류 메시지가 표시된다
```

---

## M3: Cross-Layer Rule Admin UI

### AC-M3-01: Dynamic Form - reference_exists

```gherkin
Given admin 사용자가 ValidationEditModal을 열고
  And rule_type으로 "cross_layer"를 선택했을 때
When check_type 드롭다운에서 "reference_exists"를 선택하면
Then source_column 선택 필드가 표시된다 (컬럼 목록에서 선택)
  And target 필드가 "layer_names"로 자동 설정된다
```

### AC-M3-02: Dynamic Form - compare_layers

```gherkin
Given admin 사용자가 ValidationEditModal에서 cross_layer를 선택했을 때
When check_type 드롭다운에서 "compare_layers"를 선택하면
Then 다음 필드들이 표시된다:
  | field                 | type     | required |
  | column                | select   | yes      |
  | operator              | select   | yes      |
  | reference_layer_column | select  | yes      |
  | threshold_ratio       | number   | no       |
  And operator 선택지에 <=, >=, <, >, ==, != 가 포함된다
```

### AC-M3-03: Dynamic Form - equipment_compatibility

```gherkin
Given admin 사용자가 check_type으로 "equipment_compatibility"를 선택했을 때
When compatibility 필드에서 "within_range"를 선택하면
Then range_tolerance 숫자 입력 필드가 추가로 표시된다
  And compatibility가 "same_value"일 때는 range_tolerance 필드가 숨겨진다
```

### AC-M3-04: Placeholder 제거

```gherkin
Given admin 사용자가 ValidationEditModal에서 cross_layer를 선택했을 때
When 모달이 렌더링되면
Then "Phase 4 - 아직 구현되지 않았습니다" 메시지가 더 이상 표시되지 않는다
  And 대신 check_type 기반 동적 폼이 표시된다
```

### AC-M3-05: Rule Preview [DEFERRED]

> **DEFERRED**: Preview/Test 기능은 향후 Phase에서 구현한다. 현재 SPEC 범위에서 제외.

~~```gherkin
Given admin 사용자가 cross-layer 규칙을 구성한 후
When "Preview" 버튼을 클릭하면
Then 현재 프로젝트 데이터에 대해 해당 규칙이 실행되고
  And 결과가 모달 내 테이블로 표시된다
  And 규칙은 아직 저장되지 않은 상태이다
```~~

### AC-M3-06: 유효하지 않은 폼 제출 방지

```gherkin
Given admin 사용자가 cross_layer 규칙에서 compare_layers를 선택하고
  And operator 필드를 비워둔 채
When "Save" 버튼을 클릭하면
Then 클라이언트 사이드 검증으로 operator 필수 에러가 표시된다
  And 서버 요청이 발생하지 않는다
```

---

## Definition of Done

### M1 (Backend Engine)
- [ ] `cross_layer_validation_service.py` 신규 파일 생성
- [ ] `validate_cross_layer_rules()` 메인 진입점 구현
- [ ] `_validate_reference_exists()` 함수 구현 및 테스트 통과
- [ ] `_validate_compare_layers()` 함수 구현 및 테스트 통과
- [ ] `_validate_equipment_compatibility()` 함수 구현 및 테스트 통과
- [ ] `validate_project()`에서 cross_layer_validation_service 호출 통합
- [ ] `replace_validations()`에 cross_layer rule_config 검증 추가
- [ ] Seed data에 cross-layer 규칙 3건 추가 (`backend/app/seed/columns.py`)
- [ ] 기존 단일 레이어 검증 동작 변경 없음 확인
- [ ] cross-layer 오류 시 Review 전환 차단 동작 확인
- [ ] ValidationErrorItem metadata 필드 동작 확인
- [ ] pytest 커버리지 85%+ (신규 함수 대상)

### M2 (Validation UI)
- [ ] ValidationPanel에서 cross-layer 오류 구분 표시
- [ ] rule_type 필터 동작
- [ ] cross-layer 오류 클릭 시 셀 네비게이션 동작
- [ ] AG Grid에서 cross-layer 오류 셀 하이라이팅
- [ ] 셀 호버 시 cross-layer 오류 툴팁 표시

### M3 (Admin UI)
- [ ] cross_layer 선택 시 동적 폼 렌더링 (3개 check_type)
- [ ] "Phase 4 - 아직 구현되지 않았습니다" 메시지 제거
- [ ] 폼 유효성 검증 (필수 필드)
- [ ] cross-layer 규칙 저장 및 수정 동작 확인
