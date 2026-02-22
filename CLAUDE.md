# PCM (Process Condition Manager) - Claude Code 작업 가이드

## 프로젝트 개요

반도체 Photo 공정의 공정조건표를 웹에서 관리하는 시스템.
제품당 ~300개 컬럼 × 30~60개 레이어의 조건 데이터를 편집·검증·승인·출력한다.

## 기술 스택

- **Frontend**: React 18 + TypeScript + Vite, AG Grid Community, React Router, Axios, Zustand
- **Backend**: FastAPI (Python), SQLAlchemy 2.x (async), Alembic, Pydantic, python-jose (JWT), passlib (bcrypt)
- **DB**: PostgreSQL 16 (JSONB로 조건 데이터 저장)
- **Infra**: Docker Compose (backend:8000, frontend:5173, nginx:80, db:5432)

## 프로젝트 구조

```
process-condition-manager/
├── backend/
│   ├── app/
│   │   ├── main.py           # FastAPI 앱 진입점
│   │   ├── config.py         # 설정 (DATABASE_URL, SECRET_KEY)
│   │   ├── constants.py      # 도메인 상수 (상태 전환, 규칙 타입, 카테고리 코드)
│   │   ├── database.py       # AsyncSession, engine, Base
│   │   ├── models/           # SQLAlchemy ORM 모델
│   │   ├── dependencies/     # FastAPI 인증 의존성 (auth.py)
│   │   ├── repositories/     # 데이터 접근 계층 (N+1 최적화)
│   │   │   ├── backbone_repository.py   # Backbone 자격 판정 + 조건 조회
│   │   │   ├── comment_repository.py    # ReviewComment 조회 (JOIN 최적화)
│   │   │   ├── change_log_repository.py # ChangeLog/StatusLog 조회 + 통계
│   │   │   └── dashboard_repository.py  # 대시보드 집계 쿼리 (4종)
│   │   ├── routers/          # API 엔드포인트 (도메인별 분리)
│   │   │   ├── projects.py              # 프로젝트 CRUD (3 endpoints)
│   │   │   ├── project_conditions.py    # 조건 저장/검증/이력 (7 endpoints)
│   │   │   ├── project_layers.py        # Backbone/Recipe/레이어 (5 endpoints)
│   │   │   ├── project_lifecycle.py     # 상태 전환/개정/요약 (5 endpoints)
│   │   │   ├── dashboard.py             # 대시보드 개요 (1 endpoint)
│   │   │   ├── comments.py, admin.py, export.py, auth.py
│   │   │   └── users.py, lines.py, columns.py, products.py
│   │   ├── services/         # 비즈니스 로직 (도메인별 분리)
│   │   │   ├── project_service.py           # 프로젝트 CRUD + 개정
│   │   │   ├── project_status_service.py    # 상태 전환 워크플로우
│   │   │   ├── project_analytics_service.py # 변경 요약 + 버전 히스토리
│   │   │   ├── dashboard_service.py         # 대시보드 오케스트레이션
│   │   │   ├── comment_service.py, change_log_service.py
│   │   │   ├── condition_service.py, validation_service.py
│   │   │   ├── backbone_service.py, recipe_service.py
│   │   │   ├── export_service.py, export_builders.py  # 전산 출력 (서비스 + 빌더 분리)
│   │   │   ├── export_admin_service.py   # 전산 출력 시스템/매핑 관리
│   │   │   ├── export_history_service.py # 출력 이력 기록/조회
│   │   │   ├── export_validation_service.py # 출력 전 데이터 검증
│   │   │   ├── equipment_service.py      # 설비 할당 CRUD
│   │   │   ├── export_data_source_service.py # 외부 데이터 소스 관리
│   │   │   ├── admin_service.py, diff_service.py
│   │   │   └── auth_service.py
│   │   ├── utils/            # 유틸리티
│   │   │   └── comparison.py # values_differ() 통합 비교 함수
│   │   ├── schemas/          # Pydantic 스키마
│   │   ├── seed/             # 시드 데이터 패키지 (모듈별 분리)
│   │   │   ├── columns.py, layers.py, products.py
│   │   │   ├── exports.py, users.py, runner.py
│   │   │   └── __init__.py, __main__.py
│   ├── alembic/              # DB 마이그레이션
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── main.tsx          # React 진입점
│   │   ├── App.tsx           # 라우터 (/, /projects, /projects/:id/edit)
│   │   ├── api/              # Axios API 클라이언트
│   │   ├── components/       # UI 컴포넌트
│   │   │   ├── editor/       # 조건표 편집기 컴포넌트 (ConditionGrid, buildColumnDefs, GridContextMenu)
│   │   │   ├── export/       # 전산 출력 컴포넌트
│   │   │   ├── auth/         # 인증 관련 컴포넌트
│   │   │   └── layout/       # Header, Layout
│   │   ├── hooks/            # 커스텀 훅 (도메인별 분리)
│   │   │   ├── useEditorCellEdit.ts    # 셀 편집/저장/오토세이브
│   │   │   ├── useEditorNavigation.ts  # 레이어/에러/셀 네비게이션
│   │   │   ├── useEditorModals.ts      # 모달 상태 관리
│   │   │   ├── useLines.ts             # 라인 목록 조회
│   │   │   └── useProjects.ts, useColumns.ts, useAutoSave.ts ...
│   │   ├── pages/            # 페이지 컴포넌트 (DashboardPage, ProjectListPage, ConditionEditorPage)
│   │   ├── stores/           # Zustand 스토어
│   │   ├── types/            # TypeScript 타입 (도메인별 분리)
│   │   │   ├── user.ts, master.ts, column.ts
│   │   │   ├── project.ts, changelog.ts, editor.ts
│   │   │   ├── admin.ts, export.ts, dashboard.ts
│   │   │   └── index.ts     # Re-export 허브
│   │   └── lib/              # 유틸리티 (validation, diff)
│   ├── package.json
│   └── Dockerfile
├── nginx/                    # 리버스 프록시
├── docker-compose.yml
└── .claude/docs/             # 참고문서 (아래 참조)
```

