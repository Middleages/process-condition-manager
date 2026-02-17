# PCM 기술 스택 및 아키텍처

## 기술 스택 개요

PCM은 현대적인 웹 기술 스택을 기반으로 구축된 풀스택 애플리케이션입니다. 백엔드는 Python FastAPI, 프론트엔드는 React + TypeScript, 데이터베이스는 PostgreSQL을 사용하며, Docker Compose를 통해 통합 관리됩니다.

---

## Backend 기술 스택

### Core Framework

**FastAPI 0.115.6**
- 목적: 고성능 비동기 웹 프레임워크
- 선택 근거:
  - 네이티브 비동기 지원으로 높은 동시성 처리
  - 자동 API 문서 생성 (Swagger UI, ReDoc)
  - Pydantic 통합으로 강력한 타입 검증
  - Python 3.12 타입 힌트 완벽 지원
- 사용 사례: RESTful API 엔드포인트 구현, 미들웨어, CORS 설정

**Python 3.12**
- 목적: 최신 Python 런타임
- 선택 근거:
  - 향상된 타입 힌트 지원 (PEP 695)
  - 성능 개선 (CPython 최적화)
  - 최신 표준 라이브러리 기능
- 사용 사례: 전체 백엔드 코드 실행 환경

---

### Database Layer

**SQLAlchemy 2.0.36 (Async ORM)**
- 목적: 객체 관계 매핑 및 데이터베이스 추상화
- 선택 근거:
  - 비동기 쿼리 지원 (asyncio + asyncpg)
  - 강력한 ORM 기능 (관계, 지연 로딩, 조인)
  - 타입 안전한 쿼리 빌더
- 사용 사례: 모델 정의, 쿼리 실행, 트랜잭션 관리

**PostgreSQL 16-alpine**
- 목적: 관계형 데이터베이스 관리 시스템
- 선택 근거:
  - JSONB 타입으로 유연한 조건 데이터 저장
  - 강력한 인덱싱 및 쿼리 성능
  - ACID 트랜잭션 보장
  - 엔터프라이즈급 안정성
- 사용 사례: 공정조건표 데이터 저장, 마스터 데이터 관리, 변경 이력 추적

**Alembic 1.14.1**
- 목적: 데이터베이스 마이그레이션 도구
- 선택 근거:
  - SQLAlchemy와 완벽한 통합
  - 버전 관리 및 롤백 지원
  - 자동 마이그레이션 생성
- 사용 사례: 스키마 변경 이력 관리, 환경별 데이터베이스 동기화

**asyncpg 0.30.0**
- 목적: 비동기 PostgreSQL 드라이버
- 선택 근거:
  - 순수 Python 구현
  - psycopg2 대비 2-3배 빠른 성능
  - SQLAlchemy async와 네이티브 통합
- 사용 사례: 데이터베이스 연결 풀 관리, 쿼리 실행

---

### Validation & Serialization

**Pydantic 2.10.4**
- 목적: 데이터 검증 및 직렬화
- 선택 근거:
  - 타입 힌트 기반 자동 검증
  - FastAPI와 네이티브 통합
  - 성능 최적화 (Rust 기반 코어)
- 사용 사례: API 요청/응답 스키마 정의, 설정 검증

---

### File Processing

**openpyxl 3.1.5**
- 목적: Excel 파일 읽기/쓰기 및 파일 파싱
- 선택 근거:
  - xlsx 포맷 완벽 지원
  - 스타일 및 포맷 유지
  - 대용량 파일 처리
  - 벌크 업로드 및 파일 파싱
- 사용 사례: 샘플 데이터 임포트, 검증 규칙 벌크 업로드, 전산 출력 (Type A/B/C) Excel 생성

**lxml 5.3.0**
- 목적: XML 파싱 및 XPath 쿼리
- 선택 근거:
  - 빠른 C 기반 파서
  - XPath 1.0 완벽 지원
  - 대용량 XML 처리
- 사용 사례: Recipe XML 파싱, XPath 기반 컬럼 매핑

---

### Testing

