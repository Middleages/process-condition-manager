# 백엔드 수정 가이드

Process Condition Manager의 백엔드(FastAPI/Python)를 수정하고 유지보수하는 방법을 설명합니다.

## 개발 환경 설정

백엔드 개발을 시작하기 전에 필요한 명령어들입니다.

### 설치 및 실행

```bash
# 1. 백엔드 디렉토리로 이동
cd /home/appuser/process-condition-manager/backend

# 2. Python 가상환경 생성 (선택사항)
python3 -m venv venv
source venv/bin/activate  # Linux/Mac
# or venv\Scripts\activate  # Windows

# 3. 의존성 설치
pip install -r requirements.txt

# 4. 개발 서버 시작 (http://localhost:8000)
uvicorn app.main:app --reload

# 5. API 문서 보기
# Swagger UI: http://localhost:8000/docs
# ReDoc: http://localhost:8000/redoc

# 6. 테스트 실행
pytest

# 7. DB 마이그레이션 생성
alembic revision --autogenerate -m "description"

# 8. DB 마이그레이션 적용
alembic upgrade head
```

### 주요 Python 라이브러리

| 라이브러리 | 버전 | 용도 |
|-----------|------|------|
| FastAPI | 0.115.6 | 웹 프레임워크 |
| SQLAlchemy | 2.0.36 | ORM, DB |
| asyncpg | 0.30.0 | 비동기 PostgreSQL |
| Pydantic | 2.10.4 | 데이터 검증 |
| python-jose | 3.3.0 | JWT 토큰 |
| passlib | 1.7.4 | 비밀번호 해싱 |
| openpyxl | 3.1.5 | Excel 생성 |
| lxml | 5.3.0 | XML 파싱 |
| Alembic | 1.14.1 | DB 마이그레이션 |

---

## 요청 흐름: Router → Service → Repository → Model

FastAPI 백엔드의 계층 구조를 이해해야 코드를 수정할 수 있습니다.

```
API 요청
    ↓
Router (라우터) — HTTP 엔드포인트 정의
    ↓
Service (서비스) — 비즈니스 로직 처리
    ↓
Repository (저장소) — 데이터 접근 최적화 (N+1 쿼리 방지)
    ↓
Model (모델) — ORM 테이블 정의
    ↓
Database (데이터베이스) — PostgreSQL
```

### 층별 역할

1. **Router (라우터)** — `routers/` 폴더
   - HTTP 요청 수신
   - 입력 데이터 검증 (Pydantic 스키마)
   - 요청을 서비스로 전달
   - 응답 반환

2. **Service (서비스)** — `services/` 폴더
   - 비즈니스 로직 실행
   - 여러 모델 간 조화
   - 복잡한 연산 수행
   - 저장소 호출

3. **Repository (저장소)** — `repositories/` 폴더
   - 데이터 조회 최적화
   - JOIN으로 N+1 쿼리 방지
   - 복잡한 SELECT 로직

4. **Model (모델)** — `models/` 폴더
   - SQLAlchemy ORM 모델
   - DB 테이블 구조
   - 컬럼 정의

### 실제 예시: 프로젝트 생성

```
클라이언트 요청
    ↓ POST /api/projects
Router (projects.py)
    - request body 검증 (ProjectCreateRequest)
    - 사용자 인증 확인
    ↓
Service (project_service.py)
    - 제품/Backbone 존재 확인
    - 레이어별 조건 복사
    - Project + ProjectLayer 생성
    ↓
Model
    - Project 테이블에 INSERT
    - ProjectLayer 테이블에 INSERT
    ↓
Database
    - 데이터 저장
    ↓
응답 반환
    - 생성된 프로젝트 정보 반환
```

---

## 라우터 파일: 모든 엔드포인트 매핑

라우터는 `backend/app/routers/` 폴더에 있습니다.

### 라우터 목록과 담당 기능

