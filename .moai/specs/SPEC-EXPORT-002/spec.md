# SPEC-EXPORT-002: Export Data Pipeline (외부 데이터 소스 연동)

## 메타데이터

| 항목 | 값 |
|------|-----|
| SPEC ID | SPEC-EXPORT-002 |
| 제목 | Export Data Pipeline (외부 데이터 소스 연동) |
| 상태 | Planned |
| 우선순위 | High |
| 생성일 | 2026-02-20 |
| 선행 SPEC | SPEC-EXPORT-001 (전산 출력 확장), SPEC-AUTH-001 (인증/인가) |
| Phase | Phase 5 |

---

## 1. Environment (환경)

### 1.1 현재 시스템 상태

- **SPEC-EXPORT-001 완료**: Export Admin UI (시스템 CRUD + 컬럼 매핑), Equipment Assignment UI, Export Validation Report, Export History Logging 구현 완료
- **Export 아키텍처**: ExportService(오케스트레이션) + ExportBuilders(순수 함수) 패턴으로 Type A/B/C 3종 포맷 생성
- **ExportColumnMapping 모델**: `export_column_mappings` 테이블이 `column_definitions` FK를 통해 조건표 컬럼을 export 대상 컬럼에 매핑
- **ExportAdminService**: 시스템/매핑 CRUD 서비스 완료, `/api/admin/export-systems` + `/mappings` REST API 완료
- **ExportMappingManager UI**: Admin 페이지에서 컬럼 매핑을 관리하는 프론트엔드 컴포넌트 완료
- **ExportBuilders**: `build_type_a_data`, `build_type_b_data`, `build_type_c_data` 순수 함수에서 `ProjectLayer.conditions` JSONB 데이터만 참조하여 행 데이터를 생성
- **인증**: JWT RBAC (admin/reviewer/editor) 전 엔드포인트 적용 완료

### 1.2 한계점

- 현재 Export는 **조건표 데이터(project_layers.conditions JSONB)만** 출력 가능하다
- 사내 Big Data 시스템에서 매시간 배치 ETL로 적재하는 **외부 테이블 데이터를 출력에 포함할 수 없다**
- `export_column_mappings`에는 소스 유형 구분이 없어, 조건표 컬럼만 매핑 대상으로 선택 가능하다
- 외부 테이블의 컬럼 구조를 동적으로 탐색하는 기능이 없다
- 외부 데이터와 조건표 데이터를 JOIN하여 통합 출력하는 메커니즘이 없다

### 1.3 기술 스택

- Backend: FastAPI + SQLAlchemy 2.x (async) + Pydantic v2 + PostgreSQL 16
- Frontend: React 18 + TypeScript + Zustand + AG Grid Community
- 인증: JWT (access/refresh token) + RBAC (require_admin dependency)
- 외부 데이터: 동일 PostgreSQL 인스턴스의 `public` 스키마 내 테이블 (PCM은 SELECT 권한만 보유)

### 1.4 외부 데이터 환경

- 사내 Big Data 시스템이 **매시간 배치 ETL**로 외부 테이블을 PCM과 동일한 PostgreSQL DB에 적재
- PCM은 외부 테이블에 대해 **SELECT 전용** (INSERT/UPDATE/DELETE 불가)
- 테이블 스키마는 고정적이나, 컬럼 추가/변경이 비정기적으로 발생 가능
- 항상 **최신 데이터**를 사용 (시간 기반 필터링 불필요)
- JOIN 키 조합은 데이터 소스마다 상이: product_id, step_seq, ppid, layer, part_id 등의 조합

---

## 2. Assumptions (가정)