**pytest 8.3.4**
- 목적: 테스트 프레임워크
- 선택 근거:
  - 간결한 문법
  - 강력한 fixture 시스템
  - 풍부한 플러그인 생태계
- 사용 사례: 유닛 테스트, 통합 테스트, 커버리지 측정

**pytest-asyncio 0.24.0**
- 목적: 비동기 테스트 지원
- 선택 근거:
  - async/await 테스트 함수 지원
  - 비동기 fixture 관리
- 사용 사례: 비동기 서비스 로직 테스트

---

## Frontend 기술 스택

### Core Framework

**React 18.3.1**
- 목적: UI 라이브러리
- 선택 근거:
  - 컴포넌트 기반 아키텍처
  - 풍부한 생태계 및 커뮤니티
  - Concurrent Rendering으로 성능 최적화
  - Hooks를 통한 상태 로직 재사용
- 사용 사례: 컴포넌트 개발, 상태 관리, UI 렌더링

**TypeScript 5.7.3**
- 목적: 정적 타입 검사
- 선택 근거:
  - 컴파일 타임 오류 검출
  - IDE 자동완성 및 리팩토링 지원
  - 대규모 코드베이스 유지보수성
- 사용 사례: 전체 프론트엔드 코드 작성

**Vite 6.0.7**
- 목적: 빌드 도구 및 개발 서버
- 선택 근거:
  - 즉각적인 HMR (Hot Module Replacement)
  - esbuild 기반 초고속 빌드
  - 네이티브 ES 모듈 지원
  - Webpack 대비 10배 빠른 개발 서버
- 사용 사례: 개발 서버 실행, 프로덕션 빌드

---

### Data Grid

**AG Grid Community 32.3.3**
- 목적: 고성능 데이터 그리드
- 선택 근거:
  - 수만 개 행 처리 가능한 가상 스크롤링
  - 인라인 편집, 셀 렌더러 커스터마이징
  - Excel 유사 키보드 네비게이션
  - 무료 커뮤니티 버전으로 충분한 기능 제공
- 사용 사례: 공정조건표 편집 그리드, 300개 컬럼 × 60개 레이어 렌더링

---

### Routing & State Management

**React Router 7.1.1**
- 목적: 클라이언트 사이드 라우팅
- 선택 근거:
  - React 생태계 표준
  - 동적 라우팅 및 중첩 라우트
  - 타입 안전한 라우트 파라미터
- 사용 사례: 페이지 네비게이션, 프로젝트 상세 라우팅

**TanStack Query 5.90.21 (React Query)**
- 목적: 서버 상태 관리
- 선택 근거:
  - 자동 캐싱 및 백그라운드 재검증
  - Optimistic UI 업데이트
  - 로딩 및 에러 상태 자동 관리
  - devtools 내장
- 사용 사례: API 데이터 페칭, 캐싱, 동기화

**Zustand 5.0.11**
- 목적: 클라이언트 상태 관리
- 선택 근거:
  - 간결한 API (Redux 대비 보일러플레이트 90% 감소)
  - TypeScript 완벽 지원
  - React 외부에서도 사용 가능
  - 미들웨어 지원
- 사용 사례: 편집기 상태 (dirty cells, 검증 오류), 사용자 선택, Toast

---

### HTTP Client

**Axios 1.7.9**
- 목적: HTTP 클라이언트
- 선택 근거:
  - Promise 기반 인터페이스
  - 요청/응답 인터셉터
  - 타임아웃 및 재시도 설정
  - fetch API 대비 풍부한 기능
- 사용 사례: API 호출, 에러 핸들링, 인증 토큰 주입

---

### UI & Styling

**Tailwind CSS 4.1.18**
- 목적: 유틸리티 우선 CSS 프레임워크
- 선택 근거:
  - 빠른 UI 개발
  - 일관된 디자인 시스템
  - JIT (Just-In-Time) 컴파일로 작은 번들 크기
  - 반응형 디자인 간편 구현
- 사용 사례: 컴포넌트 스타일링, 레이아웃, 반응형 디자인

---

### Testing

