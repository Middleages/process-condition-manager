# SPEC-CROSS-001: Implementation Plan

## Metadata

| Field   | Value            |
| ------- | ---------------- |
| SPEC ID | SPEC-CROSS-001   |
| Title   | Cross-Layer Validation Engine |

---

## Milestones

### M1: Backend Cross-Layer Validation Engine (Primary Goal)

**목표:** 3가지 check_type(reference_exists, compare_layers, equipment_compatibility)에 대한 서버 사이드 검증 엔진 구현 및 Admin rule_config 검증 추가.

#### Technical Approach

**1. Cross-Layer Validation Service 신규 생성** (`backend/app/services/cross_layer_validation_service.py`)

현재 `validate_project()` 함수는 레이어별로 순회하며 단일 레이어 검증만 수행한다. Cross-layer 검증은 전체 프로젝트 레이어 데이터에 접근해야 하므로, 별도 서비스 파일로 분리하여 기존 레이어별 루프 이후 호출한다.

신규 파일 (`cross_layer_validation_service.py`) 함수:
- `validate_cross_layer_rules(db, project_id, project_layers, errors)`: 메인 진입점, cross_layer 규칙 필터링 및 데이터 준비 후 각 check_type별 검증 함수 호출
- `_validate_reference_exists(rule, project_layer, layer_names, col_by_name, errors)`: 소스 컬럼 값이 프로젝트 레이어 이름 목록에 존재하는지 확인
- `_validate_compare_layers(rule, project_layer, layer_name_to_pl, col_by_name, errors)`: 참조 레이어 컬럼으로 참조 레이어를 찾고 값 비교 수행
- `_validate_equipment_compatibility(rule, equipment_groups, col_by_name, errors)`: 동일 설비 그룹 내 레이어 간 값 호환성 검증
  - `within_range` 수식: `abs(value - mean) / mean <= range_tolerance`

기존 `validation_service.py`의 `validate_project()`에서는 단일 레이어 검증 이후 `validate_cross_layer_rules()`를 호출하는 한 줄만 추가한다.

데이터 로드 전략:
- `EquipmentAssignment` 데이터는 equipment_compatibility 규칙이 존재할 때만 조회 (lazy load)
- 레이어 이름 -> ProjectLayer 매핑은 한 번만 구성하여 재사용

**2. Admin Service 확장** (`backend/app/services/admin_service.py`)

`replace_validations()` 함수에 cross_layer 전용 검증 로직 추가:
- check_type 유효성 검증
- check_type별 필수 필드 검증
- operator 허용값 검증 (compare_layers)
- compatibility 허용값 검증 (equipment_compatibility)

**3. Seed Data** (`backend/app/seed/columns.py`)

기존 seed 스크립트에 cross-layer 규칙 3건 추가:
- OVL_REF_LAYER에 대한 reference_exists 규칙
- SC_EXPOSE_ENERGY_mJ에 대한 compare_layers 규칙
- SC_ILLUM_MODE에 대한 equipment_compatibility 규칙

#### File Changes

| File | Action | Description |
| ---- | ------ | ----------- |
| `backend/app/services/cross_layer_validation_service.py` | Create | cross_layer 검증 서비스 (3개 헬퍼 함수 + validate_cross_layer_rules 진입점) |
| `backend/app/services/validation_service.py` | Modify | validate_project()에서 cross_layer_validation_service 호출 추가 |
| `backend/app/services/admin_service.py` | Modify | replace_validations()에 cross_layer rule_config 검증 추가 |
| `backend/app/seed/columns.py` | Modify | cross-layer 규칙 시드 데이터 3건 추가 |

#### Risks and Mitigations

| Risk | Probability | Impact | Mitigation |
| ---- | ----------- | ------ | ---------- |
| EquipmentAssignment 데이터가 없는 프로젝트에서 equipment_compatibility 실행 | Medium | Low | 설비 배정 없으면 검증 건너뛰기 |
| 대량 레이어(60개) x 대량 규칙(20개)으로 성능 저하 | Low | Medium | lazy loading, 한 번의 쿼리로 필요 데이터 모두 로드 |
| 참조 레이어 컬럼 값이 잘못된 형식일 때 에러 | Medium | Low | null/empty 값은 건너뛰기, try-except로 형변환 오류 처리 |

---

### M2: Cross-Layer Validation UI (Secondary Goal)

**목표:** 프론트엔드에서 cross-layer 검증 오류를 시각적으로 구분하여 표시하고, 오류 네비게이션 및 셀 하이라이팅을 구현한다.

#### Technical Approach

**1. ValidationPanel 개선** (`frontend/src/components/editor/ValidationPanel.tsx`)

현재 ValidationPanel은 모든 오류를 동일한 형태로 표시한다. Cross-layer 오류 구분을 위해:
- `rule_type`이 `"cross_layer"`인 오류에 링크 아이콘 및 "Cross" 배지 추가
- 오류 메시지에 참조 레이어 정보가 이미 포함되어 있으므로 (REQ-CL-004) 추가 파싱 불필요
- 상단에 rule_type 필터 버튼 추가 (All / Single / Cross-Layer)

**2. 오류 네비게이션**

기존 `onErrorClick` 핸들러는 layer_id와 column_name으로 셀을 찾아 이동한다. Cross-layer 오류도 동일한 구조(layer_id, column_name)를 사용하므로 기존 네비게이션 로직을 그대로 활용한다.

**3. 셀 하이라이팅** (`frontend/src/pages/ConditionEditorPage.tsx`)