## 참고문서 (`.claude/docs/`)

작업 시 반드시 아래 문서를 참고할 것:

| 문서 | 내용 | 참고 시점 |
|------|------|----------|
| `process-condition-manager-prd-v2.md` | **PRD v2** — 전체 요구사항, 워크플로우 5단계, 편집 UI 설계, 승인 프로세스, 전산 출력 포맷 | 기능 구현 시 최우선 참조 |
| `db-schema-design.md` | **DB 스키마** — 전체 테이블 설계, JSONB 구조, 인덱스 전략, 데이터 흐름 | 모델/API 작업 시 |
| `phase1-task-list.md` | **Phase 1 태스크** — Sprint 1~4 태스크, 의존관계, 완료 기준 (DoD) | Phase 1 작업 순서 결정 시 |
| `phase2-4-detailed-plan.md` | **Phase 2~4 상세 기획** — 각 Phase별 기능, API, UI 설계, 태스크 리스트 | Phase 2 이후 작업 시 |
| `revision-feature-design.md` | **개정(Revision) 기능** — 버전 관리, Archived 상태, 버전 히스토리 | Revision 기능 구현 시 |
| `pcm-wireframe.html` | **와이어프레임** — 프로젝트 목록, 생성 모달, 조건표 편집기 UI 상세 | 프론트엔드 UI 구현 시 |
| `photo_process_condition_sample.xlsx` | **샘플 데이터** — 원본 조건표, TypeA/B/C 출력 예시, Config, XML 매핑 | 시드 데이터·전산 출력 구현 시 |
| `pcm-api-spec.yaml` | API 스펙 (미작성) | - |

## 핵심 도메인 개념

- **공정조건표**: 행=레이어(30~60개), 열=파라미터(~300개). 4개 카테고리(SP/SC/OVL/DEV)로 그룹핑
- **Backbone**: 기존 양산 제품의 조건표. 신규 제품 생성 시 backbone을 복사하여 초안 생성
- **레이어별 backbone 교체**: 특정 레이어만 다른 제품의 조건으로 교체 가능
- **Recipe XML**: 설비에서 추출한 XML. 매핑 테이블 기반으로 조건표에 반영 (diff → 선택 적용)
- **전산 출력**: Approved 조건표를 사내 전산 시스템별 포맷(Type A/B/C)으로 변환·Excel 다운로드

## DB 핵심 테이블