**Vitest 4.0.18**
- 목적: Vite 네이티브 테스트 프레임워크
- 선택 근거:
  - Vite 설정 재사용
  - Jest 호환 API
  - 빠른 실행 속도
  - TypeScript 네이티브 지원
- 사용 사례: 컴포넌트 테스트, 훅 테스트, 유틸 함수 테스트

---

## Infrastructure

### Containerization

**Docker 27.4.1**
- 목적: 컨테이너화
- 선택 근거:
  - 일관된 개발/배포 환경
  - 격리된 실행 환경
  - 간편한 의존성 관리
- 사용 사례: 백엔드, 프론트엔드, DB, Nginx 컨테이너 실행

**Docker Compose 2.32.4**
- 목적: 멀티 컨테이너 오케스트레이션
- 선택 근거:
  - YAML 기반 서비스 정의
  - 네트워크 및 볼륨 자동 관리
  - 로컬 개발 환경 통합 관리
- 사용 사례: 4개 서비스 (db, backend, frontend, nginx) 통합 실행

---

### Reverse Proxy

**Nginx 1.27-alpine**
- 목적: 리버스 프록시 및 정적 파일 서빙
- 선택 근거:
  - 고성능 HTTP 서버
  - 경량 alpine 이미지
  - 간단한 라우팅 설정
- 사용 사례:
  - / → 프론트엔드 빌드 파일 서빙
  - /api → 백엔드 FastAPI로 프록시
  - CORS 헤더 관리

---

## 개발 환경 요구사항

### 필수 소프트웨어

**Docker Desktop (macOS/Windows) 또는 Docker Engine (Linux)**
- 버전: 20.10 이상
- 목적: 컨테이너 실행 환경
- 설치: https://docs.docker.com/get-docker/

**Node.js 20.x LTS**
- 목적: 프론트엔드 개발 및 빌드
- 설치: https://nodejs.org/

**Python 3.12**
- 목적: 백엔드 로컬 개발 (선택 사항, Docker로 대체 가능)
- 설치: https://www.python.org/

---

### 개발 도구 권장사항

**IDE/Editor**
- Visual Studio Code 권장
- 확장: Python, ESLint, Prettier, Tailwind CSS IntelliSense, Docker

**Git**
- 버전: 2.30 이상
- 목적: 버전 관리

**포트 사용**
- PostgreSQL: 5432
- FastAPI: 8000
- Vite Dev Server: 5173
- Nginx: 80

---

## 빌드 및 배포 설정

### Docker Compose 서비스 구성

**db 서비스**
- 이미지: postgres:16-alpine
- 포트: 5432:5432
- 볼륨: postgres_data (데이터 영속성)
- 환경 변수: POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD

**backend 서비스**
- 빌드: backend/Dockerfile
- 포트: 8000:8000
- 볼륨: backend/app (hot reload)
- 의존성: db 서비스 시작 후 실행
- 환경 변수: DATABASE_URL, SECRET_KEY, CORS_ORIGINS

**frontend 서비스**
- 빌드: frontend/Dockerfile (multi-stage build)
- 포트: 5173:5173 (개발 모드)
- 볼륨: frontend/src (hot reload)

**nginx 서비스**
- 빌드: nginx/Dockerfile
- 포트: 80:80
- 의존성: backend, frontend 서비스
- 설정: nginx/nginx.conf

---

### Backend Dockerfile 구조

**Stage 1 - Base**
- FROM python:3.12-slim
- 작업 디렉토리 설정: /app
- 시스템 패키지 설치: postgresql-client, build-essential

**Stage 2 - Dependencies**
- requirements.txt 복사 및 pip install
- 캐시 활용으로 빌드 속도 향상

**Stage 3 - Application**
- 애플리케이션 코드 복사
- Alembic 마이그레이션 실행
- uvicorn으로 FastAPI 실행: --host 0.0.0.0 --port 8000 --reload

---

### Frontend Dockerfile 구조

**Stage 1 - Build**
- FROM node:20-alpine
- 작업 디렉토리 설정: /app
- package.json, package-lock.json 복사
- npm ci로 의존성 설치
- 소스 코드 복사
- npm run build로 프로덕션 빌드

