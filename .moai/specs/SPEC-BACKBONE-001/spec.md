# SPEC-BACKBONE-001: Dynamic Backbone Eligibility

## 메타데이터

| 항목 | 값 |
|------|-----|
| SPEC ID | SPEC-BACKBONE-001 |
| 제목 | Dynamic Backbone Eligibility (동적 Backbone 자격 판정) |
| 상태 | Planned |
| 우선순위 | High |
| 생성일 | 2026-02-20 |
| 선행 SPEC | SPEC-AUTH-001 (인증/인가), SPEC-005 (전산 출력 기본) |
| Phase | Post-Phase 4 (Enhancement) |

---

## 1. Environment (환경)

### 1.1 현재 시스템 상태

- **Backbone 선택 방식**: `products.is_backbone` 정적 Boolean 플래그로 관리. Admin이 수동으로 `is_backbone=True`를 설정해야 해당 제품이 Backbone으로 사용 가능
- **Backbone 조건 데이터 소스**: 마스터 테이블 `product_layers.conditions` (JSONB)에서 직접 복사
- **프로젝트 생성 흐름**: 라인 선택 -> 대상 제품 선택 -> Backbone 제품 선택 (`is_backbone=True` 필터) -> `product_layers.conditions`를 `project_layers.conditions`로 deepcopy
- **레이어별 Backbone 교체**: `backbone_service.replace_layer_backbone()` - 소스 제품의 `is_backbone` 플래그 확인 후 `product_layers.conditions`에서 조건 복사
- **레이어 추가**: `backbone_service.add_layer()` - 소스 제품의 `is_backbone` 확인 후 `product_layers.conditions`에서 복사
- **상태 흐름**: Draft -> Review -> Approved -> (Revision 시) Archived. `is_latest=True`가 제품당 최신 프로젝트를 표시

### 1.2 관련 코드 현황

**Backend:**
- `backend/app/models/product.py`: `Product.is_backbone` (Boolean 컬럼), `ProductLayer.conditions` (JSONB)
- `backend/app/models/project.py`: `Project.status`, `Project.is_latest`, `ProjectLayer.conditions`, `ProjectLayer.backbone_conditions`, `ProjectLayer.backbone_product_id`
- `backend/app/services/project_service.py`: `create_project()` - `backbone.is_backbone` 검증 -> `product_layers` 조건 복사
- `backend/app/services/backbone_service.py`: `replace_layer_backbone()` - `source_product.is_backbone` 검증 -> `product_layers` 조건 복사; `add_layer()` - 동일 패턴
- `backend/app/routers/products.py`: `list_products()` - `is_backbone` 쿼리 파라미터 필터
- `backend/app/schemas/product.py`: `ProductResponse.is_backbone`, `ProductDetailResponse`
- `backend/app/schemas/admin_master.py`: `ProductCreate.is_backbone`, `ProductUpdate.is_backbone`
- `backend/app/services/admin_master_service.py`: 제품 CRUD에서 `is_backbone` 필드 처리

**Frontend:**
- `frontend/src/types/master.ts`: `Product.is_backbone` 타입 정의
- `frontend/src/hooks/useProducts.ts`: `useBackboneProducts()` - `fetchProducts({ is_backbone: true })` 호출
- `frontend/src/api/products.ts`: `fetchProducts(params)` - `is_backbone` 쿼리 파라미터 전송
- `frontend/src/components/projects/ProjectCreateModal.tsx`: `useBackboneProducts(lineId)` 사용하여 Backbone 드롭다운 구성
- `frontend/src/components/editor/BackboneReplaceModal.tsx`: `useBackboneProducts()` 사용
- `frontend/src/components/editor/LayerAddModal.tsx`: `useBackboneProducts()` 사용
- `frontend/src/components/admin/ProductManagementPanel.tsx`: `is_backbone` 체크박스 관리
- `frontend/src/components/admin/ProductFormModal.tsx`: `is_backbone` 입력 필드

### 1.3 Gap 분석