| 파일 | 엔드포인트 | 담당 기능 |
|-----|-----------|---------|
| auth.py | `/api/auth/*` | 로그인, 토큰 갱신, 사용자 정보 |
| projects.py | `/api/projects` | 프로젝트 생성, 목록, 상세 조회 |
| project_conditions.py | `/api/projects/{id}/conditions` | 조건 데이터 저장/조회 |
| project_layers.py | `/api/projects/{id}/layers` | Backbone 교체, 레이어 관리 |
| project_lifecycle.py | `/api/projects/{id}/status` | 상태 전환, 개정, 승인/반려 |
| comments.py | `/api/projects/{id}/comments` | 코멘트 CRUD |
| export.py | `/api/export/*` | 전산 출력 미리보기, 다운로드 |
| export_admin.py | `/api/admin/export-systems` | 전산 시스템 CRUD |
| export_data_source.py | `/api/admin/data-sources` | 데이터 소스 관리 |
| equipment.py | `/api/projects/{id}/equipment` | 설비 할당 CRUD |
| dashboard.py | `/api/dashboard` | 대시보드 통계 |
| admin.py | `/api/admin/*` | 일반 관리 기능 |
| admin_users.py | `/api/admin/users` | 사용자 관리 CRUD |
| admin_master.py | `/api/admin/master/*` | 라인/제품/레이어 CRUD |
| columns.py | `/api/columns` | 컬럼 메타데이터 조회 |
| products.py | `/api/products` | 제품/Backbone 목록 |
| lines.py | `/api/lines` | 라인 목록 조회 |
| users.py | `/api/users` | 사용자 정보 조회 |

### 라우터 구조 이해하기

각 라우터 파일의 기본 구조:

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.dependencies.auth import get_current_user, require_active_user
from app.services import project_service
from app.schemas.project import ProjectCreateRequest, ProjectResponse

# 라우터 생성
router = APIRouter(prefix="/api/projects", tags=["projects"])

# 엔드포인트 정의
@router.get("/")
async def list_projects(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """프로젝트 목록 조회"""
    projects = await project_service.list_projects(db)
    return {"data": projects}

@router.post("/")
async def create_project(
    request: ProjectCreateRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_active_user),
):
    """새 프로젝트 생성"""
    project = await project_service.create_project(
        db, request.product_id, request.backbone_id, user.id
    )
    return project
```

### 엔드포인트 추가 패턴

새로운 엔드포인트를 추가하는 단계를 알아봅시다.

#### 1단계: 스키마 정의 (schemas 폴더)

`app/schemas/project.py`에:

```python
from pydantic import BaseModel

class MyNewRequest(BaseModel):
    name: str
    description: str

class MyNewResponse(BaseModel):
    id: int
    name: str
    status: str

    model_config = {"from_attributes": True}  # ORM 모델 자동 변환
```

#### 2단계: 서비스 함수 작성 (services 폴더)

`app/services/project_service.py`에:

```python
async def my_new_function(db: AsyncSession, name: str) -> Project:
    """비즈니스 로직"""
    project = Project(name=name, status="draft")
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return project
```

#### 3단계: 라우터에 엔드포인트 추가

`app/routers/projects.py`에:

```python
from app.schemas.project import MyNewRequest, MyNewResponse

@router.post("/my-endpoint")
async def my_new_endpoint(
    request: MyNewRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_active_user),
) -> MyNewResponse:
    """엔드포인트 설명"""
    result = await project_service.my_new_function(db, request.name)
    return MyNewResponse.from_orm(result)
```

#### 4단계: main.py에 라우터 등록 (이미 되어 있음)

`app/main.py`에 이미 있으면 자동으로 로드됨:

```python
app.include_router(projects.router)
```

---

## 서비스 파일: 비즈니스 로직 매핑

서비스는 `backend/app/services/` 폴더에 있습니다.

### 서비스 목록과 역할

| 파일 | 담당 기능 |
|-----|---------|
| `project_service.py` | 프로젝트 CRUD, Backbone 복사 |
| `project_status_service.py` | 상태 전환 워크플로우 (Review, Approve, Reject) |
| `project_analytics_service.py` | 변경 요약, 버전 히스토리 |
| `condition_service.py` | 조건 데이터 저장/조회 |
| `validation_service.py` | 단일 셀 검증 규칙 |
| `cross_layer_validation_service.py` | 크로스 레이어 검증 (참조, 비교 등) |
| `backbone_service.py` | Backbone 조회, 레이어 교체 |
| `recipe_service.py` | Recipe XML 파싱, 적용 |
| `comment_service.py` | 코멘트 CRUD |
| `change_log_service.py` | 변경 이력 기록 |
| `export_service.py` | 전산 출력 오케스트레이션 |
| `export_builders.py` | Excel 생성 (Type A/B/C) |
| `export_admin_service.py` | 시스템/매핑 관리 |
| `export_validation_service.py` | 출력 전 데이터 검증 |
| `export_history_service.py` | 출력 이력 기록/조회 |
| `equipment_service.py` | 설비 할당 CRUD |
| `dashboard_service.py` | 대시보드 통계 |
| `admin_service.py` | 관리자 기능 (옵션, 감시 로그) |
| `admin_user_service.py` | 사용자 CRUD |
| `admin_master_service.py` | 마스터 데이터 CRUD |
| `auth_service.py` | JWT 토큰, 비밀번호 해싱 |
| `diff_service.py` | 데이터 비교 |

### 서비스 작성 패턴

```python
# services/my_service.py
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException

