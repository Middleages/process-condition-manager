# SPEC-CROSS-001: Cross-Layer Validation

## Metadata

| Field       | Value                                     |
| ----------- | ----------------------------------------- |
| SPEC ID     | SPEC-CROSS-001                            |
| Title       | Cross-Layer Validation Engine             |
| Created     | 2026-02-19                                |
| Status      | Planned                                   |
| Priority    | High                                      |
| Phase       | Phase 4                                   |
| Assigned    | expert-backend, expert-frontend           |
| Related     | SPEC-001 (Validation), SPEC-AUTH-001 (RBAC) |

---

## 1. Environment

### 1.1 Current System State

PCM(Process Condition Manager)은 반도체 Photo 공정의 공정조건표를 관리하는 시스템이다. 현재 단일 레이어 수준의 검증(range, required, conditional_required)이 구현되어 있으며, 레이어 간 교차 검증은 아직 구현되지 않았다.

### 1.2 Existing Infrastructure

다음 인프라가 이미 구축되어 있다:

**Backend:**
- `ColumnValidation` 모델: `rule_type` 필드에 `'cross_layer'` 값 이미 지원, `rule_config` JSONB 필드 존재
- `ValidationService` (`backend/app/services/validation_service.py`): range, required, conditional_required 처리하지만 cross_layer는 미구현
- `AdminService` (`backend/app/services/admin_service.py`): `ALLOWED_RULE_TYPES`에 `'cross_layer'` 포함, replace_validations/bulk_upload 동작하지만 cross_layer rule_config 검증 없음
- `EquipmentAssignment` 모델 (`backend/app/models/export.py`): project_layer_id, equipment_id, equipment_params(JSONB) 필드 존재
- Validation API: `POST /api/projects/{id}/validate` 엔드포인트 존재
- Admin API: `PUT /api/admin/columns/{id}/validations` 엔드포인트 존재

**Frontend:**
- `ColumnValidation` 타입: `rule_type`에 `'cross_layer'` 이미 포함
- `validateCellValue()` (`frontend/src/lib/validation.ts`): cross_layer case 미처리
- `ValidationPanel` (`frontend/src/components/editor/ValidationPanel.tsx`): 단일 레이어 오류만 표시
- `ValidationEditModal` (`frontend/src/components/admin/ValidationEditModal.tsx`): cross_layer 선택 시 "Phase 4 - 아직 구현되지 않았습니다" 표시

### 1.3 Domain Context

- 공정조건표: 행=레이어(30~60개), 열=파라미터(~300개), 4개 카테고리(SP/SC/OVL/DEV)
- 제품당 모든 레이어의 조건 데이터가 JSONB(`project_layers.conditions`)에 저장됨
- OVL(Overlay) 카테고리에서 참조 레이어 개념이 핵심 (OVL_REF_LAYER 등)
- 동일 설비에 배정된 레이어들은 호환 가능한 조건 값을 가져야 함

### 1.4 Tech Stack

- Backend: FastAPI, SQLAlchemy 2.x (async), Pydantic v2, PostgreSQL 16
- Frontend: React 18 + TypeScript, AG Grid Community, Zustand
- DB: PostgreSQL 16 with JSONB

---

## 2. Assumptions

| ID   | Assumption                                                                                     | Confidence | Risk if Wrong                              |
| ---- | ---------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------ |
| A-01 | Cross-layer 검증은 서버 사이드에서만 실행된다 (클라이언트 사이드 실시간 검증 불필요)           | High       | 실시간 cross-layer 검증 추가 시 복잡도 증가 |
| A-02 | EquipmentAssignment 모델의 기존 스키마가 equipment_compatibility 검증에 충분하다               | High       | 스키마 변경 및 마이그레이션 필요            |
| A-03 | cross_layer 규칙은 프로젝트 전체 레이어 대상으로 실행된다 (특정 레이어 제외 불가)              | Medium     | 레이어 필터링 로직 추가 필요                |
| A-04 | 기존 ValidationResponse 스키마에 cross-layer 오류 정보를 포함할 수 있다                        | High       | 응답 스키마 변경 필요                       |
| A-05 | cross_layer 규칙 수는 프로젝트당 10~20개 이내로 제한된다                                       | Medium     | 대량 규칙 시 성능 최적화 필요               |
| A-06 | Admin 사용자만 cross-layer 검증 규칙을 생성/수정할 수 있다                                     | High       | 권한 체계 변경 필요                         |

