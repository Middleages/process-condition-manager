# SPEC-BACKBONE-001: Acceptance Criteria

## 추적 태그: SPEC-BACKBONE-001

---

## M1: Backbone 자격 판정 + 조건 복사 소스 변경

### AC-1.1: Backbone 자격 판정 - Approved 프로젝트 존재

**Given** 제품 A에 `status='approved' AND is_latest=true`인 프로젝트가 존재할 때
**When** `GET /api/products?is_backbone=true` API를 호출하면
**Then** 응답 목록에 제품 A가 포함되어야 한다

### AC-1.2: Backbone 자격 판정 - Approved 프로젝트 없음

**Given** 제품 B에 프로젝트가 하나도 없거나, 모든 프로젝트가 `draft`, `review`, `rejected`, `archived` 상태일 때
**When** `GET /api/products?is_backbone=true` API를 호출하면
**Then** 응답 목록에 제품 B가 포함되지 않아야 한다

### AC-1.3: Backbone 자격 판정 - 개정 중인 제품

**Given** 제품 C에 대해 Revision이 생성되어 최신 프로젝트가 `status='draft', is_latest=true`이고, 이전 프로젝트가 `status='archived', is_latest=false`일 때
**When** `GET /api/products?is_backbone=true` API를 호출하면
**Then** 응답 목록에 제품 C가 포함되지 않아야 한다

### AC-1.4: Backbone 자격 판정 - 개정 승인 후 자격 회복

**Given** 제품 C의 개정 프로젝트가 `status='approved', is_latest=true`로 전환되었을 때
**When** `GET /api/products?is_backbone=true` API를 호출하면
**Then** 응답 목록에 제품 C가 포함되어야 한다

### AC-1.5: Backbone 자격 판정 - 라인 필터

**Given** Line 1에 속한 제품 A (Approved 프로젝트 있음)와 Line 2에 속한 제품 D (Approved 프로젝트 있음)가 있을 때
**When** `GET /api/products?is_backbone=true&line_id=1` API를 호출하면
**Then** 응답 목록에 제품 A만 포함되고 제품 D는 제외되어야 한다

### AC-1.6: 프로젝트 생성 - Backbone 조건 소스 변경

**Given** 제품 X에 Approved 프로젝트 (v2)가 있고, 해당 프로젝트의 `project_layers`에 레이어 L1의 조건이 `{"PARAM_A": "100", "PARAM_B": "200"}`일 때
**And** 마스터 `product_layers`의 L1 조건은 `{"PARAM_A": "50", "PARAM_B": "150"}`(구버전)일 때
**When** 제품 Y를 생성하면서 Backbone으로 제품 X를 선택하면
**Then** 생성된 프로젝트의 L1 레이어 `conditions`는 `{"PARAM_A": "100", "PARAM_B": "200"}`이어야 한다 (Approved 프로젝트 조건)
**And** `backbone_conditions`도 `{"PARAM_A": "100", "PARAM_B": "200"}`이어야 한다

### AC-1.7: 프로젝트 생성 - 비자격 제품 차단

**Given** 제품 Z에 Approved 프로젝트가 없을 때 (Draft 상태만 존재)
**When** 제품 Y를 생성하면서 `backbone_product_id`로 제품 Z의 ID를 전송하면
**Then** HTTP 400 에러가 반환되어야 한다
**And** 에러 메시지에 Backbone 자격이 없음을 설명하는 내용이 포함되어야 한다

### AC-1.8: 레이어별 Backbone 교체 - 소스 변경

**Given** 프로젝트 P (Draft 상태)의 레이어 L1이 있고
**And** 소스 제품 X에 Approved 프로젝트가 있으며, 해당 프로젝트의 L1 조건이 `{"PARAM_C": "300"}`일 때
**When** `POST /api/projects/{P}/layers/{L1}/backbone` API로 `source_product_id=X`를 전송하면
**Then** 프로젝트 P의 L1 `conditions`가 `{"PARAM_C": "300"}`으로 교체되어야 한다
**And** `backbone_conditions`도 `{"PARAM_C": "300"}`으로 갱신되어야 한다
**And** `backbone_product_id`가 제품 X의 ID로 갱신되어야 한다