async def my_business_logic(db: AsyncSession, data: dict) -> dict:
    """
    비즈니스 로직 설명

    Args:
        db: 데이터베이스 세션
        data: 입력 데이터

    Returns:
        처리 결과

    Raises:
        HTTPException: 오류 발생 시
    """
    # 1. 입력 검증
    if not data.get('name'):
        raise HTTPException(status_code=400, detail="Name is required")

    # 2. 데이터 조회 (저장소 또는 직접 쿼리)
    item = await db.get(MyModel, data['id'])
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    # 3. 비즈니스 로직 수행
    item.name = data['name']
    item.status = 'processed'

    # 4. 저장
    db.add(item)
    await db.commit()
    await db.refresh(item)

    # 5. 결과 반환
    return {"id": item.id, "status": item.status}
```

---

## 모델 파일: DB 테이블 매핑

모델은 `backend/app/models/` 폴더에 있습니다.

### 모델 목록과 테이블 매핑

| 모델 파일 | ORM 클래스 | DB 테이블 | 담당 데이터 |
|----------|-----------|----------|----------|
| `user.py` | User | users | 사용자 계정, 권한 |
| `line.py` | Line | lines | 생산 라인 마스터 |
| `product.py` | Product, ProductLayer | products, product_layers | 제품, Backbone |
| `column.py` | ColumnDef, ColumnCategory, ColumnValidation | column_definitions, column_categories, column_validations | 컬럼 메타, 검증 규칙 |
| `project.py` | Project, ProjectLayer | projects, project_layers | 신규 조건표 프로젝트 |
| `change_log.py` | ChangeLog, StatusLog | change_logs, status_logs | 셀 변경 이력, 상태 전환 로그 |
| `comment.py` | ReviewComment | review_comments | 코멘트 (선택사항) |
| `export.py` | ExportSystem, ColumnMapping, EquipmentAssignment | export_systems, export_column_mappings, equipment_assignments | 전산 출력 설정 |
| `export_data_source.py` | ExportDataSource | export_data_sources | 데이터 소스 |
| `export_history.py` | ExportHistory | export_histories | 출력 이력 감시 |

### 모델 구조 이해하기

```python
# models/project.py
from sqlalchemy import Column, Integer, String, JSON, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base

class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    status = Column(String, default="draft")
    conditions = Column(JSON)  # JSONB로 조건 데이터 저장
    created_at = Column(DateTime)

    # Relationship
    product = relationship("Product")
    layers = relationship("ProjectLayer")
```

### 새로운 테이블 추가 단계

1. **모델 클래스 정의**

   `models/my_table.py`:

   ```python
   from sqlalchemy import Column, Integer, String, ForeignKey, DateTime
   from sqlalchemy.orm import relationship
   from datetime import datetime
   from app.database import Base

   class MyTable(Base):
       __tablename__ = "my_tables"

       id = Column(Integer, primary_key=True)
       name = Column(String, nullable=False)
       project_id = Column(Integer, ForeignKey("projects.id"))
       created_at = Column(DateTime, default=datetime.utcnow)

       project = relationship("Project")
   ```

2. **마이그레이션 생성**

   ```bash
   alembic revision --autogenerate -m "Add my_tables table"
   ```

3. **마이그레이션 파일 확인** (`alembic/versions/`)

   자동 생성된 파일 검토 후:

   ```bash
   alembic upgrade head
   ```

---

## Pydantic 스키마: 요청/응답 검증

스키마는 `backend/app/schemas/` 폴더에 있습니다.

### 스키마의 역할

- **요청 검증**: 클라이언트 입력이 올바른 형식인지 확인
- **응답 직렬화**: ORM 모델을 JSON으로 변환
- **자동 문서화**: Swagger UI에 자동 표시

### 스키마 작성 패턴

```python
# schemas/project.py
from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional

