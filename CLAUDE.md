# PCM (Process Condition Manager) - Claude Code 작업 가이드

## 프로젝트 개요

반도체 Photo 공정의 공정조건표를 웹에서 관리하는 시스템.
제품당 ~300개 컬럼 × 30~60개 레이어의 조건 데이터를 편집·검증·승인·출력한다.

## 기술 스택

- **Frontend**: React 18 + TypeScript + Vite, AG Grid Community, React Router, Axios
- **Backend**: FastAPI (Python), SQLAlchemy 2.x (async), Alembic, Pydantic
- **DB**: PostgreSQL 16 (JSONB로 조건 데이터 저장)
- **Infra**: Docker Compose (backend:8000, frontend:5173, nginx:80, db:5432)

## 프로젝트 구조

```
process-condition-manager/
├── backend/
│   ├── app/
│   │   ├── main.py           # FastAPI 앱 진입점
│   │   ├── config.py         # 설정 (DATABASE_URL, SECRET_KEY)
│   │   ├── database.py       # AsyncSession, engine, Base
│   │   ├── models/           # SQLAlchemy ORM 모델 (전체 정의 완료)
│   │   ├── routers/          # API 엔드포인트 (미구현)
│   │   ├── services/         # 비즈니스 로직 (미구현)
│   │   ├── schemas/          # Pydantic 스키마 (미구현)
│   │   └── utils/            # 유틸리티 (미구현)
│   ├── alembic/              # DB 마이그레이션
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── main.tsx          # React 진입점
│   │   ├── App.tsx           # 라우터 (/, /projects, /projects/:id/edit)
│   │   ├── api/client.ts     # Axios 클라이언트 (/api 기본경로)
│   │   ├── components/layout/ # Header, Layout
│   │   └── pages/            # ProjectListPage, ConditionEditorPage (플레이스홀더)
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
- `export_systems` / `export_column_mappings` — 전산 출력 설정
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

## 현재 진행 상태

- Docker Compose 구성 완료 (Sprint 1.1)
- FastAPI 프로젝트 구조 세팅 완료 (Sprint 1.2)
- React + Vite 프로젝트 구조 세팅 완료 (Sprint 1.3)
- SQLAlchemy 모델 전체 정의 완료 (Sprint 1.4)
- Alembic 초기화 완료 (Sprint 1.5 진행 중)
- 다음 작업: 시드 데이터(1.6) → 백엔드 핵심 API(Sprint 2) → 프론트엔드 UI(Sprint 3)

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

### Phase 1 인증: 드롭다운 사용자 선택
- 로그인 없이, 헤더에 사용자 선택 드롭다운 배치
- 선택된 사용자 ID를 change_log 등 기록용으로 사용
- 본격적인 JWT 인증은 Phase 4에서 구현

### 테스트 전략
- **Backend**: pytest — 핵심 비즈니스 로직(backbone 복사, 검증, 벌크 저장)에 집중
- **Frontend**: Vitest — 핵심 유틸 함수(diff 계산, 검증 로직)에 집중
- 전체 커버리지보다 **핵심 로직의 정확성 보장** 우선

## 코딩 컨벤션

- Backend: Python 타입 힌트 필수, Pydantic 스키마로 요청/응답 정의, 비동기(async/await) 사용
- Frontend: TypeScript strict mode, 컴포넌트 파일명 PascalCase, AG Grid Community Edition 사용
- API 경로: `/api/` 접두사, RESTful 컨벤션
- DB: JSONB로 조건 데이터 저장, EAV로 변경 이력 추적