| 현재 (As-Is) | 목표 (To-Be) | Gap |
|--------------|-------------|-----|
| Admin이 `is_backbone` 플래그를 수동 설정 | Approved 프로젝트 존재 여부로 자동 판정 | Backbone 자격 판정 로직 전면 교체 필요 |
| `product_layers.conditions`에서 Backbone 조건 복사 | Approved 프로젝트의 `project_layers.conditions`에서 복사 | 데이터 소스 변경 (마스터 -> 프로젝트) |
| 정적 데이터 (시드/Admin 수정) | Approved될 때마다 자동으로 최신 조건 반영 | 동적 데이터 갱신 메커니즘 |
| `is_backbone` 컬럼이 DB, API, UI 전 계층에 존재 | `is_backbone` 컬럼 제거 또는 deprecated 처리 | 전 계층 점진적 제거 필요 |

### 1.4 기술 스택

- Backend: FastAPI + SQLAlchemy 2.x (async) + Pydantic v2 + PostgreSQL 16
- Frontend: React 18 + TypeScript + Zustand + AG Grid Community + TanStack Query
- 인증: JWT (access/refresh token) + RBAC (admin/reviewer/editor)

---

## 2. Assumptions (가정)

| ID | 가정 | 신뢰도 | 근거 | 위험 (오류 시) |
|----|------|--------|------|----------------|
| A1 | Backbone 자격은 `projects.status='approved' AND projects.is_latest=true`인 프로젝트가 존재하는 제품으로 정의한다 | High | 사용자 요구사항 직접 확인: "현 상태가 approved인것 기준" |  |
| A2 | 하나의 제품에 대해 `is_latest=true AND status='approved'`인 프로젝트는 최대 1개다 | High | 기존 비즈니스 로직: `revise_project()`가 원본을 archived로 변경하고 신규 Draft 생성 |  |
| A3 | Backbone 조건 복사의 소스는 Approved 프로젝트의 `project_layers.conditions`이다 (마스터 `product_layers.conditions`가 아님) | High | 사용자 요구사항 직접 확인 |  |
| A4 | 기존에 `is_backbone=True`로 생성된 프로젝트들은 마이그레이션 불필요 - 이미 복사된 `backbone_conditions` 스냅샷은 유효하다 | High | 프로젝트 생성 시점에 이미 deepcopy 완료, 소급 변경 불필요 |  |
| A5 | 개정(Revision) 중인 제품의 Backbone 소스는 현재 Approved 버전이 아닌 가장 최근 Approved 프로젝트의 조건이다. Draft 상태의 개정은 Backbone 소스로 사용하지 않는다 | High | 사용자 확인: Draft 개정 중에도 기존 Approved 조건이 Backbone으로 제공 |  |
| A6 | 제품/레이어 마스터 데이터는 미래에 외부 Datalake에서 동기화될 예정이나, 이 SPEC에서는 구현하지 않는다. Datalake는 구조 데이터만 제공하고 조건값은 제공하지 않는다 | High | 사용자 요구사항: "compatible with that future direction but NOT implement it" |  |
| A7 | `is_backbone` 컬럼은 Phase 1에서 deprecated 처리하고, 충분한 전환 기간 후 제거한다 (하위 호환성) | Medium | 기존 Admin UI, 시드 데이터, 테스트에서 광범위하게 사용 중 |  |
| A8 | Backbone 자격이 없는 제품(Approved 프로젝트 없음)을 Backbone으로 선택하는 것은 차단되어야 한다 | High | 데이터 무결성: 조건이 없는 Backbone 복사 시 빈 조건표 생성 |  |

---

## 3. Requirements (요구사항)

### M1: Backbone 자격 판정 로직 변경 + 조건 복사 소스 변경

#### 3.1 Backbone 자격 판정 API

**REQ-BB-001** [Event-Driven]
**WHEN** 클라이언트가 Backbone 제품 목록을 요청하면 **THEN** `projects` 테이블에서 `status='approved' AND is_latest=true`인 프로젝트가 존재하는 제품만 반환해야 한다.

**REQ-BB-002** [State-Driven]
**IF** 특정 제품에 `status='approved' AND is_latest=true`인 프로젝트가 없으면 **THEN** 해당 제품은 Backbone 후보 목록에서 제외되어야 한다.