- `products` / `layers` / `product_layers` — 마스터 데이터 (backbone 소스)
- `projects` / `project_layers` — 신규 조건표 작업 단위. conditions(JSONB), backbone_conditions(JSONB)
- `column_definitions` / `column_categories` / `column_validations` — 컬럼 메타데이터·검증 규칙
- `change_logs` — 셀 단위 변경 이력 (manual/backbone/recipe)
- `export_systems` / `export_column_mappings` — 전산 출력 설정 (source_type으로 내부/외부 구분)
- `export_data_sources` — 외부 데이터 소스 정의 (테이블명, JOIN 키, 컬럼 탐색)
- `export_histories` — 전산 출력 이력 (감사 추적)
- `recipe_xml_mappings` — XML XPath ↔ 조건표 컬럼 매핑

## 워크플로우 (상태 흐름)

```
Draft → Review → Approved → (Revision 생성 시) Archived
  ↑        ↓
  └── Rejected
```

- Review 전환: 검증 오류 0건 필수
- 승인/반려: 검토자 권한
- Approved → POST /revise → 새 Draft(v+1) 생성, 기존은 Archived

## 개발 단계

- **Phase 1 (MVP)**: 프로젝트 생성 + backbone 복사, AG Grid 편집 UI, 기본 검증, 저장
- **Phase 2**: 레이어별 backbone 교체, Recipe XML 반영, 관리자 설정, Revision 기능
- **Phase 3**: 승인 프로세스, 코멘트, 변경 이력, 전산 출력 (Type A/B/C)
- **Phase 4**: 인증/권한, Cross-layer 검증, 전산 출력 확장, 대시보드
- **Phase 5**: 동적 Backbone(SPEC-BACKBONE-001), Excel 붙여넣기(SPEC-PASTE-001 예정)

## 현재 진행 상태

- Phase 1 (MVP) 완료: 프로젝트 생성, backbone 복사, AG Grid 편집 UI, 검증, 벌크 저장
- Phase 2 완료: 레이어별 backbone 교체, Recipe XML 반영, 관리자 설정, Revision 기능
- SPEC-003 완료: 승인 워크플로우 (Review Request, Approve/Reject, 상태 전환)
- SPEC-004 완료: 변경 이력 패널 + 버전 히스토리
  - M1: 백엔드 API (changelog 필터, timeline, cell history, version history)
  - M2: 변경 이력 슬라이드아웃 패널 + 셀 히스토리 모달
  - M3: 버전 히스토리 드롭다운 + Read-Only 모드 (archived 버전 보기)
- SPEC-005 완료: 전산 출력 시스템 (Type A/B/C)
  - ExportService: Type A(수평), Type B(설비분할), Type C(키-값 전치) 3종 포맷
  - Export API: 시스템 목록 조회, 미리보기, 단건/벌크 다운로드 (Excel/ZIP)
  - Export UI: Approved 상태 시 ExportPanel (시스템 선택, 미리보기, 다운로드)
  - EquipmentAssignment 모델 + 마이그레이션 + 시드 데이터
- SPEC-AUTH-001 완료: JWT 인증/인가 시스템
  - M1: Backend Auth 모듈 (JWT access/refresh token, bcrypt 해싱, OAuth2 의존성)
  - M2: Frontend Auth UI (Zustand auth store, LoginPage, ProtectedRoute, Axios 인터셉터)
  - M3: RBAC 강화 (전체 엔드포인트 인증 적용, 역할 기반 접근 제어)
- 구조 개선 완료:
  - 라우터 분리: projects.py → project_lifecycle.py + project_conditions.py
  - 서비스 분리: project_service.py → project_service + project_status_service + project_analytics_service
  - Repository 패턴: CommentRepository, ChangeLogRepository (N+1 쿼리 최적화)
  - 상수 중앙화: constants.py (상태 전환, 규칙 타입, 카테고리 코드)
  - 프론트엔드 훅 추출: useEditorCellEdit, useEditorNavigation, useEditorModals
  - 타입 분할: types/index.ts → 7개 도메인 파일 + re-export hub
  - 시드 패키지화: seed.py → seed/ 패키지 (master, product, column, project, export 모듈)
  - Excel 빌더 분리: export_service.py → export_service(오케스트레이션) + export_builders(순수 함수)
  - 그리드 컴포넌트 분할: ConditionGrid(425→314줄) + buildColumnDefs + GridContextMenu
