# SPEC-EXPORT-002 구현 계획

**SPEC ID**: SPEC-EXPORT-002
**추적 태그**: SPEC-EXPORT-002

---

## 1. 마일스톤 개요

| 마일스톤 | 설명 | 우선순위 | 상대 복잡도 | 의존성 |
|----------|------|----------|-------------|--------|
| M1 | External Data Source Registration (Admin UI) | Primary Goal | Medium (3/5) | 없음 |
| M2 | Export Column Mapping Extension | Secondary Goal | High (4/5) | M1 (데이터 소스 존재 필요) |
| M3 | Export Builder Integration | Final Goal | High (4/5) | M1 + M2 (소스 등록 + 매핑 확장 완료 필요) |

---

## 2. M1: External Data Source Registration (Primary Goal)

### 2.1 기술 접근

**백엔드:**
- 기존 `export_admin.py` 라우터 패턴을 따라 `/api/admin/data-sources` 라우터 생성
- `require_admin` 의존성으로 접근 제어
- `export_data_source_service.py`에 비즈니스 로직 분리 (Router -> Service -> Model 패턴)
- ExportDataSource 모델: source_name(UNIQUE), table_name, schema_name(DEFAULT 'public'), description, join_key_mappings(JSONB), is_active
- 테이블 존재 검증: `information_schema.tables` 조회로 table_name 유효성 확인
- 동적 컬럼 감지: `information_schema.columns` 조회로 컬럼 목록 반환
- Alembic 마이그레이션으로 `export_data_sources` 테이블 생성

**프론트엔드:**
- AdminLayout에 '데이터 소스' 탭 추가 (`/admin/data-sources`)
- ExportDataSourcesPage: 데이터 소스 목록 테이블 + 추가/수정/삭제 버튼
- ExportDataSourceForm: 모달 폼 (source_name, table_name, description, join_keys 편집, is_active 토글)
  - join_key_mappings: 외부 컬럼명 + PCM 필드 드롭다운 쌍을 동적으로 추가/삭제할 수 있는 행 입력 UI (pcm_field 선택지: project.product_id, layer.step_seq, layer.layer_name, layer.layer_number)
  - table_name 입력 후 '테이블 확인' 버튼으로 존재 여부 검증 + 컬럼 목록 미리보기
- 비활성 소스: 회색 배경 또는 비활성 뱃지로 시각 구분

### 2.2 구현 순서

1. Backend: ExportDataSource ORM 모델 정의 (`models/export_data_source.py`)
2. Backend: Alembic 마이그레이션 생성 (export_data_sources 테이블)
3. Backend: Pydantic 스키마 정의 (`schemas/export_data_source.py`)
4. Backend: Service 로직 구현 (`services/export_data_source_service.py`)
   - CRUD 메서드 + table_exists 검증 + discover_columns 메서드
5. Backend: Router 엔드포인트 구현 (`routers/export_data_source.py`)
6. Backend: main.py에 라우터 등록
7. Frontend: API 클라이언트 (`api/exportDataSource.ts`)
8. Frontend: Custom hooks (`hooks/useExportDataSources.ts`)
9. Frontend: ExportDataSourcesPage + ExportDataSourceForm
10. Frontend: AdminLayout + App.tsx 라우트 추가

### 2.3 리스크

| 리스크 | 영향 | 대응 |
|--------|------|------|
| 외부 테이블이 별도 스키마(public 외)에 있을 가능성 | Low | table_schema를 설정 가능하게 모델에 schema_name 필드 추가 고려 (기본값 'public') |
| join_key_mappings JSONB 편집 UI 복잡도 | Low | 매핑 객체 배열이므로 external_column + pcm_field 드롭다운 행 추가/삭제 UI로 구현 |
| information_schema 접근 권한 | Low | PostgreSQL 기본 권한으로 접근 가능, SELECT 권한이면 충분 |

---

## 3. M2: Export Column Mapping Extension (Secondary Goal)

### 3.1 기술 접근

**백엔드:**
- `export_column_mappings` 테이블에 3개 컬럼 추가:
  - `source_type` VARCHAR(20) NOT NULL DEFAULT 'condition'
  - `data_source_id` INTEGER nullable FK -> export_data_sources.id
  - `source_column_name` VARCHAR(200) nullable
- 기존 `column_id` NOT NULL 제약을 nullable로 변경 (source_type='external'일 때)
- CHECK 제약 추가: source_type별 필수 필드 강제
- Alembic 마이그레이션: 컬럼 추가 + 기존 데이터 source_type='condition' 기본값 설정
- ExportAdminService의 매핑 CRUD 메서드 확장:
  - create_mapping: source_type 분기 검증 추가
  - update_mapping: source_type 변경 시 관련 필드 정합성 검증
  - list_mappings: 응답에 data_source_name, source_column_name 포함
- ExportColumnMapping 모델에 ExportDataSource relationship 추가

