# SPEC-EXPORT-001 구현 계획

**SPEC ID**: SPEC-EXPORT-001
**추적 태그**: SPEC-EXPORT-001

---

## 1. 마일스톤 개요

| 마일스톤 | 설명 | 우선순위 | 상대 복잡도 | 의존성 |
|----------|------|----------|-------------|--------|
| M1 | Export Admin UI | Primary Goal | High (5/5) | 없음 |
| M2 | Equipment Assignment UI | Secondary Goal | Medium (3/5) | 없음 |
| M3 | Export Validation Report | Secondary Goal | Medium (3/5) | M1 (매핑 데이터 의존) |
| M4 | Export History Logging | Final Goal | Low-Medium (2/5) | 없음 |

---

## 2. M1: Export Admin UI (Primary Goal)

### 2.1 기술 접근

**백엔드:**
- 기존 `admin.py` 라우터 패턴을 따라 `/api/admin/export-systems` 라우터 생성
- `require_admin` 의존성으로 접근 제어
- `export_admin_service.py`에 비즈니스 로직 분리 (Router -> Service -> Model 패턴)
- ExportSystem CRUD + ExportColumnMapping CRUD (nested resource)
- system_name UNIQUE 제약 검증, CASCADE 삭제 처리

**프론트엔드:**
- AdminLayout에 '전산 출력 시스템' 탭 추가 (`/admin/export-systems`)
- ExportSystemsPage: 시스템 목록 테이블 + 추가/수정/삭제 버튼
- ExportSystemForm: 모달 폼 (system_name, format_type 드롭다운, description, is_active 토글)
- ExportMappingManager: 특정 시스템 선택 시 컬럼 매핑 관리 UI
  - 컬럼 선택: column_definitions에서 카테고리별 필터링 가능한 드롭다운
  - Drag-and-drop 또는 up/down 버튼으로 sort_order 변경
- ExportMappingForm: 매핑 추가/수정 모달 (column 선택, target_column_name, is_required 체크)

### 2.2 구현 순서

1. Backend: Pydantic 스키마 정의 (`schemas/export_admin.py`)
2. Backend: Service 로직 구현 (`services/export_admin_service.py`)
3. Backend: Router 엔드포인트 구현 (`routers/export_admin.py`)
4. Backend: main.py에 라우터 등록
5. Frontend: API 클라이언트 (`api/exportAdmin.ts`)
6. Frontend: Custom hooks (`hooks/useExportAdmin.ts`)
7. Frontend: ExportSystemsPage + ExportSystemForm
8. Frontend: ExportMappingManager + ExportMappingForm
9. Frontend: AdminLayout + App.tsx 라우트 추가

### 2.3 리스크

| 리스크 | 영향 | 대응 |
|--------|------|------|
| additional_config JSONB 편집 UI 복잡도 | Medium | JSON 에디터 대신 format_type별 구조화된 폼 제공 (예: TYPE_C의 unit_mappings) |
| 매핑 순서 변경 UX | Low | 드래그앤드롭 라이브러리 도입 대신 up/down 버튼으로 단순 구현 |
| 기존 시드 데이터와 Admin 생성 데이터의 공존 | Low | 시드 데이터는 초기 설정용, Admin에서 자유롭게 편집 가능 |

---

## 3. M2: Equipment Assignment UI (Secondary Goal)

### 3.1 기술 접근

**백엔드:**
- `routers/equipment.py` 신규 라우터 생성
- `/api/projects/{id}/layers/{layer_id}/equipment` RESTful 경로
- `equipment_service.py`에 CRUD + reorder 로직
- 프로젝트 상태 검증: approved/archived 상태에서는 수정 차단 (403)
- project_layer 존재 여부 검증

**프론트엔드:**
- ConditionEditorPage에 EquipmentPanel 통합
  - 현재 선택된 레이어의 설비 목록 표시
  - 설비별 equipment_id + equipment_params 편집
- EquipmentForm: 설비 추가/수정 모달
  - equipment_id 입력
  - equipment_params: 키-값 쌍 동적 추가/삭제 폼
  - 기존 conditions 컬럼 이름 기반으로 override 가능한 파라미터 목록 제안
- 읽기 전용 모드: 프로젝트 상태가 approved/archived일 때

### 3.2 구현 순서

