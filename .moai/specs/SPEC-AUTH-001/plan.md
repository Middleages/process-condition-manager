---
id: SPEC-AUTH-001
type: plan
version: "1.0.0"
---

# SPEC-AUTH-001: 구현 계획 (Implementation Plan)

## 참조 (Reference)
- SPEC: `.moai/specs/SPEC-AUTH-001/spec.md`
- 수용 기준: `.moai/specs/SPEC-AUTH-001/acceptance.md`

---

## Milestone 1: 백엔드 Auth 모듈

**Priority: High** | 선결 조건 없음

### M1.1: 의존성 추가

**수정 파일**: `backend/requirements.txt`

추가할 패키지:
```
python-jose[cryptography]==3.3.0
passlib[bcrypt]==1.7.4
bcrypt==4.2.1
```

### M1.2: DB 마이그레이션

**수정 파일**:
- `backend/app/models/user.py` (password_hash, email 컬럼 추가)
- 새 Alembic revision 생성

User 모델 변경사항:
```
password_hash: VARCHAR(255) NOT NULL DEFAULT ''
email: VARCHAR(255) UNIQUE
is_active: BOOLEAN DEFAULT TRUE (기존 필드 확인/추가)
```

마이그레이션 명령:
```bash
docker-compose exec backend alembic revision --autogenerate -m "add_password_hash_email_to_users"
docker-compose exec backend alembic upgrade head
```

### M1.3: Auth 서비스

**새 파일**: `backend/app/services/auth_service.py`

구현 함수:
- `verify_password(plain_password, hashed_password) -> bool`
- `get_password_hash(password) -> str`
- `create_access_token(data: dict, expires_delta: timedelta) -> str`
- `create_refresh_token(data: dict) -> str`
- `decode_token(token: str) -> dict`

설정 상수:
- `SECRET_KEY`: 환경변수에서 로드
- `ALGORITHM = "HS256"`
- `ACCESS_TOKEN_EXPIRE_MINUTES = 15`
- `REFRESH_TOKEN_EXPIRE_DAYS = 7`

### M1.4: Auth 의존성 (Dependencies)

**새 파일**: `backend/app/dependencies/auth.py`

구현 함수:
- `get_current_user(token: str) -> User` — Bearer token 파싱 + 검증
- `require_active_user(user: User) -> User` — is_active=True 검증
- `require_reviewer(user: User) -> User` — role in ('reviewer', 'admin') 검증
- `require_admin(user: User) -> User` — role == 'admin' 검증
- `require_project_owner(project_id: int, user: User, db: AsyncSession) -> Project` — 소유권 검증

**수정 파일**: `backend/app/main.py`
- OAuth2PasswordBearer 스키마 설정

### M1.5: Auth 라우터

**새 파일**: `backend/app/routers/auth.py`

엔드포인트:
| Method | Path | 설명 |
|--------|------|------|
| POST | `/api/auth/login` | username/password → access token + refresh cookie |
| POST | `/api/auth/logout` | refresh cookie 만료 |
| POST | `/api/auth/refresh` | cookie refresh token → 새 access token |
| GET  | `/api/auth/me` | 현재 로그인 사용자 정보 조회 |

**수정 파일**: `backend/app/main.py`
- `app.include_router(auth_router, prefix="/api/auth", tags=["auth"])`
- CORS middleware에 `allow_credentials=True`, `allow_headers=["Authorization", ...]` 추가

### M1.6: 시드 데이터 업데이트

**수정 파일**: `backend/app/seed.py`

변경사항:
- 모든 시드 유저에 `password_hash = get_password_hash("changeme123!")` 추가
- `email` 필드 추가 (예: `admin@pcm.local`, `reviewer@pcm.local`, `editor@pcm.local`)
- `is_active = True` 명시

### M1.7: Auth 테스트

**새 파일**: `backend/tests/test_auth.py`

테스트 케이스:
- `test_login_success`: 올바른 credentials → 200 + access token
- `test_login_wrong_password`: 잘못된 password → 401
- `test_login_inactive_user`: is_active=False → 401
- `test_refresh_token`: 유효한 refresh cookie → 새 access token
- `test_protected_endpoint_without_token`: 인증 없이 보호 엔드포인트 → 401
- `test_protected_endpoint_with_token`: 유효한 token으로 보호 엔드포인트 → 200
- `test_admin_only_endpoint_with_editor`: editor 역할로 /api/admin/ → 403
- `test_reviewer_endpoint_with_editor`: editor 역할로 approve → 403

---

## Milestone 2: 프론트엔드 Auth UI

**Priority: High** | 선결 조건: M1 완료

### M2.1: useAuthStore 구현

**새 파일**: `frontend/src/stores/useAuthStore.ts`

상태 구조:
```typescript
interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  // 기존 useUserStore 호환 getter
  currentUserId: number | null;
}
```

액션:
- `login(credentials) -> Promise<void>` — POST /api/auth/login
- `logout() -> Promise<void>` — POST /api/auth/logout + 상태 초기화
- `refreshToken() -> Promise<void>` — POST /api/auth/refresh
- `fetchCurrentUser() -> Promise<void>` — GET /api/auth/me

**수정 파일**: `frontend/src/stores/useUserStore.ts`
- `currentUserId` getter를 useAuthStore로 위임 (하위 호환성 유지)

### M2.2: LoginPage 구현

**새 파일**: `frontend/src/pages/LoginPage.tsx`

UI 요소:
- username 입력 필드
- password 입력 필드
- 로그인 버튼
- 에러 메시지 표시 영역
- (Optional) "로그인 상태 유지" 체크박스

라우트: `/login`

