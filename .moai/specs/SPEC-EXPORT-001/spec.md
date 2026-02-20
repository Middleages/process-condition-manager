# SPEC-EXPORT-001: 전산 출력 확장

## 메타데이터

| 항목 | 값 |
|------|-----|
| SPEC ID | SPEC-EXPORT-001 |
| 제목 | Export System Extension (전산 출력 확장) |
| 상태 | Completed |
| 우선순위 | High |
| 생성일 | 2026-02-20 |
| 선행 SPEC | SPEC-005 (전산 출력 기본), SPEC-AUTH-001 (인증/인가) |
| Phase | Phase 4 |

---

## 1. Environment (환경)

### 1.1 현재 시스템 상태

- **SPEC-005 완료**: ExportService(오케스트레이션) + ExportBuilders(순수 함수) 아키텍처로 Type A/B/C 3종 포맷 전산 출력 구현 완료
- **백엔드 모델**: ExportSystem, ExportColumnMapping, EquipmentAssignment ORM 모델 존재
- **시드 데이터**: 3개 전산 시스템(MES-TRACK/TYPE_A, EQP-SCANNER/TYPE_B, SPC-OVL/TYPE_C)이 시드로만 관리
- **프론트엔드**: ExportPanel + ExportSystemList + ExportPreviewTable + ExportDownloadButton 컴포넌트 존재
- **Admin 패턴**: /api/admin/* 라우터, AdminLayout + XmlMappingsPage + ValidationRulesPage 패턴 구축 완료
- **인증**: JWT 기반 RBAC (admin/reviewer/editor) 적용 완료

### 1.2 한계점

- 전산 출력 시스템과 컬럼 매핑을 관리하는 Admin UI가 **없음** (시드 데이터로만 관리)
- Equipment Assignment에 대한 CRUD API와 UI가 **없음** (모델만 존재)
- 다운로드 전 데이터 품질 검증 기능이 **없음**
- 출력 이력 추적 기능이 **없음** (누가 언제 어떤 시스템으로 출력했는지 기록 불가)

### 1.3 기술 스택

- Backend: FastAPI + SQLAlchemy 2.x (async) + Pydantic v2 + PostgreSQL 16
- Frontend: React 18 + TypeScript + Zustand + AG Grid Community
- 인증: JWT (access/refresh token) + RBAC (require_admin dependency)

---

## 2. Assumptions (가정)

| ID | 가정 | 신뢰도 | 근거 |
|----|------|--------|------|
| A1 | Export Admin 기능은 admin 역할만 접근 가능하다 | High | SPEC-AUTH-001 RBAC 패턴, 기존 admin 라우터에 require_admin 적용 |
| A2 | Equipment Assignment UI는 프로젝트 편집 페이지(ConditionEditorPage) 내에 위치한다 | Medium | Type B 출력과 직접 연관되므로 편집기 컨텍스트에서 관리가 자연스러움 |
| A3 | Export Validation은 다운로드 직전에 실행되며, 경고(warning)는 무시 가능하고 오류(error)는 차단한다 | Medium | 반도체 공정에서 불완전한 데이터 출력은 치명적이므로 오류 차단 필요 |
| A4 | Export History는 성공한 다운로드만 기록한다 | High | 실패한 요청은 별도 로깅 불필요, 감사 추적은 성공 건에 집중 |
| A5 | 기존 export_systems 테이블 스키마는 변경하지 않는다 | High | 하위 호환성 유지 |

---

## 3. Requirements (요구사항)

### M1: Export Admin UI

**REQ-EXT-001** [Ubiquitous]
시스템은 **항상** admin 역할의 사용자에게만 전산 출력 시스템 관리 페이지 접근을 허용해야 한다.

**REQ-EXT-002** [Event-Driven]
**WHEN** admin 사용자가 새 전산 출력 시스템 추가를 요청하면 **THEN** system_name, format_type(TYPE_A/TYPE_B/TYPE_C), description, additional_config(JSONB), is_active 필드를 입력받아 export_systems 테이블에 저장해야 한다.

**REQ-EXT-003** [Event-Driven]
**WHEN** admin 사용자가 기존 전산 출력 시스템을 수정하면 **THEN** 해당 시스템의 모든 편집 가능 필드를 업데이트해야 한다.

**REQ-EXT-004** [Event-Driven]
**WHEN** admin 사용자가 전산 출력 시스템을 삭제하면 **THEN** 연관된 export_column_mappings를 CASCADE 삭제하고, 삭제 확인 다이얼로그를 표시해야 한다.

**REQ-EXT-005** [Event-Driven]
**WHEN** admin 사용자가 특정 전산 시스템의 컬럼 매핑 관리를 요청하면 **THEN** 해당 시스템에 연결된 export_column_mappings 목록을 sort_order 순으로 표시하고, 추가/수정/삭제/순서변경 기능을 제공해야 한다.

**REQ-EXT-006** [Event-Driven]
**WHEN** 컬럼 매핑 추가 시 **THEN** column_definitions 테이블에서 사용 가능한 컬럼 목록을 카테고리(SP/SC/OVL/DEV)별로 필터링하여 선택할 수 있어야 한다.

**REQ-EXT-007** [Unwanted]
시스템은 system_name이 중복된 전산 출력 시스템 생성을 **허용하지 않아야 한다**.

**REQ-EXT-008** [State-Driven]
**IF** 전산 출력 시스템의 is_active가 false이면 **THEN** Admin 목록에서 비활성 상태로 시각적 구분하여 표시해야 한다.

### M2: Equipment Assignment UI

**REQ-EXT-010** [Event-Driven]
**WHEN** 사용자가 프로젝트 편집 페이지에서 특정 레이어의 설비 할당을 요청하면 **THEN** 해당 project_layer에 연결된 equipment_assignments 목록을 표시해야 한다.

**REQ-EXT-011** [Event-Driven]
**WHEN** 사용자가 설비를 추가하면 **THEN** equipment_id와 equipment_params(JSONB)를 입력받아 equipment_assignments 테이블에 저장해야 한다.

**REQ-EXT-012** [Event-Driven]
**WHEN** 사용자가 설비의 파라미터를 수정하면 **THEN** equipment_params의 개별 키-값을 편집할 수 있어야 하며, 수정된 파라미터는 Type B 출력 시 해당 조건값을 override 해야 한다.

**REQ-EXT-013** [Event-Driven]
**WHEN** 사용자가 설비를 삭제하면 **THEN** 확인 후 equipment_assignments에서 해당 레코드를 삭제해야 한다.

**REQ-EXT-014** [Event-Driven]
**WHEN** 사용자가 설비 순서를 변경하면 **THEN** sort_order를 업데이트하여 Type B 출력 순서에 반영해야 한다.

**REQ-EXT-015** [State-Driven]
**IF** 프로젝트 상태가 approved 또는 archived이면 **THEN** 설비 할당 UI는 읽기 전용 모드로 표시해야 한다.

### M3: Export Validation Report

**REQ-EXT-020** [Event-Driven]
**WHEN** 사용자가 전산 출력 다운로드를 요청하면 **THEN** 다운로드 실행 전에 해당 시스템의 매핑된 컬럼에 대해 데이터 품질 검증을 수행해야 한다.

**REQ-EXT-021** [Event-Driven]
**WHEN** 검증 수행 시 **THEN** 다음 항목을 확인해야 한다:
- is_required가 true인 컬럼의 null/빈값 여부 (ERROR)
- 매핑된 컬럼이 column_definitions에 존재하는지 (ERROR)
- 숫자 타입 컬럼에 비숫자 값이 들어있는지 (WARNING)
- 레이어별 누락된 매핑 컬럼 비율 (WARNING, 50% 이상 시)

**REQ-EXT-022** [State-Driven]
**IF** 검증 결과에 ERROR 레벨 항목이 있으면 **THEN** 다운로드 버튼을 비활성화하고 오류 요약을 표시해야 한다.

**REQ-EXT-023** [State-Driven]
**IF** 검증 결과에 WARNING만 있으면 **THEN** 경고 요약을 표시하되 다운로드는 허용해야 한다.

**REQ-EXT-024** [Event-Driven]
**WHEN** 검증 리포트를 표시할 때 **THEN** 시스템별/레이어별/컬럼별로 그룹핑하여 문제를 확인할 수 있어야 한다.

### M4: Export History Logging

**REQ-EXT-030** [Event-Driven]
**WHEN** 전산 출력 다운로드가 성공하면 **THEN** 다음 정보를 export_histories 테이블에 기록해야 한다:
- project_id, system_id, exported_by(user_id), exported_at(timestamp)
- export_type(single/bulk), file_count, total_rows

**REQ-EXT-031** [Event-Driven]
**WHEN** 사용자가 프로젝트의 출력 이력을 조회하면 **THEN** 시간 역순으로 출력 이력을 페이징하여 표시해야 한다.

**REQ-EXT-032** [Ubiquitous]
시스템은 **항상** 출력 이력에 사용자 이름, 시스템 이름, 출력 일시, 출력 타입을 포함해야 한다.

**REQ-EXT-033** [Optional]
**가능하면** Admin 페이지에서 전체 프로젝트에 대한 출력 이력 통계(시스템별 사용 빈도, 일별 출력 건수)를 제공한다.

---

## 4. Specifications (사양)

### 4.1 신규 DB 모델

#### export_histories 테이블 (M4)

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| id | SERIAL | PK | |
| project_id | INTEGER | FK → projects.id, NOT NULL | 대상 프로젝트 |
| export_system_id | INTEGER | FK → export_systems.id, NOT NULL | 출력 시스템 |
| exported_by | INTEGER | FK → users.id, NOT NULL | 출력 사용자 |
| export_type | VARCHAR(10) | NOT NULL | 'single' 또는 'bulk' |
| file_count | INTEGER | NOT NULL, DEFAULT 1 | 파일 수 |
| total_rows | INTEGER | NOT NULL | 총 행 수 |
| exported_at | TIMESTAMPTZ | DEFAULT now() | 출력 시각 |

### 4.2 신규/수정 API Endpoints

#### M1: Export Admin API

| Method | Path | 설명 | 인증 |
|--------|------|------|------|
| GET | /api/admin/export-systems | 전체 시스템 목록 (비활성 포함) | require_admin |
| POST | /api/admin/export-systems | 시스템 생성 | require_admin |
| PUT | /api/admin/export-systems/{id} | 시스템 수정 | require_admin |
| DELETE | /api/admin/export-systems/{id} | 시스템 삭제 | require_admin |
| GET | /api/admin/export-systems/{id}/mappings | 매핑 목록 | require_admin |
| POST | /api/admin/export-systems/{id}/mappings | 매핑 추가 | require_admin |
| PUT | /api/admin/export-systems/{id}/mappings/{mapping_id} | 매핑 수정 | require_admin |
| DELETE | /api/admin/export-systems/{id}/mappings/{mapping_id} | 매핑 삭제 | require_admin |
| PUT | /api/admin/export-systems/{id}/mappings/reorder | 매핑 순서 변경 | require_admin |

#### M2: Equipment Assignment API

| Method | Path | 설명 | 인증 |
|--------|------|------|------|
| GET | /api/projects/{id}/layers/{layer_id}/equipment | 설비 목록 | require_auth |
| POST | /api/projects/{id}/layers/{layer_id}/equipment | 설비 추가 | require_auth |
| PUT | /api/projects/{id}/layers/{layer_id}/equipment/{eq_id} | 설비 수정 | require_auth |
| DELETE | /api/projects/{id}/layers/{layer_id}/equipment/{eq_id} | 설비 삭제 | require_auth |
| PUT | /api/projects/{id}/layers/{layer_id}/equipment/reorder | 순서 변경 | require_auth |

#### M3: Export Validation API

| Method | Path | 설명 | 인증 |
|--------|------|------|------|
| POST | /api/projects/{id}/export/validate | 출력 전 검증 | require_auth |

#### M4: Export History API

| Method | Path | 설명 | 인증 |
|--------|------|------|------|
| GET | /api/projects/{id}/export/history | 프로젝트별 출력 이력 | require_auth |
| GET | /api/admin/export-history | 전체 출력 이력 (admin) | require_admin |
| GET | /api/admin/export-history/stats | 출력 통계 (optional) | require_admin |

### 4.3 영향받는 파일 목록

#### 신규 파일

**Backend:**
- `backend/app/routers/export_admin.py` - Export Admin API 라우터 (M1)
- `backend/app/routers/equipment.py` - Equipment Assignment API 라우터 (M2)
- `backend/app/services/export_admin_service.py` - Export Admin 비즈니스 로직 (M1)
- `backend/app/services/equipment_service.py` - Equipment 비즈니스 로직 (M2)
- `backend/app/services/export_validation_service.py` - Export 검증 로직 (M3)
- `backend/app/services/export_history_service.py` - Export 이력 로직 (M4)
- `backend/app/schemas/export_admin.py` - Admin 스키마 (M1)
- `backend/app/schemas/equipment.py` - Equipment 스키마 (M2)
- `backend/app/models/export_history.py` - ExportHistory 모델 (M4)
- `backend/alembic/versions/xxxx_add_export_histories.py` - 마이그레이션 (M4)

**Frontend:**
- `frontend/src/pages/admin/ExportSystemsPage.tsx` - Export 시스템 관리 페이지 (M1)
- `frontend/src/components/admin/ExportSystemForm.tsx` - 시스템 추가/수정 모달 (M1)
- `frontend/src/components/admin/ExportMappingManager.tsx` - 컬럼 매핑 관리 UI (M1)
- `frontend/src/components/admin/ExportMappingForm.tsx` - 매핑 추가/수정 모달 (M1)
- `frontend/src/components/editor/EquipmentPanel.tsx` - 설비 할당 패널 (M2)
- `frontend/src/components/editor/EquipmentForm.tsx` - 설비 추가/수정 모달 (M2)
- `frontend/src/components/export/ExportValidationReport.tsx` - 검증 리포트 UI (M3)
- `frontend/src/components/export/ExportHistoryPanel.tsx` - 출력 이력 패널 (M4)
- `frontend/src/hooks/useExportAdmin.ts` - Export Admin 훅 (M1)
- `frontend/src/hooks/useEquipment.ts` - Equipment 훅 (M2)
- `frontend/src/hooks/useExportHistory.ts` - Export History 훅 (M4)
- `frontend/src/api/exportAdmin.ts` - Export Admin API 클라이언트 (M1)
- `frontend/src/api/equipment.ts` - Equipment API 클라이언트 (M2)

#### 수정 파일

**Backend:**
- `backend/app/main.py` - 신규 라우터 등록 (M1, M2, M3, M4)
- `backend/app/models/__init__.py` - ExportHistory 모델 import 추가 (M4)
- `backend/app/routers/export.py` - 검증 endpoint 추가, 이력 기록 연동 (M3, M4)
- `backend/app/services/export_service.py` - 검증/이력 서비스 호출 추가 (M3, M4)
- `backend/app/schemas/export.py` - 검증 응답 스키마 추가 (M3)

**Frontend:**
- `frontend/src/App.tsx` - Admin 라우트에 ExportSystemsPage 추가 (M1)
- `frontend/src/pages/admin/AdminLayout.tsx` - 네비게이션 탭 추가 (M1)
- `frontend/src/components/export/ExportPanel.tsx` - 검증 리포트 + 이력 패널 통합 (M3, M4)
- `frontend/src/components/export/ExportDownloadButton.tsx` - 검증 상태 연동 (M3)
- `frontend/src/pages/ConditionEditorPage.tsx` - EquipmentPanel 통합 (M2)
- `frontend/src/types/export.ts` - 검증/이력 타입 추가 (M3, M4)

### 4.4 추적 태그 (Traceability)

| 태그 | 범위 |
|------|------|
| SPEC-EXPORT-001 | 전체 SPEC |
| SPEC-EXPORT-001-M1 | Export Admin UI |
| SPEC-EXPORT-001-M2 | Equipment Assignment UI |
| SPEC-EXPORT-001-M3 | Export Validation Report |
| SPEC-EXPORT-001-M4 | Export History Logging |