**REQ-BB-003** [Event-Driven]
**WHEN** 제품에 대한 개정(Revision)이 진행 중이어서 최신 프로젝트가 `status='draft'`이고, 이전 버전이 `status='archived' AND is_latest=false`인 경우 **THEN** 해당 제품은 Backbone 후보 목록에서 제외되어야 한다. (Approved 상태인 is_latest=true 프로젝트가 없으므로)

**REQ-BB-004** [Optional]
**가능하면** Backbone 목록 API 응답에 소스 프로젝트의 `revision` 번호와 `approved_at` 일시를 포함하여, 사용자가 Backbone 데이터의 신선도를 확인할 수 있도록 한다.

#### 3.2 Backbone 조건 복사 소스 변경

**REQ-BB-010** [Event-Driven]
**WHEN** 프로젝트 생성 시 Backbone 조건을 복사하면 **THEN** 마스터 `product_layers.conditions` 대신 Backbone 제품의 Approved 프로젝트(`status='approved' AND is_latest=true`) `project_layers.conditions`에서 조건을 복사해야 한다.

**REQ-BB-011** [Event-Driven]
**WHEN** 레이어별 Backbone 교체(`replace_layer_backbone`) 시 **THEN** 소스 제품의 Approved 프로젝트 `project_layers.conditions`에서 해당 레이어 조건을 복사해야 한다.

**REQ-BB-012** [Event-Driven]
**WHEN** 레이어 추가(`add_layer`) 시 소스 제품이 지정되면 **THEN** 소스 제품의 Approved 프로젝트 `project_layers.conditions`에서 조건을 복사해야 한다.

**REQ-BB-013** [Unwanted]
시스템은 Approved 프로젝트가 없는 제품의 조건을 Backbone 소스로 사용하는 것을 **허용하지 않아야 한다**.

**REQ-BB-014** [Ubiquitous]
시스템은 **항상** Backbone 조건 복사 시 `project_layers.backbone_conditions`에 복사된 조건의 스냅샷을 저장해야 한다. (기존 동작 유지)

**REQ-BB-015** [Ubiquitous]
시스템은 **항상** Backbone 조건 복사 시 `project_layers.backbone_product_id`에 소스 제품 ID를 기록해야 한다. (기존 동작 유지)

#### 3.3 `is_backbone` 플래그 Deprecation

**REQ-BB-020** [Event-Driven]
**WHEN** Backbone 목록 API가 동적 판정 로직으로 변경되면 **THEN** `products.is_backbone` 컬럼은 더 이상 Backbone 필터링에 사용하지 않아야 한다.

**REQ-BB-021** [State-Driven]
**IF** `is_backbone` 필터가 API 요청에 포함되면 **THEN** 동적 판정 로직(Approved 프로젝트 존재 여부)으로 대체 처리해야 한다. (하위 호환성)

**REQ-BB-022** [Optional]
**가능하면** Admin 제품 관리 UI에서 `is_backbone` 체크박스를 제거하고, Backbone 자격 상태를 읽기 전용 뱃지로 표시한다.

**REQ-BB-023** [Optional]
**가능하면** API 응답의 `is_backbone` 필드를 동적으로 계산된 값으로 반환하여, 기존 클라이언트와의 호환성을 유지한다.

#### 3.4 개정(Revision) 시나리오

**REQ-BB-030** [Event-Driven]
**WHEN** Approved 프로젝트에 대해 개정(Revision)이 생성되면 **THEN** 원본 프로젝트는 `status='archived', is_latest=false`로 변경되고, 새 Draft 프로젝트가 `is_latest=true`로 생성되므로, 해당 제품은 Backbone 자격을 일시적으로 상실한다.

**REQ-BB-031** [Event-Driven]
**WHEN** 개정된 프로젝트가 Approved 상태로 전환되면 **THEN** 해당 제품은 Backbone 자격을 자동으로 회복하며, 새로운 Approved 조건이 Backbone 소스로 사용된다.

**REQ-BB-032** [State-Driven]
**IF** 개정 중인 제품(Draft 상태)을 다른 프로젝트가 Backbone으로 사용하려 하면 **THEN** 해당 제품은 Backbone 후보 목록에 표시되지 않아야 한다.

#### 3.5 하위 호환성

**REQ-BB-040** [Ubiquitous]
시스템은 **항상** 기존에 생성된 프로젝트의 `backbone_conditions`, `backbone_product_id` 데이터를 보존해야 한다. (마이그레이션으로 변경하지 않음)

