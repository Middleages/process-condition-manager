---
id: SPEC-AUTH-001
type: acceptance
version: "1.0.0"
---

# SPEC-AUTH-001: 수용 기준 (Acceptance Criteria)

## 참조 (Reference)
- SPEC: `.moai/specs/SPEC-AUTH-001/spec.md`
- 구현 계획: `.moai/specs/SPEC-AUTH-001/plan.md`

---

## 시나리오 1: 로그인 성공

**관련 요구사항**: REQ-AUTH-010

```
Given 유효한 username과 password가 등록된 사용자가 있을 때
When POST /api/auth/login을 {"username": "admin", "password": "changeme123!"}로 호출하면
Then 200 OK 응답을 받아야 한다
And 응답 body에 "access_token" 필드가 포함되어야 한다
And 응답 header에 "Set-Cookie: refresh_token=...; HttpOnly; SameSite=Lax" 가 포함되어야 한다
And access_token의 payload에 user_id, username, role, exp가 포함되어야 한다
```

---

## 시나리오 2: 로그인 실패 - 잘못된 비밀번호

**관련 요구사항**: REQ-AUTH-010

```
Given 등록된 사용자가 있을 때
When POST /api/auth/login을 {"username": "admin", "password": "wrongpassword"}로 호출하면
Then 401 Unauthorized 응답을 받아야 한다
And 응답 body에 에러 메시지가 포함되어야 한다
And Set-Cookie 헤더가 없어야 한다
```

---

## 시나리오 3: JWT 보호 엔드포인트 접근 성공

**관련 요구사항**: REQ-AUTH-001

```
Given 로그인을 통해 발급된 유효한 access_token이 있을 때
When "Authorization: Bearer {access_token}" 헤더와 함께 GET /api/projects를 호출하면
Then 200 OK 응답을 받아야 한다
And 프로젝트 목록 데이터가 반환되어야 한다
```

---

## 시나리오 4: 미인증 접근 차단

**관련 요구사항**: REQ-AUTH-001, REQ-AUTH-022

```
Given Authorization 헤더가 없을 때
When GET /api/projects를 호출하면
Then 401 Unauthorized 응답을 받아야 한다
And "WWW-Authenticate: Bearer" 헤더가 포함되어야 한다
```

---

## 시나리오 5: Token 자동 갱신 (Silent Refresh)

**관련 요구사항**: REQ-AUTH-011, REQ-AUTH-013, REQ-AUTH-014

```
Given 유효한 refresh token cookie가 있고 access token이 만료된 상태일 때
When 프론트엔드가 API 호출 후 401 응답을 받으면
Then 자동으로 POST /api/auth/refresh를 호출해야 한다
And refresh가 성공하면 새 access_token을 받아야 한다
And 새 access_token으로 원래 실패했던 API 요청을 재시도해야 한다
And 재시도된 요청이 200 OK를 받으면 사용자에게 정상 결과를 표시해야 한다
```

---

## 시나리오 6: RBAC - Admin 전용 접근 차단

**관련 요구사항**: REQ-AUTH-023, REQ-AUTH-031, REQ-AUTH-033

```
Given role='editor'인 사용자가 로그인하여 유효한 access_token을 보유할 때
When "Authorization: Bearer {access_token}" 헤더와 함께 /api/admin/ 엔드포인트를 호출하면
Then 403 Forbidden 응답을 받아야 한다
And 에러 메시지에 권한 부족 관련 내용이 포함되어야 한다
```

---

## 시나리오 7: RBAC - Reviewer 전용 승인 차단

**관련 요구사항**: REQ-AUTH-024, REQ-AUTH-032, REQ-AUTH-033

```
Given role='editor'인 사용자가 로그인하여 유효한 access_token을 보유할 때
When "Authorization: Bearer {access_token}" 헤더와 함께 POST /api/projects/{id}/approve를 호출하면
Then 403 Forbidden 응답을 받아야 한다
And 프로젝트 상태는 변경되지 않아야 한다
```

---

## 시나리오 8: ProtectedRoute 리다이렉트

**관련 요구사항**: REQ-AUTH-015, REQ-AUTH-034

```
Given 브라우저에 로그인 정보(access_token)가 없는 비로그인 상태일 때
When 브라우저에서 /projects 경로에 직접 접근하면
Then /login?redirect=/projects 경로로 리다이렉트되어야 한다
And 로그인 성공 후 /projects로 자동 이동되어야 한다
```

---