---

## 3. Requirements

### 3.1 Cross-Layer Validation Engine (Backend)

**REQ-CL-001: Reference Layer Existence Validation**

WHEN a cross_layer validation rule with `check_type: "reference_exists"` is active,
the system SHALL verify that the value in the source column points to an existing layer name within the current project.

- `rule_config` 구조:
  ```json
  {
    "check_type": "reference_exists",
    "source_column": "OVL_REF_LAYER",
    "target": "layer_names"
  }
  ```
- 소스 컬럼의 값이 null 또는 빈 문자열인 경우 검증을 건너뛴다 (required 규칙에 위임).
- 해당 레이어 이름이 프로젝트 내 존재하지 않으면 ValidationErrorItem을 생성한다.
- 에러 메시지에 참조된 레이어 이름을 포함한다.

**REQ-CL-002: Layer Value Comparison Validation**

WHEN a cross_layer validation rule with `check_type: "compare_layers"` is active,
the system SHALL compare the column value of the current layer against the same column of the referenced layer using the specified operator and optional threshold ratio.

- `rule_config` 구조:
  ```json
  {
    "check_type": "compare_layers",
    "column": "SC_EXPOSE_ENERGY_mJ",
    "operator": "<=",
    "reference_layer_column": "OVL_REF_LAYER",
    "threshold_ratio": 1.5
  }
  ```
- 지원 연산자: `<=`, `>=`, `<`, `>`, `==`, `!=`
- `threshold_ratio`가 지정된 경우: `current_value operator (reference_value * threshold_ratio)`로 비교한다.
- `threshold_ratio`가 없는 경우: `current_value operator reference_value`로 직접 비교한다.
- 참조 레이어 컬럼(`reference_layer_column`)의 값으로 참조 레이어를 결정한다.
- `reference_layer_column`은 레이어 참조를 저장하는 모든 컬럼을 지정할 수 있다. 예시:
  - `OVL_REF_LAYER` (Overlay reference)
  - `FF_REF_LAYER_1`, `FF_REF_LAYER_2` (Feedforward references)
  - `TROCS_REF_LAYER` (TROCS reference)
  - 각 cross_layer 규칙이 `reference_layer_column`을 통해 어떤 컬럼을 사용할지 지정한다.
- 참조 레이어가 존재하지 않거나 비교 대상 값이 null인 경우 검증을 건너뛴다.
- 비교 실패 시 현재 레이어, 참조 레이어, 양쪽 값을 에러 메시지에 포함한다.

**REQ-CL-003: Equipment Compatibility Validation**

WHEN a cross_layer validation rule with `check_type: "equipment_compatibility"` is active,
the system SHALL verify that layers assigned to the same equipment have compatible values in the specified column.

- `rule_config` 구조:
  ```json
  {
    "check_type": "equipment_compatibility",
    "column": "SC_ILLUM_MODE",
    "compatibility": "same_value"
  }
  ```
- `compatibility` 유형:
  - `"same_value"`: 동일 설비의 모든 레이어에서 해당 컬럼 값이 동일해야 한다.
  - `"within_range"`: 동일 설비의 레이어 값들의 평균(mean)을 구하고, 각 값이 평균 대비 지정된 허용 범위 내에 있어야 한다.
    - 수식: 모든 레이어에 대해 `abs(value - mean) / mean <= range_tolerance` 를 만족해야 한다.
    - 추가 설정: `"range_tolerance": 0.1` (10% 허용 범위)
    - 예시: values=[100, 108, 95], mean=101, tolerance=0.1 -> max deviation=6.9% < 10% -> 통과
- `EquipmentAssignment` 테이블을 조회하여 동일 equipment_id에 배정된 project_layer들을 그룹핑한다.
- 호환성 위반 시 해당 설비 ID, 충돌하는 레이어 이름들, 각각의 값을 에러 메시지에 포함한다.