**REQ-BB-041** [Ubiquitous]
시스템은 **항상** 기존 `product_layers.conditions` 데이터를 유지해야 한다. (삭제하지 않음 - Datalake 연동 전까지 마스터 데이터로 활용 가능)

### M2: Frontend Backbone 선택 UI 변경

**REQ-BB-050** [Event-Driven]
**WHEN** ProjectCreateModal에서 Backbone 드롭다운을 표시할 때 **THEN** 동적 Backbone 목록 API를 호출하여 Approved 프로젝트가 있는 제품만 표시해야 한다.

**REQ-BB-051** [Event-Driven]
**WHEN** BackboneReplaceModal에서 소스 Backbone 제품 목록을 표시할 때 **THEN** 동적 Backbone 목록 API를 호출해야 한다.

**REQ-BB-052** [Event-Driven]
**WHEN** LayerAddModal에서 소스 Backbone 제품 목록을 표시할 때 **THEN** 동적 Backbone 목록 API를 호출해야 한다.

**REQ-BB-053** [Optional]
**가능하면** Backbone 드롭다운에 각 제품의 Approved 버전 번호 (예: "ProductA (v3)")와 승인일을 함께 표시한다.

**REQ-BB-054** [Event-Driven]
**WHEN** BackboneReplaceModal에서 소스 제품 선택 후 레이어 목록을 로드할 때 **THEN** 마스터 `product_layers` 대신 Approved 프로젝트의 `project_layers` 목록을 조회해야 한다.

### M3: `is_backbone` 플래그 제거 (선택적 정리)

**REQ-BB-060** [Optional]
**가능하면** `products.is_backbone` DB 컬럼을 Alembic 마이그레이션으로 제거한다.

**REQ-BB-061** [Optional]
**가능하면** Admin 제품 관리의 `ProductFormModal`에서 `is_backbone` 입력 필드를 제거한다.

**REQ-BB-062** [Optional]
**가능하면** `ProductCreate`, `ProductUpdate`, `ProductResponse` 스키마에서 `is_backbone` 필드를 제거하거나 computed 필드로 변경한다.

**REQ-BB-063** [Optional]
**가능하면** Frontend `Product` 타입에서 `is_backbone` 필드를 제거하거나 optional로 변경한다.

**REQ-BB-064** [Optional]
**가능하면** 시드 데이터(`backend/app/seed/products.py`)에서 `is_backbone` 설정 코드를 제거한다.

---

## 4. Specifications (사양)

### 4.1 DB 스키마 변경

#### 변경 없음 (M1, M2)
- 기존 `products`, `projects`, `project_layers` 테이블 스키마 변경 없음
- 신규 테이블 추가 없음
- 쿼리 로직만 변경

#### M3 (선택적 - `is_backbone` 제거)
| 작업 | 대상 | 설명 |
|------|------|------|
| DROP COLUMN | `products.is_backbone` | Alembic 마이그레이션으로 컬럼 제거 |

### 4.2 핵심 쿼리 변경

#### Backbone 제품 목록 조회 (신규 쿼리 로직)

```sql
-- Approved 프로젝트가 존재하는 제품 = Backbone 자격 보유
SELECT DISTINCT p.*
FROM products p
INNER JOIN projects pj ON pj.product_id = p.id
WHERE pj.status = 'approved'
  AND pj.is_latest = true
  AND (p.line_id = :line_id OR :line_id IS NULL)
ORDER BY p.product_name;
```

#### Backbone 조건 소스 조회 (신규 쿼리 로직)

```sql
-- 소스 제품의 Approved 프로젝트에서 project_layers 조건 조회
SELECT pl.*
FROM project_layers pl
INNER JOIN projects pj ON pl.project_id = pj.id
WHERE pj.product_id = :source_product_id
  AND pj.status = 'approved'
  AND pj.is_latest = true;
```

### 4.3 API 변경 사항

#### 기존 API 수정