### AC-1.9: 레이어별 Backbone 교체 - 비자격 소스 차단

**Given** 소스 제품 Z에 Approved 프로젝트가 없을 때
**When** `replace_layer_backbone()` API에 `source_product_id=Z`를 전송하면
**Then** HTTP 400 에러가 반환되어야 한다

### AC-1.10: 레이어 추가 - 소스 변경

**Given** 프로젝트 P (Draft 상태)에 레이어 L5가 없고
**And** 소스 제품 X에 Approved 프로젝트가 있으며, 해당 프로젝트에 L5 레이어 조건이 존재할 때
**When** `add_layer()` API에 `source_product_id=X`와 `layer_id=L5`를 전송하면
**Then** Approved 프로젝트의 L5 조건이 새 `project_layer`의 `conditions`와 `backbone_conditions`에 복사되어야 한다

### AC-1.11: 기존 프로젝트 데이터 보존

**Given** 기존에 `is_backbone=True` 기반으로 생성된 프로젝트들이 존재할 때
**When** 이 SPEC의 변경이 배포된 후
**Then** 기존 프로젝트의 `backbone_conditions`, `backbone_product_id` 데이터는 변경 없이 보존되어야 한다

### AC-1.12: ChangeLog 기록 유지

**Given** 레이어별 Backbone 교체가 수행될 때
**When** 조건이 변경되면
**Then** 기존과 동일하게 `change_logs` 테이블에 `change_type='backbone'`으로 변경 이력이 기록되어야 한다

---

## M2: Frontend Backbone 선택 UI 변경

### AC-2.1: ProjectCreateModal - Backbone 드롭다운

**Given** Line 1에 Approved 프로젝트가 있는 제품이 2개, 없는 제품이 3개 있을 때
**When** ProjectCreateModal에서 Line 1을 선택하면
**Then** Backbone 드롭다운에는 Approved 프로젝트가 있는 2개 제품만 표시되어야 한다

### AC-2.2: ProjectCreateModal - 빈 Backbone 목록 처리

**Given** 선택한 라인에 Approved 프로젝트가 있는 제품이 하나도 없을 때
**When** Backbone 드롭다운을 확인하면
**Then** 빈 목록이 표시되어야 한다
**And** 프로젝트 생성 버튼은 비활성화 상태여야 한다

### AC-2.3: BackboneReplaceModal - 소스 제품 목록

**Given** Backbone 교체 모달이 열렸을 때
**When** 소스 Backbone 제품 드롭다운을 확인하면
**Then** Approved 프로젝트가 있는 제품만 표시되어야 한다

### AC-2.4: BackboneReplaceModal - 소스 레이어 목록

**Given** BackboneReplaceModal에서 소스 제품 X를 선택했을 때
**When** 소스 레이어 드롭다운이 로드되면
**Then** 제품 X의 Approved 프로젝트에 속한 `project_layers`의 레이어 목록이 표시되어야 한다
**And** 마스터 `product_layers`의 레이어가 아닌 Approved 프로젝트 레이어가 기준이어야 한다

### AC-2.5: BackboneReplaceModal - 자동 레이어 매칭

**Given** 대상 레이어가 "Layer_001"이고, 소스 제품의 Approved 프로젝트에 "Layer_001" 레이어가 존재할 때
**When** 소스 제품을 선택하면
**Then** 소스 레이어 드롭다운에 "Layer_001"이 자동 선택되어야 한다

### AC-2.6: LayerAddModal - 소스 Backbone 목록

**Given** LayerAddModal이 열렸을 때
**When** 소스 Backbone 제품 드롭다운을 확인하면
**Then** Approved 프로젝트가 있는 제품만 표시되어야 한다