**REQ-CL-004: Validation Service Integration**

The system SHALL integrate cross-layer validation into the existing `validate_project()` function in `validation_service.py`.

- 기존 단일 레이어 검증(required, range, conditional_required) 이후에 cross-layer 검증을 실행한다.
- cross_layer 타입 규칙만 필터링하여 별도 처리한다.
- cross-layer 오류도 기존 `ValidationErrorItem` 스키마를 사용하되, `rule_type`은 `"cross_layer"`로 설정한다.
- 에러 메시지 포맷은 참조되는 레이어 정보를 포함하여 사용자가 문제를 이해할 수 있도록 한다.
- cross-layer 검증 오류도 기존 단일 레이어 오류와 동일하게 Review 전환을 차단한다.
- 프로젝트 상태를 Draft -> Review로 변경하려면 cross-layer 오류를 포함한 모든 검증 오류가 0건이어야 한다.

**REQ-CL-005: Admin Service - Cross-Layer Rule Config Validation**

WHEN an admin creates or updates a cross_layer validation rule via `PUT /api/admin/columns/{id}/validations`,
the system SHALL validate the `rule_config` structure based on `check_type`.

- `check_type: "reference_exists"`: `source_column` (string, 필수), `target` (string, 필수, "layer_names" 고정) 검증
- `check_type: "compare_layers"`: `column` (string, 필수), `operator` (string, 필수, 허용값), `reference_layer_column` (string, 필수), `threshold_ratio` (number, 선택) 검증
- `check_type: "equipment_compatibility"`: `column` (string, 필수), `compatibility` (string, 필수, "same_value" | "within_range"), `range_tolerance` (number, compatibility가 within_range일 때 필수) 검증
- 유효하지 않은 check_type 또는 필수 필드 누락 시 HTTP 422 에러를 반환한다.

**REQ-CL-006: Seed Data for Cross-Layer Rules**

The system SHALL include sample cross-layer validation rules in the seed data.

- 최소 3개 규칙 (각 check_type별 1개) 포함
- OVL 카테고리의 REF_LAYER 관련 reference_exists 규칙
- SC 카테고리의 EXPOSE_ENERGY 관련 compare_layers 규칙
- SC 카테고리의 ILLUM_MODE 관련 equipment_compatibility 규칙

### 3.2 Cross-Layer Validation UI (Frontend)

**REQ-CL-UI-001: Cross-Layer Error Display in Validation Panel**

WHEN cross-layer validation errors exist,
the system SHALL display them in the ValidationPanel with visual distinction from single-layer errors.

- cross-layer 오류는 아이콘 또는 배지로 구분한다 (예: "Cross" 레이블 또는 링크 아이콘).
- 오류 항목에 참조된 레이어 이름을 추가 표시한다.
- 오류를 rule_type별로 그룹핑할 수 있는 필터를 제공한다.

**REQ-CL-UI-002: Cross-Layer Error Navigation**

WHEN a user clicks on a cross-layer validation error in the ValidationPanel,
the system SHALL navigate to the relevant layer and highlight the affected cell.

- 단일 레이어 오류와 동일한 네비게이션 동작을 유지한다.
- cross-layer 오류의 경우 현재 레이어의 오류 셀로 이동한다.
- 참조 레이어 정보를 에러 메시지에서 확인할 수 있도록 한다.

**REQ-CL-UI-003: Cross-Layer Affected Cell Highlighting**

While cross-layer validation errors exist for a project,
the system SHALL highlight affected cells with a cross-layer specific visual indicator.

- cross-layer 오류 셀에 기존 validation error 스타일과 구별되는 색상 또는 마커를 적용한다.
- 셀 호버 시 cross-layer 오류 메시지를 툴팁으로 표시한다.

### 3.3 Cross-Layer Rule Admin UI (Frontend)

**REQ-CL-ADMIN-001: Cross-Layer Rule Configuration Form**

WHEN an admin selects `cross_layer` rule type in the ValidationEditModal,
the system SHALL display a dynamic form based on the selected `check_type`.