| Method | Path | 변경 내용 |
|--------|------|-----------|
| GET | `/api/products?is_backbone=true` | `is_backbone` 쿼리 파라미터 무시, 동적 Approved 프로젝트 기반 필터로 대체 |
| POST | `/api/projects` | `create_project()`: Backbone 검증을 `is_backbone` 플래그 대신 Approved 프로젝트 존재 여부로 변경. 조건 복사 소스를 `product_layers` 대신 Approved 프로젝트의 `project_layers`로 변경 |
| POST | `/api/projects/{id}/layers/{layer_id}/backbone` | `replace_layer_backbone()`: 소스 검증 및 조건 복사 소스 변경 (위와 동일) |
| POST | `/api/projects/{id}/layers` | `add_layer()`: 소스 검증 및 조건 복사 소스 변경 (위와 동일) |

#### 신규 API (Optional - REQ-BB-004)

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/products/backbones` | 전용 Backbone 목록 엔드포인트. 제품 정보 + Approved 프로젝트 revision, approved_at 포함 |

#### 소스 레이어 목록 API 변경

| Method | Path | 변경 내용 |
|--------|------|-----------|
| GET | `/api/products/{product_id}/layers` | (선택) Approved 프로젝트의 `project_layers` 반환으로 변경하거나, 별도 엔드포인트 추가 |

### 4.4 서비스 계층 변경

#### `project_service.py` 변경

- `create_project()`:
  - (제거) `backbone.is_backbone` 검증
  - (추가) Backbone 제품의 Approved 프로젝트 존재 확인 쿼리
  - (변경) 조건 복사 소스: `product_layers` -> Approved 프로젝트 `project_layers`
  - (변경) `backbone_map` 구성: `{layer_id: conditions}` 소스 변경

#### `backbone_service.py` 변경

- `replace_layer_backbone()`:
  - (제거) `source_product.is_backbone` 검증 (line 52)
  - (추가) 소스 제품의 Approved 프로젝트 존재 확인
  - (변경) 소스 레이어 조회: `ProductLayer` -> Approved 프로젝트의 `ProjectLayer`
- `add_layer()`:
  - (제거) `source_product.is_backbone` 검증 (line 151)
  - (추가) 소스 제품의 Approved 프로젝트 존재 확인
  - (변경) 소스 레이어 조회: `ProductLayer` -> Approved 프로젝트의 `ProjectLayer`

#### `routers/products.py` 변경

- `list_products()`:
  - `is_backbone=True` 파라미터 처리 로직 변경
  - JOIN + subquery 방식으로 Approved 프로젝트 존재 여부 기반 필터링

#### 공통 유틸리티 함수 (신규 추출 권장)

```python
async def get_approved_project_for_product(
    db: AsyncSession, product_id: int
) -> Project | None:
    """제품의 현재 Approved 프로젝트를 조회한다."""
    result = await db.execute(
        select(Project)
        .options(selectinload(Project.layers).selectinload(ProjectLayer.layer))
        .where(
            Project.product_id == product_id,
            Project.status == "approved",
            Project.is_latest == True,
        )
    )
    return result.scalars().first()
