# 시스템 아키텍처 개요

PCM의 전체 시스템 구조, 데이터 흐름, 기술 스택, 그리고 핵심 개념을 한눈에 파악할 수 있도록 설명합니다.

## 전체 시스템 구조

### 브라우저에서 데이터베이스까지의 흐름

```
┌─────────────────────────────────────────────────────────────────┐
│  사용자 브라우저 (http://localhost)                              │
│  - React 애플리케이션 (Vite + TypeScript)                        │
│  - AG Grid를 이용한 대용량 데이터 조건표 편집                    │
│  - Zustand로 상태 관리                                           │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                      API HTTP 요청/응답
                      (JSON 형식)
                               │
        ┌──────────────────────┴──────────────────────┐
        │                                              │
┌───────▼────────────────────┐         ┌──────────────▼────────┐
│  Nginx (포트 80)           │         │  Nginx (포트 80)      │
│  - 리버스 프록시           │         │  - 정적 파일 제공     │
│  - 요청 라우팅             │         │  - 캐싱               │
└───────┬────────────────────┘         └──────────────┬────────┘
        │                                              │
        │ /api/* 요청                         기타 요청 (JS, CSS)
        │                                              │
┌───────▼────────────────────────────────────────────┴──────────┐
│  FastAPI 백엔드 (포트 8000)                                    │
│  - Python 3.12 + AsyncIO                                      │
│  - 비동기 요청 처리                                            │
│  - JWT 인증/인가                                              │
│  - 비즈니스 로직 처리                                          │
│  - 검증 로직                                                   │
└───────┬──────────────────────────────────────────────────────┘
        │
        │ SQLAlchemy ORM
        │ (비동기 쿼리)
        │
┌───────▼──────────────────────────────────────────────────────┐
│  PostgreSQL 16 데이터베이스 (포트 5432)                       │
│  - 관계형 데이터 저장                                         │
│  - JSONB로 조건 데이터 저장 (유연성)                          │
│  - 인덱싱 (빠른 조회)                                        │
│  - 트랜잭션 지원                                              │
└────────────────────────────────────────────────────────────────┘
```

## 프로젝트 폴더 구조

### 전체 구조

```
process-condition-manager/
│
├── 설정 및 문서
│   ├── CLAUDE.md              # 프로젝트 개발 가이드
│   ├── README.md              # 프로젝트 소개
│   ├── docker-compose.yml     # Docker 설정
│   ├── .env.example           # 환경 변수 템플릿
│   └── .gitignore             # Git 무시 파일
│
├── backend/                   # FastAPI 백엔드
│   ├── app/
│   │   ├── main.py            # FastAPI 앱 진입점
│   │   ├── config.py          # 설정 (DB 연결, 환경변수)
│   │   ├── constants.py       # 도메인 상수 (상태, 규칙 타입 등)
│   │   ├── database.py        # 데이터베이스 세션 관리
│   │   ├── models/            # SQLAlchemy ORM 모델 (아래 설명)
│   │   ├── routers/           # API 엔드포인트 (아래 설명)
│   │   ├── services/          # 비즈니스 로직 (아래 설명)
│   │   ├── schemas/           # Pydantic 요청/응답 스키마
│   │   ├── seed/              # 시드 데이터 (테스트용 마스터 데이터)
│   │   └── utils/             # 유틸리티 함수 (검증, 헬퍼)
│   ├── alembic/               # 데이터베이스 마이그레이션
│   ├── requirements.txt       # Python 의존성
│   ├── Dockerfile             # 백엔드 컨테이너 이미지
│   └── pytest.ini             # 테스트 설정
│
├── frontend/                  # React 프론트엔드
│   ├── src/
│   │   ├── main.tsx           # React 애플리케이션 진입점
│   │   ├── App.tsx            # 라우터 설정 (페이지 경로)
│   │   ├── api/               # Axios API 클라이언트
│   │   ├── components/        # 재사용 가능한 React 컴포넌트
│   │   │   ├── editor/        # 조건표 편집기 관련 컴포넌트
│   │   │   ├── export/        # 전산 출력 관련 컴포넌트
│   │   │   ├── admin/         # 관리자 화면 컴포넌트
│   │   │   ├── auth/          # 인증 관련 컴포넌트
│   │   │   ├── layout/        # 레이아웃 (헤더, 푸터)
│   │   │   └── projects/      # 프로젝트 관리 컴포넌트
│   │   ├── pages/             # 페이지 컴포넌트 (아래 설명)
│   │   ├── stores/            # Zustand 상태 관리 (아래 설명)
│   │   ├── hooks/             # 커스텀 React 훅
│   │   ├── types/             # TypeScript 타입 정의
│   │   └── lib/               # 유틸리티 함수 (검증, diff 계산 등)
│   ├── package.json           # Node.js 의존성
│   ├── vite.config.ts         # Vite 번들러 설정
│   ├── tsconfig.json          # TypeScript 설정
│   ├── Dockerfile             # 프론트엔드 컨테이너 이미지
│   └── index.html             # HTML 진입점
│
├── nginx/                     # Nginx 리버스 프록시
│   ├── Dockerfile             # Nginx 컨테이너 이미지
│   └── nginx.conf             # Nginx 설정 (라우팅)
│
├── docs/                      # 프로젝트 문서
│   ├── 01-quick-start.md      # 빠른 시작 가이드
│   ├── 02-architecture-overview.md  # 이 파일
│   └── ...                    # 기타 문서
│
└── .claude/                   # Claude Code 설정
    ├── docs/                  # 참고 문서들
    ├── rules/                 # 개발 규칙
    └── skills/                # MoAI 스킬
```