1. Backend: Pydantic 스키마 정의 (`schemas/equipment.py`)
2. Backend: Service 로직 구현 (`services/equipment_service.py`)
3. Backend: Router 엔드포인트 구현 (`routers/equipment.py`)
4. Backend: main.py에 라우터 등록
5. Frontend: API 클라이언트 (`api/equipment.ts`)
6. Frontend: Custom hooks (`hooks/useEquipment.ts`)
7. Frontend: EquipmentPanel + EquipmentForm
8. Frontend: ConditionEditorPage에 EquipmentPanel 통합

### 3.3 리스크

| 리스크 | 영향 | 대응 |
|--------|------|------|
| equipment_params JSONB의 유연한 편집 UI | Medium | 키-값 쌍 동적 폼으로 구현, JSON raw 편집은 advanced 옵션으로 제공 |
| 레이어별 설비 목록이 많아질 경우 | Low | 가상 스크롤 불필요, 레이어당 설비는 일반적으로 10개 미만 |

---

## 4. M3: Export Validation Report (Secondary Goal)

### 4.1 기술 접근

**백엔드:**
- `services/export_validation_service.py` 신규 서비스
- `POST /api/projects/{id}/export/validate` endpoint (body: system_ids)
- 검증 항목:
  - **ERROR**: required 컬럼에 null/빈값 (is_required=True인 매핑 컬럼 확인)
  - **ERROR**: 매핑된 column_id가 column_definitions에 존재하지 않음
  - **WARNING**: 숫자 타입 컬럼에 비숫자 값
  - **WARNING**: 레이어별 데이터 누락률 50% 이상
- 검증 결과 구조: `{ system_id, issues: [{ level, layer, column, message }] }`

**프론트엔드:**
- ExportValidationReport 컴포넌트
  - 다운로드 버튼 클릭 시 자동으로 검증 실행
  - ERROR/WARNING 아이콘 + 색상 구분
  - 시스템별 -> 레이어별 -> 컬럼별 트리 구조 표시
  - ERROR 존재 시 다운로드 버튼 비활성화 + 오류 수 표시
  - WARNING만 있으면 "경고를 확인하고 계속" 버튼 표시
- ExportPanel, ExportDownloadButton 수정: 검증 결과 연동

### 4.2 구현 순서

1. Backend: 검증 결과 스키마 정의 (`schemas/export.py` 확장)
2. Backend: ExportValidationService 구현
3. Backend: export.py 라우터에 validate endpoint 추가
4. Frontend: ExportValidationReport 컴포넌트
5. Frontend: ExportPanel + ExportDownloadButton 검증 연동

### 4.3 리스크

| 리스크 | 영향 | 대응 |
|--------|------|------|
| 대량 데이터(60 레이어 x 300 컬럼) 검증 성능 | Medium | 매핑된 컬럼만 검증 (전체 300개 아닌 시스템별 매핑된 컬럼만), 레이어 단위 처리 |
| 검증 규칙 확장 요구 | Low | 검증 함수를 Strategy 패턴으로 분리하여 추후 규칙 추가 용이하게 설계 |

---

## 5. M4: Export History Logging (Final Goal)

### 5.1 기술 접근

**백엔드:**
- `models/export_history.py`: ExportHistory ORM 모델 + Alembic 마이그레이션
- `services/export_history_service.py`: 이력 생성 + 조회 + 통계
- 기존 `routers/export.py`의 export endpoint에 이력 기록 로직 추가
  - 다운로드 성공 시 `ExportHistoryService.log_export()` 호출
  - 현재 인증된 user 정보를 의존성에서 주입
- 이력 조회 API: 프로젝트별 + 전체(admin) + 통계(optional)
- 페이지네이션: offset/limit 기반

**프론트엔드:**
- ExportHistoryPanel: ExportPanel 하단에 최근 출력 이력 표시
  - 사용자명, 시스템명, 출력일시, 타입(single/bulk) 표시
  - "더 보기" 버튼으로 추가 로딩
- Admin 전체 이력: AdminLayout에 '출력 이력' 탭 추가 (Optional)

### 5.2 구현 순서

1. Backend: ExportHistory 모델 정의
2. Backend: Alembic 마이그레이션 생성
3. Backend: ExportHistoryService 구현
4. Backend: export.py에 이력 기록 + 조회 endpoint 추가
5. Backend: 기존 export endpoint에 이력 기록 로직 통합
6. Frontend: API 클라이언트 + hooks
7. Frontend: ExportHistoryPanel 컴포넌트
8. Frontend: ExportPanel에 ExportHistoryPanel 통합

