# Phase 1 MVP - 태스크 리스트

> **목표**: "backbone 기반으로 조건표를 생성하고, 웹에서 300개 컬럼을 편집·검증·저장할 수 있다"  
> **개발**: 1인 개발  
> **순서**: 위에서 아래로 순차 진행 (의존관계 반영)

---

## Sprint 1: 프로젝트 세팅 + DB

| # | 태스크 | 설명 | 산출물 |
|---|--------|------|--------|
| 1.1 | Docker Compose 구성 | FastAPI + PostgreSQL + Nginx 컨테이너 세팅, hot reload 개발환경 | docker-compose.yml, Dockerfile |
| 1.2 | FastAPI 프로젝트 구조 | 디렉토리 구조, 설정(config), DB 연결, Alembic 초기화 | 백엔드 boilerplate |
| 1.3 | React 프로젝트 구조 | CRA 또는 Vite, 라우팅 기본 설정, AG Grid 설치 | 프론트엔드 boilerplate |
| 1.4 | SQLAlchemy 모델 정의 | 스키마 문서 기반 전체 모델 작성 | models.py |
| 1.5 | Alembic 마이그레이션 | 초기 테이블 생성 마이그레이션 | migration 파일 |
| 1.6 | 시드 데이터 | column_definitions(300개), column_categories(4개), 테스트용 제품/레이어 데이터 | seed 스크립트 |

---

## Sprint 2: 백엔드 핵심 API

| # | 태스크 | 설명 | 산출물 |
|---|--------|------|--------|
| 2.1 | 제품/레이어 CRUD API | products, layers, product_layers 조회·등록 | /api/products, /api/layers |
| 2.2 | 프로젝트 생성 API | 신규 프로젝트 생성 + backbone 복사 로직 (Step 1) | POST /api/projects |
| 2.3 | 프로젝트 조건표 조회 API | project_layers의 conditions JSONB를 카테고리별로 반환 | GET /api/projects/{id}/conditions |
| 2.4 | 셀 편집 API | 단일/다중 셀 업데이트, change_log 자동 기록 | PATCH /api/projects/{id}/layers/{id}/conditions |
| 2.5 | 저장 API | 전체 조건표 저장 (벌크 업데이트) | PUT /api/projects/{id}/conditions |
| 2.6 | 컬럼 메타데이터 API | column_definitions + validations 조회 (프론트 그리드 설정용) | GET /api/columns |
| 2.7 | 검증 API | 전체 조건표 검증 실행, 오류 목록 반환 | POST /api/projects/{id}/validate |

---

## Sprint 3: 프론트엔드 핵심 UI

| # | 태스크 | 설명 | 산출물 |
|---|--------|------|--------|
| 3.1 | 프로젝트 목록 페이지 | 프로젝트 리스트, 상태 표시, 생성 버튼 | /projects 페이지 |
| 3.2 | 프로젝트 생성 모달/페이지 | 제품명 입력, backbone 선택, 생성 | 생성 폼 |
| 3.3 | 조건표 편집 페이지 레이아웃 | 헤더 + 좌측 레이어 패널 + 메인 그리드 + 하단 검증 패널 | /projects/{id}/edit 페이지 뼈대 |
| 3.4 | 카테고리 탭 구현 | SP/SC/OVL/DEV 탭 전환, 탭별 컬럼 필터링 | 탭 컴포넌트 |
| 3.5 | AG Grid 통합 | 컬럼 정의 동적 생성, 셀 편집, 고정 컬럼(레이어명), display_name 표시 | 그리드 컴포넌트 |
| 3.6 | 셀 편집 연동 | 셀 변경 시 API 호출, 저장 버튼, 로딩/에러 처리 | 편집 로직 |
| 3.7 | 셀 스타일링 | backbone 대비 변경(노란), 검증 오류(빨간), 툴팁(원래값 표시) | cellStyle, tooltip |
| 3.8 | 레이어 네비게이션 패널 | 레이어 목록, 클릭시 행 스크롤, 오류 건수 뱃지 | 좌측 패널 컴포넌트 |
| 3.9 | 검증 패널 | 하단 오류 목록, 클릭시 해당 셀로 이동 | 하단 패널 컴포넌트 |
| 3.10 | 실시간 셀 검증 | 셀 편집 완료 시 프론트에서 즉시 검증 (범위, 필수값) | 검증 로직 |

---

## Sprint 4: 통합 + 마무리

| # | 태스크 | 설명 | 산출물 |
|---|--------|------|--------|
| 4.1 | 프론트-백엔드 E2E 연결 | API 연동 전체 점검, 에러 핸들링 통일 | 통합 테스트 |
| 4.2 | backbone 대비 diff 로직 | conditions vs backbone_conditions 비교, 변경 셀 목록 생성 | diff 유틸리티 |
| 4.3 | 복사·붙여넣기 지원 | AG Grid에서 Excel↔그리드 간 복붙 동작 확인 및 보완 | 복붙 핸들러 |
| 4.4 | 기본 인증 (간이) | 간단한 로그인 (사용자 선택 또는 기본 인증), 편집자 식별용 | 로그인 페이지 |
| 4.5 | 배포 설정 | Docker Compose production 설정, Nginx SSL, 환경변수 분리 | docker-compose.prod.yml |
| 4.6 | 사용자 테스트 준비 | 테스트 시나리오 작성, 샘플 데이터 세팅, 팀원 피드백 수집 계획 | 테스트 문서 |

---

## 태스크 의존관계 요약

```
1.1 → 1.2 → 1.4 → 1.5 → 1.6
1.1 → 1.3
1.5 → 2.1 → 2.2 → 2.3
1.5 → 2.6
2.3 + 2.6 → 3.3 → 3.4 → 3.5
2.4 → 3.6 → 3.7
2.7 → 3.9 → 3.10
3.5 → 3.8
전체 → 4.1 → 4.2 → 4.3
4.1 → 4.4 → 4.5 → 4.6
```

---

## Phase 1 완료 기준 (Definition of Done)

- [ ] 프로젝트 생성 시 backbone 조건표가 복사되어 초안이 만들어진다
- [ ] 카테고리 탭(SP/SC/OVL/DEV)으로 나눠서 조건표를 편집할 수 있다
- [ ] 컬럼명이 display_name으로 표시된다
- [ ] 셀 편집 시 실시간 검증(범위, 필수값)이 동작한다
- [ ] 저장 시 전체 검증이 동작한다
- [ ] backbone 대비 변경된 셀이 노란색으로 하이라이트된다
- [ ] 검증 오류 셀이 빨간색으로 표시되고, 오류 목록에서 클릭하면 해당 셀로 이동한다
- [ ] 변경 이력이 DB에 기록된다
- [ ] Docker Compose로 배포할 수 있다