## 백엔드 상세 구조

### 데이터 모델 (models/)

```
models/
├── user.py              # User 모델 - 사용자 계정, 역할(admin/reviewer/editor)
├── project.py           # Project 모델 - 공정조건표 프로젝트
│                        #   fields: id, name, status (Draft/Review/Approved)
│                        #   conditions: JSONB (실제 조건 데이터)
├── product.py           # Product 모델 - 마스터 제품 정보
├── layer.py             # ProductLayer 모델 - 제품의 레이어 정보
├── column.py            # Column 모델 - 공정 파라미터 (메타데이터)
│                        #   약 250개의 컬럼 정의
├── change_log.py        # ChangeLog 모델 - 셀 변경 이력 추적
├── export.py            # Export 모델 - 전산 출력 시스템 설정
└── export_history.py    # ExportHistory 모델 - 출력 이력 기록
```

**핵심 모델 관계**:
- User (사용자) → 여러 Project 생성
- Project (프로젝트) → Product 기반으로 생성
- Project → 여러 ProjectLayer 포함
- ProjectLayer → 여러 Column 참조
- Column → 여러 검증 규칙 정의

### API 라우터 (routers/)

각 라우터는 특정 도메인의 엔드포인트를 관리합니다:

```
routers/
├── auth.py              # 인증 (로그인, 토큰 갱신)
├── projects.py          # 프로젝트 CRUD (생성, 조회, 수정)
├── project_lifecycle.py # 상태 전환 (Draft→Review→Approved)
├── project_conditions.py # 조건 데이터 저장/검증
├── project_layers.py    # 레이어 관리 (Backbone 복사/교체)
├── comments.py          # 댓글 (Project/Layer/Cell 레벨)
├── change_log.py        # 변경 이력 조회
├── export.py            # 전산 출력 (미리보기, 다운로드)
├── admin.py             # 관리자 설정 (시스템 설정)
├── users.py             # 사용자 관리
├── products.py          # 제품 마스터 데이터
├── lines.py             # 라인 마스터 데이터
├── columns.py           # 컬럼 메타데이터 조회
└── dashboard.py         # 대시보드 통계
```

### 비즈니스 로직 (services/)