| ID | 가정 | 신뢰도 | 근거 |
|----|------|--------|------|
| A1 | 외부 테이블은 PCM과 동일한 PostgreSQL 인스턴스의 `public` 스키마에 존재한다 | High | 인프라 팀 확인, 동일 DB에 ETL 적재 |
| A2 | PCM은 외부 테이블에 대해 SELECT 권한만 보유하며, DDL/DML을 수행하지 않는다 | High | DBA 정책, PCM은 읽기 전용 소비자 |
| A3 | 외부 데이터 소스 등록/관리는 admin 역할만 수행 가능하다 | High | SPEC-AUTH-001 RBAC 패턴, 기존 admin 라우터 패턴 |
| A4 | `information_schema.columns`를 통해 외부 테이블의 컬럼 목록을 동적으로 검색할 수 있다 | High | PostgreSQL 표준 카탈로그, SELECT 권한으로 접근 가능 |
| A5 | JOIN 키 조합은 데이터 소스마다 다르며, 등록 시 admin이 지정한다 | High | 소스 테이블마다 키 구조가 상이 (product_id+step_seq vs product_id+layer 등) |
| A6 | 이 SPEC에서는 외부 컬럼의 **직접 매핑(lookup)만** 처리하며, 계산식(formula)은 SPEC-EXPORT-003에서 다룬다 | High | 범위 분리 합의, 단계적 구현 전략 |
| A7 | 기존 `export_column_mappings` 테이블의 스키마 확장이 가능하다 (신규 컬럼 추가) | High | Alembic 마이그레이션으로 안전하게 확장 가능, 하위 호환성 유지 설계 |
| A8 | 외부 테이블의 컬럼 변경 빈도는 낮으며 (월 1~2회 이하), 동적 감지로 대응 가능하다 | Medium | 운영팀 경험적 데이터, 스키마 변경 시 admin이 매핑을 갱신 |
| A9 | 외부 테이블에서 가져오는 데이터의 행 수는 레이어당 1행 이하이다 (1:1 또는 0:1 관계) | Medium | JOIN 키 조합이 레이어 단위의 유일한 식별자를 구성, 다중 행 반환은 집계가 필요하며 이는 SPEC-EXPORT-003 범위 |

---

## 3. Requirements (요구사항)

### M1: External Data Source Registration (Admin UI)

**REQ-PIPE-001** [Ubiquitous]
시스템은 **항상** admin 역할의 사용자에게만 외부 데이터 소스 관리 기능 접근을 허용해야 한다.

**REQ-PIPE-002** [Event-Driven]
**WHEN** admin 사용자가 새 외부 데이터 소스 등록을 요청하면 **THEN** source_name(표시명), table_name(실제 DB 테이블명), schema_name(DB 스키마, 기본 'public'), description, join_key_mappings(외부↔PCM 키 매핑 배열), is_active 필드를 입력받아 `export_data_sources` 테이블에 저장해야 한다.

**REQ-PIPE-003** [Event-Driven]
**WHEN** admin 사용자가 데이터 소스를 등록하거나 수정할 때 **THEN** `information_schema.tables`를 조회하여 해당 table_name이 실제로 존재하는지 검증해야 한다.

**REQ-PIPE-004** [Unwanted]
시스템은 존재하지 않는 테이블 이름으로 데이터 소스 등록을 **허용하지 않아야 한다**.

**REQ-PIPE-005** [Event-Driven]
**WHEN** admin 사용자가 등록된 데이터 소스의 컬럼 목록을 요청하면 **THEN** `information_schema.columns`를 조회하여 해당 테이블의 column_name + data_type 목록을 반환해야 한다.

**REQ-PIPE-006** [Event-Driven]
**WHEN** admin 사용자가 기존 데이터 소스를 수정하면 **THEN** source_name, table_name, schema_name, description, join_key_mappings, is_active의 편집 가능 필드를 업데이트해야 한다.

**REQ-PIPE-007** [Event-Driven]
**WHEN** admin 사용자가 데이터 소스를 삭제하면 **THEN** 연관된 export_column_mappings에서 해당 data_source_id를 참조하는 매핑이 있는지 확인하고, 매핑이 존재하면 soft delete(is_active=false)로 처리해야 한다. 참조 매핑이 없는 경우에만 hard delete를 허용한다.

**REQ-PIPE-008** [Unwanted]
시스템은 source_name이 중복된 외부 데이터 소스 생성을 **허용하지 않아야 한다**.

**REQ-PIPE-009** [State-Driven]
**IF** 외부 데이터 소스의 is_active가 false이면 **THEN** Admin 목록에서 비활성 상태로 시각적 구분하여 표시해야 하며, 신규 매핑 생성 시 소스 선택 드롭다운에서 제외해야 한다.

### M2: Export Column Mapping Extension

**REQ-PIPE-010** [Ubiquitous]
시스템은 **항상** 기존 export_column_mappings의 모든 기존 데이터에 대해 하위 호환성을 유지해야 한다. 기존 매핑은 `source_type='condition'`으로 자동 분류된다.

**REQ-PIPE-011** [Event-Driven]
**WHEN** admin 사용자가 컬럼 매핑을 추가할 때 **THEN** source_type을 선택할 수 있어야 한다:
- `condition` (기본값): 기존 방식, column_definitions에서 조건표 컬럼 선택
- `external`: 외부 데이터 소스에서 컬럼 선택

