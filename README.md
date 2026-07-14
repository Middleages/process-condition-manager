# PCM (Process Condition Manager)

반도체 공정 조건표를 웹에서 관리하는 FastAPI/React 애플리케이션입니다. 앱 DB는
Alembic이 소유하고, ingest DB는 외부 적재 데이터의 읽기 전용 경계입니다. 현재 스키마는
Project Profile과 재사용 가능한 managed ChoiceSet을 사용합니다.

## 사전 요구사항

- Docker와 Docker Compose
- 로컬 도구 실행 시 Python 3.13+, `uv`, Node.js 20+

## Docker Compose 개발 실행

```bash
docker compose up --build
```

기본 포트:

- Frontend: <http://localhost:5173>
- Backend / health: <http://localhost:8000>, <http://localhost:8000/health>
- App PostgreSQL: `localhost:5432`
- Ingest PostgreSQL: `localhost:5433`

backend는 시작할 때 `alembic upgrade head`를 먼저 실행합니다. Phase 2.6의 `0004`는
**reset-only 전환**입니다. `0003`의 mutable 테이블 9개 중 하나라도 데이터가 있으면 첫
DDL 전에 의도적으로 실패합니다. 승인되지 않은 legacy backfill이나 자동 삭제는 없습니다.

### 기존 개발 app DB를 명시적으로 재설정

아래 스크립트는 확인 인자가 없으면 실행되지 않으며, Compose label로 검증된
`app-db-data` 볼륨만 제거합니다. ingest DB와 frontend node_modules 볼륨은 중지하거나
삭제하지 않습니다.

```bash
./backend/scripts/reset_dev_app_db.sh --confirm-disposable
# backend startup also applies the migration; this makes the sequence explicit:
docker compose exec backend alembic upgrade head
docker compose exec backend python -m scripts.seed_dev
curl --fail http://localhost:8000/health
```

일반 중지는 `docker compose down`을 사용합니다. 이 schema 전환을 위해
`docker compose down -v`를 사용하지 마십시오. 그 명령은 app DB 외의 볼륨까지 삭제합니다.

### 격리된 QA Compose 실행

기본 개발 볼륨과 포트를 재사용하지 않도록 **고유 project name과 포트 override를 함께**
사용합니다.

```bash
COMPOSE_PROJECT_NAME=pcm-phase26-qa \
APP_DB_PORT=15442 INGEST_DB_PORT=15443 BACKEND_PORT=18000 FRONTEND_PORT=15173 \
  docker compose up --build
```

지원되는 변수와 기본값은 `APP_DB_PORT=5432`, `INGEST_DB_PORT=5433`,
`BACKEND_PORT=8000`, `FRONTEND_PORT=5173`입니다.

## Backend 개발 및 검증

```bash
cd backend
uv sync --frozen
uv run ruff check .
uv run pyright
APP_TEST_DATABASE_URL=postgresql+asyncpg://pcm_user:pcm_pass@localhost:15442/pcm_test \
APP_DATABASE_URL=postgresql+asyncpg://pcm_user:pcm_pass@localhost:15442/pcm_test \
  uv run pytest
uv run python -m scripts.measure_sheet_perf
```

PostgreSQL migration/seed 테스트는 `APP_TEST_DATABASE_URL`에서 서버 자격 증명만 가져와
`pcm_phase26_test_<uuid>` DB를 만들고 종료 시 connection을 끊은 뒤 해당 DB만 삭제합니다.
설정된 `pcm_test` DB 자체를 downgrade/reset하지 않습니다.

일반 로컬 DB 준비:

```bash
cd backend
uv run alembic upgrade head
uv run python -m scripts.seed_dev
uv run uvicorn app.main:app --reload
```

## Frontend 개발

```bash
cd frontend
npm ci
npm run typecheck
npm run build
npm test
npm run dev
```

## API 경로

health만 root에 유지되고 기능 API는 `/api` 아래에 있습니다.

- `GET /health`
- `GET|POST /api/choice-sets`
- `GET|PATCH /api/choice-sets/{set_code}`
- `GET|POST /api/choice-sets/{set_code}/options`
- `PATCH /api/choice-sets/{set_code}/options/{option_code}`
- `PUT /api/choice-sets/{set_code}/option-order`
- `POST /api/choice-sets/{set_code}/import/preview`
- `POST /api/choice-sets/{set_code}/import`
- `GET|POST /api/parameters`
- `GET|PATCH /api/parameters/{parameter_id}`
- `POST /api/parameters/{parameter_id}/deactivate`
- `GET|POST /api/parameters/categories`
- `GET|POST /api/projects`
- `GET /api/projects/{project_id}`
- `GET|PATCH /api/projects/{project_id}/profile`
- `GET /api/projects/{project_id}/sheet`
- `GET /api/processes`, `GET /api/processes/{process_key}/layers`

Choice options are fetched through the ChoiceSet endpoints; SheetOut columns carry only
`choice_set_code` and `choice_set_version`, never embedded option arrays.

## CI 및 폐쇄망 메모

`.github/workflows/ci.yml`은 backend lint/typecheck/test와 frontend
typecheck/build/test를 실행합니다. Backend job의 `APP_TEST_DATABASE_URL`과
`APP_DATABASE_URL`은 모두 CI 전용 `pcm_test` PostgreSQL service를 가리킵니다.

- Python 의존성은 `backend/uv.lock`, Node 의존성은 `frontend/package-lock.json`으로 고정합니다.
- Docker 이미지와 GitHub Actions는 폐쇄망에서 내부 mirror가 필요합니다.
- CDN 자산은 사용하지 않습니다.