- SPEC-CROSS-001 완료: Cross-Layer 검증 엔진 (Phase 4)
  - M1: 백엔드 검증 엔진 (reference_exists, compare_layers, equipment_compatibility 3종)
  - M2: ValidationPanel 크로스 레이어 오류 구분 표시 + 필터 + 셀 하이라이팅
  - M3: Admin UI 동적 규칙 폼 (CrossLayerRuleForm)
  - Hotfix: step_seq 기반 참조 검증 수정, 에러 셀 포커싱 수정, Step Seq 고정 컬럼, Admin Cross-Layer 요약 컬럼
- SPEC-EXPORT-001 완료: 전산 출력 확장 (Phase 4)
  - M1: Export Admin UI (시스템 CRUD + 컬럼 매핑 관리)
  - M2: Equipment Assignment UI (레이어별 설비 할당 CRUD)
  - M3: Export Validation Report (다운로드 전 데이터 품질 검증)
  - M4: Export History Logging (출력 이력 자동 기록 + 조회)
  - ExportHistory 모델 + Alembic 마이그레이션, ExportAdminService, EquipmentService, ExportValidationService
  - 프론트엔드: ExportSystemsPage, ExportMappingManager, EquipmentPanel, ExportHistoryPanel, ExportValidationReport
  - Hotfix: OVL_REF_LAYER 필수 검증 해제, 설비 reorder 라우트 순서 수정, 관리자 UI 스크롤 수정, 더티셀 추적 기준값 수정
- SPEC-DASHBOARD-001 완료: 대시보드 (Phase 4)
  - Backend: DashboardRepository (4종 집계 쿼리) + DashboardService + Dashboard Router
  - Frontend: DashboardPage (상태 카드, 내 프로젝트, 검토 대기, 활동 타임라인)
  - 라우팅: `/` = DashboardPage, Header에 프로젝트 네비게이션 추가
- Phase 4 전체 완료: 인증/권한, Cross-layer 검증, 전산 출력 확장, 대시보드
- Line Filter 완료: 라인별 프로젝트/대시보드 필터링
  - Backend: ProjectResponse에 line_id/line_name 추가, 프로젝트 목록·대시보드 4종 쿼리에 line_id 필터
  - Frontend: useLines 훅 + fetchLines API, ProjectListPage/DashboardPage 라인 드롭다운
  - ProjectCreateModal: 라인 필수 선택 → 제품/Backbone 목록 연동 필터
  - ProjectListPage: URL 쿼리 양방향 동기화 (`?status=X&line_id=Y`, useSearchParams 기반)
  - DashboardPage → ProjectListPage 간 라인 필터 전달
- SPEC-ADMIN-001 완료: Admin Enhancement (관리자 섹션 확장)
  - M1: User CRUD + Enum(select_options) 관리
    - Backend: admin_user_service (list/create/update/deactivate/reset_password), admin_users router (5 endpoints)
    - Backend: admin_service에 select_options 조회/수정 추가 (2 endpoints)
    - Frontend: UserManagementPage (테이블 + CRUD + 역할 배지 + 비활성화), UserFormModal, PasswordResetModal
    - Frontend: EnumManagementPage (select 컬럼 목록 + 옵션 편집), SelectOptionsEditModal
  - M2: Master Data (Line/Product/Layer/Column/Category) 관리
    - Backend: admin_master_service (CRUD + FK 보호 삭제 + reorder), admin_master router (17 endpoints)
    - Frontend: MasterDataPage (내부 서브탭 5종), Line/Product/Layer/Column/Category 관리 패널
    - Public 쿼리 키 무효화: Admin 변경 시 일반 사용자 드롭다운도 즉시 갱신
  - M3: Audit Log 조회 + Category 관리
    - Backend: admin_service에 audit_logs 조회 추가 (JOIN 5 tables, 필터 + 페이지네이션)
    - Frontend: AuditLogPage (필터 바 + 페이지네이션 테이블), CategoryManagementPanel
  - Admin 탭 순서: 사용자 관리 | 마스터 데이터 | 선택 옵션 | XML 매핑 | 검증 규칙 | 전산 출력 | 외부 데이터 | 변경 이력
  - Default: `/admin/users`
