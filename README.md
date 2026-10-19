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
APP_DB_PORT=15432 INGEST_DB_PORT=15433 BACKEND_PORT=18000 FRONTEND_PORT=15173 \
  docker compose up --build
```

지원되는 변수와 기본값은 `APP_DB_PORT=5432`, `INGEST_DB_PORT=5433`,
`BACKEND_PORT=8000`, `FRONTEND_PORT=5173`입니다.

위 Compose 격리 포트와 backend test DB를 혼동하지 마십시오. Phase 2.6 검증에서 별도
`pcm-phase26-test-db` PostgreSQL은 `127.0.0.1:15442`를 사용하며, app/ingest Compose DB는
각각 `15432`/`15433`입니다.

## 현재 제품 흐름

- **제품 목록:** LINE을 먼저 선택하고 Process 또는 Part ID를 검색 버튼/Enter로 조회합니다.
  입력 중에는 검색하지 않습니다. 서버가 LINE + Process + Part ID별 최신 버전을 선택한 뒤
  25건씩 커서 페이지를 나눕니다. 최신은 최신 승인본을 뜻하지 않습니다.
- **공정조건 열기:** 목록의 `열기`는 `/projects/:projectId/sheet`로 바로 이동합니다.
  조건표·기본정보·이력 탭은 같은 제품 식별·버전·상태 문맥을 공유합니다. 탭 이동 중 조건표
  입력과 붙여넣기 상태를 유지하며, 기본정보 변경 등은 미저장 입력과 진행 중 저장을 확인하고
  편집 잠금을 넘깁니다. 잠금 해제나 최신 정보 재조회 실패 시 안내와 재시도를 제공합니다.
- **공정조건 등록:** Process 구조·백본 미리보기 후 Part ID와 필수 Device Type·Project Category를
  입력합니다. 별도 프로젝트명 입력은 없고, UI가 앞뒤 공백을 제거한 Part ID를 호환용 `name`으로
  전송합니다. 내부 Project 모델과 필수 `name` API/컬럼은 유지합니다. 기존 LINE/Process라도
  다른 Part ID로 등록할 수 있고, 같은 조합은 기존 HTTP 409 계약으로 차단합니다.
- **편집·검토:** 고정 1:1 Project Profile, managed ChoiceSet, 조건표 잠금/fencing,
  셀·규칙 검증, 변경 이력·백본 비교, 검토 요청·승인·반려·댓글 및 Revision 생성을 제공합니다.
  승인 시 파라미터 정의를 snapshot으로 보존하고, Revision은 새 Draft를 만들고 원본을 보관합니다.
- **자동 metadata 경계:** 생성 시 Profile 초기값을 한 번 복사합니다. 현재
  `ManualProjectMetadataProvider`는 외부 I/O가 없으며 조건표 셀은 수동 입력입니다.
  생성 후 Profile은 사용자가 명시적으로 편집합니다. Device Ref는 모델과 화면에 없습니다.
- **ChoiceSet:** `device_type`, `project_category`, `active_direction`, `gate_direction`을
  재사용합니다. 안정적인 option code와 관리 가능한 label/정렬을 분리합니다. 기존 비활성 code는
  읽을 수 있지만 신규 저장은 차단됩니다. 조건표 열은 옵션 배열 대신 `choice_set_code`와 version을 받습니다.

현재 흐름과 설계 범위는 [PRODUCT](./PRODUCT.md), [DESIGN](./DESIGN.md),
[LINE 중심 목록 안내](./docs/design/2026-10-16-pcm-line-first-brief.md)를 참고하세요.
구현 근거는 `frontend/src/features/projects/`, `backend/app/features/projects/`,
`backend/app/features/validation/`, `backend/app/features/approval/`입니다.

[Phase 2.6 QA](./docs/superpowers/evidence/2026-07-14-phase-2-6-browser-qa.md)는 당시 검증 기록입니다.
이후 [LINE 목록 검증](./docs/verification/issue87/README.md)은 격리된 PostgreSQL fixture의 실제 API,
[작업화면 검증](./docs/evidence/product-workspace-89/README.md)은 모의 API를 사용한 UI 증거입니다.
기록별 SHA·데이터·범위를 구분하며, 현재 배포 DB나 모든 후속 변경의 검증으로 해석하지 않습니다.
[모델 검토](./docs/design/data-model/README.md)의 ORM/마이그레이션 차이는 실제 DB에서 아직 확인하지 않았습니다.

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
- `GET /api/projects/lines`
- `GET /api/projects/{project_id}`
- `GET|PATCH /api/projects/{project_id}/profile`
- `GET /api/projects/{project_id}/sheet`
- `POST /api/projects/{project_id}/validate`
- `GET|POST /api/validation-rules`, `GET|PATCH /api/validation-rules/{code}`
- `POST /api/projects/{project_id}/transitions`, `POST /api/projects/{project_id}/revisions`
- `GET|POST /api/projects/{project_id}/comments`
- `PATCH|DELETE /api/projects/{project_id}/comments/{comment_id}`
- `GET /api/projects/{project_id}/events`
- `GET /api/projects/{project_id}/event-batches/{batch_id}`
- `GET /api/projects/{project_id}/cell-history`
- `GET /api/processes`, `GET /api/processes/{process_key}/layers`

Choice options are fetched through the ChoiceSet endpoints; SheetOut columns carry only
`choice_set_code` and `choice_set_version`, never embedded option arrays.

## CI 및 폐쇄망 메모

`.github/workflows/ci.yml`은 backend lint/typecheck/test와 frontend
typecheck/build/test를 실행합니다. Backend job의 `APP_TEST_DATABASE_URL`과
`APP_DATABASE_URL`은 모두 CI 전용 `pcm_test` PostgreSQL service를 가리킵니다.

- Python 의존성은 `backend/uv.lock`, Node 의존성은 `frontend/package-lock.json`으로 고정합니다.
- Docker 이미지와 GitHub Actions는 폐쇄망에서 내부 mirror가 필요합니다.
- 런타임 CDN·외부 폰트 요청은 사용하지 않습니다. 앱과 같은 출처의 로컬 폰트 배포 방식과 비용은
  [DESIGN의 Typography](./DESIGN.md#typography)를 참고하세요.