## 시나리오 9: 비활성 계정 로그인 차단

**관련 요구사항**: REQ-AUTH-030

```
Given is_active=False 상태인 사용자의 username과 올바른 password가 있을 때
When POST /api/auth/login을 호출하면
Then 401 Unauthorized 응답을 받아야 한다
And 응답 body에 "계정이 비활성 상태입니다" 또는 이에 준하는 메시지가 포함되어야 한다
And Set-Cookie 헤더가 없어야 한다
```

---

## 시나리오 10: 기존 테스트 호환성 유지

**관련 요구사항**: REQ-AUTH-020 (마이그레이션 이후 하위 호환성)

```
Given SPEC-AUTH-001 구현이 완료된 후
When 백엔드에서 기존 pytest 테스트 스위트를 실행하면
Then 모든 기존 테스트가 통과해야 한다 (250건 이상)
And 새로 추가된 Auth 테스트도 모두 통과해야 한다

When 프론트엔드에서 기존 vitest 테스트 스위트를 실행하면
Then 모든 기존 테스트가 통과해야 한다 (71건 이상)
And 새로 추가된 Auth 컴포넌트/스토어 테스트도 모두 통과해야 한다
```

---

## 시나리오 11: Logout

**관련 요구사항**: REQ-AUTH-012

```
Given 로그인된 사용자가 유효한 refresh token cookie를 보유할 때
When POST /api/auth/logout을 호출하면
Then 200 OK 응답을 받아야 한다
And Set-Cookie 헤더로 refresh_token cookie가 만료(Max-Age=0)되어야 한다
And 이후 만료된 refresh token으로 /api/auth/refresh를 호출하면 401을 받아야 한다
```

---

## 시나리오 12: 프로젝트 소유권 검증

**관련 요구사항**: REQ-AUTH-025, REQ-AUTH-033

```
Given user_A가 생성한 프로젝트가 있고, role='editor'인 user_B가 로그인했을 때
When user_B가 "Authorization: Bearer {user_B_token}"으로 user_A의 프로젝트를 수정하면
Then 403 Forbidden 응답을 받아야 한다

Given role='admin'인 admin_user가 로그인했을 때
When admin_user가 user_A의 프로젝트를 수정하면
Then 200 OK 응답을 받아야 한다 (admin은 모든 프로젝트 수정 가능)
```

---

## 시나리오 13: /api/auth/ 경로 인증 면제

**관련 요구사항**: REQ-AUTH-001

```
Given Authorization 헤더가 없을 때
When POST /api/auth/login을 호출하면
Then 401이 아닌 로그인 처리 결과(200 또는 401 credential error)를 받아야 한다
And 미들웨어에서 "인증 토큰 없음"으로 차단되지 않아야 한다
```

---

## 품질 게이트 (Quality Gates)

### 백엔드 테스트 커버리지
- 신규 Auth 코드 (`auth_service.py`, `auth.py`, `dependencies/auth.py`) 커버리지 >= 85%
- 전체 백엔드 테스트 통과: `pytest backend/tests/ -v`

### 프론트엔드 테스트 커버리지
- `useAuthStore.ts`, `LoginPage.tsx`, `ProtectedRoute.tsx` 커버리지 >= 85%
- 전체 프론트엔드 테스트 통과: `npm run test --prefix frontend`

### 타입 안전성
- TypeScript 타입 에러 Zero: `npx tsc --noEmit` 통과
- Python 타입 에러 Zero: `mypy backend/app/` 통과 (선택적)

### 보안 검증
- password 평문 저장 없음 확인 (DB 직접 조회)
- localStorage에 token 저장 없음 확인 (브라우저 DevTools)
- HTTP-only cookie 설정 확인 (응답 헤더 검사)

### Definition of Done (완료 기준)

- [ ] M1.1~M1.7 모든 백엔드 작업 완료 및 테스트 통과
- [ ] M2.1~M2.6 모든 프론트엔드 작업 완료
- [ ] M3.1~M3.4 모든 RBAC 강화 작업 완료
- [ ] 기존 pytest 250건 모두 통과 (regression 없음)
- [ ] 기존 vitest 71건 모두 통과 (regression 없음)
- [ ] 신규 Auth 테스트 시나리오 1~13 모두 통과
- [ ] 백엔드/프론트엔드 커버리지 >= 85%
- [ ] TypeScript 타입 에러 Zero
- [ ] Docker Compose 환경에서 전체 E2E 수동 검증 완료
