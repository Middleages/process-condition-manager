# SPEC-BACKBONE-001: Implementation Plan

## 추적 태그: SPEC-BACKBONE-001

---

## 마일스톤 개요

| 마일스톤 | 제목 | 우선순위 | 의존성 |
|----------|------|----------|--------|
| M1 | Backbone 자격 판정 + 조건 복사 소스 변경 (Backend) | Primary Goal | 없음 |
| M2 | Frontend Backbone 선택 UI 변경 | Secondary Goal | M1 완료 |
| M3 | `is_backbone` 플래그 제거 (동시 진행) | Required Goal | M1, M2 완료 |

---

## M1: Backbone 자격 판정 + 조건 복사 소스 변경 (Backend)

### 우선순위: Primary Goal
### 태그: SPEC-BACKBONE-001-M1

### 기술 접근 방식

1. **공통 유틸리티 함수 추출**: Backbone 자격 판정 로직을 별도 모듈(`backbone_eligibility.py`)로 추출하여 `project_service`, `backbone_service`, `products` 라우터 등에서 공유

2. **`get_approved_project_for_product()`**: 제품 ID를 받아 `status='approved' AND is_latest=true`인 프로젝트를 `project_layers`와 함께 eager loading하여 반환하는 유틸리티 함수. 이 함수가 모든 Backbone 관련 로직의 핵심 빌딩 블록

3. **`list_backbone_products()`**: Approved 프로젝트가 존재하는 제품 목록을 반환하는 쿼리. `products JOIN projects` 패턴으로 구현. `line_id` 필터 지원

4. **조건 복사 소스 변경**: `project_service.create_project()`, `backbone_service.replace_layer_backbone()`, `backbone_service.add_layer()`의 조건 복사 소스를 `product_layers` -> Approved 프로젝트의 `project_layers`로 변경

### 구현 순서

**Step 1: Backbone Repository 생성**
- `backend/app/repositories/backbone_repository.py` 신규 생성 (기존 Repository 패턴과 일관)
- `BackboneRepository.get_approved_project_for_product(db, product_id) -> Project | None`
- `BackboneRepository.get_backbone_layer_map(db, product_id) -> dict[int, dict]` (layer_id -> conditions)
- `BackboneRepository.validate_backbone_source(db, product_id) -> Project` (검증 + 조회 통합, 실패 시 HTTPException)
- `BackboneRepository.list_backbone_products(db, line_id) -> list[dict]` (Backbone 목록 + revision/approved_at)
- `BackboneRepository.get_backbone_layers(db, product_id) -> list[ProjectLayer]` (소스 레이어 조회)

**Step 1.5: Partial Index 마이그레이션**
- `alembic revision -m "add_backbone_lookup_partial_index"`
- `CREATE INDEX ix_projects_backbone_lookup ON projects (product_id, status, is_latest) WHERE status = 'approved' AND is_latest = true`

**Step 2: `products.py` 라우터 변경 + 신규 엔드포인트**
- `list_products()` 엔드포인트에서 `is_backbone=True` 쿼리 파라미터 수신 시:
  - 기존: `Product.is_backbone == True` WHERE 조건
  - 변경: `EXISTS (SELECT 1 FROM projects WHERE product_id = products.id AND status='approved' AND is_latest=true)` 서브쿼리
- `ProductResponse`에 `is_backbone` 필드는 동적 계산값으로 유지 (하위 호환성)
- 신규 `GET /api/products/backbones`: `BackboneRepository.list_backbone_products()` 호출, revision/approved_at 포함
- 신규 `GET /api/products/{product_id}/backbone-layers`: `BackboneRepository.get_backbone_layers()` 호출

**Step 3: `project_service.py` 변경**
- `create_project()`:
  - 기존: `backbone.is_backbone` 검증 -> `ProductLayer` 조회
  - 변경: `validate_backbone_source()` 호출 -> Approved 프로젝트의 `ProjectLayer` 조건 조회
  - `backbone_map` 구성: `{layer_id: conditions}` 소스가 `product_layers` -> `project_layers`

**Step 4: `backbone_service.py` 변경**
- `replace_layer_backbone()`:
  - 기존: `source_product.is_backbone` 검증 -> `ProductLayer` 조회
  - 변경: `validate_backbone_source()` -> Approved 프로젝트의 `ProjectLayer` 조회
- `add_layer()`:
  - 동일 패턴 변경