```
services/
├── auth_service.py           # 인증/인가 로직 (JWT, bcrypt)
├── project_service.py        # 프로젝트 CRUD 비즈니스 로직
├── project_status_service.py # 상태 전환 워크플로우
├── project_analytics_service # 변경 요약, 버전 히스토리
├── condition_service.py      # 조건 저장/조회 로직
├── validation_service.py     # 검증 규칙 적용
├── backbone_service.py       # Backbone 복사/교체 로직
├── recipe_service.py         # Recipe XML 반영 로직
├── comment_service.py        # 댓글 관리
├── change_log_service.py     # 변경 이력 기록/조회
├── export_service.py         # 전산 출력 (Type A/B/C)
├── export_builders.py        # Excel 빌더 (순수 함수)
├── dashboard_service.py      # 대시보드 집계 쿼리
└── admin_service.py          # 관리자 설정 관리
```

**서비스 패턴**:
- 각 서비스는 관련 비즈니스 로직을 캡슐화
- 데이터베이스 접근은 Repository 패턴 사용
- 트랜잭션 관리 (async/await)

## 프론트엔드 상세 구조

### 페이지 (pages/)

사용자가 방문하는 화면들:

```
pages/
├── LoginPage.tsx              # 로그인 화면
├── DashboardPage.tsx          # 대시보드 (사용자 홈)
├── ProjectListPage.tsx        # 프로젝트 목록 조회
├── ConditionEditorPage.tsx    # 조건표 편집 화면 (메인)
├── admin/
│   ├── UserManagementPage.tsx # 사용자 관리 (Admin만 접근)
│   ├── MasterDataPage.tsx     # 마스터 데이터 관리 (제품, 레이어 등)
│   ├── ExportSystemsPage.tsx  # 전산 출력 시스템 설정
│   ├── ValidationRulesPage.tsx # 검증 규칙 관리
│   └── ...                    # 기타 관리 페이지
└── NotFoundPage.tsx           # 404 페이지
```

### 페이지 흐름도

```
브라우저 접속
    │
    ├─→ 로그인 상태 확인
    │       │
    │       └─→ 미로그인 → LoginPage (로그인)
    │       └─→ 로그인 → DashboardPage (홈)
    │
    ├─→ /projects → ProjectListPage (프로젝트 목록)
    │
    ├─→ /projects/:id/edit → ConditionEditorPage (조건표 편집)
    │       │
    │       ├─→ AG Grid 조건표 표시
    │       ├─→ 셀 편집 → 자동 검증
    │       ├─→ 저장 → 변경 이력 기록
    │       ├─→ 상태 전환 (Draft→Review→Approved)
    │       └─→ 댓글, 변경 이력 조회
    │
    └─→ /admin → AdminLayout (관리자 섹션)
        ├─→ 사용자 관리
        ├─→ 마스터 데이터 관리
        ├─→ 전산 출력 시스템 설정
        └─→ 검증 규칙 관리
```

### 컴포넌트 구조 (components/)

```
components/
├── editor/
│   ├── ConditionGrid.tsx      # AG Grid 조건표 컴포넌트
│   ├── buildColumnDefs.tsx    # 그리드 컬럼 정의 생성
│   ├── GridContextMenu.tsx    # 우클릭 메뉴 (댓글, 이력 등)
│   ├── ValidationPanel.tsx    # 검증 오류 표시
│   ├── ChangeLogPanel.tsx     # 변경 이력 슬라이드아웃
│   ├── ApprovalButtons.tsx    # 승인/반려 버튼
│   └── ReviewRequestModal.tsx # 검토 요청 모달
│
├── export/
│   ├── ExportPanel.tsx        # 전산 출력 패널
│   ├── ExportPreview.tsx      # 출력 미리보기
│   └── ExportDownload.tsx     # 다운로드 UI
│
├── admin/
│   ├── UserManagementPanel.tsx      # 사용자 CRUD
│   ├── MasterDataPanel.tsx          # 마스터 데이터 관리
│   ├── ExportSystemPanel.tsx        # 출력 시스템 설정
│   └── ValidationRuleForm.tsx       # 검증 규칙 폼
│
├── auth/
│   ├── LoginForm.tsx          # 로그인 폼
│   └── ProtectedRoute.tsx     # 로그인 보호 라우트
│
├── layout/
│   ├── Header.tsx             # 헤더 (네비게이션)
│   ├── Sidebar.tsx            # 사이드바 (메뉴)
│   └── Layout.tsx             # 전체 레이아웃
│
└── ui/
    ├── Button.tsx             # 버튼
    ├── Modal.tsx              # 모달
    ├── Table.tsx              # 테이블
    └── ...                    # 기타 UI 컴포넌트
```

