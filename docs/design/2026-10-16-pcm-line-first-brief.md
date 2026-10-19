# PCM 제품 목록: LINE 중심 탐색

2026-10-16 검토 시작, 2026-10-17 사용자 합의사항 반영.
2026-10-19 현재 동작 설명을 기준 main `8aa5052`의 소스에 동기화했다. 시안·당시 검증 기록은 아래에 구분해 보존한다.

## 목적과 확정된 범위

공정 엔지니어가 LINE으로 작업 범위를 정하고 Process 또는 Part ID로 공정조건을 찾는다. 시각적 계층 부재를 우선 해결하며, 상태 가독성과 큰 목록 탐색을 함께 개선한다. 실제 규모는 5–6개 LINE, LINE별 수천 개 이상의 Process다.

- 화면 메뉴·목록 제목: **제품 목록**.
- 상세 의미: **제품 공정조건**. 등록 행동: **공정조건 등록**.
- 프로젝트명은 목록의 식별 정보에서 제외한다.
- LINE + Process + Part ID 조합마다 최신 버전 한 행만 표시한다. 과거 버전은 이력에 보존한다.
- 최신은 최신 승인본과 다르다. 신규 작성·검토 중 리비전도 최신이면 표시한다.
- LINE 선택 시 첫 25건을 조회하며, 검색과 이전/다음 페이지 이동을 제공한다.
- 내부 Project 모델명·API 명칭은 우선 유지한다. 이름 컬럼 삭제나 전체 모듈 이름 변경은 이번 작업 범위가 아니다.

## 검토 산출물

- [클릭 가능한 목록 시안](../../opendesign/mockups/pcm-line-first/index.html)
- [현재 데이터 모델 HTML](data-model/index.html)
- [모델 근거와 검증 범위](data-model/README.md)

목록 시안은 6개 LINE별 63개 조합의 유한한 예시 데이터로 작동한다. 실제 데이터 연결, 수천 건 성능 검증 또는 앱 구현 완료를 뜻하지 않는다. 두 HTML은 외부 CDN 없이 파일을 직접 열 수 있다.

로컬 HTTP 미리보기는 저장소 루트에서 다음과 같이 실행한다. 이미 같은 서버가 실행 중이면 재사용한다.

```bash
python3 -m http.server 8289 --directory .
```

- 목록: <http://localhost:8289/opendesign/mockups/pcm-line-first/index.html>
- 모델: <http://localhost:8289/docs/design/data-model/index.html>

## 시각적·상호작용 기준과 당시 시안

- 종이색·먹색·파란 행동색을 사용한다. 왼쪽 LINE 선택을 먼저 인식하게 하고 현재 LINE을 목록 위에 표시한다.
- Process와 Part ID를 15–17px의 주요 행 정보로, 수정일·버전을 보조 정보로 배치한다. 행 높이는 시안에서 약 66px다.
- 상태는 14px/700의 비대화형 캡슐 배지다. 작성 중은 중립 회색, 검토 중은 황색, 승인됨은 녹색으로 배경·테두리·문구를 함께 사용한다. 반려용 적색 스타일도 정의했다.
- 실제 행동은 직사각형 `열기` 버튼으로 구분한다. 열 제목과 접근성 이름은 공정조건 열기를 명시한다. 상태 배지에는 pointer/hover 행동 표시를 두지 않는다.
- 반복 검색 제목, 원시 계보 ID, 허용 액션 열을 기본 목록에서 제거한다.
- 검색은 현재 LINE 안에서 Process 또는 Part ID를 대상으로 한다. 검색 버튼 또는 Enter로 실행하며 입력만으로 조회하지 않는다.
- 검색 실행 또는 LINE 변경 시 첫 페이지로 돌아간다. LINE 변경 시 적용된 검색어를 유지하고, 미제출 입력은 적용된 검색어로 복원한다.
- 초기화는 검색을 해제하고 첫 페이지를 보여준다. 상단·하단에 이전/다음 버튼을 두고 첫·마지막 페이지 비활성 상태를 동기화한다. 페이지 이동 후 결과 시작점으로 스크롤한다.
- LINE 옆 전체 건수는 표시하지 않는다. 현재 표시 범위와 다음 페이지 유무만으로 탐색할 수 있다.

시안의 열기 다이얼로그는 식별 정보와 버전 이력을 보여준다. 실제 상세 화면·조건표 전체를 대체하는 구현은 아니다. 공정조건 등록 폼도 예시 데이터에서 조합 중복만 확인하며 저장하지 않는다. 기존 생성 계약의 나머지 필수 항목은 시안에 포함하지 않았다.