### 5.3 리스크

| 리스크 | 영향 | 대응 |
|--------|------|------|
| 출력 이력 데이터 증가에 따른 조회 성능 | Low | exported_at + project_id 복합 인덱스 생성, 기본 페이지네이션 적용 |
| 인증 정보 주입 | Low | 기존 export endpoint에 require_auth 의존성 추가 필요 (현재는 미적용 가능성) |

---

## 6. 아키텍처 설계 방향

### 6.1 백엔드 레이어 구조

```
routers/
  export_admin.py          (M1: Admin CRUD endpoints)
  equipment.py             (M2: Equipment CRUD endpoints)
  export.py                (M3: validate endpoint 추가, M4: history endpoints 추가)

services/
  export_admin_service.py  (M1: ExportSystem + ExportColumnMapping CRUD)
  equipment_service.py     (M2: EquipmentAssignment CRUD)
  export_validation_service.py  (M3: Pre-export data quality check)
  export_history_service.py     (M4: Export history logging + query)
  export_service.py        (기존: M4 이력 기록 호출 추가)

models/
  export.py                (기존: ExportSystem, ExportColumnMapping, EquipmentAssignment)
  export_history.py        (M4: ExportHistory 신규)

schemas/
  export_admin.py          (M1: Admin 전용 스키마)
  equipment.py             (M2: Equipment 스키마)
  export.py                (기존: M3 검증 응답 추가, M4 이력 응답 추가)
```

### 6.2 프론트엔드 컴포넌트 구조

```
pages/admin/
  ExportSystemsPage.tsx    (M1: Export 시스템 관리 페이지)

components/admin/
  ExportSystemForm.tsx     (M1: 시스템 추가/수정 모달)
  ExportMappingManager.tsx (M1: 컬럼 매핑 관리)
  ExportMappingForm.tsx    (M1: 매핑 추가/수정 모달)

components/editor/
  EquipmentPanel.tsx       (M2: 설비 할당 패널)
  EquipmentForm.tsx        (M2: 설비 추가/수정 모달)

components/export/
  ExportPanel.tsx           (기존: M3/M4 통합)
  ExportValidationReport.tsx (M3: 검증 리포트)
  ExportHistoryPanel.tsx     (M4: 출력 이력)
```

### 6.3 기존 코드 패턴 준수

- **Admin 라우터**: `prefix="/api/admin"`, `require_admin` 의존성 (admin.py 패턴)
- **서비스 분리**: 오케스트레이션(ExportService) + 순수 함수(ExportBuilders) 패턴 유지
- **스키마**: Pydantic v2 `model_config = {"from_attributes": True}` 패턴
- **프론트엔드**: Zustand 스토어 불필요 (React Query 캐시로 충분), custom hooks 패턴
- **모달 폼**: MappingFormModal, ValidationEditModal 패턴 참고

---

## 7. 마일스톤 간 의존성

```
M1 (Export Admin UI)
  |
  +---> M3 (Export Validation) - M1의 매핑 관리로 정확한 매핑 데이터 보장

M2 (Equipment Assignment UI) - 독립적

M4 (Export History Logging) - 독립적 (기존 export endpoint에 이력 기록만 추가)
```

- M1과 M2는 병렬 개발 가능
- M3는 M1 완료 후 진행 권장 (정확한 매핑 데이터가 검증의 전제 조건)
- M4는 독립적으로 언제든 진행 가능

---

## 8. 전체 리스크 요약

| 리스크 | 마일스톤 | 심각도 | 대응 전략 |
|--------|----------|--------|-----------|
| JSONB 편집 UI 복잡도 | M1, M2 | Medium | format_type별 구조화된 폼 + 키-값 동적 폼 |
| 대량 데이터 검증 성능 | M3 | Medium | 매핑 컬럼 한정 검증, 레이어 단위 처리 |
| 기존 export endpoint에 인증 의존성 추가 | M4 | Low | Optional 인증으로 하위 호환성 유지 |
| Admin UI 테스트 부담 | M1 | Low | 기존 Admin 페이지 테스트 패턴 재사용 |