- SPEC-006 완료: 버전 히스토리 개선 + Change Log 정확성
  - M1: values_differ() 통합 (utils/comparison.py), 숫자 타입 정규화, false-positive 정리 마이그레이션
  - M2: revision_reason 컬럼 추가, 개정 생성 시 사유 저장/표시
  - M3: 버전 간 JSONB diff API (diff_service.py) + VersionDiffView 프론트엔드
- SPEC-EXPORT-002 완료: Export Data Pipeline (외부 데이터 소스 연동)
  - M1: ExportDataSource 모델 + CRUD API + Admin UI (ExportDataSourcesPage)
  - M2: export_column_mappings에 source_type/data_source_id/source_column_name 추가 (마이그레이션)
  - M3: ExportBuilders에서 source_type='external' 경로 처리, 외부 테이블 JOIN 출력
- SPEC-BACKBONE-001 완료: 동적 Backbone 자격 판정 (Phase 5)
  - M1: BackboneRepository (Approved 프로젝트 기반 동적 판정, Partial Index)
  - M1: 조건 복사 소스 변경 (product_layers → Approved project_layers)
  - M1: 신규 API 2개 (GET /backbones, GET /backbone-layers)
  - M2: Frontend Backbone 드롭다운 동적 목록 + 버전 정보 표시
  - M2: BackboneReplaceModal 레이어 소스를 Approved project_layers로 변경
  - M3: is_backbone 플래그 전 계층 제거 (DB 컬럼, 스키마, 서비스, UI, 시드, 테스트)

## 개발 명령어

```bash
# 전체 서비스 실행
docker-compose up -d

# 백엔드만 실행 (hot reload)
docker-compose up backend

# Alembic 마이그레이션 생성
docker-compose exec backend alembic revision --autogenerate -m "description"

# Alembic 마이그레이션 적용
docker-compose exec backend alembic upgrade head

# 프론트엔드 개발 서버
cd frontend && npm run dev
```

## 아키텍처 결정 사항

### 시드 데이터
- 사내 데이터 기반으로 **현실적인 더미 데이터를 생성**하여 시드로 사용
- 샘플 Excel(67컬럼)을 참고하되, 실제 데이터는 사용자가 추후 조정
- 제품/레이어 마스터 데이터는 Phase 1에서는 **시드 스크립트로만** 투입

### 저장 전략: 혼합 (임시저장 + 명시적 저장)
- **프론트엔드**: 셀 편집 시 dirty cell을 메모리(Zustand)에 누적, 셀별 실시간 검증 + 색상 표시
- **임시저장**: 일정 간격(예: 30초)으로 자동 임시저장 → 브라우저 닫힘 등 데이터 유실 방지
- **명시적 저장**: 저장 버튼 클릭 시 벌크 PUT으로 전체 변경사항 서버 반영 + change_log 기록
- **단일 셀 PATCH API는 Phase 1에서 불필요** — 자동저장 도입 시 추후 검토

### 상태 관리: Zustand
- AG Grid 데이터, dirty cells, 검증 오류 등을 Zustand store로 관리
- Redux 대비 보일러플레이트 적고, 카테고리 탭별 분할 로딩에 적합

### 인증: JWT 기반 (SPEC-AUTH-001 완료)
- JWT access token (15분) + refresh token (7일, HTTP-only cookie) 기반 인증
- bcrypt 패스워드 해싱, FastAPI OAuth2PasswordBearer 의존성
- RBAC: admin(전체), reviewer(승인/반려), editor(본인 프로젝트)
- 프론트엔드: Zustand auth store, Bearer 토큰 자동 첨부, 401 자동 갱신

### 테스트 전략
- **Backend**: pytest — 핵심 비즈니스 로직(backbone 복사, 검증, 벌크 저장)에 집중
- **Frontend**: Vitest — 핵심 유틸 함수(diff 계산, 검증 로직)에 집중
- 전체 커버리지보다 **핵심 로직의 정확성 보장** 우선

## 코딩 컨벤션

- Backend: Python 타입 힌트 필수, Pydantic 스키마로 요청/응답 정의, 비동기(async/await) 사용
- Frontend: TypeScript strict mode, 컴포넌트 파일명 PascalCase, AG Grid Community Edition 사용
- API 경로: `/api/` 접두사, RESTful 컨벤션
- DB: JSONB로 조건 데이터 저장, EAV로 변경 이력 추적