## 현재 앱 구현

근거: `frontend/src/features/projects/{ProjectListPage,ProjectTable,ProductWorkspace,ProjectCreateWizard}.tsx`, `frontend/src/features/projects/wizardState.ts`, `frontend/src/api/projects.ts`, `backend/app/features/projects/{router,repository,service,schema}.py`.

- `GET /api/projects/lines`로 LINE을 조회하고 선택한 LINE을 `line_id`로 전달한다. `query`는 Process/Part ID를 대상으로 하며 버튼/Enter로만 적용한다.
- 서버는 LINE/Process/Part ID별 version 내림차순, 동률이면 id 내림차순으로 최신 행을 고른다. 그 뒤 상태/Profile 필터와 커서를 적용하고 id 내림차순으로 페이지를 나눈다. 기본 limit와 UI 요청은 25다. 과거 행을 브라우저에서 제거하는 방식이 아니다.
- LINE 변경은 적용된 검색어를 유지하고 미제출 입력을 되돌리며 첫 페이지로 이동한다. 검색 실행·초기화도 첫 페이지로 돌아간다. 목록 URL과 복귀 시 행 포커스 문맥을 유지한다.
- `열기`는 `/projects/:projectId/sheet`로 바로 이동한다. 공통 식별·버전·상태 아래 조건표/기본정보/이력을 제공한다. 기존 `/projects/:projectId`는 조건표로 연결한다. 탭 이동은 입력과 붙여넣기를 유지하며 기본정보 변경·상태 변경 등은 미저장 입력/진행 중 저장을 보호하고 편집 잠금을 인계한다. 해제/재조회 실패는 편집을 중지하고 재시도를 안내한다.
- 공정조건 등록에는 별도 프로젝트명 입력이 없다. UI는 `trim()`한 Part ID를 필수 호환용 `name`에도 보낸다. 내부 Project 모델명·필수 name 컬럼/API 계약은 유지한다. 기존 LINE/Process의 다른 Part ID는 허용하며, 같은 조합은 서버의 HTTP 409 계약으로 차단한다.

## 검증 근거와 남은 경계

- [Issue 87 검증](../verification/issue87/README.md): 격리된 PostgreSQL fixture의 실제 API로 LINE·검색·페이지와 대량 조회를 검증한 당시 기록이다. 브라우저와 규모 시험의 데이터 차이, 로컬 수치와 운영 보장 차이는 원문에 유지한다.
- [제품 작업화면 검증](../evidence/product-workspace-89/README.md): 조건표/기본정보/이력의 문맥·입력 보호·잠금 인계 UI를 검증했다. 모든 backend API가 모의 응답이므로 실제 DB/fencing 검증을 뜻하지 않는다.
- 아래 독립 시안은 앱 이전의 예시다. 시안의 상세 다이얼로그·저장하지 않는 등록 폼은 현재 앱의 동작 설명이 아니다.
- 폰트의 실제 앱 배포·로딩 계약은 [DESIGN](../../DESIGN.md#typography)에 기록한다. 아래 시안의 시스템 fallback 관찰과 구분한다.
- 모델 다이어그램의 ORM/마이그레이션 차이는 실제 DB 확인 없이 해결된 것으로 판단하지 않는다. 이 작업은 스키마·데이터를 변경하지 않는다.

## 시안 검증 결과와 한계

브라우저에서 25/25/13 분할, 첫·마지막 페이지 비활성, 버튼/Enter 검색, Process·Part ID 검색, LINE 변경 시 적용 검색어 유지와 첫 페이지 복귀, 빈 결과·초기화, 이력 표시를 확인했다. 하단 페이지 버튼의 이동과 결과 시작점 스크롤도 확인했다. Escape로 상세 창을 닫으면 원래 열기 버튼으로 포커스가 돌아온다.

1440/1024 화면을 직접 검토했으며 1024에서 가로 넘침과 배지 셀 넘침이 없었다. 상태 배지 14px/700 및 브라우저 실행 오류 0건을 확인했다. 이 검증은 유한한 예시 데이터를 쓰는 독립 시안에 한정되며 실제 앱의 전체 테스트나 수천 건 API 성능 통과를 뜻하지 않는다.

외부 폰트 요청은 없다. 시안은 Noto Sans KR/Apple SD Gothic Neo/Malgun Gothic/WenQuanYi/sans-serif 폴백을 사용하며 확인 환경에서는 WenQuanYi를 사용할 수 있었다. 이 문장은 당시 시안의 관찰이다. 현재 앱의 로컬 폰트 계약은 [DESIGN](../../DESIGN.md#typography)을 따른다.