### AC-2.7: Admin 제품 관리 - Backbone 상태 표시 (Optional)

**Given** Admin 제품 관리 페이지에 접근했을 때
**When** 제품 목록을 확인하면
**Then** Approved 프로젝트가 있는 제품에는 "Backbone 자격" 뱃지가 표시되어야 한다
**And** `is_backbone` 체크박스 편집 기능은 제거되거나 비활성화되어야 한다

---

## M3: `is_backbone` 플래그 제거 (Optional)

### AC-3.1: DB 컬럼 제거

**Given** M1, M2가 완료되어 `is_backbone` 필드가 더 이상 로직에서 사용되지 않을 때
**When** Alembic 마이그레이션을 실행하면
**Then** `products` 테이블에서 `is_backbone` 컬럼이 제거되어야 한다
**And** 기존 데이터의 다른 컬럼은 영향받지 않아야 한다

### AC-3.2: API 응답 필드 제거

**Given** `is_backbone` 컬럼이 제거된 후
**When** `GET /api/products` API를 호출하면
**Then** 응답에 `is_backbone` 필드가 포함되지 않아야 한다

### AC-3.3: Admin UI 필드 제거

**Given** `is_backbone` 컬럼이 제거된 후
**When** Admin 제품 생성/수정 모달을 확인하면
**Then** `is_backbone` 입력 필드가 존재하지 않아야 한다

### AC-3.4: 시드 데이터 정리

**Given** `is_backbone` 컬럼이 제거된 후
**When** 시드 데이터 스크립트를 실행하면
**Then** `is_backbone` 관련 설정 코드 없이 정상 실행되어야 한다

### AC-3.5: 마이그레이션 롤백 가능

**Given** `is_backbone` 컬럼 제거 마이그레이션이 적용된 후
**When** `alembic downgrade -1`을 실행하면
**Then** `products.is_backbone` 컬럼이 `Boolean, default=False`로 복원되어야 한다

---

## Quality Gate 기준

### 테스트 커버리지

- M1 변경 파일: 85% 이상 커버리지 필수
  - `backbone_eligibility.py` (신규): 90% 이상
  - `project_service.py` (변경): 기존 커버리지 유지 이상
  - `backbone_service.py` (변경): 기존 커버리지 유지 이상
  - `products.py` router (변경): 기존 커버리지 유지 이상
- M2 변경: Frontend 타입 안전성 검증 (TypeScript strict mode 통과)
- M3: 마이그레이션 up/down 양방향 테스트

### 성능 기준

- Backbone 목록 API 응답 시간: P95 < 200ms (제품 100개, 프로젝트 500개 기준)
- 프로젝트 생성 API 응답 시간: 기존 대비 10% 이내 증가 허용

### 하위 호환성

- M1/M2 적용 후: 기존 프로젝트 데이터 무결성 100% 보존
- M1/M2 적용 후: 기존 API 인터페이스(`is_backbone` 파라미터) 호환 유지
- M3 적용 전: `is_backbone` 파라미터 동작 보장

### Definition of Done

- [ ] M1: 모든 Backbone 관련 서비스가 동적 판정 로직으로 전환됨
- [ ] M1: 조건 복사 소스가 Approved 프로젝트 `project_layers`로 변경됨
- [ ] M1: 기존 테스트가 신규 로직에 맞게 업데이트되고 전부 통과
- [ ] M1: 개정 시나리오 (Backbone 자격 상실/회복) 테스트 통과
- [ ] M2: Frontend의 모든 Backbone 드롭다운이 동적 목록을 사용
- [ ] M2: BackboneReplaceModal 레이어 목록이 Approved 프로젝트 기반으로 변경
- [ ] M2: TypeScript 빌드 에러 없음
- [ ] (Optional) M3: `is_backbone` 컬럼 제거 마이그레이션 up/down 성공
- [ ] (Optional) M3: 전 계층에서 `is_backbone` 참조 제거 완료