### 상태 관리 (stores/)

Zustand를 사용한 전역 상태 관리:

```
stores/
├── authStore.ts       # 인증 상태 (사용자, 토큰)
├── editorStore.ts     # 편집기 상태 (그리드 데이터, dirty 셀)
├── projectStore.ts    # 프로젝트 상태 (현재 프로젝트 정보)
└── uiStore.ts        # UI 상태 (모달, 토스트 등)
```

**핵심 상태**:
- `authStore.user`: 현재 로그인 사용자
- `editorStore.conditions`: 편집 중인 조건 데이터
- `editorStore.dirtyCell`: 수정된 셀 추적
- `editorStore.validationErrors`: 검증 오류 목록

## 데이터 흐름

### 1. 조건표 편집 흐름

```
사용자가 셀 클릭 및 값 입력
    │
    ├─→ ConditionGrid (AG Grid)
    │   ├─→ editorStore에 상태 업데이트
    │   └─→ 실시간 셀 검증 (validationService)
    │           ├─→ Range 검증
    │           ├─→ Required 검증
    │           └─→ Pattern 검증
    │
    ├─→ 검증 오류 시
    │   └─→ 셀을 빨간색으로 표시 + ValidationPanel 업데이트
    │
    └─→ 저장 버튼 클릭
        └─→ API 호출: PUT /api/projects/:id/conditions
            ├─→ 백엔드: condition_service에서 조건 저장
            ├─→ 변경 이력 자동 기록 (change_log)
            └─→ editorStore 초기화 (dirty 상태 해제)
```

### 2. 프로젝트 생성 흐름

```
사용자: "새 프로젝트 생성" 클릭
    │
    └─→ ProjectCreateModal
        ├─→ 제품 선택 (Product 목록)
        ├─→ Backbone 선택
        └─→ 생성 버튼 클릭
            │
            └─→ API 호출: POST /api/projects
                └─→ 백엔드: project_service.create_project()
                    ├─→ Project 레코드 생성 (status=Draft)
                    ├─→ Backbone 제품의 조건 복사
                    ├─→ ProjectLayer 생성 (모든 레이어)
                    ├─→ 조건 JSONB에 저장
                    └─→ 응답: Project ID
                        │
                        └─→ 프론트엔드: ConditionEditorPage로 이동
```

### 3. 상태 전환 흐름

```
사용자: "검토 요청" 클릭
    │
    ├─→ 검증 확인 (모든 검증 오류 = 0)
    │
    └─→ API 호출: PATCH /api/projects/:id/status
        ├─→ state: "Draft" → "Review"
        │
        └─→ 백엔드: project_status_service.transition_to_review()
            ├─→ 모든 셀 최종 검증
            ├─→ StatusLog 기록
            └─→ Project.status = "Review"
                │
                └─→ Reviewer가 프로젝트 조회 가능
                    │
                    ├─→ 댓글 추가 가능
                    │
                    └─→ Reviewer: "승인" 클릭
                        └─→ API: PATCH /api/projects/:id/status
                            ├─→ status: "Review" → "Approved"
                            └─→ Project 잠금 (수정 불가)
```

## 데이터베이스 스키마 요약

### 핵심 테이블