**프론트엔드:**
- ExportMappingForm 확장:
  - source_type 라디오 또는 드롭다운 (조건표 / 외부 소스)
  - source_type='condition': 기존 UI (카테고리별 컬럼 선택)
  - source_type='external': 데이터 소스 드롭다운 -> 소스 선택 시 컬럼 드롭다운 동적 로드
- ExportMappingManager 확장:
  - 매핑 목록에 source_type 아이콘/뱃지 표시 (조건표 vs 외부)
  - 외부 매핑의 경우 소스 이름 + 컬럼 이름 표시

### 3.2 구현 순서

1. Backend: Alembic 마이그레이션 생성 (컬럼 추가 + CHECK 제약)
2. Backend: ExportColumnMapping 모델 수정 (신규 컬럼 + relationship)
3. Backend: Pydantic 스키마 수정 (ExportMappingCreate/Update/Response 확장)
4. Backend: ExportAdminService 수정 (source_type 분기 검증, 응답 확장)
5. Frontend: 타입 정의 수정 (`types/export.ts`)
6. Frontend: ExportMappingForm 확장 (source_type 선택 + 동적 컬럼 로드)
7. Frontend: ExportMappingManager 확장 (소스 타입 표시)

### 3.3 리스크

| 리스크 | 영향 | 대응 |
|--------|------|------|
| column_id nullable 변경으로 기존 쿼리 영향 | Medium | 기존 데이터에 source_type='condition' 기본값 적용, column_id NOT NULL 보장. ExportBuilders에서 column_definition 접근 시 null 안전 처리 |
| CHECK 제약과 ORM 레벨 검증 이중 관리 | Low | DB CHECK를 최종 안전망으로, Service 레벨에서 선제 검증하여 사용자 친화적 오류 메시지 반환 |
| 외부 컬럼 드롭다운 로딩 지연 | Low | 소스 선택 시 API 호출로 컬럼 로드, 로딩 인디케이터 표시 |

---

## 4. M3: Export Builder Integration (Final Goal)

### 4.1 기술 접근

**백엔드 - ExportService 수정:**
- `_get_column_mappings` 반환값에 source_type, data_source 정보 포함
- 신규 헬퍼 `_get_external_data`:
  1. external 매핑을 data_source_id별로 그룹핑
  2. 각 data_source에 대해 table_name, join_keys 조회
  3. 프로젝트 레이어 정보에서 JOIN 키 값 추출
  4. raw SQL (text())로 외부 테이블에 SELECT 실행 (필요 컬럼 + WHERE 조건)
  5. 결과를 `{(join_key_values): {column_name: value}}` 딕셔너리로 반환
- `generate`, `generate_preview` 메서드에서 external 매핑이 있으면 외부 데이터 조회 후 ExportBuilders에 전달

**백엔드 - ExportBuilders 수정:**
- `build_type_a_data`, `build_type_b_data`, `build_type_c_data` 함수 시그니처 확장:
  - 새 인자: `external_data: dict[str, dict[str, Any]] = None` (키: 레이어 식별자, 값: {컬럼명: 값})
- 각 행 생성 시 매핑의 source_type 확인:
  - `condition`: 기존 로직 (conditions JSONB 참조)
  - `external`: external_data 딕셔너리에서 값 조회, 없으면 빈 문자열

**백엔드 - ExportValidationService 수정:**
- 외부 소스 매핑에 대한 검증 항목 추가:
  - ERROR: is_required=true인 외부 매핑의 값이 null/부재
  - WARNING: 외부 데이터 소스가 비활성 상태
  - WARNING: 외부 테이블에 해당 레이어의 데이터가 없음

**프론트엔드:**
- 신규 UI 변경 없음 (Export Panel, Preview, Download 기존 동작 유지)
- Preview 응답에 외부 데이터 값이 자동으로 포함됨

### 4.2 구현 순서

1. Backend: ExportService에 `_get_external_data` 헬퍼 구현
2. Backend: ExportService.generate / generate_preview 메서드 수정 (외부 데이터 조회 통합)
3. Backend: ExportBuilders의 build_type_a/b/c_data 시그니처 및 로직 수정
4. Backend: ExportValidationService에 외부 소스 검증 추가
5. Backend: 통합 테스트 (조건표 + 외부 데이터 혼합 출력)
6. Frontend: (변경 없음 - 기존 Preview/Download UI가 자동으로 외부 데이터 표시)

### 4.3 리스크

| 리스크 | 영향 | 대응 |
|--------|------|------|
| 외부 테이블 쿼리 성능 (대량 레이어) | Medium | 레이어별 개별 쿼리 대신 IN 절로 배치 조회, 필요 컬럼만 SELECT |
| JOIN 키 매핑 오류 (잘못된 키 조합) | Medium | Admin이 join_keys 설정 시 유효성 안내, 조회 결과 0건 시 경고 로그 |
| raw SQL 주입 위험 | High | table_name/column_name을 화이트리스트(information_schema에서 확인된 값)로 검증, 바인딩 파라미터 사용 |
| 외부 테이블 스키마 변경 시 매핑 깨짐 | Medium | 동적 컬럼 감지로 변경 감지 가능, 출력 시 컬럼 존재 여부 검증 추가 |