**Stage 2 - Runtime (Nginx)**
- FROM nginx:1.27-alpine
- 빌드 결과물 복사: dist → /usr/share/nginx/html
- Nginx 설정 복사
- 포트 80 노출

---

### CI/CD 고려사항

**GitHub Actions 워크플로우**
- 백엔드 테스트: pytest 실행, 커버리지 측정
- 프론트엔드 테스트: vitest 실행
- 린팅: ruff (backend), eslint (frontend)
- 포맷팅: black (backend), prettier (frontend)
- Docker 이미지 빌드 및 레지스트리 푸시

**배포 전략**
- Blue-Green 배포 또는 Rolling Update
- Alembic 마이그레이션 자동 실행
- 환경별 설정 주입 (.env 파일)

---

## 테스트 전략

### Backend 테스트

**테스트 범위**
- 서비스 계층 핵심 비즈니스 로직
- 6개 주요 서비스 테스트 (project, backbone, recipe, validation, condition, change_log)

**테스트 프레임워크**
- pytest + pytest-asyncio
- fixture를 통한 DB 세션 및 모델 데이터 준비

**커버리지 목표**
- 핵심 비즈니스 로직: 85% 이상
- 전체 코드: 70% 이상

**실행 명령**
```bash
docker-compose exec backend pytest --cov=app --cov-report=html
```

---

### Frontend 테스트

**테스트 범위**
- Zustand 스토어 (useUserStore, useEditorStore)
- 유틸리티 함수 (validation, diff)

**테스트 프레임워크**
- Vitest + @testing-library/react

**커버리지 목표**
- 핵심 유틸 함수: 85% 이상
- 전체 코드: 60% 이상

**실행 명령**
```bash
cd frontend
npm test
```

---

## 성능 최적화

### Backend 최적화

**비동기 처리**
- asyncio + asyncpg로 동시 처리 성능 극대화
- Connection pooling으로 DB 연결 재사용

**JSONB 인덱싱**
- GIN 인덱스로 JSONB 쿼리 성능 향상
- 조건 데이터 검색 속도 10배 개선

**캐싱 전략**
- 컬럼 정의, 검증 규칙 등 마스터 데이터 메모리 캐싱
- Redis 도입 고려 (Phase 4)

---

### Frontend 최적화

**AG Grid 가상 스크롤링**
- 수만 개 행을 부드럽게 렌더링
- DOM 노드 최소화로 메모리 사용 절감

**React Query 캐싱**
- 서버 데이터 자동 캐싱 및 백그라운드 재검증
- Stale-While-Revalidate 전략

**코드 스플리팅**
- React.lazy + Suspense로 페이지별 lazy loading
- 초기 로딩 시간 40% 단축

**번들 최적화**
- Vite의 Rollup 기반 트리 쉐이킹
- Tailwind JIT로 CSS 크기 90% 감소

---

## 보안 고려사항

### Backend 보안

**CORS 설정**
- 허용된 origin만 접근 가능
- config.py에서 CORS_ORIGINS 환경 변수로 관리

**SQL Injection 방지**
- SQLAlchemy ORM 사용으로 자동 파라미터 바인딩
- 원시 SQL 쿼리 사용 금지

**입력 검증**
- Pydantic 스키마로 모든 요청 데이터 검증
- 타입 불일치, 범위 초과 자동 차단

**환경 변수 관리**
- SECRET_KEY, DATABASE_URL 등 민감 정보 환경 변수 분리
- .env 파일 .gitignore 처리

---

### Frontend 보안

**XSS 방지**
- React의 자동 이스케이핑
- dangerouslySetInnerHTML 사용 금지

**CSRF 방지**
- SameSite 쿠키 속성 설정 (Phase 4, JWT 도입 시)

**의존성 보안**
- npm audit로 취약점 정기 스캔
- Dependabot으로 자동 업데이트

---

## 확장성 및 유지보수성

### 아키텍처 패턴

