# PCM 프로젝트 구조

## 전체 디렉토리 트리

```
process-condition-manager/
├── backend/                    # FastAPI 백엔드 애플리케이션
│   ├── app/                    # 메인 애플리케이션 코드
│   │   ├── main.py             # FastAPI 진입점, CORS 설정, 라우터 등록
│   │   ├── config.py           # 환경 변수 및 설정 (DATABASE_URL, SECRET_KEY, CORS_ORIGINS)
│   │   ├── database.py         # 비동기 DB 세션, 엔진, Base 클래스
│   │   │
│   │   ├── models/             # SQLAlchemy ORM 모델 (8개 파일)
│   │   │   ├── __init__.py     # 모델 통합 import
│   │   │   ├── user.py         # User 모델 (사용자 정보)
│   │   │   ├── product.py      # Product, Layer, ProductLayer 모델 (마스터 데이터)
│   │   │   ├── project.py      # Project, ProjectLayer, ReviewComment 모델 (작업 단위)
│   │   │   ├── column.py       # ColumnDefinition, ColumnCategory, ColumnValidation
│   │   │   ├── change_log.py   # ChangeLog 모델 (변경 이력 추적)
│   │   │   ├── export.py       # ExportSystem, ExportColumnMapping (전산 출력)
│   │   │   └── line.py         # Line 모델 (생산 라인)
│   │   │
│   │   ├── routers/            # API 엔드포인트 (8개 파일)
│   │   │   ├── __init__.py     # 라우터 통합 export
│   │   │   ├── users.py        # 사용자 CRUD API
│   │   │   ├── lines.py        # 생산 라인 조회 API
│   │   │   ├── columns.py      # 컬럼 정의 및 검증 규칙 조회 API
│   │   │   ├── products.py     # 제품 및 레이어 조회 API
│   │   │   ├── projects.py     # 프로젝트 CRUD, 검증, Revision, Recipe, Backbone 교체, 승인/반려
│   │   │   ├── comments.py     # 댓글 CRUD, 해결 상태 관리 API
│   │   │   └── admin.py        # 관리자 API (XML 매핑, 검증 규칙 CRUD)
│   │   │
│   │   ├── services/           # 비즈니스 로직 (9개 파일)
│   │   │   ├── __init__.py     # 서비스 통합 export
│   │   │   ├── project_service.py    # 프로젝트 CRUD, 상태 전환, 승인/반려 서비스
│   │   │   ├── backbone_service.py   # Backbone 복사 및 레이어별 교체 로직
│   │   │   ├── recipe_service.py     # Recipe XML 파싱 및 Diff 생성
│   │   │   ├── validation_service.py # 검증 규칙 실행 및 조건부 검증
│   │   │   ├── condition_service.py  # 조건 데이터 CRUD 및 벌크 저장
│   │   │   ├── change_log_service.py # 변경 이력 생성 및 조회
│   │   │   ├── comment_service.py    # 댓글 CRUD, 해결 상태, 미해결 건수 조회
│   │   │   └── admin_service.py      # 관리 기능 (XML 매핑, 검증 규칙 관리)
│   │   │
│   │   ├── schemas/            # Pydantic 스키마 (10개 파일)
│   │   │   ├── __init__.py     # 스키마 통합 export
│   │   │   ├── user.py         # UserCreate, UserResponse, UserUpdate
│   │   │   ├── product.py      # ProductResponse, LayerResponse
│   │   │   ├── project.py      # ProjectCreate, ProjectResponse, ProjectUpdate, 상태 전환
│   │   │   ├── column.py       # ColumnDefinitionResponse, ValidationRuleResponse
│   │   │   ├── backbone.py     # BackboneReplaceRequest, BackboneReplaceResponse
│   │   │   ├── recipe.py       # RecipeUploadRequest, RecipeDiffResponse
│   │   │   ├── comment.py      # CommentCreate, CommentResponse, CommentListResponse
│   │   │   ├── line.py         # LineResponse
│   │   │   └── admin.py        # XmlMappingRequest, ValidationRuleRequest
│   │   │
│   │   └── utils/              # 유틸리티 함수
│   │       └── helpers.py      # 공통 헬퍼 함수
│   │
│   ├── tests/                  # pytest 테스트 (12개 파일)
│   │   ├── __init__.py
│   │   ├── conftest.py         # 공통 fixture 및 테스트 설정
│   │   ├── test_project_service.py   # 프로젝트 서비스 테스트
│   │   ├── test_backbone_service.py  # Backbone 복사/교체 테스트
│   │   ├── test_recipe_service.py    # Recipe XML 처리 테스트
│   │   ├── test_validation_service.py # 검증 로직 테스트
│   │   ├── test_condition_service.py # 조건 데이터 저장 테스트
│   │   ├── test_change_log_service.py # 변경 이력 테스트
│   │   ├── test_admin_service.py     # 관리 기능 테스트
│   │   ├── test_revision.py          # Revision 기능 테스트
│   │   ├── test_approval_workflow.py # 승인/반려 워크플로우 테스트
│   │   └── test_comment_service.py   # 댓글 서비스 테스트
│   │
│   ├── alembic/                # 데이터베이스 마이그레이션
│   │   ├── versions/           # 마이그레이션 버전 파일 (4개)
│   │   │   ├── 001_initial_schema.py
│   │   │   ├── 002_add_lines_and_product_fields.py
│   │   │   ├── 003_add_revision_fields.py
│   │   │   └── 004_add_review_comment_columns.py
│   │   ├── env.py              # Alembic 환경 설정
│   │   └── script.py.mako      # 마이그레이션 템플릿
│   │
│   ├── requirements.txt        # Python 의존성 목록
│   └── Dockerfile              # 백엔드 Docker 이미지 정의
│
├── frontend/                   # React + Vite 프론트엔드 애플리케이션
│   ├── src/
│   │   ├── main.tsx            # React 진입점, QueryClient 초기화
│   │   ├── App.tsx             # 라우터 정의 (/, /projects, /projects/:id/edit, /admin)
│   │   ├── index.css           # 전역 스타일 (Tailwind CSS + AG Grid 커스텀)
│   │   │
│   │   ├── pages/              # 페이지 컴포넌트
│   │   │   ├── HomePage.tsx    # 홈페이지
│   │   │   ├── ProjectListPage.tsx  # 프로젝트 목록 페이지
│   │   │   └── ConditionEditorPage.tsx  # 조건표 편집 페이지 (승인/코멘트 통합)
│   │   │
│   │   ├── components/         # 재사용 가능한 컴포넌트
│   │   │   ├── editor/         # 조건표 편집기 관련 컴포넌트 (18개 파일)
│   │   │   │   ├── ConditionGrid.tsx       # AG Grid 메인 컴포넌트 (댓글 마커, 컨텍스트 메뉴)
│   │   │   │   ├── CategoryTabs.tsx        # SP/SC/OVL/DEV 탭
│   │   │   │   ├── EditorHeader.tsx        # 편집기 헤더 (프로젝트 정보, 저장 버튼)
│   │   │   │   ├── ValidationPanel.tsx     # 검증 오류 패널
│   │   │   │   ├── ChangeHistoryPanel.tsx  # 변경 이력 패널
│   │   │   │   ├── LayerNavPanel.tsx       # 레이어 네비게이션 패널
│   │   │   │   ├── BackboneReplaceModal.tsx  # Backbone 교체 모달
│   │   │   │   ├── RecipeUploadModal.tsx   # Recipe XML 업로드 모달
│   │   │   │   ├── RecipeDiffTable.tsx     # Recipe Diff 테이블 뷰어
│   │   │   │   ├── LayerAddModal.tsx       # 레이어 추가 모달
│   │   │   │   ├── RevisionCreateModal.tsx # 개정 생성 다이얼로그
│   │   │   │   ├── StatusBanner.tsx        # 프로젝트 상태 배너 (Draft/Review/Approved)
│   │   │   │   ├── StatusTimeline.tsx      # 상태 변경 타임라인 표시
│   │   │   │   ├── ReviewRequestModal.tsx  # 검토 요청 모달 (Draft→Review 전환)
│   │   │   │   ├── ApprovalButtons.tsx     # 승인/반려 버튼 컴포넌트
│   │   │   │   ├── CommentPanel.tsx        # 댓글 목록 패널 (필터링, 네비게이션)
│   │   │   │   ├── CommentThread.tsx       # 개별 댓글 스레드 (해결 상태 토글)
│   │   │   │   └── CommentDialog.tsx       # 셀 댓글 작성 다이얼로그 (컨텍스트 메뉴)
│   │   │   │
│   │   │   ├── layout/         # 레이아웃 컴포넌트
│   │   │   │   ├── Header.tsx              # 헤더 (사용자 선택, 네비게이션)
│   │   │   │   └── Layout.tsx              # 전체 레이아웃 래퍼
│   │   │   │
│   │   │   ├── admin/          # 관리자 페이지 컴포넌트 (5개 파일)
│   │   │   │   ├── AdminLayout.tsx         # 관리자 레이아웃
│   │   │   │   ├── XmlMappingsPage.tsx     # XML 매핑 관리 페이지
│   │   │   │   ├── ValidationRulesPage.tsx # 검증 규칙 관리 페이지
│   │   │   │   ├── MappingFormModal.tsx    # XML 매핑 폼 모달
│   │   │   │   └── ValidationEditModal.tsx # 검증 규칙 편집 모달
│   │   │   │
│   │   │   ├── projects/       # 프로젝트 관련 컴포넌트
│   │   │   │   ├── ProjectCreateModal.tsx  # 프로젝트 생성 모달
│   │   │   │   ├── ProjectCard.tsx         # 프로젝트 카드
│   │   │   │   └── StatusBadge.tsx         # 상태 배지
│   │   │   │
│   │   │   └── ui/             # 범용 UI 컴포넌트 (6개 파일)
│   │   │       ├── button.tsx
│   │   │       ├── input.tsx
│   │   │       ├── select.tsx
│   │   │       ├── dialog.tsx
│   │   │       ├── toast.tsx
│   │   │       └── badge.tsx
│   │   │
│   │   ├── hooks/              # 커스텀 훅 (8개 파일)
│   │   │   ├── useProjects.ts          # 프로젝트 목록 조회
│   │   │   ├── useProducts.ts          # 제품/레이어 조회
│   │   │   ├── useColumns.ts           # 컬럼 정의 조회
│   │   │   ├── useUsers.ts             # 사용자 목록 조회
│   │   │   ├── useAutoSave.ts          # 자동 저장
│   │   │   ├── useAdminMappings.ts     # XML 매핑 관리 훅
│   │   │   ├── useAdminValidations.ts  # 검증 규칙 관리 훅
│   │   │   └── useComments.ts          # 댓글 조회/생성/해결 훅
│   │   │
│   │   ├── api/                # API 클라이언트 모듈 (7개 파일)
│   │   │   ├── client.ts               # Axios 인스턴스 (/api 기본경로)
│   │   │   ├── projects.ts             # 프로젝트 API 호출 (상태 전환, 승인/반려 포함)
│   │   │   ├── products.ts             # 제품/레이어 API 호출
│   │   │   ├── columns.ts              # 컬럼 정의 API 호출
│   │   │   ├── users.ts                # 사용자 API 호출
│   │   │   ├── comments.ts             # 댓글 CRUD API 호출
│   │   │   └── admin.ts                # 관리 API 호출
│   │   │
│   │   ├── stores/             # Zustand 상태 관리 (3개 파일)
│   │   │   ├── useEditorStore.ts       # 편집기 상태 (dirty cells, 검증 오류, recipe cells)
│   │   │   ├── useToastStore.ts        # Toast 메시지 상태
│   │   │   └── useUserStore.ts         # 현재 사용자 상태
│   │   │
│   │   ├── lib/                # 라이브러리 및 유틸리티
│   │   │   ├── validation.ts           # 클라이언트 검증 로직
│   │   │   ├── diff.ts                 # Recipe Diff 계산
│   │   │   └── utils.ts                # 공통 유틸 함수
│   │   │
│   │   └── types/              # TypeScript 타입 정의
│   │       └── index.ts                # 통합 타입 정의 (프로젝트, 제품, 컬럼, 댓글 등)
│   │
│   ├── src/stores/__tests__/   # Store 테스트
│   │   ├── useUserStore.test.ts
│   │   └── useEditorStore.test.ts
│   │
│   ├── src/lib/__tests__/      # 유틸리티 테스트
│   │   ├── validation.test.ts
│   │   └── diff.test.ts
│   │
│   ├── package.json            # npm 의존성 및 스크립트
│   ├── vite.config.ts          # Vite 빌드 설정
│   ├── tsconfig.json           # TypeScript 컴파일 설정
│   ├── tailwind.config.js      # Tailwind CSS 설정
│   └── Dockerfile              # 프론트엔드 Docker 이미지 정의
│
├── nginx/                      # Nginx 리버스 프록시
│   ├── nginx.conf              # Nginx 설정 파일
│   └── Dockerfile              # Nginx Docker 이미지
│
├── .claude/                    # Claude Code 설정 및 문서
│   ├── docs/                   # 참고 문서
│   │   ├── process-condition-manager-prd-v2.md  # PRD 전체 요구사항
│   │   ├── db-schema-design.md                  # DB 스키마 설계
│   │   ├── phase1-task-list.md                  # Phase 1 태스크 목록
│   │   ├── phase2-4-detailed-plan.md            # Phase 2~4 상세 기획
│   │   ├── revision-feature-design.md           # Revision 기능 설계
│   │   ├── pcm-wireframe.html                   # UI 와이어프레임
│   │   ├── photo_process_condition_sample.xlsx  # 샘플 데이터
│   │   └── pcm-api-spec.yaml                    # API 스펙 (미작성)
│   │
│   ├── agents/                 # MoAI 커스텀 에이전트
│   ├── hooks/                  # Claude Code 훅
│   ├── output-styles/          # 출력 스타일 정의
│   ├── rules/                  # 프로젝트 규칙
│   ├── settings.json           # Claude Code 설정
│   └── skills/                 # MoAI 스킬
│
├── .moai/                      # MoAI-ADK 프로젝트 관리
│   ├── config/                 # MoAI 설정
│   ├── docs/                   # 생성된 문서
│   ├── project/                # 프로젝트 메타데이터
│   └── specs/                  # SPEC 문서
│
├── docker-compose.yml          # Docker Compose 오케스트레이션
├── CLAUDE.md                   # Claude Code 작업 가이드
├── README.md                   # 프로젝트 README
└── .gitignore                  # Git 제외 파일 목록
```