**Step 5: 시드 데이터 업데이트**
- `backend/app/seed/products.py`: Backbone 제품별 Approved 프로젝트 자동 생성
  - 각 Backbone 제품에 대해 `status='approved', is_latest=true` 프로젝트 생성
  - `project_layers.conditions`에 기존 `product_layers.conditions` 복사
  - `is_backbone=True` 설정 코드 제거 (M3)

**Step 6: 테스트 수정**
- `conftest.py`: Backbone fixture를 `is_backbone=True` 설정에서 Approved 프로젝트 생성 패턴으로 변경
- 기존 backbone 관련 테스트 전부 갱신
- 신규 테스트 케이스:
  - Approved 프로젝트 있는 제품 -> Backbone 목록에 표시
  - Approved 프로젝트 없는 제품 -> Backbone 목록에서 제외
  - 개정 중(Draft) 제품 -> Backbone 목록에서 제외
  - 개정 승인 후 -> Backbone 자격 회복
  - 조건 복사가 Approved 프로젝트 `project_layers`에서 수행되는지 검증
  - 신규 API 엔드포인트 (`/backbones`, `/backbone-layers`) 테스트

### 리스크와 대응

| 리스크 | 영향도 | 대응 방안 |
|--------|--------|-----------|
| Backbone 목록 쿼리 성능 저하 (JOIN + subquery) | Medium | `projects.product_id` + `projects.status` + `projects.is_latest` 복합 인덱스 추가 검토 |
| 기존 테스트 대량 실패 | High | 테스트 fixture를 먼저 업데이트하고, CI에서 전체 테스트 실행으로 누락 방지 |
| 개정 중 제품의 Backbone 자격 상실로 사용자 혼란 | Medium | UI에서 "개정 중" 상태 표시, 사용자 안내 메시지 제공 |

---

## M2: Frontend Backbone 선택 UI 변경

### 우선순위: Secondary Goal
### 태그: SPEC-BACKBONE-001-M2
### 의존성: M1 완료

### 기술 접근 방식

1. **API 호출 변경**: `useBackboneProducts()` 훅이 동적 Backbone API를 호출하도록 변경. 기존 `fetchProducts({ is_backbone: true })` 패턴은 백엔드에서 is_backbone 파라미터를 동적 쿼리로 처리하므로, 프론트엔드 변경은 최소화 가능

2. **레이어 목록 소스 변경**: `BackboneReplaceModal`에서 소스 제품의 레이어 목록을 조회할 때, 마스터 `product_layers` 대신 Approved 프로젝트의 `project_layers`를 조회하도록 변경

3. **Admin UI 변경**: 제품 관리에서 `is_backbone` 체크박스를 읽기 전용 뱃지("Backbone 자격" 유/무)로 변경

### 구현 순서

**Step 1: `useBackboneProducts()` 훅 검토**
- M1에서 백엔드 `list_products(is_backbone=True)` 쿼리가 동적으로 변경되므로, 프론트엔드 `useBackboneProducts()` 훅은 기존 코드 그대로 동작 가능
- 추가 정보(revision 번호, approved_at)를 표시하려면 응답 타입 확장 필요

**Step 2: `BackboneReplaceModal` 레이어 목록 변경**
- 현재: `fetchProductLayers(productId)` -> `GET /api/products/{id}/layers` (마스터 `product_layers`)
- 변경: Approved 프로젝트의 `project_layers` 조회 API 호출
- 옵션 A: 기존 `GET /api/products/{id}/layers` 백엔드를 변경하여 Approved 프로젝트 레이어 반환
- 옵션 B: 별도 엔드포인트 `GET /api/products/{id}/backbone-layers` 추가
- 권장: 옵션 A (기존 API 동작 변경) - 이 API는 Backbone 교체 컨텍스트에서만 사용됨

**Step 3: Admin 제품 관리 UI 변경**
- `ProductManagementPanel.tsx`: `is_backbone` 체크박스 -> 동적 뱃지 ("Backbone 자격")
- `ProductFormModal.tsx`: `is_backbone` 입력 필드 제거
- 뱃지 표시: API 응답의 `is_backbone` (동적 계산값) 기반

**Step 4: 타입 변경**
- `frontend/src/types/master.ts`: `Product.is_backbone`을 optional (`boolean | undefined`)로 변경하거나 유지 (M3 범위)

### 리스크와 대응

| 리스크 | 영향도 | 대응 방안 |
|--------|--------|-----------|
| `fetchProductLayers` API 동작 변경이 다른 곳에 영향 | Low | 이 API 사용처 전수 확인 (현재 BackboneReplaceModal에서만 사용) |
| Admin UI에서 Backbone 자격 상태 실시간 반영 지연 | Low | TanStack Query invalidation으로 해결 |

