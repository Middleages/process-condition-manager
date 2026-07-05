# PCM (Process Condition Manager)

반도체 Photo 공정 조건표를 웹 기반으로 관리하기 위한 재구축 프로젝트입니다. 현재 레포는 **Phase 0 — 리셋 + 기반** 상태이며, 핵심 목표는 이후 Phase가 의존할 백엔드/프론트 골격, 파라미터 레지스트리, 적재 판독기, 인증 경계, 로컬/CI 실행 경로를 고정하는 것입니다.

## Phase 0 범위

- FastAPI 백엔드 골격
- 앱 DB와 적재 DB의 분리된 커넥션 경계
- 파라미터/카테고리/선택지 레지스트리 CRUD API
- fixture 기반 ingest reader 계약 및 process/layer 조회 API
- 인증 어댑터 경계와 개발용 admin 스텁
- React/TypeScript 프론트 골격
- 파라미터 관리 화면과 process/layer 확인 화면
- Docker Compose 기반 로컬 실행
- PR CI: backend lint/typecheck/test, frontend typecheck/build/test

## 로컬 실행

### 사전 요구사항

- Docker와 Docker Compose
- 또는 로컬 개발용 Python 3.13+, uv, Node.js 20+

### Docker Compose 원커맨드 실행

```bash
docker compose up --build
```

서비스 포트:

- Frontend: <http://localhost:5173>
- Backend: <http://localhost:8000>
- Backend health: <http://localhost:8000/health>
- App PostgreSQL: `localhost:5432`
- Fixture/Ingest PostgreSQL: `localhost:5433`

Compose는 앱 DB와 적재 DB를 별도 PostgreSQL 컨테이너로 띄웁니다. backend 컨테이너는 시작 시 `alembic upgrade head`를 실행한 뒤 FastAPI 개발 서버를 실행합니다.

### Compose 중지

```bash
docker compose down
```

볼륨까지 삭제하려면 다음 명령을 사용합니다.

```bash
docker compose down -v
```

## Backend 개발 명령

```bash
cd backend
uv sync --frozen
uv run ruff check .
uv run pyright
uv run pytest
uv run alembic upgrade head
uv run uvicorn app.main:app --reload
```

## Frontend 개발 명령

```bash
cd frontend
npm ci
npm run typecheck
npm run build
npm test
npm run dev
```

## API 경로

현재 Phase 0 백엔드는 API prefix 없이 다음 경로를 노출합니다.

- `GET /health`
- `GET /parameters`
- `POST /parameters`
- `PATCH /parameters/{parameter_id}`
- `POST /parameters/{parameter_id}/deactivate`
- `PUT /parameters/{parameter_id}/options`
- `GET /parameters/categories`
- `POST /parameters/categories`
- `PATCH /parameters/categories/{category_id}`
- `GET /processes`
- `GET /processes/{process_key}/layers`

Vite 개발 서버는 `/parameters`, `/processes`, `/api` 요청을 backend 컨테이너로 프록시합니다.

## CI

GitHub Actions workflow는 `.github/workflows/ci.yml`에 있습니다.

Backend job:

```bash
cd backend
uv run ruff check .
uv run pyright
uv run pytest
```

Frontend job:

```bash
cd frontend
npm run typecheck
npm run build
npm test
```

현재 환경의 npm registry 정책상 신규 패키지 추가가 제한될 수 있어, frontend lint script는 별도 ESLint/Biome 패키지를 추가하지 않고 TypeScript strict typecheck를 실행합니다. ESLint 또는 Biome은 사내 미러/허용 패키지 정책이 확정되면 T7 후속 보강으로 추가합니다.

## 폐쇄망/사내망 운영 메모

- Python 의존성은 `backend/uv.lock`을 기준으로 고정합니다.
- Node 의존성은 `frontend/package-lock.json`을 기준으로 `npm ci`를 사용합니다.
- Docker 이미지(`python:3.13-slim`, `node:20-alpine`, `postgres:16-alpine`, `ghcr.io/astral-sh/uv`)는 사내 registry에 미러링해야 합니다.
- GitHub Actions marketplace action(`actions/checkout`, `actions/setup-python`, `actions/setup-node`, `astral-sh/setup-uv`)도 폐쇄망 CI에서는 내부 action mirror 또는 사전 번들 runner 이미지로 대체해야 합니다.
- CDN 로딩은 사용하지 않습니다. 프론트 자산은 Vite build 결과물로 자체 호스팅합니다.