class ProjectCreateRequest(BaseModel):
    """프로젝트 생성 요청"""
    product_id: int = Field(..., description="제품 ID")
    backbone_product_id: int = Field(..., description="Backbone 제품 ID")
    name: Optional[str] = None

class ProjectResponse(BaseModel):
    """프로젝트 응답"""
    id: int
    product_id: int
    product_name: str
    status: str
    revision: int
    created_at: datetime

    model_config = {
        "from_attributes": True  # ORM 객체 자동 변환
    }

class ProjectDetailResponse(ProjectResponse):
    """상세 프로젝트 응답"""
    conditions: dict  # JSONB 데이터
    layers: list  # ProjectLayer 리스트
```

---

## 인증 및 인가: JWT 토큰과 권한

인증 관련 코드는 `dependencies/auth.py`, `services/auth_service.py`에 있습니다.

### JWT 토큰 구조

```
Access Token (15분 유효)
├─ 사용자 ID (sub)
└─ 발급 시간 (iat), 만료 시간 (exp)

Refresh Token (7일 유효)
├─ 사용자 ID (sub)
└─ 타입 (type: "refresh")
```

### 인증 흐름

```
1. 로그인 (POST /api/auth/login)
   - 사용자명/비밀번호 검증
   - Access Token 생성 (메모리)
   - Refresh Token 생성 (HTTP-only 쿠키)

2. API 호출
   - Authorization: Bearer {access_token}
   - 토큰 검증 → 사용자 로드

3. 토큰 만료
   - 자동 갱신 (401 인터셉터)
   - POST /api/auth/refresh
   - 새 Access Token 발급

4. 로그아웃
   - Refresh Token 쿠키 삭제
```

### 권한별 접근 제어

```python
from app.dependencies.auth import get_current_user, require_active_user

# 인증된 사용자만
@router.get("/")
async def my_endpoint(
    user: User = Depends(get_current_user)
):
    """로그인 필요"""
    pass

# 활성화된 사용자만
@router.post("/")
async def create_endpoint(
    user: User = Depends(require_active_user)
):
    """활성 사용자만 가능"""
    pass

# 특정 역할만
async def require_admin(user: User = Depends(get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403)
    return user

@router.delete("/")
async def delete_endpoint(
    user: User = Depends(require_admin)
):
    """관리자만 삭제 가능"""
    pass
```

### 개발 중 인증 우회

인증 없이 테스트하려면:

```python
# 임시: dependencies/auth.py에서
async def get_current_user(token: str | None = None, db: AsyncSession = None):
    # 개발 모드에서 하드코딩
    if True:  # 임시 조건
        return User(id=1, username="dev_user", role="admin", is_active=True)
    # ... 실제 인증 로직
```

---

## 에러 처리: HTTPException 사용

FastAPI의 에러 처리 패턴입니다.

### HTTPException 사용법

```python
from fastapi import HTTPException, status

# 404 — 리소스 없음
if not item:
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Item not found"
    )

# 400 — 잘못된 요청
if not validate_data(data):
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Invalid data format"
    )

# 403 — 권한 없음
if user.role != "admin":
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Admin access required"
    )

# 401 — 인증 필요
if not token:
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
        headers={"WWW-Authenticate": "Bearer"}
    )

# 500 — 서버 오류 (자동 처리됨)
# app.main.py의 exception_handler에서 자동으로 처리
```

### 커스텀 에러 응답

```python
from pydantic import BaseModel

class ErrorDetail(BaseModel):
    error_code: str
    message: str
    details: dict = None

# 사용
raise HTTPException(
    status_code=400,
    detail=ErrorDetail(
        error_code="INVALID_DATA",
        message="제공된 데이터가 유효하지 않습니다",
        details={"field": "name", "issue": "required"}
    ).model_dump()
)
```

---

## 비동기 프로그래밍: async/await

FastAPI는 비동기 프로그래밍을 사용합니다.

### async/await 기본

```python
# ❌ 잘못된 방식 (동기)
def get_user(user_id: int):
    return db.query(User).get(user_id)  # DB 블로킹!

# ✅ 올바른 방식 (비동기)
async def get_user(user_id: int):
    return await db.get(User, user_id)  # 논블로킹
```

### 주의사항

```python
# ❌ 비동기 함수를 동기로 호출 불가
async def async_func():
    pass

def sync_func():
    result = async_func()  # ❌ 에러!

# ✅ await 사용
async def caller():
    result = await async_func()  # ✅ 올바름