**REQ-PIPE-012** [State-Driven]
**IF** source_type이 `external`이면 **THEN** data_source_id(FK -> export_data_sources)와 source_column_name(외부 테이블의 컬럼명)을 필수로 입력받아야 하고, column_id(FK -> column_definitions)는 NULL이어야 한다.

**REQ-PIPE-013** [State-Driven]
**IF** source_type이 `condition`이면 **THEN** column_id(FK -> column_definitions)를 필수로 입력받아야 하고, data_source_id와 source_column_name은 NULL이어야 한다.

**REQ-PIPE-014** [Event-Driven]
**WHEN** source_type을 `external`로 선택할 때 **THEN** 활성(is_active=true) 데이터 소스 목록이 드롭다운으로 제공되고, 소스 선택 후 해당 테이블의 컬럼 목록이 동적으로 로드되어 컬럼을 선택할 수 있어야 한다.

**REQ-PIPE-015** [Unwanted]
시스템은 source_type이 `external`인데 data_source_id 또는 source_column_name이 없는 매핑 저장을 **허용하지 않아야 한다**.

**REQ-PIPE-015.1** [Event-Driven]
**WHEN** source_type이 `external`인 매핑을 저장할 때 **THEN** source_column_name이 참조하는 외부 테이블에 실제로 존재하는지 `information_schema.columns`를 조회하여 검증해야 한다.

**REQ-PIPE-016** [Unwanted]
시스템은 source_type이 `condition`인데 column_id가 없는 매핑 저장을 **허용하지 않아야 한다**.

### M3: Export Builder Integration

**REQ-PIPE-020** [Event-Driven]
**WHEN** 전산 출력을 생성할 때 매핑 목록에 source_type='external'인 매핑이 포함되어 있으면 **THEN** 해당 외부 데이터 소스의 join_keys를 사용하여 외부 테이블과 JOIN 쿼리를 수행하여 외부 데이터를 가져와야 한다.

**REQ-PIPE-021** [Event-Driven]
**WHEN** 외부 데이터를 조회할 때 **THEN** 프로젝트의 product_id와 프로젝트 레이어 정보를 기반으로 join_keys에 정의된 키 조합으로 매칭해야 한다.

**REQ-PIPE-022** [State-Driven]
**IF** 외부 데이터 매핑에 해당하는 행이 외부 테이블에 존재하지 않으면 **THEN** 해당 셀 값을 빈 문자열("")로 처리해야 한다 (NULL 안전 처리).

**REQ-PIPE-023** [Ubiquitous]
시스템은 **항상** 외부 데이터를 조건표 데이터와 동일한 행(레이어) 단위로 병합하여 기존 Type A/B/C 출력 포맷을 유지해야 한다.

**REQ-PIPE-024** [Ubiquitous]
시스템은 **항상** source_type='condition'인 매핑은 기존 로직(ProjectLayer.conditions JSONB 참조)으로 처리하고, source_type='external'인 매핑만 외부 테이블 조회를 수행해야 한다.

**REQ-PIPE-025** [State-Driven]
**IF** 외부 데이터 소스가 비활성(is_active=false) 상태이면 **THEN** 해당 소스를 참조하는 매핑의 값을 빈 문자열로 처리하고, 로그에 경고를 기록해야 한다.

**REQ-PIPE-026** [Event-Driven]
**WHEN** Export Validation을 수행할 때 **THEN** external 소스 매핑에 대해서도 데이터 존재 여부와 is_required 컬럼의 null 검증을 수행해야 한다.

**REQ-PIPE-027** [Optional]
**가능하면** 외부 데이터 조회 결과를 Export Preview에도 반영하여, 미리보기에서 외부 데이터 컬럼값을 확인할 수 있도록 한다.

---

## 4. Specifications (사양)

### 4.1 신규 DB 모델

#### export_data_sources 테이블 (M1)

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| id | SERIAL | PK | |
| source_name | VARCHAR(100) | UNIQUE, NOT NULL | 표시명 (admin이 설정) |
| table_name | VARCHAR(200) | NOT NULL | 실제 DB 테이블명 (예: ext_mes_data) |
| description | TEXT | nullable | 설명 |
| schema_name | VARCHAR(50) | NOT NULL, DEFAULT 'public' | DB 스키마명 (기본 public, 향후 확장 대비) |
| join_key_mappings | JSONB | NOT NULL | JOIN 키 매핑 배열 (아래 구조 참고) |
| is_active | BOOLEAN | DEFAULT true | 활성 여부 |
| created_at | TIMESTAMPTZ | DEFAULT now() | 생성 시각 |
| updated_at | TIMESTAMPTZ | DEFAULT now(), ON UPDATE now() | 수정 시각 |