---

## 5. 아키텍처 설계 방향

### 5.1 백엔드 레이어 구조

```
routers/
  export_data_source.py        (M1: Data Source Admin CRUD endpoints)
  export_admin.py              (기존: M2 매핑 CRUD 확장)

services/
  export_data_source_service.py (M1: Data Source CRUD + 테이블 검증 + 컬럼 감지)
  export_admin_service.py       (기존: M2 매핑 source_type 분기 추가)
  export_service.py             (기존: M3 외부 데이터 조회 로직 추가)
  export_builders.py            (기존: M3 external_data 인자 추가)
  export_validation_service.py  (기존: M3 외부 소스 검증 추가)

models/
  export_data_source.py         (M1: ExportDataSource 신규)
  export.py                     (기존: M2 ExportColumnMapping 확장)

schemas/
  export_data_source.py         (M1: Data Source 전용 스키마)
  export_admin.py               (기존: M2 매핑 스키마 확장)
```

### 5.2 프론트엔드 컴포넌트 구조

```
pages/admin/
  ExportDataSourcesPage.tsx     (M1: 데이터 소스 관리 페이지)

components/admin/
  ExportDataSourceForm.tsx      (M1: 데이터 소스 추가/수정 모달)
  ExportMappingForm.tsx         (기존: M2 source_type 선택 UI 추가)
  ExportMappingManager.tsx      (기존: M2 소스 타입 표시 추가)

api/
  exportDataSource.ts           (M1: 데이터 소스 API 클라이언트)

hooks/
  useExportDataSources.ts       (M1: 데이터 소스 관리 훅)

types/
  export.ts                     (기존: M1/M2 타입 확장)
```

### 5.3 기존 코드 패턴 준수

- **Admin 라우터**: `prefix="/api/admin"`, `require_admin` 의존성 (export_admin.py 패턴)
- **서비스 분리**: CRUD 서비스(ExportDataSourceService) + 오케스트레이션(ExportService) + 순수 함수(ExportBuilders) 패턴 유지
- **스키마**: Pydantic v2 `model_config = ConfigDict(from_attributes=True)` 패턴
- **프론트엔드**: React Query 캐시 기반 custom hooks 패턴
- **모달 폼**: ExportSystemForm, ExportMappingForm 패턴 참고
- **SQL 보안**: raw SQL 사용 시 sqlalchemy.text() + 바인딩 파라미터, 테이블/컬럼명은 information_schema 화이트리스트 검증

### 5.4 외부 데이터 조회 보안

외부 테이블에 대한 raw SQL 실행 시 SQL Injection 방지 전략:
1. table_name: `information_schema.tables`에서 존재 확인된 값만 허용
2. column_name: `information_schema.columns`에서 확인된 값만 허용
3. JOIN 키 값: SQLAlchemy `text()` 바인딩 파라미터로 전달
4. 동적 식별자(테이블명, 컬럼명): PostgreSQL의 `quote_ident()` 함수 또는 SQLAlchemy 식별자 이스케이프 사용

---

## 6. 마일스톤 간 의존성

```
M1 (Data Source Registration)
  |
  +---> M2 (Mapping Extension) - M1의 데이터 소스 존재가 전제
         |
         +---> M3 (Builder Integration) - M1 + M2 완료가 전제
```

- M1은 독립적으로 먼저 구현 가능
- M2는 M1 완료 후 진행 (외부 소스 참조를 위한 export_data_sources 테이블 필요)
- M3는 M1 + M2 완료 후 진행 (매핑에 external 소스 정보가 존재해야 외부 데이터 조회 가능)
- 모든 마일스톤은 순차적 진행 권장

---

## 7. 전체 리스크 요약

| 리스크 | 마일스톤 | 심각도 | 대응 전략 |
|--------|----------|--------|-----------|
| SQL Injection (raw SQL) | M3 | High | information_schema 화이트리스트 + 바인딩 파라미터 + quote_ident() |
| column_id nullable 변경 영향 | M2 | Medium | 기존 데이터 기본값 적용, ORM 접근 시 null 안전 처리 |
| 외부 테이블 쿼리 성능 | M3 | Medium | IN 절 배치 조회, 필요 컬럼만 SELECT |
| 외부 테이블 스키마 변경 | M1, M3 | Medium | 동적 컬럼 감지, 출력 시 컬럼 존재 검증 |
| JOIN 키 매핑 오류 | M3 | Medium | Admin 가이드, 조회 0건 시 경고 |
