---
id: SPEC-AUTH-001
version: "1.0.0"
status: approved
created: "2026-02-19"
updated: "2026-02-19"
author: MoAI
priority: high
---

# SPEC-AUTH-001: JWT 인증/인가 시스템

## HISTORY

| 버전  | 날짜       | 작성자 | 변경 내용        |
| ----- | ---------- | ------ | ---------------- |
| 1.0.0 | 2026-02-19 | MoAI   | 최초 작성 (초안) |

---

## 개요

현재 PCM(Process Condition Manager) 시스템은 헤더의 드롭다운으로 사용자를 선택하는 방식으로 인증을 처리하고 있다. 이를 JWT(JSON Web Token) 기반 로그인 시스템으로 교체하여 실질적인 사용자 인증 및 역할 기반 접근 제어(RBAC)를 도입한다.

**현재 상태**: X-User-Id 헤더로 사용자 식별 (Phase 1 임시 구현)
**목표 상태**: JWT access token + refresh token (HTTP-only cookie) 기반 인증/인가

---

## Ubiquitous Requirements (상시 요구사항)

### REQ-AUTH-001
시스템은 `/api/auth/` 경로를 제외한 모든 `/api/` 엔드포인트에 대해 **항상** JWT access token 유효성 검증을 수행해야 한다.

### REQ-AUTH-002
시스템은 사용자 password를 **항상** bcrypt 해시로 저장해야 한다. 평문(plaintext) password 저장은 절대 허용되지 않는다.

### REQ-AUTH-003
시스템의 JWT token payload에는 **항상** `user_id`, `username`, `role`, `exp` 필드가 포함되어야 한다.

### REQ-AUTH-004
시스템은 CORS 설정에서 **항상** `Authorization` 헤더를 허용해야 한다.

---

## Event-Driven Requirements (이벤트 기반 요구사항)

### REQ-AUTH-010
**WHEN** 올바른 credentials(username, password)로 `POST /api/auth/login`을 호출하면,
**THEN** 시스템은 access token(유효기간 15분)과 refresh token(유효기간 7일, HTTP-only cookie)을 응답해야 한다.

### REQ-AUTH-011
**WHEN** `POST /api/auth/refresh`를 호출하면,
**THEN** 시스템은 HTTP-only cookie의 refresh token을 검증하고, 유효한 경우 새로운 access token을 발급해야 한다.

### REQ-AUTH-012
**WHEN** `POST /api/auth/logout`을 호출하면,
**THEN** 시스템은 refresh token cookie를 만료시키고 200 응답을 반환해야 한다.

### REQ-AUTH-013
**WHEN** access token 만료 1분 전이 되면,
**THEN** 프론트엔드는 자동으로 `/api/auth/refresh`를 호출하여 새 access token을 갱신해야 한다.

### REQ-AUTH-014
**WHEN** API 호출에서 401 응답을 받으면,
**THEN** 프론트엔드는 token refresh를 1회 시도하고, 실패할 경우 `/login`으로 리다이렉트해야 한다.

### REQ-AUTH-015
**WHEN** 비로그인 사용자가 보호된 경로에 접근하면,
**THEN** 시스템은 `/login?redirect={원래경로}`로 리다이렉트해야 한다.

### REQ-AUTH-016
**WHEN** 로그인 성공 후 `redirect` 쿼리 파라미터가 존재하면,
**THEN** 시스템은 해당 경로로 리다이렉트해야 한다.

---

## Unwanted Requirements (금지 요구사항)

### REQ-AUTH-020
마이그레이션 완료 후, 시스템은 `X-User-Id` 헤더만으로 사용자 인증을 처리**하지 않아야 한다**.

### REQ-AUTH-021
프론트엔드는 access token을 `localStorage`에 저장**하지 않아야 한다** (XSS 공격 방어).

### REQ-AUTH-022
시스템은 만료된 JWT token으로의 API 접근을 허용**하지 않아야 한다**.

### REQ-AUTH-023
시스템은 `admin` 역할이 아닌 사용자의 `/api/admin/` 엔드포인트 접근을 허용**하지 않아야 한다**.

### REQ-AUTH-024
시스템은 `reviewer` 역할이 아닌 사용자의 approve/reject 엔드포인트 호출을 허용**하지 않아야 한다**.

### REQ-AUTH-025
시스템은 타 사용자 소유의 프로젝트 수정을 허용**하지 않아야 한다** (본인 소유 또는 admin 역할 예외).

---

## State-Driven Requirements (상태 기반 요구사항)

### REQ-AUTH-030
**IF** 사용자의 `is_active` 값이 `False`이면,
**THEN** 시스템은 해당 사용자의 로그인 시도를 거부하고 401 응답을 반환해야 한다.

### REQ-AUTH-031
**IF** 사용자의 `role`이 `admin`이면,
**THEN** 시스템은 모든 CRUD 작업을 허용해야 한다.

### REQ-AUTH-032
**IF** 사용자의 `role`이 `reviewer`이면,
**THEN** 시스템은 읽기 권한과 승인/반려 권한을 허용해야 한다.

### REQ-AUTH-033
**IF** 사용자의 `role`이 `editor`이면,
**THEN** 시스템은 본인 소유 프로젝트의 생성/수정 권한과 댓글 작성 권한을 허용해야 한다.

### REQ-AUTH-034
**IF** 프론트엔드의 `accessToken`이 `null`이면,
**THEN** 시스템은 사용자를 `/login`으로 리다이렉트해야 한다.

---

## Optional Requirements (선택적 요구사항)

### REQ-AUTH-040
**가능하면** 로그인 화면에 "로그인 상태 유지" 체크박스를 제공하여 refresh token 유효기간을 선택적으로 연장할 수 있어야 한다.

### REQ-AUTH-041
**가능하면** 관리자가 특정 사용자의 비밀번호를 초기화할 수 있는 기능을 제공해야 한다.

### REQ-AUTH-042
**가능하면** 로그인 5회 연속 실패 시 계정을 30분간 잠금 처리하는 기능을 제공해야 한다.

---

## 기술 제약사항 (Technical Constraints)

### 의존성 버전
```
python-jose[cryptography]==3.3.0
passlib[bcrypt]==1.7.4
bcrypt==4.2.1
```

### 아키텍처 제약
- 기존 `user.id` FK 관계는 모든 테이블에서 보존해야 한다
- 기존 시드 유저의 초기 비밀번호: `"changeme123!"`
- Access token 유효기간: 15분
- Refresh token 유효기간: 7일
- Refresh token 저장 방식: HTTP-only Secure Cookie

### 데이터베이스 변경사항
- `users` 테이블에 `password_hash VARCHAR(255)`, `email VARCHAR(255)` 컬럼 추가
- 기존 데이터 마이그레이션: 시드 스크립트로 초기 password_hash 삽입

### 보안 요구사항
- SECRET_KEY는 환경변수로 관리 (코드에 하드코딩 금지)
- JWT ALGORITHM: HS256
- CORS: `credentials: true` 설정 필수

---

## 마일스톤 (Milestones)

| 마일스톤 | 내용                          | 우선순위     |
| -------- | ----------------------------- | ------------ |
| M1       | 백엔드 Auth 모듈              | Priority High |
| M2       | 프론트엔드 Auth UI            | Priority High |
| M3       | RBAC 엔드포인트 강화          | Priority Medium |