- check_type 선택 드롭다운을 제공한다: reference_exists, compare_layers, equipment_compatibility
- 각 check_type에 따라 동적으로 필드를 표시한다:
  - `reference_exists`: source_column 입력 (컬럼 목록에서 선택)
  - `compare_layers`: column, operator 선택, reference_layer_column 입력, threshold_ratio(선택)
  - `equipment_compatibility`: column, compatibility 선택, range_tolerance(조건부)
- 기존 "Phase 4 - 아직 구현되지 않았습니다" 메시지를 실제 폼으로 교체한다.

**REQ-CL-ADMIN-002: Cross-Layer Rule Preview/Test** [DEFERRED]

> **DEFERRED**: 이 요구사항은 향후 Phase에서 구현한다. 현재 SPEC 범위에서 제외.

~~WHEN an admin has configured a cross-layer rule and clicks "Preview",
the system SHALL execute the rule against current project data and display results without saving.~~

- ~~미리보기는 기존 validate API를 활용하되, 임시 규칙을 포함하여 실행한다.~~
- ~~결과를 모달 내에서 테이블 형태로 표시한다 (위반 레이어, 값, 메시지).~~

---

## 4. Specifications

### 4.1 Backend Architecture

#### 4.1.1 Cross-Layer Validation Service (`cross_layer_validation_service.py` - 신규)

Cross-layer 검증 로직을 별도 서비스 파일로 분리한다: `backend/app/services/cross_layer_validation_service.py`

신규 파일 함수 구조:
- `validate_cross_layer_rules(db, project_id, project_layers, errors)` - 메인 진입점
- `_validate_reference_exists(rule, project_layer, layer_names, col_by_name, errors)`
- `_validate_compare_layers(rule, project_layer, layer_name_to_pl, col_by_name, errors)`
- `_validate_equipment_compatibility(rule, equipment_groups, col_by_name, errors)`

기존 `validation_service.py`의 `validate_project()`는 단일 레이어 검증 이후 `validate_cross_layer_rules()`를 호출한다:

```
validation_service.validate_project(db, project_id)
  1. 기존 로직: 프로젝트/레이어/컬럼 로드
  2. 기존 로직: required, range, conditional_required 검증
  3. [NEW] cross_layer_validation_service.validate_cross_layer_rules() 호출
     → cross_layer 규칙 필터링
     → 프로젝트 레이어 이름 목록 구성
     → EquipmentAssignment 로드 (equipment_compatibility용)
     → 각 cross_layer 규칙에 대해 check_type별 검증 함수 호출
  4. 모든 오류를 errors 리스트에 통합하여 반환
```

#### 4.1.3 Admin Service Changes (`admin_service.py`)

`replace_validations()` 함수에 cross_layer rule_config 검증 로직 추가:

```
if rule.rule_type == "cross_layer":
    check_type = rule.rule_config.get("check_type")
    if check_type not in ("reference_exists", "compare_layers", "equipment_compatibility"):
        raise ValueError(...)
    # check_type별 필수 필드 검증
```

#### 4.1.4 Seed Data

`backend/app/seed/columns.py`에 cross-layer 규칙 3건 추가.

### 4.2 Frontend Architecture

#### 4.2.0 Client-Side Validation (`frontend/src/lib/validation.ts`)

`validateCellValue()` 함수에서 `cross_layer` rule_type에 대해 명시적으로 빈 배열을 반환한다. Cross-layer 검증은 서버 사이드 전용이므로 클라이언트에서 실행하지 않는다.

#### 4.2.1 ValidationPanel Enhancement

`frontend/src/components/editor/ValidationPanel.tsx`:
- cross-layer 오류 구분 표시 (아이콘/배지)
- 참조 레이어 정보 표시 컬럼 추가
- rule_type 필터 드롭다운 추가

#### 4.2.2 ValidationEditModal Enhancement

`frontend/src/components/admin/ValidationEditModal.tsx`:
- check_type 기반 동적 폼 렌더링
- 기존 placeholder 메시지 제거
- rule_config 빌더 UI

#### 4.2.3 Cell Highlighting

AG Grid에서 cross-layer 오류 셀에 대한 스타일링:
- `cellClassRules`에 cross-layer 에러 클래스 추가
- 툴팁에 cross-layer 에러 메시지 포함

