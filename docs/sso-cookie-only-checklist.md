# SSO Cookie-Only 정리 체크리스트

## 목표
- 인증 경로를 `app_token` HttpOnly 쿠키 단일 방식으로 단순화한다.
- Bearer 토큰/refresh 기반 레거시 흐름을 제거한다.

## 체크리스트

- [x] **백엔드 인증 의존성 단일화**
  - `get_current_user`에서 Bearer fallback 제거
  - `app_token` 쿠키만 검증

- [x] **백엔드 refresh 엔드포인트 제거**
  - `/api/auth/refresh` 삭제
  - 쿠키 세션만 유지

- [x] **프론트 토큰 주입/리프레시 로직 제거**
  - Axios 인터셉터의 Authorization 헤더 주입 제거
  - 401 리프레시 큐 제거

- [x] **프론트 상태 저장소 정리**
  - `login`은 SSO redirect만 수행
  - `restoreSession`은 `/auth/me` 기반
  - `refreshToken`, `setAccessToken`은 호환용 no-op으로 유지

- [x] **동작 검증**
  - 백엔드 문법 컴파일
  - 프론트 빌드


- [x] **사용자 식별자 필드 명세 정리**
  - 표준 식별자는 `userid`(= SSO `loginid`)
  - `/auth/me` 응답의 `username`, `display_name`은 `userid`와 동일 값으로 유지

## 비고
- 테스트 코드 호환을 위해 store 시그니처(`refreshToken`, `setAccessToken`)는 유지하되 동작은 비활성(no-op) 처리.


## DEV 로그인 우회 (사외 개발용)
- 엔드포인트: `/api/auth/dev-login`
- 활성 조건: `ENVIRONMENT=development` 또는 `DEV_LOGIN_ENABLED=true`
- 계정 제한: `DEV_LOGIN_ALLOWLIST`(콤마 구분) 설정 시 화이트리스트만 허용
- 기본 계정: `DEV_LOGIN_DEFAULT_USERNAME`
- 운영에서는 반드시 비활성화
