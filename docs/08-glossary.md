# 용어 사전

PCM(Process Condition Manager) 프로젝트에서 사용하는 모든 도메인 용어와 기술 용어를 정리한 사전입니다.

## 목차

1. [도메인 용어 (반도체 공정)](#도메인-용어-반도체-공정)
2. [상태 용어](#상태-용어)
3. [기술 용어](#기술-용어)
4. [프로젝트 약어](#프로젝트-약어)
5. [UI/UX 용어](#uiux-용어)

---

## 도메인 용어 (반도체 공정)

### Backbone (골라구조)

| 용어 | 영문 | 설명 | 사용 위치 |
|------|------|------|----------|
| **Backbone** | Backbone / Base Condition | 기존 양산 제품의 공정조건표. 신규 제품 생성 시 복사하여 초안 생성의 기본이 되는 참조 데이터. | 프로젝트 생성 시 선택, `main_backbone_id` (프로젝트 모델), ProjectCreateRequest |
| **메인 Backbone** | Main Backbone | 전체 프로젝트의 기본 Backbone. 프로젝트 생성 시 선택한 제품. | Project 모델의 `main_backbone_id` |
| **레이어별 Backbone 교체** | Layer Backbone Replacement | 특정 레이어만 다른 제품의 조건으로 변경. 제품 간 레이어 조합 가능. | `BackboneReplaceRequest`, `backbone_product_id` (ProjectLayer) |
| **Backbone 조건** | Backbone Conditions | Backbone에서 복사한 원본 조건값. 변경 이력 추적을 위해 별도 저장. | `backbone_conditions` (JSONB, ProjectLayer) |

### Recipe (레시피)

| 용어 | 영문 | 설명 | 사용 위치 |
|------|------|------|----------|
| **Recipe XML** | Recipe XML / Equipment Recipe | 설비에서 추출한 공정 조건 데이터. XML 형식. | `RecipeUploadModal`, `recipe_service.py` |
| **Recipe 적용** | Recipe Apply | XML 데이터를 조건표에 반영하는 작업. Diff 계산 후 선택적 적용. | `recipe_service.py`, RecipeApplyRequest |
| **Recipe Diff** | Recipe Diff | XML의 조건값과 현재 조건표의 차이. 검토 후 적용 여부 결정. | `RecipeDiffTable`, diff 계산 로직 |
| **XML 매핑** | XML Column Mapping | XML의 XPath와 조건표 컬럼명 매핑. 관리자가 설정. | `/admin/xml-mappings`, recipe_xml_mappings 테이블 |

### Layer (레이어)

| 용어 | 영문 | 설명 | 사용 위치 |
|------|------|------|----------|
| **Layer** | Layer / Process Step | 반도체 Photo 공정의 각 스텝. 공정조건표의 행(Row). 제품당 30~60개. | Layer 모델, ProjectLayer |
| **Layer Name** | Layer Name | 레이어의 이름. 예: AA_PHOTO, GATE_PHOTO. | layer.layer_name (Layer 모델) |
| **Step Seq** | Step Sequence | 레이어의 공정 순서 번호. 예: 001, 002, 003. | layer.step_seq, 정렬 기준 |
| **Layer Number** | Layer Number | 레이어 번호. 예: L1, L2, L3. | layer.layer_number |

### 공정조건표

| 용어 | 영문 | 설명 | 사용 위치 |
|------|------|------|----------|
| **공정조건표** | Process Condition Table | 레이어(행) × 파라미터(열)로 구성된 반도체 공정 조건 데이터 집합. 프로젝트의 핵심. | Project, ProjectLayer |
| **조건(Condition)** | Condition / Parameter Value | 특정 레이어-파라미터의 값. | conditions (JSONB, ProjectLayer) |
| **파라미터** | Parameter / Column | 공정 조건의 항목. 약 300개. 예: PR_TYPE, SPIN_SPEED. | ColumnDefinition 모델 |
| **셀** | Cell | 조건표의 한 칸. 레이어 × 파라미터의 교점. | GridCell (AG Grid 용어) |
| **Dirty Cell** | Dirty Cell / Modified Cell | 사용자가 편집했으나 저장하지 않은 셀. 메모리에만 존재. | dirtyCells (Zustand store) |

### 카테고리

| 용어 | 영문 | 설명 | 사용 위치 |
|------|------|------|----------|
| **SP (Spin/PR)** | SP (Spin/PR) | 코팅 관련 카테고리. PR 도포, 스핀, 프리베이크, 접착제 등. | category_code "SP", UI 탭 |
| **SC (Scanner/Expose)** | SC (Scanner/Expose) | 노광 관련 카테고리. 노광 장비, 레티클, 에너지, 포커스 등. | category_code "SC", UI 탭 |
| **OVL (Overlay)** | OVL (Overlay) | 정렬 정밀도 관련 카테고리. 오버레이 측정, 보정, APC 등. | category_code "OVL", UI 탭 |
| **DEV (Develop)** | DEV (Develop) | 후처리 관련 카테고리. 현상, 린스, 포스트베이크, CD 측정 등. | category_code "DEV", UI 탭 |
| **카테고리 탭** | Category Tab | UI에서 4개 카테고리로 나뉜 탭. 스크롤 없이 300개 컬럼 브라우징. | CategoryTabs 컴포넌트 |

### 전산출력

| 용어 | 영문 | 설명 | 사용 위치 |
|------|------|------|----------|
| **전산출력** | Export / System Output | 완성된 조건표를 사내 전산 시스템별 포맷으로 변환·출력. 최종 단계. | Export 관련 컴포넌트/서비스 |
| **전산 시스템** | Export System | 출력 대상 시스템. 약 10개. 각 시스템별 포맷 정의 필요. | export_systems 테이블 |
| **Type A** | Type A (Horizontal Format) | 행=레이어, 열=파라미터의 수평 형식. Excel 테이블. | export_builders.py 함수 |
| **Type B** | Type B (Equipment Split Format) | 각 설비별로 데이터를 분할한 형식. 복수 시트. | export_builders.py 함수 |
| **Type C** | Type C (Key-Value Transposed Format) | 키-값 쌍을 전치(transpose)한 형식. 시스템 입력용. | export_builders.py 함수 |
| **설비 할당** | Equipment Assignment | 레이어별로 사용할 설비를 지정. Type B 출력 시 필요. | equipment_service.py, EquipmentPanel |
| **데이터 소스** | Export Data Source | 외부 시스템에서 추출한 메타데이터. 매핑에 사용. | export_data_source 테이블, export_data_source_service.py |

### Photo 공정

| 용어 | 영문 | 설명 | 사용 위치 |
|------|------|------|----------|
| **Photo 공정** | Photolithography Process | 반도체 제조의 미세 패턴 형성 공정. PCM의 대상. | 도메인 배경 |
| **제품** | Product | 반도체 칩의 종류. 예: Product_A, Product_B. | Product 모델 |
| **라인** | Line | 제조 생산 라인. 제품은 라인에 속함. | Line 모델 |

---

## 상태 용어

### 프로젝트 상태 (Workflow)

| 용어 | 영문 | 설명 | 사용 위치 | 다음 상태 |
|------|------|------|----------|----------|
| **Draft** | Draft | 초안 상태. 작성 중이거나 검토 반려됨. 수정 가능. | status = "draft" | Review (검증 오류 0건 필수) |
| **Review** | Review / Under Review | 검토 중 상태. 작성자가 검토 요청함. 편집 불가. | status = "review" | Approved 또는 Rejected |
| **Approved** | Approved | 승인 상태. 검토자가 승인함. 최종 완성. | status = "approved" | Archived (Revision 생성 시) |
| **Rejected** | Rejected | 반려 상태. 검토자가 반려함. Draft로 복귀 가능. | status = "rejected" | Draft (편집 후 재요청) |
| **Archived** | Archived | 보관 상태. Revision 생성으로 이전 버전이 됨. 읽기 전용. | status = "archived" | (최종 상태) |

### 상태 전환 규칙

| 현재 상태 | 가능한 전환 | 조건 | 권한 |
|----------|-----------|------|------|
| Draft | Review | 검증 오류 0건 | editor |
| Review | Approved | (없음) | reviewer |
| Review | Rejected | 코멘트 작성 | reviewer |
| Rejected | Draft | (없음) | editor |
| Approved | Archived | Revision 생성 시 자동 | system |

### Revision (개정)

| 용어 | 영문 | 설명 | 사용 위치 |
|------|------|------|----------|
| **Revision** | Revision / Version | 프로젝트의 버전 번호. Approved → Revision 시 증가. | revision (Project) |
| **Revision 생성** | Create Revision | Approved 상태의 프로젝트에서 새 draft 생성. 기존은 archived로 변경. | ReviseProjectRequest, project_service.revise_project() |
| **Latest** | Latest / Current Version | 가장 최신의 버전. 일반적으로 draft 또는 review 상태. | is_latest (Project) |
| **Parent Project** | Parent Project | Revision 생성 시 원본 프로젝트 참조. | parent_project_id (Project) |

---

## 기술 용어

### 데이터베이스

| 용어 | 영문 | 설명 | 사용 위치 |
|------|------|------|----------|
| **JSONB** | JSONB (PostgreSQL JSON Binary) | PostgreSQL의 바이너리 JSON 형식. 조건 데이터 저장. | conditions, backbone_conditions (ProjectLayer) |
| **ORM** | Object-Relational Mapping | 데이터베이스를 객체로 매핑하는 라이브러리. | SQLAlchemy (Python) |
| **SQLAlchemy** | SQLAlchemy | Python의 ORM 라이브러리. 모델 정의 및 쿼리 작성. | `/backend/app/models/` |
| **Alembic** | Alembic | 데이터베이스 마이그레이션 도구. 스키마 버전 관리. | `/backend/alembic/` |
| **Migration** | Database Migration | 데이터베이스 스키마 버전 관리. 새 테이블, 컬럼 추가 등. | alembic revision, upgrade |
| **Async/Await** | Async/Await | 비동기 프로그래밍 패턴. FastAPI에서 사용. | `async def`, `await` |
| **AsyncSession** | AsyncSession | SQLAlchemy의 비동기 세션. | `/backend/app/database.py` |

### 인증/보안

| 용어 | 영문 | 설명 | 사용 위치 |
|------|------|------|----------|
| **JWT** | JSON Web Token | 사용자 인증 토큰. 요청마다 포함. | Authorization 헤더 |
| **Access Token** | Access Token | 단기 토큰 (15분). API 호출에 사용. | Bearer 토큰 |
| **Refresh Token** | Refresh Token | 장기 토큰 (7일). 쿠키에 저장. Access token 갱신용. | HTTP-only 쿠키 |
| **bcrypt** | bcrypt | 패스워드 해싱 라이브러리. | auth_service.get_password_hash() |
| **RBAC** | Role-Based Access Control | 역할 기반 접근 제어. editor, reviewer, admin. | User.role, RequireRole 컴포넌트 |

### 프론트엔드

| 용어 | 영문 | 설명 | 사용 위치 |
|------|------|------|----------|
| **React** | React | JavaScript UI 라이브러리. | `/frontend/src/` |
| **TypeScript** | TypeScript | JavaScript의 타입 안전 버전. | `/frontend/src/**/*.ts`, `/frontend/src/**/*.tsx` |
| **Zustand** | Zustand | 간단한 상태 관리 라이브러리. | `/frontend/src/stores/` |
| **AG Grid** | AG Grid Community | 엔터프라이즈급 그리드 컴포넌트. 300컬럼 편집 UI 핵심. | ConditionGrid, buildColumnDefs |
| **Vite** | Vite | 고속 번들러 및 개발 서버. | `/frontend/` 빌드 |
| **React Router** | React Router | 페이지 라우팅 라이브러리. | `/frontend/src/App.tsx` |
| **Axios** | Axios | HTTP 클라이언트 라이브러리. API 통신. | `/frontend/src/api/` |

### 백엔드

| 용어 | 영문 | 설명 | 사용 위치 |
|------|------|------|----------|
| **FastAPI** | FastAPI | Python의 고속 웹 프레임워크. REST API 구축. | `/backend/app/main.py` |
| **Pydantic** | Pydantic | Python의 데이터 검증 라이브러리. 요청/응답 스키마. | `/backend/app/schemas/` |
| **Service** | Service / Business Logic Layer | 비즈니스 로직을 담당하는 계층. | `/backend/app/services/` |
| **Repository** | Repository / Data Access Layer | 데이터 접근을 담당하는 계층. N+1 최적화. | `/backend/app/repositories/` |
| **Router** | Router / Endpoint | API 엔드포인트를 정의하는 계층. | `/backend/app/routers/` |
| **Dependency** | Dependency / Dependency Injection | 의존성 주입. 인증, DB 접근 등. | `/backend/app/dependencies/auth.py`, Depends() |

### 배포/인프라

| 용어 | 영문 | 설명 | 사용 위치 |
|------|------|------|----------|
| **Docker** | Docker | 컨테이너 기반 배포 도구. | Dockerfile, docker-compose.yml |
| **Docker Compose** | Docker Compose | 다중 컨테이너 오케스트레이션. | docker-compose.yml |
| **Container** | Container | 독립적인 실행 환경. Backend, Frontend, DB. | docker-compose.yml services |
| **PostgreSQL** | PostgreSQL | 오픈소스 관계형 데이터베이스. | DB 서비스 |
| **Nginx** | Nginx | 웹 서버 및 리버스 프록시. 정적 파일 서빙. | nginx/ |

---

## 프로젝트 약어

| 약어 | 영문 | 설명 |
|------|------|------|
| **PCM** | Process Condition Manager | 이 프로젝트의 이름. |
| **SP** | Spin/PR | 카테고리: 코팅 관련. |
| **SC** | Scanner/Expose | 카테고리: 노광 관련. |
| **OVL** | Overlay | 카테고리: 정렬 정밀도 관련. |
| **DEV** | Develop | 카테고리: 후처리 관련. |
| **PR** | Photoresist | PR 레지스트. 감광성 물질. |
| **API** | Application Programming Interface | 프론트엔드-백엔드 통신 인터페이스. |
| **CORS** | Cross-Origin Resource Sharing | 도메인 간 요청 허용 설정. |
| **REST** | Representational State Transfer | API 설계 아키텍처. |
| **UI** | User Interface | 사용자 인터페이스. 화면. |
| **UX** | User Experience | 사용자 경험. |

---

## UI/UX 용어

### 그리드/편집

| 용어 | 영문 | 설명 | 사용 위치 |
|------|------|------|----------|
| **Dirty Cell** | Dirty Cell / Modified Cell | 사용자가 편집했으나 저장하지 않은 셀. 주황색 배경. | ConditionGrid, useEditorStore |
| **Recipe Cell** | Recipe Cell / Applied Recipe Cell | Recipe XML을 적용한 셀. 초록색 배경. | ConditionGrid |
| **Validation Error Cell** | Validation Error Cell | 검증 규칙을 위반한 셀. 빨강색 배경. | ConditionGrid, ValidationPanel |
| **Auto Save** | Auto Save | 자동 저장. 일정 간격(~30초)으로 dirty cells 임시 저장. | useAutoSave |
| **Bulk Save** | Bulk Save / Batch Save | 모든 dirty cells를 한 번에 저장. 저장 버튼 클릭 시. | POST /api/projects/{id}/save |
| **Grid Context Menu** | Grid Context Menu / Right-click Menu | 그리드 셀 우클릭 시 나타나는 메뉴. 댓글, 이력 조회 등. | GridContextMenu |

### 패널/모달

| 용어 | 영문 | 설명 | 사용 위치 |
|------|------|------|----------|
| **Validation Panel** | Validation Panel | 검증 오류를 표시하는 패널. 필터, 셀 하이라이팅. | ValidationPanel |
| **Change History Panel** | Change History Panel / Changelog Panel | 셀 변경 이력을 보여주는 슬라이드아웃 패널. | ChangeHistoryPanel |
| **Version History Modal** | Version History Modal | Revision 버전 이력을 보여주는 모달. Read-only 모드로 전환. | VersionHistoryModal |
| **Comment Panel** | Comment Panel / Review Comment Panel | 프로젝트 전체 댓글과 검토 코멘트를 보여주는 패널. | CommentPanel |
| **Equipment Panel** | Equipment Panel | 레이어별 설비 할당을 관리하는 패널. | EquipmentPanel |

### 상태 표시

| 용어 | 영문 | 설명 | 사용 위치 |
|------|------|------|----------|
| **Status Badge** | Status Badge | 프로젝트 상태를 표시하는 배지. Draft, Review, Approved 등. | StatusBadge |
| **Status Banner** | Status Banner | 조건표 상단의 상태 및 작업 버튼 영역. | StatusBanner |
| **Status Timeline** | Status Timeline | 프로젝트의 상태 변경 이력을 시간순으로 보여줌. | StatusTimeline |

### 팝업/대화창

| 용어 | 영문 | 설명 | 사용 위치 |
|------|------|------|----------|
| **Modal** | Modal / Dialog | 사용자 입력을 받는 팝업 창. | ProjectCreateModal, ReviewRequestModal 등 |
| **Confirm Dialog** | Confirm Dialog / Confirmation Prompt | 삭제, 상태 변경 등 중요 작업 전 확인 창. | confirm-dialog 컴포넌트 |
| **Toast** | Toast Notification | 일시적 알림 메시지. 우측 하단에 나타남. | toast.success(), toast.error() 등 |

### 네비게이션

| 용어 | 영문 | 설명 | 사용 위치 |
|------|------|------|----------|
| **Header** | Header / Navigation Bar | 상단 네비게이션 바. 로고, 메뉴, 사용자 정보. | Header 컴포넌트 |
| **Layer Nav Panel** | Layer Navigation Panel | 좌측 레이어 목록 패널. 스크롤, 검색, 필터. | LayerNavPanel |
| **Sidebar** | Sidebar | 좌측 사이드바. 메뉴, 필터 등. | Layout 컴포넌트 |
| **Breadcrumb** | Breadcrumb / Path Navigation | 현재 위치를 보여주는 경로. 예: 프로젝트 > 편집. | 페이지 상단 |

---

## 데이터 구조 용어

### 모델/스키마

| 용어 | 영문 | 설명 | 사용 위치 |
|------|------|------|----------|
| **Project** | Project | 공정조건표 작업 단위. 제품과 Backbone의 조합. | Project 모델, /api/projects |
| **ProjectLayer** | ProjectLayer | 프로젝트 내 특정 레이어의 조건. conditions 저장. | ProjectLayer 모델 |
| **ColumnDefinition** | ColumnDefinition | 컬럼의 메타데이터. 타입, 카테고리, 검증 규칙 ID. | ColumnDefinition 모델 |
| **ColumnValidation** | ColumnValidation | 컬럼의 검증 규칙. Range, required 등. | ColumnValidation 모델 |
| **ChangeLog** | ChangeLog / Change History | 셀 변경 이력 레코드. manual, backbone, recipe 등 출처 기록. | ChangeLog 모델 |
| **StatusLog** | StatusLog / Status History | 프로젝트 상태 변경 이력. Draft → Review 등. | StatusLog 모델 |
| **Comment** | Comment / Review Comment | 댓글 또는 검토 코멘트. 셀 또는 프로젝트 전체 대상. | Comment 모델 |
| **ExportHistory** | ExportHistory | 전산 출력 이력. 언제, 누가, 어느 시스템으로. | ExportHistory 모델 |

### 데이터 흐름

| 용어 | 영문 | 설명 | 사용 위치 |
|------|------|------|----------|
| **Request** | Request / HTTP Request | 프론트엔드에서 백엔드로 보내는 요청. | `ProjectCreateRequest`, `/api/**` POST/PUT |
| **Response** | Response / HTTP Response | 백엔드에서 프론트엔드로 보내는 응답. | `ProjectResponse`, `/api/**` GET |
| **Payload** | Payload | 요청/응답의 본문 데이터. | Request/Response body |
| **Query Parameter** | Query Parameter | URL에 붙는 필터 파라미터. 예: `?status=draft&line_id=1`. | 목록 조회 API |
| **Path Parameter** | Path Parameter | URL 경로의 변수. 예: `/api/projects/{id}`. | `{id}`, `{projectId}` |

---

## 관계도 요약

```
Product (제품)
  ├─ ProductLayer (제품의 레이어와 조건)
  │   └─ conditions (JSONB: 파라미터 값들)
  └─ is_backbone (Backbone 여부)

Project (공정조건표 작업)
  ├─ product_id → Product (대상 제품)
  ├─ main_backbone_id → Product (메인 Backbone)
  ├─ status (draft/review/approved/rejected/archived)
  ├─ revision (버전 번호)
  ├─ parent_project_id → Project (Revision 원본)
  └─ ProjectLayer[] (각 레이어별 조건)
      ├─ layer_id → Layer
      ├─ backbone_product_id → Product (레이어별 Backbone)
      ├─ conditions (JSONB: 현재 조건값)
      ├─ backbone_conditions (JSONB: Backbone 원본값)
      └─ ChangeLog[] (이 레이어-셀의 변경 이력)

ColumnDefinition (컬럼 메타데이터)
  ├─ column_name (영문 코드)
  ├─ display_name (한글 표시명)
  ├─ category_code (SP/SC/OVL/DEV)
  └─ ColumnValidation[] (검증 규칙들)

Comment (댓글/코멘트)
  ├─ project_id
  ├─ project_layer_id (NULL이면 프로젝트 전체)
  └─ column_name (NULL이면 레이어 전체)

ExportSystem (전산 시스템 정의)
  ├─ system_name
  ├─ export_format (TYPE_A/TYPE_B/TYPE_C)
  └─ ExportColumnMapping[] (컬럼 매핑)
```

---

## 참고 자료

- **CLAUDE.md**: 프로젝트 전체 개요 및 아키텍처
- **PRD v2.md**: 프로젝트 요구사항 및 기능 설명
- **constants.py**: 도메인 상수 (상태, 규칙 타입 등)
- **models/**: 데이터베이스 모델 정의
- **schemas/**: Pydantic 스키마 (요청/응답)