### 4.3 Data Flow

```
Admin: 규칙 생성/수정
  → PUT /api/admin/columns/{id}/validations (rule_config 검증 포함)
  → column_validations 테이블에 저장

User: 검증 실행
  → POST /api/projects/{id}/validate
  → validation_service.validate_project()
    → 단일 레이어 검증 (기존)
    → cross-layer 검증 (신규)
  → ValidationResponse 반환
  → ValidationPanel에 모든 오류 표시
```

### 4.4 Error Message Templates

| check_type               | 메시지 템플릿                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| reference_exists         | `"{layer_name}의 {column_name} 값 '{value}'에 해당하는 레이어가 프로젝트에 존재하지 않습니다"` |
| compare_layers           | `"{layer_name}의 {column_name} 값({value})이 참조 레이어 {ref_layer}의 값({ref_value}) 대비 기준({operator} {threshold})을 초과합니다"` |
| equipment_compatibility  | `"설비 {equipment_id}에 배정된 레이어들의 {column_name} 값이 일치하지 않습니다: {layer_values}"` |

### 4.5 ValidationErrorItem Schema 확장

ValidationErrorItem에 optional metadata 필드 추가:
- `metadata`: `dict | None` (기본값 `None`)
- cross_layer 오류 시 참조 레이어 정보를 구조화하여 포함:
  ```json
  {
    "referenced_layer": "AA_PHOTO",
    "referenced_value": "150",
    "check_type": "compare_layers"
  }
  ```
- 기존 단일 레이어 검증(range, required 등) 오류의 metadata는 `null`이다.
- 이 필드는 optional이므로 기존 API 소비자에 대한 하위 호환성이 유지된다.

---

## 5. Constraints

| ID   | Constraint                                                                           |
| ---- | ------------------------------------------------------------------------------------ |
| C-01 | cross_layer 검증은 기존 validate_project API의 응답 스키마에 하위 호환 필드만 추가한다 (optional `metadata` 필드) |
| C-02 | EquipmentAssignment 테이블의 스키마를 변경하지 않는다                                |
| C-03 | 기존 단일 레이어 검증 로직의 동작을 변경하지 않는다                                  |
| C-04 | cross_layer 검증 추가로 인한 validate API 응답 시간 증가는 2초 이내로 제한한다       |
| C-05 | Admin 권한(role: admin)만 cross-layer 규칙을 생성/수정할 수 있다 (기존 RBAC 활용)   |

---

## 6. Traceability

| Requirement        | PRD Reference                          | File(s) Affected                                           |
| ------------------ | -------------------------------------- | ---------------------------------------------------------- |
| REQ-CL-001         | Phase 4, 4.2 참조 레이어 존재          | backend/app/services/cross_layer_validation_service.py     |
| REQ-CL-002         | Phase 4, 4.2 상위 레이어 의존          | backend/app/services/cross_layer_validation_service.py     |
| REQ-CL-003         | Phase 4, 4.2 설비 호환성               | backend/app/services/cross_layer_validation_service.py     |
| REQ-CL-004         | Phase 4, 4.2 통합                      | backend/app/services/validation_service.py                 |
| REQ-CL-005         | Phase 4, Admin                         | backend/app/services/admin_service.py                      |
| REQ-CL-006         | Phase 4, Seed                          | backend/app/seed/columns.py                                |
| REQ-CL-UI-001      | Phase 4, 4.2 UI                        | frontend/src/components/editor/ValidationPanel.tsx          |
| REQ-CL-UI-002      | Phase 4, 4.2 Navigation                | frontend/src/components/editor/ValidationPanel.tsx          |
| REQ-CL-UI-003      | Phase 4, 4.2 Highlighting              | frontend/src/pages/ConditionEditorPage.tsx                  |
| REQ-CL-ADMIN-001   | Phase 4, Admin UI                      | frontend/src/components/admin/ValidationEditModal.tsx       |
| REQ-CL-ADMIN-002   | Phase 4, Admin Preview                 | frontend/src/components/admin/ValidationEditModal.tsx       |