```
users
├── id (PK)
├── email (unique)
├── hashed_password
├── role (admin, reviewer, editor)
├── is_active
└── created_at

projects
├── id (PK)
├── name
├── status (Draft, Review, Approved, Archived)
├── product_id (FK → products)
├── user_id (FK → users, 생성자)
├── conditions (JSONB) ← 모든 조건 데이터
├── version (개정 번호)
└── created_at, updated_at

products
├── id (PK)
├── name (제품명)
└── is_active

product_layers
├── id (PK)
├── product_id (FK)
├── layer_id (FK)
└── order

columns
├── id (PK)
├── name (파라미터명)
├── category (SP, SC, OVL, DEV)
├── description
├── data_type (string, number, boolean)
└── validations (JSON 배열)

change_logs
├── id (PK)
├── project_id (FK)
├── column_id (FK)
├── old_value
├── new_value
├── change_type (manual, backbone, recipe)
├── user_id (FK)
└── created_at

comments
├── id (PK)
├── project_id (FK)
├── user_id (FK)
├── content
├── target_type (project, layer, cell)
├── target_id
└── created_at
```

## 기술 스택 요약

### 프론트엔드

| 기술 | 역할 | 버전 |
|------|------|------|
| React | UI 프레임워크 | 18 |
| TypeScript | 타입 안전성 | 5.x |
| Vite | 번들러 | 5.x |
| AG Grid | 대용량 데이터 그리드 | Community |
| TanStack Query | 서버 상태 관리 | v5 |
| Zustand | 클라이언트 상태 관리 | 4.x |
| Axios | HTTP 클라이언트 | 1.x |
| Tailwind CSS | CSS 프레임워크 | 3.x |

### 백엔드

| 기술 | 역할 | 버전 |
|------|------|------|
| FastAPI | 웹 프레임워크 | 0.100+ |
| Python | 프로그래밍 언어 | 3.12 |
| SQLAlchemy | ORM | 2.x (async) |
| PostgreSQL | 데이터베이스 | 16 |
| Pydantic | 데이터 검증 | v2 |
| python-jose | JWT 토큰 | 3.x |
| passlib | 비밀번호 해싱 | 1.x |
| Alembic | 마이그레이션 | 1.x |

### 인프라

| 기술 | 역할 |
|------|------|
| Docker | 컨테이너화 |
| Docker Compose | 컨테이너 오케스트레이션 |
| Nginx | 리버스 프록시 |

## 핵심 워크플로우

### 프로젝트 생명 주기

```
1. 프로젝트 생성 (Draft 상태)
   └─→ Backbone 제품 선택 → 조건 복사

2. 편집 단계
   ├─→ 조건표 편집 (셀 수정)
   ├─→ 실시간 검증
   ├─→ Backbone 교체 (선택사항)
   ├─→ Recipe XML 반영 (선택사항)
   └─→ 저장 (변경 이력 기록)

3. 검토 단계 (Review 상태)
   ├─→ 검증 오류 0건 필수
   ├─→ 검토자에게 요청
   ├─→ 댓글 및 논의
   └─→ 승인 또는 반려

4. 승인 단계 (Approved 상태)
   ├─→ 수정 불가 (Read-Only)
   ├─→ 전산 출력 가능
   └─→ 버전 히스토리 유지

5. 개정 단계 (Revision)
   ├─→ Approved 프로젝트에서 "개정" 클릭
   ├─→ 새 Draft 생성 (version + 1)
   └─→ 기존 프로젝트는 Archived
```

### 사용자 역할별 권한

```
┌────────────┬──────────┬──────────┬────────────┐
│ 기능       │ Admin    │ Reviewer │ Editor     │
├────────────┼──────────┼──────────┼────────────┤
│ 프로젝트 생성 │ O      │ O        │ O          │
│ 조건표 편집   │ O      │ O        │ 본인만 O   │
│ 저장          │ O      │ O        │ 본인만 O   │
│ 검토 요청     │ O      │ O        │ 본인만 O   │
│ 승인/반려     │ O      │ O        │ -          │
│ 사용자 관리   │ O      │ -        │ -          │
│ 시스템 설정   │ O      │ -        │ -          │
└────────────┴──────────┴──────────┴────────────┘
```