**join_key_mappings 구조:**
```json
[
  {"external_column": "product_id", "pcm_field": "project.product_id"},
  {"external_column": "step_seq", "pcm_field": "layer.step_seq"}
]
```

사용 가능한 pcm_field 값:
- `project.product_id` — 프로젝트의 제품 ID
- `layer.step_seq` — 레이어의 Step Seq
- `layer.layer_name` — 레이어명
- `layer.layer_number` — 레이어 번호

#### export_column_mappings 테이블 확장 (M2)

기존 테이블에 다음 컬럼을 추가한다 (Alembic 마이그레이션):

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| source_type | VARCHAR(20) | NOT NULL, DEFAULT 'condition' | 'condition' 또는 'external' |
| data_source_id | INTEGER | FK -> export_data_sources.id, nullable | external 소스 참조 (source_type='external'일 때 필수) |
| source_column_name | VARCHAR(200) | nullable | 외부 테이블의 컬럼명 (source_type='external'일 때 필수) |

기존 column_id FK 변경:
- 현재: `column_id INTEGER NOT NULL FK -> column_definitions.id`
- 변경: `column_id INTEGER nullable FK -> column_definitions.id` (source_type='external'일 때 NULL 허용)

CHECK 제약:
- `CHECK (source_type = 'condition' AND column_id IS NOT NULL AND data_source_id IS NULL) OR (source_type = 'external' AND data_source_id IS NOT NULL AND source_column_name IS NOT NULL AND column_id IS NULL)`

### 4.2 신규/수정 API Endpoints

#### M1: External Data Source Admin API

| Method | Path | 설명 | 인증 |
|--------|------|------|------|
| GET | /api/admin/data-sources | 전체 데이터 소스 목록 (비활성 포함) | require_admin |
| POST | /api/admin/data-sources | 데이터 소스 등록 (테이블 존재 검증 포함) | require_admin |
| PUT | /api/admin/data-sources/{id} | 데이터 소스 수정 (테이블 존재 재검증) | require_admin |
| DELETE | /api/admin/data-sources/{id} | 데이터 소스 삭제 (참조 매핑 확인) | require_admin |
| GET | /api/admin/data-sources/{id}/columns | 동적 컬럼 목록 조회 (information_schema) | require_admin |

#### M2: Export Column Mapping Extension (기존 API 확장)

기존 `export_admin.py` 라우터의 매핑 CRUD API를 확장한다:

| Method | Path | 변경 사항 |
|--------|------|-----------|
| POST | /api/admin/export-systems/{id}/mappings | 요청 바디에 source_type, data_source_id, source_column_name 추가 |
| PUT | /api/admin/export-systems/{id}/mappings/{mapping_id} | 요청 바디에 source_type, data_source_id, source_column_name 추가 |
| GET | /api/admin/export-systems/{id}/mappings | 응답에 source_type, data_source_name, source_column_name 추가 |

#### M3: Export Builder Integration (내부 로직 변경, 신규 API 없음)

기존 Export API (`/api/projects/{id}/export/download`, `/api/projects/{id}/export/preview`)의 내부 로직 변경:
- ExportService가 매핑의 source_type을 판별하여 external 매핑이 있으면 외부 데이터를 조회
- ExportBuilders의 build_type_a/b/c_data 함수에 외부 데이터 딕셔너리를 추가 인자로 전달
- ExportValidationService에 external 소스 검증 로직 추가

### 4.3 동적 컬럼 감지 SQL

테이블 존재 확인:
```sql
SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = :table_name AND table_schema = 'public'
)
```

테이블 컬럼 조회:
```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = :table_name AND table_schema = 'public'
ORDER BY ordinal_position
```

### 4.4 외부 데이터 조회 전략

ExportService에서 외부 데이터를 조회하는 흐름:

