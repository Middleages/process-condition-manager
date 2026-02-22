# 자주 하는 수정 레시피

PCM 프로젝트에서 가장 흔한 수정 작업을 단계별로 안내합니다. 각 레시피는 정확한 파일 경로와 코드 패턴을 포함합니다.

## 목차

1. [텍스트/라벨 변경하기](#1-텍스트라벨-변경하기)
2. [컬럼(파라미터) 추가/수정하기](#2-컬럼파라미터-추가수정하기)
3. [검증 규칙 변경하기](#3-검증-규칙-변경하기)
4. [시드 데이터 수정하기](#4-시드-데이터-수정하기)
5. [새 페이지 추가하기](#5-새-페이지-추가하기)
6. [API 엔드포인트 추가하기](#6-api-엔드포인트-추가하기)
7. [환경 변수 변경하기](#7-환경-변수-변경하기)
8. [사용자/역할 관리](#8-사용자역할-관리)

---

## 1. 텍스트/라벨 변경하기

UI에 표시되는 텍스트를 바꾸는 방법입니다. 버튼, 메뉴, 메시지, 헤더 등 모든 텍스트가 포함됩니다.

### 1.1 페이지 제목/헤더 변경

**파일**: `/home/appuser/process-condition-manager/frontend/src/pages/*.tsx`

예를 들어, DashboardPage의 제목을 변경하려면:

```typescript
// /frontend/src/pages/DashboardPage.tsx
export default function DashboardPage() {
  return (
    <div>
      <h1>대시보드</h1> {/* 이 텍스트를 변경 */}
    </div>
  )
}
```

**변경 방법**:
- 파일 열기: `/frontend/src/pages/DashboardPage.tsx`, `/frontend/src/pages/ProjectListPage.tsx`, `/frontend/src/pages/ConditionEditorPage.tsx` 등
- JSX 템플릿 내의 문자열 찾기 및 변경
- 저장 후 자동 리로드됨

### 1.2 버튼 라벨 변경

**파일**: `/home/appuser/process-condition-manager/frontend/src/components/**/*.tsx`

예: ApprovalButtons 컴포넌트

```typescript
// /frontend/src/components/editor/ApprovalButtons.tsx
<button className="btn-primary">승인</button>  {/* 이 텍스트 변경 */}
<button className="btn-secondary">반려</button>  {/* 이 텍스트 변경 */}
```

**변경 방법**:
- 컴포넌트 파일 열기
- 버튼 텍스트 문자열 찾기
- 변경 후 저장

### 1.3 UI 메시지/Toast 변경

**파일**: 각 컴포넌트의 문자열 리터럴

예: 저장 성공 메시지

```typescript
// 어느 컴포넌트든
toast.success("조건이 저장되었습니다")  // 이 메시지 변경
```

**변경 방법**:
- 변경할 메시지를 Grep으로 검색: `grep -r "저장되었습니다" frontend/src`
- 해당 파일에서 문자열 변경

### 1.4 카테고리 탭 라벨 변경

**파일**: `/home/appuser/process-condition-manager/backend/app/seed/columns.py`

```python
# /backend/app/seed/columns.py
CATEGORIES = [
    {"category_code": "SP", "category_name": "Spin/PR", "sort_order": 1},
    {"category_code": "SC", "category_name": "Scanner", "sort_order": 2},
    {"category_code": "OVL", "category_name": "Overlay", "sort_order": 3},
    {"category_code": "DEV", "category_name": "Develop", "sort_order": 4},
]
```

**변경 방법**:
- 파일 열기: `/backend/app/seed/columns.py`
- `category_name` 값 변경 (예: "Spin/PR" → "Spin Processing")
- DB 초기화 필요: `docker-compose exec backend python -m app.seed`

---

## 2. 컬럼(파라미터) 추가/수정하기

조건표에 새로운 파라미터를 추가하거나 기존 파라미터의 속성을 변경합니다.

### 2.1 새 컬럼 추가

**3단계 프로세스**:

1. **컬럼 정의 추가** (백엔드)
2. **검증 규칙 추가** (백엔드)
3. **프론트엔드 빌드** (자동)

#### 단계 1: 컬럼 정의 추가

**파일**: `/home/appuser/process-condition-manager/backend/app/seed/columns.py`

```python
# /backend/app/seed/columns.py
COLUMN_DEFS = [
    {
        "column_name": "SP_NEW_PARAM",  # 컬럼 코드 (영문)
        "display_name": "새 파라미터",     # 사용자 표시명 (한글)
        "category_code": "SP",           # SP/SC/OVL/DEV 중 하나
        "data_type": "float",            # string, int, float, bool 중 하나
        "sort_order": 999,               # 카테고리 내 정렬 순서
    },
    # ... 기존 컬럼들
]
```

#### 단계 2: 검증 규칙 추가 (선택)

**파일**: `/home/appuser/process-condition-manager/backend/app/seed/columns.py`

```python
VALIDATION_RULES = [
    {
        "column_name": "SP_NEW_PARAM",
        "rule_type": "range",  # range, required, conditional_required 중 하나
        "min_value": 0.0,
        "max_value": 100.0,
        "error_message": "값은 0~100 범위여야 합니다",
    },
    # ... 기존 규칙들
]
```

#### 단계 3: DB 초기화

```bash
# Docker 환경에서
docker-compose exec backend python -m app.seed

# 또는 로컬 개발 환경
cd backend
python -m app.seed
```

### 2.2 컬럼 속성 수정 (디스플레이명, 카테고리 등)

**파일**: `/home/appuser/process-condition-manager/backend/app/seed/columns.py`

```python
# 변경 전
{
    "column_name": "SP_SPIN1_SPEED",
    "display_name": "스핀 속도 1단계",
    "category_code": "SP",
}

# 변경 후
{
    "column_name": "SP_SPIN1_SPEED",
    "display_name": "스핀 속도 (1단계)",  # 표시명 변경
    "category_code": "SP",
}
```

**변경 방법**:
1. 파일 열기: `/backend/app/seed/columns.py`
2. COLUMN_DEFS 배열에서 해당 컬럼 찾기
3. `display_name` 또는 다른 속성 수정
4. DB 초기화: `docker-compose exec backend python -m app.seed`

### 2.3 컬럼 순서 변경

**파일**: `/home/appuser/process-condition-manager/backend/app/seed/columns.py`

```python
COLUMN_DEFS = [
    {"column_name": "SP_PR_TYPE", "sort_order": 1, ...},      # 순서 변경
    {"column_name": "SP_SPIN1_SPEED", "sort_order": 2, ...},  # 순서 변경
    {"column_name": "SP_SPIN2_SPEED", "sort_order": 3, ...},  # 순서 변경
]
```

**변경 방법**:
1. 각 컬럼의 `sort_order` 값 조정
2. DB 초기화

---

## 3. 검증 규칙 변경하기

셀 값의 유효성 검증 조건을 수정합니다.

### 3.1 범위(Range) 검증 규칙 변경

**파일**: `/home/appuser/process-condition-manager/backend/app/seed/columns.py`

```python
VALIDATION_RULES = [
    {
        "column_name": "SC_EXPOSE_ENERGY",
        "rule_type": "range",
        "min_value": 30.0,      # 최소값
        "max_value": 50.0,      # 최대값
        "error_message": "노광 에너지는 30~50 범위여야 합니다",
    },
]
```

**변경 방법**:
1. `/backend/app/seed/columns.py` 열기
2. VALIDATION_RULES에서 해당 규칙 찾기
3. `min_value`, `max_value` 수정
4. DB 초기화

### 3.2 필수값(Required) 검증 규칙 추가

```python
VALIDATION_RULES = [
    {
        "column_name": "SP_PR_TYPE",
        "rule_type": "required",  # 필수값 검증
        "error_message": "PR 타입은 필수입니다",
    },
]
```

### 3.3 조건부 필수값(Conditional Required) 검증

```python
VALIDATION_RULES = [
    {
        "column_name": "OVL_CORRECT_X",
        "rule_type": "conditional_required",
        "condition": "OVL_USE == 'Y'",  # 조건식
        "error_message": "OVL 사용 시 X보정값은 필수입니다",
    },
]
```

### 3.4 크로스레이어 검증 규칙 추가 (관리자 UI에서)

웹 관리자 페이지에서:
1. `/admin/validations` 접속
2. "크로스레이어 검증" 탭
3. "규칙 추가" 버튼
4. 규칙 설정:
   - 규칙 타입: reference_exists, compare_layers 등
   - 검증 컬럼: 검증할 컬럼명
   - 조건: JSON 형식으로 입력

---

## 4. 시드 데이터 수정하기

초기 데이터(제품, 레이어, 컬럼, 사용자 등)를 변경합니다.

### 4.1 제품(Product) 데이터 수정

**파일**: `/home/appuser/process-condition-manager/backend/app/seed/products.py`

```python
PRODUCTS = [
    {
        "product_name": "Product_A",
        "line_id": 1,
        "is_backbone": True,  # Backbone 여부
    },
    {
        "product_name": "Product_B",
        "line_id": 1,
        "is_backbone": False,
    },
]
```

**변경 방법**:
1. 파일 열기: `/backend/app/seed/products.py`
2. PRODUCTS 배열에서 제품 정보 수정
3. DB 초기화: `docker-compose exec backend python -m app.seed`

### 4.2 레이어(Layer) 데이터 수정

**파일**: `/home/appuser/process-condition-manager/backend/app/seed/layers.py`

```python
LAYERS = [
    {
        "layer_name": "AA_PHOTO",
        "step_seq": "001",
        "layer_number": "L1",
    },
    {
        "layer_name": "GATE_PHOTO",
        "step_seq": "002",
        "layer_number": "L2",
    },
]
```

**변경 방법**:
1. 파일 열기: `/backend/app/seed/layers.py`
2. LAYERS 배열에서 레이어 정보 수정
3. DB 초기화

### 4.3 사용자(User) 데이터 수정

**파일**: `/home/appuser/process-condition-manager/backend/app/seed/users.py`

```python
USERS = [
    {
        "username": "editor1",
        "email": "editor1@company.com",
        "display_name": "편집자1",
        "role": "editor",  # editor, reviewer, admin
        "is_active": True,
    },
    {
        "username": "reviewer1",
        "email": "reviewer1@company.com",
        "display_name": "검토자1",
        "role": "reviewer",
        "is_active": True,
    },
]
```

**변경 방법**:
1. 파일 열기: `/backend/app/seed/users.py`
2. USERS 배열에서 사용자 정보 수정
3. DB 초기화

### 4.4 라인(Line) 데이터 수정

**파일**: `/home/appuser/process-condition-manager/backend/app/seed/columns.py` 또는 관리자 UI

라인 추가/수정은 관리자 페이지에서도 가능합니다:
1. `/admin/master-data` 접속
2. "라인 관리" 탭
3. "추가" 또는 "편집" 버튼으로 수정

---

## 5. 새 페이지 추가하기

간단한 새 페이지를 만드는 기본 패턴입니다.

### 5.1 페이지 컴포넌트 생성

**파일 경로**: `/home/appuser/process-condition-manager/frontend/src/pages/NewPage.tsx`

```typescript
// /frontend/src/pages/NewPage.tsx
import { useEffect, useState } from 'react'
import Layout from '@/components/layout/Layout'

export default function NewPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // API 호출 또는 초기화 로직
    setLoading(false)
  }, [])

  if (loading) {
    return <div>로딩중...</div>
  }

  return (
    <Layout>
      <div className="container">
        <h1>새 페이지 제목</h1>
        <div>페이지 내용</div>
      </div>
    </Layout>
  )
}
```

### 5.2 라우팅 설정

**파일**: `/home/appuser/process-condition-manager/frontend/src/App.tsx`

```typescript
// App.tsx의 router 객체에 추가
{
  element: <Layout />,
  children: [
    { path: '/', element: <DashboardPage /> },
    // ... 기존 경로들
    { path: '/new-page', element: <NewPage /> },  // 새 경로 추가
  ],
}
```

### 5.3 네비게이션에 링크 추가

**파일**: `/home/appuser/process-condition-manager/frontend/src/components/layout/Header.tsx`

```typescript
// Header.tsx 내의 네비게이션 메뉴에 추가
<nav>
  <Link to="/">대시보드</Link>
  <Link to="/projects">프로젝트</Link>
  <Link to="/new-page">새 페이지</Link>
</nav>
```

---

## 6. API 엔드포인트 추가하기

새 API를 만드는 기본 패턴입니다.

### 6.1 Pydantic 스키마 정의

**파일**: `/home/appuser/process-condition-manager/backend/app/schemas/project.py` 또는 새 파일

```python
# /backend/app/schemas/custom.py
from pydantic import BaseModel

class CustomItemRequest(BaseModel):
    name: str
    value: float

class CustomItemResponse(BaseModel):
    id: int
    name: str
    value: float
    created_at: str
```

### 6.2 서비스 함수 작성

**파일**: `/home/appuser/process-condition-manager/backend/app/services/` 내의 적절한 파일

```python
# /backend/app/services/custom_service.py
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import CustomModel  # 모델 임포트

async def create_custom_item(
    db: AsyncSession,
    name: str,
    value: float,
    created_by: int,
) -> CustomModel:
    """새 아이템 생성"""
    item = CustomModel(
        name=name,
        value=value,
        created_by=created_by,
    )
    db.add(item)
    await db.flush()
    return item

async def list_custom_items(
    db: AsyncSession,
) -> list[CustomModel]:
    """모든 아이템 조회"""
    result = await db.execute(
        select(CustomModel)
    )
    return result.scalars().all()
```

### 6.3 API 엔드포인트 작성

**파일**: `/home/appuser/process-condition-manager/backend/app/routers/custom.py` (새 파일)

```python
# /backend/app/routers/custom.py
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.dependencies.auth import get_current_user
from app.schemas.custom import CustomItemRequest, CustomItemResponse
from app.services import custom_service

router = APIRouter(prefix="/api/custom", tags=["custom"])

@router.post("/items")
async def create_item(
    req: CustomItemRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """새 아이템 생성"""
    item = await custom_service.create_custom_item(
        db=db,
        name=req.name,
        value=req.value,
        created_by=user.id,
    )
    await db.commit()
    return CustomItemResponse(
        id=item.id,
        name=item.name,
        value=item.value,
        created_at=item.created_at.isoformat(),
    )

@router.get("/items")
async def list_items(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """모든 아이템 조회"""
    items = await custom_service.list_custom_items(db)
    return [
        CustomItemResponse(
            id=item.id,
            name=item.name,
            value=item.value,
            created_at=item.created_at.isoformat(),
        )
        for item in items
    ]
```

### 6.4 라우터 등록

**파일**: `/home/appuser/process-condition-manager/backend/app/main.py`

```python
# main.py의 app 초기화 코드에 추가
from app.routers import custom  # 임포트

app.include_router(custom.router)  # 라우터 등록
```

---

## 7. 환경 변수 변경하기

DB 연결, 포트, API 토큰 등 설정을 변경합니다.

### 7.1 백엔드 환경 변수

**파일**: `/home/appuser/process-condition-manager/backend/app/config.py`

```python
# config.py
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # 데이터베이스
    DATABASE_URL: str = "postgresql+asyncpg://pcm_user:pcm_pass@db:5432/pcm"
    DATABASE_URL_SYNC: str = "postgresql://pcm_user:pcm_pass@db:5432/pcm"

    # 보안
    SECRET_KEY: str = "change-this-secret-key"

    # 앱 설정
    APP_NAME: str = "Process Condition Manager"

    # CORS
    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:80,http://localhost"

    class Config:
        env_file = ".env"  # .env 파일에서 로드

settings = Settings()
```

**변경 방법**:
1. 로컬 개발: `.env` 파일 생성 또는 수정
   ```bash
   DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/pcm
   SECRET_KEY=your-secret-key
   ```

2. Docker 환경: `docker-compose.yml` 수정
   ```yaml
   backend:
     environment:
       DATABASE_URL: postgresql+asyncpg://user:pass@db:5432/pcm
       SECRET_KEY: your-secret-key
   ```

### 7.2 프론트엔드 API 기본 URL

**파일**: `/home/appuser/process-condition-manager/frontend/src/api/` 내의 클라이언트 설정

```typescript
// /frontend/src/api/client.ts
import axios from 'axios'

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000/api'

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
})
```

**변경 방법**:
1. `.env.local` 파일 생성
   ```
   REACT_APP_API_URL=http://localhost:8000/api
   ```

2. 또는 `frontend/.env` 파일 수정

### 7.3 포트 변경

**파일**: `docker-compose.yml`

```yaml
services:
  backend:
    ports:
      - "8000:8000"  # 호스트:컨테이너 포트 변경

  frontend:
    ports:
      - "5173:5173"  # 호스트:컨테이너 포트 변경

  db:
    ports:
      - "5432:5432"  # 호스트:컨테이너 포트 변경
```

---

## 8. 사용자/역할 관리

사용자를 추가하고 역할을 변경합니다.

### 8.1 사용자 추가 (관리자 UI에서)

**웹 접속 경로**: `/admin/users`

**단계**:
1. 관리자 로그인
2. 좌상단 메뉴 → "관리" → "사용자 관리"
3. "사용자 추가" 버튼 클릭
4. 폼 입력:
   - 사용자명: `editor_new` (영문, 중복 불가)
   - 이메일: `editor_new@company.com`
   - 표시명: `새 편집자` (한글 가능)
   - 역할: `editor` (editor, reviewer, admin)
5. 저장

### 8.2 사용자 역할 변경

**웹 접속 경로**: `/admin/users`

**단계**:
1. 사용자 목록에서 대상 사용자 찾기
2. "편집" 버튼 클릭
3. 역할 드롭다운 변경
4. 저장

### 8.3 사용자 비활성화

**웹 접속 경로**: `/admin/users`

**단계**:
1. 사용자 목록에서 대상 사용자 찾기
2. "비활성화" 버튼 클릭
3. 확인

### 8.4 역할 권한 설명

| 역할 | 권한 | 기능 |
|------|------|------|
| **editor** | 편집자 | 프로젝트 생성, 조건표 편집, 검증, 자동저장, 검토 요청 |
| **reviewer** | 검토자 | 프로젝트 열람, 코멘트, 승인/반려, 상태 변경 |
| **admin** | 관리자 | 모든 기능 + 관리자 설정 (사용자, 마스터 데이터, 검증 규칙, 전산 출력 설정) |

### 8.5 시드 데이터에서 사용자 추가 (개발 환경)

**파일**: `/home/appuser/process-condition-manager/backend/app/seed/users.py`

```python
USERS = [
    {
        "username": "newuser",
        "email": "newuser@company.com",
        "display_name": "새로운 사용자",
        "role": "editor",
        "is_active": True,
    },
    # ... 기존 사용자들
]
```

**적용**:
```bash
docker-compose exec backend python -m app.seed
```

---

## 팁 및 주의사항

1. **데이터베이스 초기화**: 시드 데이터 수정 후에는 `docker-compose exec backend python -m app.seed` 실행
2. **프론트엔드 자동 리로드**: 개발 서버는 파일 변경을 감지하여 자동으로 리로드됨
3. **백엔드 재시작**: 백엔드 코드 변경 후 자동으로 재시작되지 않으면 `docker-compose restart backend` 실행
4. **문자 인코딩**: 한글 텍스트는 UTF-8 인코딩으로 저장
5. **컬럼명 규칙**: 컬럼명은 영문 대문자 + 언더스코어 사용 (예: `SP_NEW_PARAM`)
6. **버전 관리**: 변경사항은 git으로 커밋하여 추적