## 검증 시스템

### 검증 규칙 타입

```
Range (범위 검증)
├─→ 최소값 ≤ 입력값 ≤ 최대값
└─→ 예: 온도는 0~300°C

Required (필수 입력)
├─→ 해당 셀에는 반드시 값 입력 필요
└─→ 예: 제품명은 필수

Conditional Required (조건부 필수)
├─→ 특정 조건 만족 시만 필수
└─→ 예: 타입=Type A인 경우 설정값 필수

Pattern (정규식)
├─→ 입력값이 정규식 패턴 매칭
└─→ 예: 이메일 형식 검증

Cross-Layer (교차 레이어)
├─→ 다른 레이어의 값과 비교
└─→ 예: Layer 2 값이 Layer 1보다 커야 함
```

### 검증 흐름

```
사용자가 셀 값 입력
    │
    └─→ editorStore 업데이트
        └─→ validation_service.validateCell()
            ├─→ 해당 컬럼의 모든 검증 규칙 조회
            ├─→ 각 규칙 순차 적용
            ├─→ 위반 시 오류 수집
            └─→ UI 업데이트
                ├─→ 셀: 빨간색 배경 + 오류 메시지
                ├─→ ValidationPanel: 오류 목록
                └─→ 저장 버튼: 활성화/비활성화
```

## 성능 특성

### AG Grid 최적화

```
조건표 크기: ~300개 컬럼 × 60개 레이어 = 18,000 셀

최적화 기법:
├─→ Virtual Scrolling: 보이는 영역만 렌더링 (약 100x 성능 향상)
├─→ 컬럼 고정: 첫 3개 컬럼 고정 (왼쪽 고정)
├─→ 카테고리 탭: 4개 탭으로 분리 (각 ~75개 컬럼)
├─→ 자동 너비 조정: 초기 렌더링 최적화
└─→ 메모리 관리: 더티 셀만 메모리 추적
```

### 데이터베이스 최적화

```
쿼리 최적화:
├─→ Index: project_id, user_id, created_at (빠른 조회)
├─→ JSONB: 조건 데이터를 GIN 인덱싱 (검색 가속)
├─→ 배치 작업: 변경 이력 벌크 insert (1000 레코드 = 100ms)
└─→ 비동기 쿼리: 여러 요청 동시 처리

캐싱:
├─→ 제품/레이어 마스터 데이터: 앱 시작 시 메모리 로드
├─→ 컬럼 메타데이터: 첫 조회 후 캐싱
└─→ 검증 규칙: 메모리 캐싱 (99% 히트율)
```

## 배포 구조

### Docker Compose 구성

```
docker-compose.yml
├── db (PostgreSQL 16)
│   └─→ 포트 5432
│   └─→ 볼륨: pgdata (데이터 영속성)
│
├── backend (FastAPI)
│   └─→ 포트 8000
│   └─→ hot reload 활성화 (--reload)
│   └─→ db 헬스체크 후 시작
│
├── frontend (React + Vite)
│   └─→ 포트 5173
│   └─→ hot reload 활성화
│   └─→ 환경변수: VITE_API_URL
│
└── nginx (리버스 프록시)
    └─→ 포트 80
    └─→ 라우팅: /api/* → backend, / → frontend
```

### 요청 라우팅

```
http://localhost/
    │
    ├─→ Nginx (포트 80)
    │   │
    │   ├─→ /api/* → http://backend:8000 (내부 네트워크)
    │   └─→ / → http://frontend:5173 (내부 네트워크)
    │
    └─→ 사용자 브라우저에서는 모두 localhost로 접근
```

## 다음 단계

1. **01-quick-start.md**: 프로젝트 실행하기
2. **CLAUDE.md**: 상세 기술 문서
3. **backend/ 및 frontend/** 디렉토리의 코드 탐색

---

**마지막 수정**: 2026-02-22
**문서 버전**: 1.0.0
