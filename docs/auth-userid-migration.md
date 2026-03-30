# `/auth/me` userid 전환 및 username alias 제거 일정

## 배경
- 인증 토큰 payload와 `/auth/me` 응답에서 로그인 식별자 키를 `username`에서 `userid`로 통일한다.
- DB 컬럼/관리자 기능의 사용자 계정 필드(`users.username`)는 그대로 유지한다.

## 적용 범위
- JWT access token payload: `username` → `userid`
- `/auth/me` 응답: `userid`를 표준 필드로 제공
- 구버전 호환: `/auth/me`에 `username` alias를 **읽기 전용**으로 한 릴리스 동안 병행 제공

## 호환 정책
- 호환 시작: 2026-03-30 릴리스
- alias 제거 예정: 2026-06-30 이후 첫 정식 릴리스

> 권장: 프론트/외부 클라이언트는 즉시 `userid`를 사용하고 `username` 의존 코드를 제거한다.