---

## M3: `is_backbone` 플래그 제거 (선택적 정리)

### 우선순위: Optional Goal
### 태그: SPEC-BACKBONE-001-M3
### 의존성: M1, M2 완료

### 기술 접근 방식

M1/M2 완료 후 `is_backbone` 플래그가 더 이상 로직에서 사용되지 않음을 확인한 후, 깔끔하게 제거하는 정리 작업.

### 구현 순서

**Step 1: Backend 스키마/모델 정리**
- `backend/app/models/product.py`: `Product.is_backbone` 컬럼 제거
- `backend/app/schemas/product.py`: `ProductResponse.is_backbone` 필드 제거
- `backend/app/schemas/admin_master.py`: `ProductCreate.is_backbone`, `ProductUpdate.is_backbone` 필드 제거
- `backend/app/services/admin_master_service.py`: `is_backbone` 관련 코드 제거

**Step 2: Alembic 마이그레이션**
- `alembic revision --autogenerate -m "drop products.is_backbone column"`
- DOWN 마이그레이션: 컬럼 복원 가능하도록 default=False로 재생성

**Step 3: Frontend 정리**
- `frontend/src/types/master.ts`: `Product.is_backbone` 필드 제거
- `frontend/src/api/products.ts`: `is_backbone` 파라미터 제거
- `frontend/src/hooks/useProducts.ts`: `useBackboneProducts()` 내부 is_backbone 파라미터 제거
- Admin 컴포넌트: is_backbone 관련 UI 코드 제거

**Step 4: 시드 데이터 정리**
- `backend/app/seed/products.py`: `is_backbone` 설정 코드 제거
- `backend/app/seed/runner.py`: 관련 참조 제거

**Step 5: 테스트 정리**
- 모든 테스트에서 `is_backbone` 참조 제거

### 리스크와 대응

| 리스크 | 영향도 | 대응 방안 |
|--------|--------|-----------|
| DB 마이그레이션 롤백 필요 시 복잡성 | Medium | DOWN 마이그레이션에 컬럼 복원 로직 포함, `default=False` |
| 외부 연동 시스템이 `is_backbone` API 필드에 의존 | Low | 현재 외부 연동 없음. API 응답에서 필드 제거 전 deprecation 기간 확보 |

---

## 아키텍처 설계 방향

### 레이어별 책임

```
[Frontend]
  ProjectCreateModal / BackboneReplaceModal / LayerAddModal
    └─ useBackboneProducts() 훅 (변경 최소화)
         └─ GET /api/products?is_backbone=true (기존 파라미터 유지, 백엔드에서 동적 처리)

[Backend API Layer]
  products.py router
    └─ is_backbone=True → EXISTS subquery (Approved project 존재 여부)

[Backend Service Layer]
  backbone_eligibility.py (NEW - 공통 유틸리티)
    ├─ get_approved_project_for_product()
    ├─ get_backbone_layer_map()
    └─ validate_backbone_source()

  project_service.py
    └─ create_project() → backbone_eligibility.validate_backbone_source()
                        → backbone_eligibility.get_backbone_layer_map()

  backbone_service.py
    ├─ replace_layer_backbone() → backbone_eligibility.validate_backbone_source()
    └─ add_layer() → backbone_eligibility.validate_backbone_source()

[Database]
  products ←JOIN→ projects (status='approved', is_latest=true)
                    └─ project_layers.conditions (Backbone 조건 소스)
```

### 설계 원칙

1. **단일 진실 소스(Single Source of Truth)**: Backbone 자격은 `projects` 테이블의 상태로만 결정. 별도 플래그/캐시 불필요
2. **쿼리 재사용**: `backbone_eligibility.py`의 유틸리티 함수로 모든 Backbone 관련 쿼리를 중앙화
3. **하위 호환성 우선**: API 인터페이스 변경 최소화. `is_backbone` 파라미터/필드는 M3까지 유지
4. **점진적 전환**: M1(필수) -> M2(필수) -> M3(선택) 순서로 단계적 적용. M3 없이도 시스템 정상 동작

### 성능 고려사항

- Backbone 목록 쿼리: `products JOIN projects` + `WHERE status='approved' AND is_latest=true` 는 기존 `WHERE is_backbone=true` 보다 느릴 수 있음
- 대응: `projects` 테이블의 `(product_id, status, is_latest)` 복합 인덱스 활용 (이미 `product_id`와 `is_latest` 각각 인덱스 존재)
- 예상 데이터 규모: 제품 ~100개, 프로젝트 ~수백 개 수준에서 성능 이슈 없음