AG Grid의 `cellClassRules`를 활용하여:
- 기존 validation error 셀: 빨간색 배경 (유지)
- cross-layer error 셀: 주황색 배경 또는 좌측 테두리로 구분
- 셀 호버 시 cross-layer 에러 메시지를 툴팁으로 표시 (`tooltipValueGetter` 활용)

#### File Changes

| File | Action | Description |
| ---- | ------ | ----------- |
| `frontend/src/components/editor/ValidationPanel.tsx` | Modify | cross-layer 오류 구분 표시, 필터 추가 |
| `frontend/src/pages/ConditionEditorPage.tsx` | Modify | cross-layer 셀 하이라이팅 스타일 추가 |
| `frontend/src/styles/` or CSS | Modify | cross-layer 오류 셀 스타일 정의 |

#### Risks and Mitigations

| Risk | Probability | Impact | Mitigation |
| ---- | ----------- | ------ | ---------- |
| cross-layer 오류가 대량 발생 시 ValidationPanel 성능 저하 | Low | Medium | 가상 스크롤 적용 또는 페이지네이션 |
| 기존 셀 하이라이팅과 cross-layer 하이라이팅 충돌 | Medium | Low | CSS 우선순위로 해결, cross-layer는 별도 클래스 |

---

### M3: Cross-Layer Rule Admin UI - Dynamic Form (Final Goal)

**목표:** Admin 사용자가 cross-layer 규칙을 생성/수정할 수 있는 동적 폼을 제공한다.

> **Note:** Preview/Test 기능(REQ-CL-ADMIN-002)은 DEFERRED로, 향후 Phase에서 구현한다.

#### Technical Approach

**1. ValidationEditModal 개선** (`frontend/src/components/admin/ValidationEditModal.tsx`)

현재 cross_layer 선택 시 placeholder 텍스트만 표시한다. 이를 동적 폼으로 교체:
- check_type 선택 드롭다운 (3가지 옵션)
- check_type별 동적 필드 렌더링:
  - `reference_exists`: source_column select (컬럼 목록에서 선택)
  - `compare_layers`: column select, operator select, reference_layer_column input, threshold_ratio number input
  - `equipment_compatibility`: column select, compatibility select, range_tolerance number input (조건부)
- 컬럼 목록은 기존 Admin API에서 제공하는 ColumnDefinition 데이터를 활용

#### File Changes

| File | Action | Description |
| ---- | ------ | ----------- |
| `frontend/src/components/admin/ValidationEditModal.tsx` | Modify | cross_layer 동적 폼 구현, placeholder 제거 |
| `frontend/src/components/admin/CrossLayerRuleForm.tsx` | Create | check_type별 동적 폼 컴포넌트 |

#### Risks and Mitigations

| Risk | Probability | Impact | Mitigation |
| ---- | ----------- | ------ | ---------- |
| 동적 폼의 복잡한 조건부 렌더링 | Low | Low | check_type별 서브 컴포넌트로 분리 |

---

## Architecture Design Direction

### Backend

```
validation_service.py
├── validate_project() ............... [기존] 진입점
│   ├── 단일 레이어 검증 루프 ......... [기존] required, range, conditional_required
│   └── validate_cross_layer_rules()    [신규] cross_layer_validation_service 호출
│
cross_layer_validation_service.py ...... [신규 파일]
├── validate_cross_layer_rules() ...... 메인 진입점
│   ├── _validate_reference_exists()
│   ├── _validate_compare_layers()
│   └── _validate_equipment_compatibility()
│
admin_service.py
├── replace_validations() ............ [기존] 규칙 교체
│   └── _validate_cross_layer_config()  [신규] rule_config 검증
```

### Frontend

```
lib/
└── validation.ts .................... [수정] cross_layer case에 빈 배열 반환 (서버 전용 검증)
components/
├── editor/
│   └── ValidationPanel.tsx .......... [수정] cross-layer 오류 구분 + 필터
├── admin/
│   ├── ValidationEditModal.tsx ...... [수정] cross_layer 동적 폼
│   └── CrossLayerRuleForm.tsx ....... [신규] check_type별 폼 컴포넌트
pages/
└── ConditionEditorPage.tsx .......... [수정] cross-layer 셀 하이라이팅
```

### Data Flow

```
[Admin] 규칙 생성
  → admin_service.replace_validations()
  → _validate_cross_layer_config() [rule_config 검증]
  → column_validations 저장

[User] 검증 실행
  → validation_service.validate_project()
  → 1. 단일 레이어 검증 (기존)
  → 2. cross_layer_validation_service.validate_cross_layer_rules() (신규)
     → EquipmentAssignment 로드 (필요 시)
     → 각 규칙별 검증 함수 실행
  → ValidationResponse 반환 (metadata 필드 포함)

[Frontend] 결과 표시
  → validateCellValue(): cross_layer → 빈 배열 반환 (서버 전용)
  → ValidationPanel: 오류 목록 (rule_type별 구분)
  → AG Grid: 셀 하이라이팅 (cross-layer vs single-layer 구분)
```

---

## Dependency Map

```
M1 (Backend Engine) ← 독립 실행 가능
  │
  ├──→ M2 (Validation UI) ← M1 완료 후 실행
  │
  └──→ M3 (Admin UI) ← M1 완료 후 실행 (M2와 병렬 가능)
```

---

## Quality Gates

| Gate | Criteria |
| ---- | -------- |
| Test Coverage | M1: validation_service 신규 함수 85%+ 커버리지 |
| Test Coverage | M2: ValidationPanel 렌더링 테스트 |
| Performance | validate API 응답 시간 2초 이내 (60레이어, 20규칙 기준) |
| Compatibility | 기존 단일 레이어 검증 동작 변경 없음 |
| Security | cross-layer 규칙 CRUD는 admin 권한만 가능 |