**Backend: Clean Layered Architecture**
- Router → Service → Model 계층 분리
- 9개 서비스: project, backbone, recipe, validation, condition, change_log, comment, admin
- comment_service.py: 댓글 CRUD, 해결 상태 토글, 미해결 건수 조회
- validation_service.py: 조건부 검증과 다중 연산자 지원
- 각 계층의 명확한 책임
- 테스트 용이성 향상 (140건 테스트 케이스)

**Frontend: Atomic Design**
- Pages → Components (editor, layout, projects, admin, ui) 계층 구조
- editor 컴포넌트 18개: AG Grid, 승인 워크플로우, 댓글 시스템 포함
- 승인 관련 컴포넌트: StatusBanner, ReviewRequestModal, ApprovalButtons, StatusTimeline
- 댓글 관련 컴포넌트: CommentPanel, CommentThread, CommentDialog
- 재사용 가능한 컴포넌트 설계
- 확장 가능한 디자인 시스템

---

### 코드 품질 도구

**Backend**
- ruff: 린터 (Flake8 + isort 통합)
- black: 코드 포맷터
- mypy: 타입 체킹 (선택 사항)

**Frontend**
- ESLint: 린터
- Prettier: 코드 포맷터
- TypeScript: 정적 타입 검사

---

### 문서화

**API 문서**
- FastAPI 자동 생성 Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

**코드 문서**
- Python: Docstring (Google 스타일)
- TypeScript: JSDoc 주석

**프로젝트 문서**
- CLAUDE.md: Claude Code 작업 가이드
- .claude/docs/: PRD, DB 스키마, 와이어프레임
- .moai/project/: 제품 개요, 구조, 기술 스택

---

## 향후 기술 로드맵

### Phase 3 기술 추가 (일부 완료)

**승인 워크플로우 (SPEC-003 완료)**
- 상태 전환 검증 로직 (Draft → Review → Approved/Rejected)
- 댓글 CRUD API (Project/Layer/Cell 레벨)
- AG Grid cellClassRules + CSS ::after를 활용한 셀 댓글 마커
- onCellContextMenu 이벤트 기반 커스텀 컨텍스트 메뉴 (Community Edition 대응)

**WebSocket 도입 (예정)**
- 실시간 협업 기능 (다중 사용자 편집 충돌 해결)
- Socket.IO 또는 FastAPI WebSocket 활용

**파일 스토리지 (예정)**
- Recipe XML, 전산 출력 Excel 파일 저장
- AWS S3 또는 MinIO 도입

---

### Phase 4 기술 추가

**JWT 인증**
- 토큰 기반 인증/인가
- FastAPI-Users 또는 자체 구현

**Redis 캐싱**
- 마스터 데이터 캐싱
- 세션 관리

**Celery (비동기 작업)**
- 대용량 Excel 생성 비동기 처리
- 백그라운드 작업 큐

**Grafana + Prometheus**
- 성능 모니터링
- 메트릭 수집 및 시각화

---

## 개발 명령어 요약

### Docker Compose 명령어

```bash
# 전체 서비스 실행
docker-compose up -d

# 특정 서비스만 실행
docker-compose up backend

# 로그 확인
docker-compose logs -f backend

# 서비스 중지
docker-compose down

# 볼륨까지 삭제 (DB 초기화)
docker-compose down -v
```

---

### Backend 명령어

```bash
# Alembic 마이그레이션 생성
docker-compose exec backend alembic revision --autogenerate -m "description"

# Alembic 마이그레이션 적용
docker-compose exec backend alembic upgrade head

# 테스트 실행
docker-compose exec backend pytest

# 커버리지 측정
docker-compose exec backend pytest --cov=app --cov-report=html
```

---

### Frontend 명령어

```bash
# 개발 서버 실행
cd frontend
npm run dev

# 프로덕션 빌드
npm run build

# 테스트 실행
npm test

# 린팅
npm run lint

# 포맷팅
npm run format
```

---

생성일: 2026-02-16
문서 버전: 1.2.0 (SPEC-003 승인 프로세스 및 코멘트 시스템 반영)
작성자: MoAI-ADK Documentation Generator
마지막 업데이트: 2026-02-17 (SPEC-003 M1-M3: 승인 워크플로우, 댓글 시스템, AG Grid 통합)