```

---

## 데이터베이스 설정: config.py

`app/config.py`에서 DB 연결 설정을 관리합니다.

### 설정 파일 구조

```python
from pydantic import model_validator
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # 데이터베이스
    DATABASE_URL: str = "postgresql+asyncpg://pcm_user:pcm_pass@db:5432/pcm"
    DATABASE_URL_SYNC: str = "postgresql://pcm_user:pcm_pass@db:5432/pcm"

    # 인증
    SECRET_KEY: str = "change-this-secret-key"  # .env에서 로드

    # 앱 정보
    APP_NAME: str = "Process Condition Manager"

    # CORS
    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:80,http://localhost"

    # 환경 설정
    ENVIRONMENT: str = "development"   # development | production
    LOG_LEVEL: str = "INFO"            # DEBUG | INFO | WARNING | ERROR

    # JWT 토큰
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    @model_validator(mode="after")
    def validate_production_settings(self) -> "Settings":
        """운영 환경(production)에서 안전하지 않은 설정을 차단합니다."""
        if self.ENVIRONMENT != "production":
            return self
        # SECRET_KEY 기본값/짧은 키 차단, DB 기본 비밀번호 차단
        # 위반 시 ValueError로 앱 기동 차단
        ...

    class Config:
        env_file = ".env"

settings = Settings()
```

> **운영 환경 보호**: `ENVIRONMENT=production`일 때 기본 SECRET_KEY, 32자 미만 키, 기본 DB 비밀번호(`pcm_pass`)를 사용하면 앱이 시작되지 않습니다.

### 환경 변수 설정

`.env` 파일 (프로젝트 루트, `.env.prod.example` 참고):

```
DATABASE_URL=postgresql+asyncpg://pcm_user:YOUR_PASSWORD@db:5432/pcm
DATABASE_URL_SYNC=postgresql://pcm_user:YOUR_PASSWORD@db:5432/pcm
SECRET_KEY=your-secret-key-change-in-production  # 운영: 32자 이상
CORS_ORIGINS=http://localhost:5173,http://localhost
ENVIRONMENT=development                           # 운영: production
LOG_LEVEL=INFO
ACCESS_TOKEN_EXPIRE_MINUTES=15
REFRESH_TOKEN_EXPIRE_DAYS=7
```

---

## 마이그레이션: 스키마 변경

Alembic으로 DB 스키마를 관리합니다.

### 마이그레이션 워크플로우

```bash
# 1. 모델 변경 후 마이그레이션 생성
cd /home/appuser/process-condition-manager/backend
alembic revision --autogenerate -m "Add new column to projects"

# 2. 생성된 파일 확인
cat alembic/versions/xxx_add_new_column_to_projects.py

# 3. 마이그레이션 적용
alembic upgrade head

# 4. 롤백 (이전 상태로)
alembic downgrade -1  # 한 단계 뒤로
alembic downgrade base  # 처음 상태로
```

### 마이그레이션 파일 수정

자동 생성된 마이그레이션이 완벽하지 않으면 수정합니다:

```python
# alembic/versions/xxx.py
def upgrade() -> None:
    # 테이블 생성
    op.create_table(
        'my_table',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )

def downgrade() -> None:
    op.drop_table('my_table')
```

---

## 테스트: pytest 실행

테스트는 `pytest`로 실행합니다.

### 테스트 실행

```bash
# 모든 테스트 실행
pytest

# 특정 파일만 실행
pytest tests/test_projects.py

# 특정 테스트만 실행
pytest tests/test_projects.py::test_create_project

# 상세 출력
pytest -v

# 커버리지 확인
pytest --cov=app
```

### 테스트 작성 패턴

```python
# tests/test_projects.py
import pytest
from httpx import AsyncClient
from app.main import app

@pytest.mark.asyncio
async def test_create_project():
    """프로젝트 생성 테스트"""
    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.post(
            "/api/projects",
            json={"product_id": 1, "backbone_product_id": 2}
        )
        assert response.status_code == 201
        assert response.json()["status"] == "draft"
```

---

## 실행 및 확인

### 개발 서버 실행

```bash
# 기본 실행
uvicorn app.main:app --reload

# 포트 변경
uvicorn app.main:app --reload --port 8001

# 전체 네트워크에 공개
uvicorn app.main:app --reload --host 0.0.0.0
```

### API 문서 접근

- **Swagger UI**: http://localhost:8000/docs — 인터랙티브 테스트
- **ReDoc**: http://localhost:8000/redoc — 문서 읽기 전용

### 헬스 체크

```bash
# 서버 상태 확인
curl http://localhost:8000/api/health