로그인 성공 시:
- redirect 쿼리 파라미터 존재 시 해당 경로로 이동
- 없으면 `/projects`로 이동

### M2.3: ProtectedRoute 구현

**새 파일**: `frontend/src/components/auth/ProtectedRoute.tsx`

동작:
- `isAuthenticated === false` → `/login?redirect={pathname}` 리다이렉트
- `isAuthenticated === true` → children 렌더링
- 로딩 중 → 스피너 표시

### M2.4: Axios 인터셉터 변경

**수정 파일**: `frontend/src/api/client.ts`

변경사항:
- Request interceptor: `X-User-Id` 헤더 제거, `Authorization: Bearer {accessToken}` 헤더 추가
- Response interceptor: 401 수신 시 refreshToken() 시도 → 성공 시 원래 요청 재시도, 실패 시 logout() + `/login` 리다이렉트

### M2.5: App.tsx 라우터 업데이트

**수정 파일**: `frontend/src/App.tsx`

변경사항:
- `/login` 라우트 추가 (LoginPage)
- `/projects`, `/projects/:id/edit` 라우트를 ProtectedRoute로 래핑
- 앱 초기화 시 `fetchCurrentUser()` 호출 (토큰 유효성 확인)

### M2.6: Header 컴포넌트 수정

**수정 파일**: `frontend/src/components/layout/Header.tsx`

변경사항:
- 사용자 드롭다운 선택기 제거
- 현재 로그인 사용자 이름 + 역할 표시
- 로그아웃 버튼 추가

---

## Milestone 3: RBAC 엔드포인트 강화

**Priority: Medium** | 선결 조건: M1, M2 완료

### M3.1: X-User-Id → JWT 기반 교체

**수정 파일**:
- `backend/app/routers/admin.py` — X-User-Id 헤더 제거, `get_current_user` 의존성 추가
- `backend/app/routers/comments.py` — 동일

### M3.2: projects.py 권한 강화

**수정 파일**: `backend/app/routers/projects.py`

변경사항:
- 모든 엔드포인트에 `get_current_user` 의존성 추가
- 수정/삭제 엔드포인트에 `require_project_owner` 추가

### M3.3: 승인/반려 엔드포인트 보호

**수정 파일**: `backend/app/routers/projects.py` (또는 해당 라우터)

변경사항:
- `POST /api/projects/{id}/approve` — `require_reviewer` 의존성 추가
- `POST /api/projects/{id}/reject` — `require_reviewer` 의존성 추가

### M3.4: RequireRole 프론트엔드 컴포넌트

**새 파일**: `frontend/src/components/auth/RequireRole.tsx`

기능:
- `allowedRoles: string[]` prop 수신
- 현재 사용자 역할이 allowedRoles에 포함되지 않으면 children을 렌더링하지 않거나 비활성화

사용 예시:
- 승인/반려 버튼: `<RequireRole allowedRoles={['reviewer', 'admin']}>`
- 관리자 메뉴: `<RequireRole allowedRoles={['admin']}>`

---

## 신규/수정 파일 요약

### 신규 파일
```
backend/app/services/auth_service.py
backend/app/dependencies/auth.py
backend/app/dependencies/__init__.py
backend/app/routers/auth.py
backend/tests/test_auth.py
frontend/src/stores/useAuthStore.ts
frontend/src/pages/LoginPage.tsx
frontend/src/components/auth/ProtectedRoute.tsx
frontend/src/components/auth/RequireRole.tsx
```

### 수정 파일
```
backend/requirements.txt
backend/app/models/user.py
backend/app/main.py
backend/app/seed.py
backend/app/routers/projects.py
backend/app/routers/admin.py
backend/app/routers/comments.py
frontend/src/api/client.ts
frontend/src/App.tsx
frontend/src/components/layout/Header.tsx
frontend/src/stores/useUserStore.ts
```

### 마이그레이션 파일
```
backend/alembic/versions/{hash}_add_password_hash_email_to_users.py
```

---

## 리스크 분석

| 리스크 | 영향도 | 발생 가능성 | 대응 방안 |
| ------ | ------ | ----------- | --------- |
| 기존 테스트에서 X-User-Id 헤더 사용 | High | High | 테스트 픽스처에 JWT 인증 헬퍼 함수 추가, 기존 테스트 단계적 마이그레이션 |
| Axios 인터셉터 순환 호출 (refresh 무한 루프) | High | Medium | isRefreshing 플래그로 중복 refresh 방지, 큐(queue) 패턴 적용 |
| bcrypt 버전 호환성 문제 | Medium | Low | requirements.txt에 bcrypt==4.2.1 고정 버전 명시 |
| refresh token cookie SameSite 정책 | Medium | Medium | 개발 환경: SameSite=Lax, 운영 환경: SameSite=Strict + Secure |
| 기존 change_log의 user_id 참조 무결성 | Low | Low | users.id FK 보존으로 자동 해결 |

---

## 기술 접근 방식 (Technical Approach)

### Token 저장 전략
- Access token: 메모리 (Zustand store) — XSS 방어
- Refresh token: HTTP-only Secure Cookie — CSRF 방어 (SameSite 설정)

### 자동 갱신 전략 (Silent Refresh)
1. Axios response interceptor가 401 수신
2. `isRefreshing` 플래그 확인 (중복 방지)
3. `/api/auth/refresh` 호출
4. 성공: 새 access token으로 대기 중인 요청 재시도
5. 실패: logout() + `/login` 리다이렉트

### 하위 호환성 전략
- `useUserStore.currentUserId`는 `useAuthStore.currentUserId`를 delegate하여 기존 컴포넌트 코드 변경 최소화
- 기존 seed.py 유저 구조 유지, `password_hash` 및 `email` 필드만 추가