---

## 주요 디렉토리 용도

### backend/ - FastAPI 백엔드

**app/**: 메인 애플리케이션 코드가 위치하는 디렉토리입니다.

**app/main.py**: FastAPI 애플리케이션 진입점으로, CORS 설정, 라우터 등록, 헬스 체크 엔드포인트를 포함합니다.

**app/config.py**: 환경 변수 기반 설정을 관리합니다. DATABASE_URL, SECRET_KEY, CORS_ORIGINS 등의 핵심 설정을 포함합니다.

**app/database.py**: SQLAlchemy 비동기 세션, 엔진, Base 클래스를 정의하여 데이터베이스 연결을 관리합니다.

**app/models/**: SQLAlchemy ORM 모델을 정의합니다. 8개 파일로 구성되어 각각 도메인별 테이블을 정의합니다. project.py에는 ReviewComment 모델이 포함되어 승인/반려 시 댓글을 관리합니다.

**app/routers/**: API 엔드포인트를 정의합니다. FastAPI의 APIRouter를 사용하여 RESTful API를 구현합니다. comments.py는 댓글 CRUD 및 해결 상태 관리를 담당합니다.

**app/services/**: 비즈니스 로직을 구현합니다. 라우터와 모델 사이의 중간 계층으로 복잡한 비즈니스 규칙을 처리합니다. comment_service.py는 댓글 생성, 조회, 해결 상태 토글, 미해결 건수 조회를 담당합니다.

**app/schemas/**: Pydantic 스키마를 정의하여 요청/응답 데이터의 타입 검증 및 직렬화를 담당합니다.

**tests/**: pytest 기반 백엔드 테스트 코드입니다. 서비스 계층의 핵심 로직을 테스트합니다. 총 140건의 테스트 케이스가 포함되어 있습니다.

**alembic/**: 데이터베이스 마이그레이션을 관리합니다. 스키마 변경 이력을 버전별로 추적합니다. 004번 마이그레이션에서 승인/댓글 관련 컬럼이 추가되었습니다.

---

### frontend/ - React 프론트엔드

**src/main.tsx**: React 애플리케이션 진입점으로, React Query의 QueryClient를 초기화합니다.

**src/App.tsx**: React Router를 사용하여 라우팅을 정의합니다. 홈, 프로젝트 목록, 조건표 편집, 관리자 페이지로 구성됩니다.

**src/pages/**: 페이지 수준 컴포넌트를 포함합니다. 각 라우트에 대응하는 최상위 컴포넌트입니다.

**src/components/editor/**: 조건표 편집기 관련 컴포넌트 18개로 구성됩니다. AG Grid, 카테고리 탭, 검증 패널, Recipe 업로드, 승인 워크플로우(StatusBanner, ApprovalButtons, ReviewRequestModal), 댓글 시스템(CommentPanel, CommentThread, CommentDialog) 등을 포함합니다.

**src/components/layout/**: 전체 레이아웃 컴포넌트입니다. Header와 Layout 래퍼를 제공합니다.

**src/components/projects/**: 프로젝트 관련 컴포넌트입니다. 프로젝트 생성 모달, 카드, 상태 배지 등을 포함합니다.

**src/components/ui/**: 재사용 가능한 범용 UI 컴포넌트 6개입니다. button, input, select, dialog, toast, badge 등을 포함합니다.

**src/hooks/**: React Query 기반 커스텀 훅 8개입니다. 데이터 페칭, 자동 저장, 댓글 관리 등의 로직을 캡슐화합니다.

**src/api/**: Axios 기반 API 클라이언트 모듈입니다. 백엔드 API 호출을 추상화합니다. comments.ts는 댓글 API를 담당합니다.

**src/stores/**: Zustand 기반 전역 상태 관리입니다. 편집기 상태, Toast, 사용자 정보를 관리합니다.

**src/lib/**: 유틸리티 라이브러리입니다. 검증 로직, Diff 계산, 공통 함수를 포함합니다.

**src/types/**: TypeScript 타입 정의입니다. API 응답, 도메인 모델, 댓글 타입을 index.ts에 통합 정의합니다.

**src/*/__tests__/**: Vitest 기반 프론트엔드 테스트 코드입니다. Store와 유틸리티 함수를 테스트합니다. 총 71건의 테스트 케이스가 포함되어 있습니다.

---

### nginx/ - 리버스 프록시

**nginx.conf**: Nginx 설정 파일로, 프론트엔드(/)와 백엔드(/api) 라우팅을 담당합니다.

---

### .claude/ - Claude Code 설정

**.claude/docs/**: 프로젝트 참고 문서를 포함합니다. PRD, DB 스키마, 태스크 목록, 와이어프레임, 샘플 데이터 등이 있습니다.

**.claude/agents/**: MoAI 커스텀 에이전트 정의 파일들입니다.

**.claude/skills/**: MoAI 스킬 정의 파일들입니다.

**.claude/hooks/**: Claude Code 이벤트 훅 스크립트입니다.

**.claude/settings.json**: Claude Code 프로젝트 설정 파일입니다.

---

### .moai/ - MoAI-ADK 관리

**.moai/config/**: MoAI 프레임워크 설정 파일들입니다.

**.moai/docs/**: 자동 생성된 문서들이 저장됩니다.

**.moai/project/**: 프로젝트 메타데이터 (product.md, structure.md, tech.md)가 저장됩니다.

**.moai/specs/**: SPEC 문서들이 저장됩니다.

---

## 핵심 파일 위치

### Backend 핵심 파일

**진입점 및 설정**:
- /home/appuser/process-condition-manager/backend/app/main.py
- /home/appuser/process-condition-manager/backend/app/config.py
- /home/appuser/process-condition-manager/backend/app/database.py

**비즈니스 로직**:
- /home/appuser/process-condition-manager/backend/app/services/project_service.py
- /home/appuser/process-condition-manager/backend/app/services/backbone_service.py
- /home/appuser/process-condition-manager/backend/app/services/recipe_service.py
- /home/appuser/process-condition-manager/backend/app/services/validation_service.py
- /home/appuser/process-condition-manager/backend/app/services/comment_service.py
- /home/appuser/process-condition-manager/backend/app/services/admin_service.py

**API 엔드포인트**:
- /home/appuser/process-condition-manager/backend/app/routers/projects.py
- /home/appuser/process-condition-manager/backend/app/routers/comments.py
- /home/appuser/process-condition-manager/backend/app/routers/products.py
- /home/appuser/process-condition-manager/backend/app/routers/columns.py
- /home/appuser/process-condition-manager/backend/app/routers/admin.py

**데이터베이스**:
- /home/appuser/process-condition-manager/backend/app/models/project.py
- /home/appuser/process-condition-manager/backend/app/models/product.py
- /home/appuser/process-condition-manager/backend/alembic/versions/

---

### Frontend 핵심 파일

**진입점**:
- /home/appuser/process-condition-manager/frontend/src/main.tsx
- /home/appuser/process-condition-manager/frontend/src/App.tsx

**편집기 UI**:
- /home/appuser/process-condition-manager/frontend/src/pages/ConditionEditorPage.tsx
- /home/appuser/process-condition-manager/frontend/src/components/editor/ConditionGrid.tsx
- /home/appuser/process-condition-manager/frontend/src/components/editor/CategoryTabs.tsx
- /home/appuser/process-condition-manager/frontend/src/components/editor/EditorHeader.tsx

**승인 워크플로우**:
- /home/appuser/process-condition-manager/frontend/src/components/editor/StatusBanner.tsx
- /home/appuser/process-condition-manager/frontend/src/components/editor/ReviewRequestModal.tsx
- /home/appuser/process-condition-manager/frontend/src/components/editor/ApprovalButtons.tsx
- /home/appuser/process-condition-manager/frontend/src/components/editor/StatusTimeline.tsx

**댓글 시스템**:
- /home/appuser/process-condition-manager/frontend/src/components/editor/CommentPanel.tsx
- /home/appuser/process-condition-manager/frontend/src/components/editor/CommentThread.tsx
- /home/appuser/process-condition-manager/frontend/src/components/editor/CommentDialog.tsx
- /home/appuser/process-condition-manager/frontend/src/api/comments.ts
- /home/appuser/process-condition-manager/frontend/src/hooks/useComments.ts

**상태 관리**:
- /home/appuser/process-condition-manager/frontend/src/stores/useEditorStore.ts
- /home/appuser/process-condition-manager/frontend/src/hooks/useAutoSave.ts
- /home/appuser/process-condition-manager/frontend/src/hooks/useAdminMappings.ts
- /home/appuser/process-condition-manager/frontend/src/hooks/useAdminValidations.ts

**API 통신**:
- /home/appuser/process-condition-manager/frontend/src/api/client.ts
- /home/appuser/process-condition-manager/frontend/src/api/projects.ts
- /home/appuser/process-condition-manager/frontend/src/api/comments.ts
- /home/appuser/process-condition-manager/frontend/src/api/admin.ts

---

## 모듈 구성

### Backend 모듈 구성

**Router Layer**: HTTP 요청을 받아 파라미터 검증 후 Service 계층으로 위임합니다.

**Service Layer**: 비즈니스 로직을 실행하고 Model 계층과 상호작용합니다.

**Model Layer**: 데이터베이스 테이블과 매핑되는 ORM 모델을 정의합니다.

**Schema Layer**: API 요청/응답 데이터 구조를 Pydantic으로 정의하여 타입 안전성을 보장합니다.

이 구조는 Clean Architecture의 원칙을 따르며, 각 계층이 명확한 책임을 가집니다.

---

### Frontend 모듈 구성

**Pages Layer**: 라우트별 페이지 컴포넌트로, 전체 페이지 레이아웃과 로직을 담당합니다.

**Components Layer**: 재사용 가능한 UI 컴포넌트로, editor, layout, projects, admin, ui로 구분됩니다.

**Hooks Layer**: React Query와 커스텀 로직을 캡슐화한 훅으로, 컴포넌트에서 재사용됩니다.

**API Layer**: Axios 기반 HTTP 클라이언트로, 백엔드 API 호출을 추상화합니다.

**Stores Layer**: Zustand 기반 전역 상태 관리로, 여러 컴포넌트 간 상태를 공유합니다.

**Lib Layer**: 순수 함수 유틸리티로, 검증, Diff 계산 등의 로직을 포함합니다.

---

## 데이터 흐름

### 조건표 편집 흐름

1. ConditionEditorPage에서 useProjectDetail 훅으로 프로젝트 데이터 로드
2. ConditionGrid에서 AG Grid로 데이터 렌더링
3. 셀 편집 시 editorStore에 dirty cell 추가
4. 실시간 검증 실행 후 결과를 editorStore에 저장
5. ValidationPanel에서 검증 오류 표시
6. useAutoSave 훅으로 30초마다 자동 저장
7. 저장 버튼 클릭 시 벌크 PUT API 호출
8. 백엔드에서 변경사항 저장 및 change_logs 기록

---

### Backbone 교체 흐름

1. BackboneReplaceModal에서 소스 제품 및 레이어 선택
2. POST /api/projects/:id/backbone/replace API 호출
3. 백엔드 backbone_service.py에서 레이어별 조건 교체
4. change_logs에 교체 이력 기록 (source=backbone)
5. 프론트엔드에서 최신 데이터 리로드
6. 편집기 UI 업데이트 및 검증 재실행

---

### Recipe XML 반영 흐름

1. RecipeUploadModal에서 XML 파일 업로드
2. POST /api/projects/:id/recipe/upload API 호출
3. 백엔드 recipe_service.py에서 XML 파싱 및 매핑
4. Diff 생성 후 프론트엔드로 반환
5. RecipeDiffTable에서 Diff 결과 표시
6. 사용자가 적용할 항목 선택
7. POST /api/projects/:id/recipe/apply API 호출
8. 백엔드에서 선택 항목 반영 및 change_logs 기록 (source=recipe)
9. 프론트엔드 데이터 리로드 및 UI 업데이트

---

### 승인 워크플로우 흐름

1. 편집자가 조건표 작성 완료 후 검증 오류 0건 확인
2. ReviewRequestModal에서 검토 요청 (Draft → Review)
3. StatusBanner에 Review 상태 표시, 편집 비활성화
4. 검토자가 셀 우클릭으로 CommentDialog를 통해 반려 사유 댓글 작성
5. ConditionGrid에서 댓글/반려 사유 있는 셀에 빨간 삼각형 마커 표시
6. CommentPanel에서 전체 댓글 목록 확인 및 필터링 (미해결/전체)
7. ApprovalButtons로 승인 또는 반려 결정
8. 승인 시 Approved, 반려 시 Draft로 복귀

---

## 개발 및 빌드

### 개발 환경 실행

Docker Compose로 전체 서비스 실행:
```bash
docker-compose up -d
```

백엔드만 hot reload로 실행:
```bash
docker-compose up backend
```

프론트엔드 개발 서버:
```bash
cd frontend
npm run dev
```

### 빌드 및 배포

프론트엔드 빌드:
```bash
cd frontend
npm run build
```

전체 Docker 이미지 빌드:
```bash
docker-compose build
```

---

## 의존성 관리

### Backend 의존성
- requirements.txt에 정의
- 주요 패키지: fastapi, sqlalchemy, alembic, pydantic, pytest, openpyxl, lxml

### Frontend 의존성
- package.json에 정의
- 주요 패키지: react, vite, ag-grid-community, tanstack-query, zustand, axios, tailwindcss

---

생성일: 2026-02-16
문서 버전: 1.2.0 (SPEC-003 승인 프로세스 및 코멘트 시스템 반영)
작성자: MoAI-ADK Documentation Generator
마지막 업데이트: 2026-02-17 (SPEC-003 M1-M3: 승인 워크플로우, 댓글 시스템, AG Grid 통합)