```

### 4.5 Frontend 변경

#### API 클라이언트

- `frontend/src/api/products.ts`: `fetchProducts()` - `is_backbone` 파라미터 사용 방식 변경 또는 새 API 엔드포인트 호출

#### 훅

- `frontend/src/hooks/useProducts.ts`: `useBackboneProducts()` - 동적 Backbone API 호출로 변경

#### 컴포넌트

- `ProjectCreateModal.tsx`: Backbone 드롭다운 소스 변경 (옵션 표시 형식 확장 가능)
- `BackboneReplaceModal.tsx`: Backbone 목록 소스 변경 + 소스 레이어 조회 API 변경
- `LayerAddModal.tsx`: Backbone 목록 소스 변경
- `ProductManagementPanel.tsx`: `is_backbone` 체크박스 제거 또는 읽기 전용 뱃지로 변경
- `ProductFormModal.tsx`: `is_backbone` 입력 필드 제거 또는 비활성화

#### 타입

- `frontend/src/types/master.ts`: `Product.is_backbone` 필드 optional 처리 또는 제거

### 4.6 Datalake 호환성 고려사항

- **마스터 데이터 (`product_layers`)**: 외부 Datalake에서 구조(product_name, part_id, layer_name, step_seq, layer_number)를 동기화할 예정이나, 조건값은 제공하지 않음
- **Backbone 조건 소스**: 이 SPEC의 변경으로 Backbone 조건의 소스가 `product_layers` (마스터)에서 `project_layers` (프로젝트)로 이동하므로, Datalake 동기화가 마스터 `product_layers.conditions`를 덮어써도 Backbone 복사에 영향 없음
- **`product_layers.conditions`의 역할 변화**: Backbone 복사 소스에서 제외되면, 마스터 조건 데이터는 참조/시드 목적으로만 유지. Datalake 연동 시 구조 데이터만 동기화하면 됨
- **호환성 확인**: 이 SPEC의 변경은 Datalake 연동 SPEC과 독립적으로 적용 가능

### 4.7 영향받는 파일 목록

#### 수정 파일

**Backend:**
- `backend/app/services/project_service.py` - `create_project()` Backbone 검증 및 조건 복사 로직 변경 (M1)
- `backend/app/services/backbone_service.py` - `replace_layer_backbone()`, `add_layer()` 검증 및 소스 변경 (M1)
- `backend/app/routers/products.py` - `list_products()` Backbone 필터 쿼리 변경 (M1)
- `backend/app/schemas/product.py` - `ProductResponse` 필드 조정 (M1/M3)
- `backend/app/schemas/admin_master.py` - `ProductCreate`, `ProductUpdate` 필드 조정 (M3)
- `backend/app/services/admin_master_service.py` - `is_backbone` 처리 제거/변경 (M3)
- `backend/app/models/product.py` - `is_backbone` 컬럼 제거 (M3)
- `backend/app/seed/products.py` - `is_backbone` 시드 데이터 제거 (M3)
- `backend/app/seed/runner.py` - `is_backbone` 참조 제거 (M3)

**Frontend:**
- `frontend/src/hooks/useProducts.ts` - `useBackboneProducts()` 로직 변경 (M2)
- `frontend/src/api/products.ts` - Backbone API 호출 변경 (M2)
- `frontend/src/components/projects/ProjectCreateModal.tsx` - Backbone 드롭다운 변경 (M2)
- `frontend/src/components/editor/BackboneReplaceModal.tsx` - 소스 선택 + 레이어 조회 변경 (M2)
- `frontend/src/components/editor/LayerAddModal.tsx` - 소스 선택 변경 (M2)
- `frontend/src/components/admin/ProductManagementPanel.tsx` - Backbone 상태 표시 변경 (M2/M3)
- `frontend/src/components/admin/ProductFormModal.tsx` - `is_backbone` 필드 제거 (M3)
- `frontend/src/types/master.ts` - `Product` 타입 변경 (M2/M3)

**테스트:**
- `backend/tests/conftest.py` - Backbone 관련 fixture 수정 (M1)
- `backend/tests/test_export_api.py` - Backbone 의존 테스트 수정 (M1)
- `backend/tests/test_export_validation.py` - Backbone 의존 테스트 수정 (M1)
- `backend/tests/test_dashboard.py` - Backbone 의존 테스트 수정 (M1)
- `backend/tests/test_recipe_service.py` - Backbone 의존 테스트 수정 (M1)

**마이그레이션:**
- `backend/alembic/versions/xxx_drop_is_backbone.py` - `is_backbone` 컬럼 제거 (M3)

#### 신규 파일 (선택)

- `backend/app/services/backbone_eligibility.py` - Backbone 자격 판정 공통 유틸리티 함수 (권장)

### 4.8 보안

- 신규 보안 이슈 없음: 기존 RBAC 체계(admin/reviewer/editor) 그대로 유지
- Backbone 목록 API는 기존 `require_auth` 의존성 유지
- Admin 제품 관리 API는 기존 `require_admin` 의존성 유지

### 4.9 추적 태그 (Traceability)

| 태그 | 범위 |
|------|------|
| SPEC-BACKBONE-001 | 전체 SPEC |
| SPEC-BACKBONE-001-M1 | Backbone 자격 판정 + 조건 복사 소스 변경 (Backend) |
| SPEC-BACKBONE-001-M2 | Frontend Backbone 선택 UI 변경 |
| SPEC-BACKBONE-001-M3 | `is_backbone` 플래그 제거 (선택적 정리) |
