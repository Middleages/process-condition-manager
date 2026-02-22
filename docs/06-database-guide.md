# 데이터베이스 가이드

Process Condition Manager의 PostgreSQL 데이터베이스와 Alembic 마이그레이션 실용 가이드입니다.

## 1. DB 접속 방법

### 1.1 Docker 컨테이너 내 psql로 직접 접속

가장 간단한 방법입니다. Docker 환경에서 실행 중일 때 사용하세요.

```bash
# PostgreSQL 컨테이너에 직접 접속
docker-compose exec db psql -U pcm_user -d pcm

# 도움말 보기
\?

# 테이블 목록 조회
\dt

# 특정 테이블 구조 보기
\d projects

# 종료
\q
```

접속 정보:
- 호스트: `db` (또는 `localhost`)
- 포트: `5432`
- 데이터베이스: `pcm`
- 사용자: `pcm_user`
- 비밀번호: `pcm_pass` (`.env` 파일에서 설정 가능)

### 1.2 DBeaver로 접속 (GUI, 추천)

DBeaver는 무료 데이터베이스 관리 도구로, SQL 편집 및 데이터 탐색이 편합니다.

설정 단계:

1. DBeaver 설치 (https://dbeaver.io/)
2. 새 데이터베이스 연결 생성
3. PostgreSQL 선택
4. 다음 정보 입력:
   - 호스트: `localhost`
   - 포트: `5432`
   - 데이터베이스: `pcm`
   - 사용자명: `pcm_user`
   - 비밀번호: `pcm_pass`
5. Test Connection 클릭으로 연결 확인
6. Finish 클릭

**Docker 환경 주의:**
Docker Compose로 실행 중이면, 호스트를 `localhost` 또는 Docker 호스트 IP로 설정하세요.

### 1.3 pgAdmin으로 접속 (웹 기반)

pgAdmin은 웹 기반 PostgreSQL 관리 도구입니다. Docker에 추가하려면:

```yaml
# docker-compose.yml에 다음 서비스 추가
pgadmin:
  image: dpage/pgadmin4:latest
  environment:
    PGADMIN_DEFAULT_EMAIL: admin@example.com
    PGADMIN_DEFAULT_PASSWORD: admin
  ports:
    - "5050:80"
  depends_on:
    - db
```

그 후 `http://localhost:5050`에 접속하고, 위의 메일/비밀번호로 로그인합니다.

### 1.4 Python 스크립트로 접속

FastAPI 백엔드의 데이터베이스 연결을 이용합니다.

```python
# 동기 엔진으로 직접 접속
from sqlalchemy import create_engine, text
from app.config import settings

engine = create_engine(settings.DATABASE_URL_SYNC)
with engine.connect() as conn:
    result = conn.execute(text("SELECT count(*) FROM projects"))
    print(result.scalar())
```

## 2. 테이블 구조 개요

### 2.1 전체 테이블 관계도 (ASCII ERD)

```
┌─────────────────┐
│    users        │
├─────────────────┤
│ id (PK)         │
│ username        │
│ display_name    │
│ role            │
│ password_hash   │
│ is_active       │
└────────┬────────┘
         │
         │ created_by
         │ reviewed_by
         │ changed_by
         │
    ┌────▼──────────────┐
    │    projects       │
    ├───────────────────┤
    │ id (PK)           │
    │ product_id (FK)   │
    │ main_backbone_id  │
    │ status            │
    │ revision          │
    │ parent_project_id │
    │ is_latest         │
    │ created_by (FK)   │
    │ reviewed_by (FK)  │
    │ created_at        │
    │ updated_at        │
    │ approved_at       │
    │ revision_reason   │
    └────┬──────────────┘
         │
         ├─────────────────────────────┐
         │                             │
    ┌────▼──────────────────┐  ┌──────▼────────────┐
    │  project_layers       │  │  change_logs      │
    ├───────────────────────┤  ├───────────────────┤
    │ id (PK)               │  │ id (PK)           │
    │ project_id (FK)       │  │ project_layer_id  │
    │ layer_id (FK)         │  │ column_name       │
    │ conditions (JSONB)    │  │ old_value         │
    │ backbone_conditions   │  │ new_value         │
    │ sort_order            │  │ change_type       │
    │ created_at            │  │ changed_by (FK)   │
    │ updated_at            │  │ changed_at        │
    └───────────────────────┘  └───────────────────┘
         │
    ┌────▼──────────────────┐
    │    layers            │
    ├──────────────────────┤
    │ id (PK)              │
    │ product_id (FK)      │
    │ layer_name           │
    │ layer_position       │
    │ sort_order           │
    └──────────────────────┘

┌────────────────────┐
│   products         │
├────────────────────┤
│ id (PK)            │
│ line_id (FK)       │
│ product_name       │
│ product_code       │
│ version            │
├────────────────────┤
│   lines            │
├────────────────────┤
│ id (PK)            │
│ line_name          │
│ line_code          │
└────────────────────┘

┌──────────────────────────┐
│  column_definitions      │
├──────────────────────────┤
│ id (PK)                  │
│ column_name              │
│ display_name             │
│ category_id (FK)         │
│ data_type                │
│ select_options (JSONB)   │
│ is_required              │
└──────────────────────────┘

┌──────────────────────┐
│  column_validations  │
├──────────────────────┤
│ id (PK)              │
│ column_id (FK)       │
│ rule_type            │
│ rule_config (JSONB)  │
│ error_message        │
└──────────────────────┘

┌──────────────────────┐
│  export_systems      │
├──────────────────────┤
│ id (PK)              │
│ system_code          │
│ system_name          │
│ export_type          │
└──────────────────────┘

┌───────────────────────────────┐
│  export_column_mappings       │
├───────────────────────────────┤
│ id (PK)                       │
│ export_system_id (FK)         │
│ column_id (FK)                │
│ export_column_name            │
│ export_column_position        │
└───────────────────────────────┘
```

### 2.2 핵심 테이블 설명

**projects**: 신규 조건표 작업 단위. 한 제품의 한 버전을 나타냅니다.
- `status`: 상태 (draft → review → approved / rejected / archived)
- `revision`: 버전 번호. 개정 시 증가
- `parent_project_id`: 개정 전 프로젝트 참조 (개정만 사용)
- `is_latest`: 가장 최신 버전인지 여부

**project_layers**: 프로젝트 내 각 레이어의 데이터.
- `conditions`: JSONB로 현재 편집 중인 조건 데이터
- `backbone_conditions`: JSONB로 원본 backbone 데이터 저장

**change_logs**: 셀 단위 변경 이력.
- `change_type`: manual(사용자), backbone(backbone 교체), recipe(Recipe XML 반영)

**column_definitions**: 조건표 컬럼 메타데이터.
- `column_name`: 컬럼 코드명 (SP_001 등)
- `display_name`: 화면에 표시될 이름
- `data_type`: 데이터 타입 (text, number, select 등)
- `is_required`: 필수 입력 여부

**export_systems**: 전산 출력 시스템 설정 (TypeA, TypeB, TypeC 등).

## 3. JSONB 구조

PCM에서는 조건 데이터를 `JSONB` 형식으로 저장합니다. 이는 검색과 필터링이 빠르고 유연한 스키마를 지원합니다.

### 3.1 conditions 필드 구조

```json
{
  "SP_001": "12.5",
  "SP_002": "100",
  "SC_001": "N2",
  "SC_002": "ON",
  "OVL_001": "0.5",
  "OVL_REF_LAYER": "Layer_1",
  "DEV_001": "Yes",
  "DEV_002": ""
}
```

구조:
- 키: 컬럼 이름 (예: SP_001)
- 값: 문자열 형태의 입력값

특수 컬럼:
- `OVL_REF_LAYER`: Overlay 검증을 위한 참조 레이어 지정

### 3.2 backbone_conditions 필드 구조

원본 backbone 제품에서 복사한 조건 데이터. 같은 형식으로 저장됩니다.

### 3.3 select_options 필드 구조 (column_definitions)

```json
[
  "Option1",
  "Option2",
  "Option3"
]
```

또는 키-값 형식:

```json
{
  "key1": "Display Name 1",
  "key2": "Display Name 2"
}
```

### 3.4 rule_config 필드 구조 (column_validations)

```json
{
  "min": 0,
  "max": 100,
  "pattern": "^[0-9]+$"
}
```

또는 reference 검증:

```json
{
  "type": "reference_exists",
  "table": "products",
  "column": "product_code"
}
```

## 4. Alembic 마이그레이션 사용법

Alembic은 데이터베이스 스키마 버전 관리 도구입니다.

### 4.1 현재 마이그레이션 상태 확인

```bash
# 현재 DB 버전 확인
docker-compose exec backend alembic current

# 마이그레이션 히스토리 확인
docker-compose exec backend alembic history

# 마이그레이션 상태 상세 조회
docker-compose exec backend alembic history --verbose
```

예상 출력:
```
001_initial_schema (초기 스키마)
002_add_lines_and_product_fields (라인, 제품 필드 추가)
003_add_revision_fields (개정 기능 필드)
...
012_extend_export_column_mappings (최신)
```

### 4.2 새 마이그레이션 생성 (자동 감지 - autogenerate)

모델 파일을 수정하면 Alembic이 변경사항을 자동으로 감지해서 마이그레이션 파일을 생성합니다.

```bash
# 모델 수정 후 마이그레이션 생성
docker-compose exec backend alembic revision --autogenerate -m "description"

# 예: User 모델에 phone_number 필드 추가
# 1. backend/app/models/user.py 수정
# 2. 다음 명령어 실행
docker-compose exec backend alembic revision --autogenerate -m "add phone_number to users"

# 생성된 파일을 확인합니다
ls backend/alembic/versions/
```

생성된 마이그레이션 파일을 **반드시 검토**하세요. 때로 자동 감지가 완벽하지 않을 수 있습니다.

### 4.3 마이그레이션 적용 (upgrade)

데이터베이스 스키마를 최신 상태로 업그레이드합니다.

```bash
# 최신 버전으로 업그레이드
docker-compose exec backend alembic upgrade head

# 특정 버전으로 업그레이드
docker-compose exec backend alembic upgrade 012_extend_export_column_mappings

# 한 단계씩 업그레이드
docker-compose exec backend alembic upgrade +1
```

적용 후 백엔드가 자동으로 스키마를 인식합니다. 필요시 백엔드를 재시작하세요.

```bash
docker-compose restart backend
```

### 4.4 마이그레이션 롤백 (downgrade)

이전 버전으로 롤백합니다. **주의: 데이터 손실 가능**

```bash
# 한 단계 이전으로 롤백
docker-compose exec backend alembic downgrade -1

# 특정 버전으로 롤백
docker-compose exec backend alembic downgrade 011_add_export_data_sources_table

# 초기 상태로 롤백 (모든 테이블 삭제)
docker-compose exec backend alembic downgrade base
```

### 4.5 마이그레이션 파일 수동 편집

자동 감지가 제대로 작동하지 않을 때, 마이그레이션 파일을 수동으로 편집합니다.

마이그레이션 파일 예시:
```python
def upgrade() -> None:
    # 새 컬럼 추가
    op.add_column('users', sa.Column('phone_number', sa.String(20), nullable=True))

def downgrade() -> None:
    # 컬럼 제거
    op.drop_column('users', 'phone_number')
```

자주 사용하는 작업:

```python
# 테이블 생성
op.create_table(
    'new_table',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(100), nullable=False),
    sa.PrimaryKeyConstraint('id')
)

# 테이블 삭제
op.drop_table('old_table')

# 컬럼 추가
op.add_column('users', sa.Column('email', sa.String(255)))

# 컬럼 제거
op.drop_column('users', 'email')

# 컬럼 수정 (타입 변경)
op.alter_column('users', 'username', type_=sa.String(100))

# NOT NULL 제약 추가/제거
op.alter_column('users', 'email', nullable=False)
op.alter_column('users', 'email', nullable=True)

# 인덱스 생성
op.create_index('idx_username', 'users', ['username'])

# 인덱스 삭제
op.drop_index('idx_username', table_name='users')

# 외래키 추가
op.create_foreign_key('fk_user_project', 'projects', 'users', ['created_by'], ['id'])

# 외래키 삭제
op.drop_constraint('fk_user_project', 'projects', type_='foreignkey')
```

## 5. 마이그레이션 문제 해결

### 5.1 마이그레이션 head 불일치 오류

오류 메시지:
```
sqlalchemy.exc.ProgrammingError:
(psycopg2.ProgrammingError) relation "alembic_version" does not exist
```

원인: 데이터베이스가 초기화되었거나 마이그레이션 테이블이 없음.

해결:
```bash
# 모든 마이그레이션을 다시 적용
docker-compose exec backend alembic upgrade head
```

### 5.2 마이그레이션 충돌 (Conflict)

오류 메시지:
```
Multiple bases found
```

원인: 두 개 이상의 마이그레이션이 base로 설정되어 있음.

해결:
```bash
# 마이그레이션 파일 확인
ls backend/alembic/versions/

# 파일의 depends_on 확인 및 수정
# 각 파일은 정확히 하나의 이전 버전을 depend해야 함
```

### 5.3 마이그레이션 자동 감지 실패

자동 감지가 모든 변경사항을 감지하지 못할 수 있습니다.

자동 감지 불가능한 경우:
- 컬럼 이름 변경
- 테이블 이름 변경
- 제약 조건 변경
- 기본값 변경
- 타입 변경 (특수한 경우)

해결:
```bash
# 빈 마이그레이션 파일 생성 후 수동 편집
docker-compose exec backend alembic revision -m "description"

# 생성된 파일을 편집
vim backend/alembic/versions/XXX_description.py
```

## 6. 시드 데이터

시드는 개발/테스트용 초기 데이터입니다.

### 6.1 시드 실행

```bash
# 백엔드 컨테이너 진입
docker-compose exec backend bash

# 시드 실행
python -m app.seed

# 또는
python -m app.seed.runner
```

출력 예시:
```
Seeding database...
  Categories: 4
  Column Definitions: 67
  Validation Rules: 15
  Users: 5
  Lines: 2
  Products: 8
  Project Layers: 20
  ...
Done!
```

### 6.2 시드 모듈 구조

```
backend/app/seed/
├── __init__.py          # 모든 시드 모듈 임포트
├── __main__.py          # python -m app.seed 진입점
├── runner.py            # 메인 seed() 함수
├── users.py             # 사용자 데이터
├── columns.py           # 컬럼 정의, 검증 규칙, 카테고리
├── layers.py            # 레이어 데이터
├── products.py          # 제품, 라인 데이터
├── exports.py           # 전산 출력 시스템, 매핑 데이터
└── external_data_sources.py  # 외부 데이터 소스
```

### 6.3 시드 내용 확인

각 모듈의 코드를 열어서 어떤 데이터가 들어가는지 확인하세요.

- `users.py`: 기본 사용자 5명 (admin, reviewer, editor 등)
- `products.py`: 테스트용 제품과 라인 정보
- `columns.py`: 조건표 컬럼 ~67개, 검증 규칙
- `layers.py`: 각 제품별 레이어 정보
- `exports.py`: 전산 출력 시스템 (TypeA, TypeB, TypeC)

### 6.4 데이터 리셋

모든 데이터를 초기화하고 다시 시드합니다.

```bash
# 방법 1: 마이그레이션 롤백 후 재적용
docker-compose exec backend alembic downgrade base
docker-compose exec backend alembic upgrade head
docker-compose exec backend python -m app.seed

# 방법 2: 데이터베이스 재생성
docker-compose down -v  # 볼륨 포함 삭제
docker-compose up -d    # 재시작
# 자동으로 마이그레이션과 시드 실행됨

# 방법 3: PostgreSQL에서 직접 초기화
docker-compose exec db psql -U pcm_user -d pcm -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
docker-compose exec backend alembic upgrade head
docker-compose exec backend python -m app.seed
```

**주의**: 프로덕션 환경에서는 절대 하지 마세요!

## 7. 자주 쓰는 SQL 쿼리

### 7.1 프로젝트 조회

```sql
-- 모든 프로젝트와 상태 조회
SELECT
    p.id,
    p.status,
    p.revision,
    prod.product_name,
    u.username,
    p.created_at
FROM projects p
JOIN products prod ON p.product_id = prod.id
JOIN users u ON p.created_by = u.id
ORDER BY p.created_at DESC;

-- 특정 제품의 모든 버전 조회
SELECT * FROM projects
WHERE product_id = 1
ORDER BY revision DESC;

-- 가장 최신 프로젝트만 조회
SELECT * FROM projects
WHERE is_latest = true
ORDER BY created_at DESC;

-- Draft 상태 프로젝트 조회
SELECT * FROM projects
WHERE status = 'draft';

-- Review 대기 프로젝트
SELECT * FROM projects
WHERE status = 'review';

-- Approved 프로젝트
SELECT * FROM projects
WHERE status = 'approved'
ORDER BY approved_at DESC;
```

### 7.2 조건 데이터 확인

```sql
-- 특정 프로젝트의 모든 조건 데이터 조회
SELECT
    pl.id,
    l.layer_name,
    pl.conditions
FROM project_layers pl
JOIN layers l ON pl.layer_id = l.id
WHERE pl.project_id = 1
ORDER BY l.layer_position;

-- 특정 컬럼의 변경 이력 조회
SELECT
    cl.id,
    l.layer_name,
    cl.column_name,
    cl.old_value,
    cl.new_value,
    cl.change_type,
    u.username,
    cl.changed_at
FROM change_logs cl
JOIN project_layers pl ON cl.project_layer_id = pl.id
JOIN layers l ON pl.layer_id = l.id
JOIN users u ON cl.changed_by = u.id
WHERE pl.project_id = 1 AND cl.column_name = 'SP_001'
ORDER BY cl.changed_at DESC;

-- 특정 레이어의 모든 변경 조회
SELECT
    cl.column_name,
    cl.change_type,
    cl.old_value,
    cl.new_value,
    u.username,
    cl.changed_at
FROM change_logs cl
JOIN project_layers pl ON cl.project_layer_id = pl.id
JOIN users u ON cl.changed_by = u.id
WHERE pl.id = 5
ORDER BY cl.changed_at DESC;

-- JSONB 필드에서 특정 키 조회
SELECT
    pl.id,
    l.layer_name,
    pl.conditions->>'SP_001' as SP_001_value
FROM project_layers pl
JOIN layers l ON pl.layer_id = l.id
WHERE pl.project_id = 1;

-- JSONB 필드에서 조건 검색 (null이 아닌 값)
SELECT
    pl.id,
    l.layer_name
FROM project_layers pl
JOIN layers l ON pl.layer_id = l.id
WHERE pl.project_id = 1
  AND (pl.conditions->>'OVL_REF_LAYER') IS NOT NULL;
```

### 7.3 사용자 관리

```sql
-- 모든 사용자 조회
SELECT
    id,
    username,
    display_name,
    role,
    is_active,
    created_at
FROM users
ORDER BY created_at DESC;

-- 특정 역할의 사용자 조회
SELECT * FROM users WHERE role = 'admin';
SELECT * FROM users WHERE role = 'reviewer';
SELECT * FROM users WHERE role = 'editor';

-- 비활성 사용자
SELECT * FROM users WHERE is_active = false;

-- 사용자가 생성한 프로젝트 수
SELECT
    u.username,
    COUNT(p.id) as project_count
FROM users u
LEFT JOIN projects p ON u.id = p.created_by
GROUP BY u.id, u.username
ORDER BY project_count DESC;

-- 사용자의 검토 이력
SELECT
    u.username,
    p.id as project_id,
    p.revision,
    psl.from_status,
    psl.to_status,
    psl.changed_at
FROM users u
JOIN project_status_logs psl ON u.id = psl.changed_by
JOIN projects p ON psl.project_id = p.id
WHERE u.id = 2
ORDER BY psl.changed_at DESC;
```

### 7.4 검증 규칙 조회

```sql
-- 모든 검증 규칙 조회
SELECT
    cd.column_name,
    cd.display_name,
    cv.rule_type,
    cv.rule_config,
    cv.error_message
FROM column_validations cv
JOIN column_definitions cd ON cv.column_id = cd.id
ORDER BY cd.column_name;

-- 특정 컬럼의 검증 규칙
SELECT
    rule_type,
    rule_config,
    error_message
FROM column_validations
WHERE column_id = (
    SELECT id FROM column_definitions
    WHERE column_name = 'SP_001'
);

-- Required 컬럼 조회
SELECT
    id,
    column_name,
    display_name,
    data_type
FROM column_definitions
WHERE is_required = true
ORDER BY column_name;
```

### 7.5 전산 출력 관련

```sql
-- 전산 출력 시스템 조회
SELECT
    id,
    system_code,
    system_name,
    export_type
FROM export_systems;

-- 특정 시스템의 컬럼 매핑 조회
SELECT
    ecm.id,
    cd.column_name,
    cd.display_name,
    ecm.export_column_name,
    ecm.export_column_position
FROM export_column_mappings ecm
JOIN column_definitions cd ON ecm.column_id = cd.id
WHERE ecm.export_system_id = 1
ORDER BY ecm.export_column_position;

-- 출력 이력 조회
SELECT
    eh.id,
    p.id as project_id,
    es.system_name,
    u.username,
    eh.export_status,
    eh.created_at
FROM export_histories eh
JOIN projects p ON eh.project_id = p.id
JOIN export_systems es ON eh.export_system_id = es.id
JOIN users u ON eh.exported_by = u.id
ORDER BY eh.created_at DESC
LIMIT 20;

-- 프로젝트별 출력 이력
SELECT
    es.system_name,
    eh.export_status,
    eh.exported_by,
    eh.created_at
FROM export_histories eh
JOIN export_systems es ON eh.export_system_id = es.id
WHERE eh.project_id = 1
ORDER BY eh.created_at DESC;
```

### 7.6 통계 조회

```sql
-- 상태별 프로젝트 수
SELECT
    status,
    COUNT(*) as count
FROM projects
WHERE is_latest = true
GROUP BY status
ORDER BY count DESC;

-- 월별 프로젝트 생성 수
SELECT
    DATE_TRUNC('month', created_at) as month,
    COUNT(*) as count
FROM projects
WHERE is_latest = true
GROUP BY DATE_TRUNC('month', created_at)
ORDER BY month DESC;

-- 사용자별 변경 건수
SELECT
    u.username,
    COUNT(cl.id) as change_count
FROM users u
LEFT JOIN change_logs cl ON u.id = cl.changed_by
GROUP BY u.id, u.username
ORDER BY change_count DESC;

-- 가장 많이 변경된 컬럼
SELECT
    column_name,
    COUNT(*) as change_count
FROM change_logs
GROUP BY column_name
ORDER BY change_count DESC
LIMIT 10;
```

## 8. 백업 및 복원

### 8.1 데이터베이스 백업

```bash
# PostgreSQL 전체 백업 (SQL 포맷)
docker-compose exec db pg_dump -U pcm_user -d pcm > backup.sql

# PostgreSQL 전체 백업 (Binary 포맷, 더 빠름)
docker-compose exec db pg_dump -U pcm_user -d pcm -Fc > backup.dump

# 특정 테이블만 백업
docker-compose exec db pg_dump -U pcm_user -d pcm -t projects > projects_backup.sql

# 압축된 백업
docker-compose exec db pg_dump -U pcm_user -d pcm | gzip > backup.sql.gz
```

### 8.2 데이터베이스 복원

```bash
# SQL 파일에서 복원
docker-compose exec -T db psql -U pcm_user -d pcm < backup.sql

# Binary 포맷에서 복원
docker-compose exec db pg_restore -U pcm_user -d pcm backup.dump

# 압축된 파일에서 복원
gunzip -c backup.sql.gz | docker-compose exec -T db psql -U pcm_user -d pcm
```

**주의:** 복원 전에 백업합니다!

```bash
# 안전한 복원 프로세스
# 1. 현재 DB 백업
docker-compose exec db pg_dump -U pcm_user -d pcm -Fc > current_backup.dump

# 2. 기존 DB 초기화
docker-compose exec db psql -U pcm_user -d pcm -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

# 3. 복원
docker-compose exec db pg_restore -U pcm_user -d pcm old_backup.dump

# 4. 마이그레이션 확인
docker-compose exec backend alembic current
```

### 8.3 데이터만 내보내기 (CSV)

```bash
# projects 테이블을 CSV로 내보내기
docker-compose exec db psql -U pcm_user -d pcm \
  -c "COPY (SELECT * FROM projects) TO STDOUT WITH CSV HEADER" > projects.csv

# 다중 테이블 내보내기
docker-compose exec db psql -U pcm_user -d pcm << EOF
\COPY projects TO 'projects.csv' WITH CSV HEADER
\COPY project_layers TO 'project_layers.csv' WITH CSV HEADER
\COPY change_logs TO 'change_logs.csv' WITH CSV HEADER
EOF
```

### 8.4 정기 백업 스크립트

`backup.sh`를 생성하여 자동화합니다:

```bash
#!/bin/bash

# 날짜 포맷
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="./backups"

# 백업 디렉토리 생성
mkdir -p $BACKUP_DIR

# 데이터베이스 백업
echo "Backing up database..."
docker-compose exec db pg_dump -U pcm_user -d pcm -Fc > $BACKUP_DIR/pcm_$DATE.dump

# 압축 (선택)
gzip $BACKUP_DIR/pcm_$DATE.dump

echo "Backup completed: $BACKUP_DIR/pcm_$DATE.dump.gz"

# 7일 이상 된 백업 삭제 (선택)
find $BACKUP_DIR -name "*.dump.gz" -mtime +7 -delete
```

실행:
```bash
chmod +x backup.sh
./backup.sh
```

Cron으로 정기 백업:
```bash
# 매일 밤 2시에 백업
0 2 * * * /path/to/backup.sh >> /var/log/pcm_backup.log 2>&1
```

## 요약

- **접속**: Docker psql, DBeaver, pgAdmin, Python 중 선택
- **마이그레이션**: `alembic revision --autogenerate`, `upgrade head`, `downgrade` 순환
- **시드**: `python -m app.seed`로 초기 데이터 투입
- **쿼리**: SQL로 프로젝트, 조건, 사용자 조회
- **백업**: pg_dump로 정기 백업, 복원 시 스키마 초기화 후 복원

문제 발생 시 Docker 로그 확인:
```bash
docker-compose logs -f db      # DB 로그
docker-compose logs -f backend # 백엔드 로그
```