1. 매핑 목록에서 source_type='external' 매핑을 그룹핑 (data_source_id 별)
2. 각 data_source에 대해:
   a. `export_data_sources`에서 table_name, schema_name, join_key_mappings 조회
   b. join_key_mappings를 순회하며 pcm_field에 따라 값을 추출:
      - `project.product_id` → Project.product_id
      - `layer.step_seq` → Layer.step_seq
      - `layer.layer_name` → Layer.layer_name
      - `layer.layer_number` → Layer.layer_number
   c. **배치 조회**: data_source별 한 번의 SELECT + IN 절로 모든 레이어 데이터를 조회 (레이어별 개별 쿼리 금지)
   d. 결과를 `{layer_identifier: {column_name: value}}` 딕셔너리로 변환
3. ExportBuilders에 외부 데이터 딕셔너리를 전달하여 행 생성 시 병합

JOIN 키 매핑 예시:
- join_key_mappings: `[{"external_column": "product_id", "pcm_field": "project.product_id"}, {"external_column": "step_seq", "pcm_field": "layer.step_seq"}]`
- product_id: Project.product_id에서 추출 → 외부 테이블의 product_id 컬럼과 매칭
- step_seq: Layer.step_seq에서 추출 → 외부 테이블의 step_seq 컬럼과 매칭

### 4.5 영향받는 파일 목록

#### 신규 파일

**Backend:**
- `backend/app/models/export_data_source.py` - ExportDataSource ORM 모델 (M1)
- `backend/app/schemas/export_data_source.py` - 데이터 소스 Pydantic 스키마 (M1)
- `backend/app/services/export_data_source_service.py` - 데이터 소스 CRUD + 컬럼 감지 서비스 (M1)
- `backend/app/routers/export_data_source.py` - 데이터 소스 Admin API 라우터 (M1)
- `backend/alembic/versions/xxxx_add_export_data_sources.py` - export_data_sources 테이블 마이그레이션 (M1)
- `backend/alembic/versions/xxxx_extend_export_column_mappings.py` - 매핑 테이블 확장 마이그레이션 (M2)

**Frontend:**
- `frontend/src/pages/admin/ExportDataSourcesPage.tsx` - 데이터 소스 관리 페이지 (M1)
- `frontend/src/components/admin/ExportDataSourceForm.tsx` - 데이터 소스 추가/수정 모달 (M1)
- `frontend/src/api/exportDataSource.ts` - 데이터 소스 API 클라이언트 (M1)
- `frontend/src/hooks/useExportDataSources.ts` - 데이터 소스 관리 훅 (M1)

#### 수정 파일

**Backend:**
- `backend/app/main.py` - 신규 라우터(export_data_source) 등록 (M1)
- `backend/app/models/__init__.py` - ExportDataSource 모델 import 추가 (M1)
- `backend/app/models/export.py` - ExportColumnMapping에 source_type, data_source_id, source_column_name 컬럼 추가 + relationship (M2)
- `backend/app/schemas/export_admin.py` - ExportMappingCreate/Update/Response에 source_type, data_source_id, source_column_name 필드 추가 (M2)
- `backend/app/services/export_admin_service.py` - 매핑 CRUD에 source_type 분기 로직 추가, 유효성 검증 추가 (M2)
- `backend/app/services/export_service.py` - generate/preview 메서드에 외부 데이터 조회 로직 추가 (M3)
- `backend/app/services/export_builders.py` - build_type_a/b/c_data 함수에 external_data 인자 추가, 외부 매핑 처리 로직 추가 (M3)
- `backend/app/services/export_validation_service.py` - external 소스 매핑에 대한 검증 로직 추가 (M3)

**Frontend:**
- `frontend/src/App.tsx` - Admin 라우트에 ExportDataSourcesPage 추가 (M1)
- `frontend/src/pages/admin/AdminLayout.tsx` - 네비게이션 탭에 '데이터 소스' 추가 (M1)
- `frontend/src/components/admin/ExportMappingForm.tsx` - source_type 선택 UI, 소스/컬럼 드롭다운 연동 추가 (M2)
- `frontend/src/components/admin/ExportMappingManager.tsx` - 매핑 목록에 source_type/소스명 표시 추가 (M2)
- `frontend/src/types/export.ts` - ExportDataSource, 확장된 ExportMapping 타입 추가 (M1, M2)

### 4.6 추적 태그 (Traceability)

| 태그 | 범위 |
|------|------|
| SPEC-EXPORT-002 | 전체 SPEC |
| SPEC-EXPORT-002-M1 | External Data Source Registration |
| SPEC-EXPORT-002-M2 | Export Column Mapping Extension |
| SPEC-EXPORT-002-M3 | Export Builder Integration |