# 응답 예시
{
  "status": "ok",
  "app": "Process Condition Manager",
  "db": "connected"
}
```

---

## 디버깅 팁

### print/logging 사용

```python
import logging

logger = logging.getLogger(__name__)

@router.get("/")
async def my_endpoint():
    logger.info("Endpoint called")  # 콘솔에 출력
    logger.error("Error occurred", exc_info=True)
    return {"status": "ok"}
```

### 데이터베이스 쿼리 확인

```python
# database.py에서 echo 활성화
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=True  # SQL 쿼리 출력
)
```

### 응답 데이터 확인

Swagger UI (/docs)에서 "Try it out" 버튼으로 실제 API 테스트:

1. 엔드포인트 선택
2. 필요한 파라미터 입력
3. "Execute" 클릭
4. 응답 확인

### PostgreSQL 직접 접근

```bash
# Docker 컨테이너에서 psql 실행
docker-compose exec db psql -U pcm_user -d pcm

# SQL 실행 예시
SELECT * FROM projects LIMIT 10;
SELECT COUNT(*) FROM projects WHERE status = 'draft';
```

---

## 성능 최적화

### N+1 쿼리 문제 해결

```python
# ❌ 나쁜 예: 루프에서 쿼리 실행
projects = await db.execute(select(Project))
for project in projects.scalars():
    product = project.product  # 각 프로젝트마다 쿼리!

# ✅ 좋은 예: JOIN으로 한 번에 로드
result = await db.execute(
    select(Project).options(selectinload(Project.product))
)
projects = result.scalars().all()
```

### 인덱스 추가

```python
# models/project.py
class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True)
    status = Column(String, index=True)  # 검색하는 컬럼에 인덱스
    product_id = Column(Integer, ForeignKey("products.id"), index=True)
```

---

## 로깅 설정

### 구조화된 로깅 (logging_config.py)

`app/logging_config.py`가 환경별 로깅을 설정합니다:

- **개발 환경**: 읽기 쉬운 텍스트 포맷 (`2026-02-27 14:00:00 [INFO] app: message`)
- **운영 환경**: JSON 한 줄 포맷 (Docker 로그 드라이버 호환)

```python
from app.logging_config import setup_logging

# main.py에서 라우터 import 전에 호출
setup_logging(settings.ENVIRONMENT, settings.LOG_LEVEL)
```

운영 환경 JSON 로그 출력 예시:
```json
{"timestamp": "2026-02-27T05:00:00+00:00", "level": "INFO", "logger": "app", "message": "서버 시작"}
```

### 서비스 코드에서 로깅

중요한 작업을 로깅합니다:

```python
import logging

logger = logging.getLogger(__name__)

@router.post("/projects")
async def create_project(request: ProjectCreateRequest, db: AsyncSession):
    try:
        project = await project_service.create_project(
            db, request.product_id, request.backbone_id, user_id=1
        )
        logger.info(f"Project created: {project.id}")
        return project
    except Exception as e:
        logger.error(f"Failed to create project: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500)
```

---

## 트랜잭션 관리

데이터 일관성을 위해 트랜잭션을 사용합니다:

```python
async def create_and_notify(db: AsyncSession, project_data):
    try:
        # 1. 프로젝트 생성
        project = Project(**project_data)
        db.add(project)
        await db.flush()  # INSERT 실행

        # 2. 알림 생성
        notification = Notification(project_id=project.id)
        db.add(notification)

        # 3. 모두 커밋
        await db.commit()
        return project
    except Exception:
        await db.rollback()  # 모두 취소
        raise
```

---

## 핵심 개념 정리

- **FastAPI**: 현대적이고 빠른 웹 프레임워크
- **SQLAlchemy**: Python ORM, 비동기 지원
- **Pydantic**: 데이터 검증 및 직렬화
- **async/await**: 논블로킹 I/O
- **JWT**: 무상태 인증 토큰
- **PostgreSQL**: 관계형 DB, JSONB 지원

---

## 더 배우기

- FastAPI 공식 문서: https://fastapi.tiangolo.com/
- SQLAlchemy 공식 문서: https://docs.sqlalchemy.org/
- Pydantic 문서: https://docs.pydantic.dev/
- PostgreSQL 문서: https://www.postgresql.org/docs/

