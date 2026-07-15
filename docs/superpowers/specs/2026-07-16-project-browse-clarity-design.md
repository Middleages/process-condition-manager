# 프로젝트 탐색 화면 명료화 설계

- **Status:** Approved
- **Approved:** 2026-07-16
- **Selected direction:** A — 핵심정보 우선 탐색
- **Design authority:** [`DESIGN.md`](../../../DESIGN.md)
- **Implementation scope:** `/projects`, `/projects/:projectId`

## 1. 배경과 문제

프로젝트 생성 화면을 정리한 뒤 목록과 상세를 같은 시각 원칙으로 검토했다. 기능과 URL
복원은 안정적이지만 현재 화면에는 다음 문제가 있다.

1. 목록의 두 Choice filter가 값이 없을 때도 각각 `선택 없음` 상태 행을 차지한다.
2. 1920px 목록은 검색·분류 입력과 표가 화면 전체로 벌어져 비교 시선 이동이 길다.
3. 1024px 목록은 실제로 숨긴 열이 있어도 표의 1040px 최소 폭 때문에 불필요한 내부 가로
   scroll이 생긴다.
4. 상세는 세 개의 요약 수치 뒤에 여섯 개의 Profile 카드가 이어져 surface 안의 surface가
   반복된다.
5. nullable Profile 값이 비어 있어도 각 카드가 같은 높이와 시각 무게를 가지므로 Layer
   구성과 조건표 이동보다 빈 Profile이 먼저 보인다.
6. 상세의 첫 업무인 프로젝트 식별, 분류 확인, Layer 검토가 하나의 읽기 흐름으로 연결되지
   않는다.

검토 근거:

- `DESIGN.md`
- `docs/superpowers/specs/2026-07-13-phase-2-5-ui-ux-design.md`
- `docs/superpowers/specs/2026-07-14-phase-2-6-project-profile-managed-choice-design.md`
- `frontend/src/features/projects/ProjectListPage.tsx`
- `frontend/src/features/projects/ProjectTable.tsx`
- `frontend/src/features/projects/ProjectDetailPage.tsx`
- `docs/superpowers/evidence/phase-2-6/screenshots/responsive-project-list-*.png`
- `docs/superpowers/evidence/phase-2-6/screenshots/responsive-profile-drawer-*.png`

## 2. 목표와 비목표

### 목표

1. 목록에서 검색·분류 filter와 결과 표를 한 번에 훑을 수 있게 한다.
2. 상세의 핵심 식별·분류 정보를 먼저 보여주고 빈 고급 Profile의 시각 무게를 낮춘다.
3. 1440×900에서 Layer 제목과 표 시작점을 최초 viewport 안에 노출한다.
4. 1024×768 목록에서 body와 표 wrapper의 불필요한 가로 overflow를 없앤다.
5. Profile 전체 조회 가능성과 잠금 기반 편집 동작은 유지한다.
6. 목록 query/filter/history/focus 복원과 상세의 목록 복귀 문맥을 보존한다.

### 비목표

- 프로젝트 API, 응답 필드, pagination, 정렬, 상태 모델 변경
- 새 목록 column, server-side filter, 전체 결과 수 추가
- Profile 필드 집합, 값 검증, 저장 payload, 잠금 protocol 변경
- Profile 편집 drawer 자체의 재설계
- Layer 교체 modal 또는 조건표 편집기 변경
- App Shell과 공통 `PageHeader`의 전역 재설계
- 새 dependency, font, icon package 추가

## 3. 선택한 방향

사용자가 선택한 **A — 핵심정보 우선 탐색**을 적용한다.

- 목록은 검색·분류 filter를 하나의 조밀한 도구 영역으로 묶고 표 비교 폭을 제한한다.
- 상세는 Identity, Product, Direction을 한 개의 핵심정보 surface에서 항상 보여준다.
- Die/Shot, Wafer Position, Layer Summary는 native `details`의 `상세 공정 Profile`에 기본
  접힘으로 둔다.
- Layer 구성은 접힌 상세 Profile 다음에 즉시 배치한다.

기각한 대안:

- **모든 Profile을 한 surface에 항상 펼침:** 카드 수는 줄지만 nullable 필드가 계속 Layer를
  아래로 밀어낸다.
- **Profile/Layer 탭:** 가장 단정하지만 두 문맥을 숨기고 탭 URL·focus·복원 상태를 새로
  소유해야 한다.

## 4. 공통 작업 프레임

- `/projects`와 `/projects/:projectId`는 `mx-auto w-full max-w-[1600px]` 작업 프레임을
  사용한다.
- App Shell의 폭과 다른 route는 변경하지 않는다.
- 1024px에서는 기존 main padding 안의 가용 폭을 모두 사용한다.
- 1920px에서는 양쪽 여백을 남겨 검색 입력, Profile 값, 표 열의 시선 이동을 제한한다.
- 기본 surface는 border 중심으로 유지하고 overlay가 아닌 본문에는 새 그림자를 추가하지
  않는다.

## 5. 프로젝트 목록

### 5.1 Filter 도구 영역

- 검색과 두 managed-choice filter를 `프로젝트 찾기`라는 한 영역으로 묶는다.
- 영역 머리의 오른쪽에는 실제 cache에 누적된 값만 `불러온 N개`로 표시한다.
- 검색, Device Type, Project Category는 1024px 이상에서 한 줄 세 열로 배치한다.
- `SearchableChoice`의 선택 상태 live region은 유지한다.
- 값이 없을 때의 `선택 없음`만 시각적으로 `sr-only` 처리해 placeholder와 중복하지 않는다.
- 선택 값, 비활성 badge, 선택 해제, loading/error/retry는 계속 보인다.
- 새 `초기화` 행동은 추가하지 않는다. 기존 입력/선택 해제로 동일한 상태를 만든다.

### 5.2 결과 표

- 승인된 여덟 열과 순서를 유지한다: 프로젝트명, LINE / Process, PARTID, Device Type,
  Category, Layer Total, 상태, Updated.
- Layer Total은 기존처럼 `2xl`, Updated는 `xl`부터 표시한다.
- 표 최소 폭을 920px로 낮춰 1024px에서 숨겨진 열 때문에 생기는 내부 가로 scroll을
  제거한다.
- 긴 값은 기존 title, truncate, raw inactive code 표시를 유지한다.
- 프로젝트명은 실제 link이고 Back 복귀 focus 계약을 유지한다.
- 적은 결과 아래의 빈 canvas는 KPI나 장식 카드로 채우지 않는다.

## 6. 프로젝트 상세

### 6.1 요약 strip

- 기존 Layer, 조건 행, Cell에 `백본`을 더해 네 칸의 compact definition strip으로 만든다.
- 백본 표시 규칙:
  - source project가 없으면 `없음`;
  - 한 프로젝트면 `#<projectId>`;
  - 둘 이상이면 `<N>개 프로젝트`.
- 이 값은 이미 받은 `project.layers[].source_project_id`에서 파생하며 API를 추가하지 않는다.

### 6.2 항상 보이는 핵심정보

- 제목은 `프로젝트 정보`, 행동은 기존 `기본정보 편집`을 유지한다.
- Identity, Product, Direction을 한 개의 bordered surface 안에서 구분선 기반 세 영역으로
  표시한다.
- 각 영역은 기존 `data-profile-group` 값을 유지한다.
- Identity는 계속 읽기 전용이며 Product/Direction 값도 편집 drawer를 통해서만 바꾼다.
- inactive choice badge와 raw code/label 표시를 유지한다.

### 6.3 기본 접힘 고급 Profile

- `상세 공정 Profile`을 native `<details>`와 `<summary>`로 제공한다.
- 기본은 닫힘이며 URL이나 local storage에 열림 상태를 저장하지 않는다.
- summary에는 `Die/Shot · Wafer Position · Layer Summary` 범위를 한 문장으로 설명한다.
- 열면 기존 세 group과 모든 고정 Profile 필드가 구분선 기반 한 surface 안에 나타난다.
- 빈 값은 계속 `—`로 표시한다.
- 모든 값은 server data 그대로 읽고 편집은 기존 drawer가 소유한다.

### 6.4 Layer 구성

- Layer 구성은 접힌 고급 Profile 바로 다음에 둔다.
- 기존 여섯 열, 36px 행, 긴 값 title/truncate, 교체 action, 빈 상태를 유지한다.
- 1440×900의 정상 fixture에서는 Layer 제목과 표 header 및 첫 행이 최초 viewport 안에
  보여야 한다.

## 7. 콘텐츠 규칙

- 목록 도구 제목: `프로젝트 찾기`.
- 상세 핵심 제목: `프로젝트 정보`.
- 접힘 제목: `상세 공정 Profile`.
- `Profile`, Process, Part ID, Device Type, Category, Layer 등 기존 domain 표기는 유지한다.
- 설명은 한 문장으로 제한하고 이미 보이는 식별자나 상태를 반복하지 않는다.
- 전체 결과 수처럼 API가 보장하지 않는 문구를 만들지 않는다.

## 8. 접근성과 반응형

- WCAG 2.2 AA와 기존 focus ring을 유지한다.
- filter 영역은 명시적 heading 또는 accessible name을 가진다.
- managed-choice live region은 빈 시각 상태를 숨겨도 screen reader tree에 남는다.
- native details/summary는 Enter와 Space로 열 수 있어야 하며 별도 click-only wrapper를 만들지
  않는다.
- 목록 link, 상세 편집 trigger, Layer 교체 action의 focus/return 계약을 유지한다.
- 1024×768, 1440×900, 1920×1080에서 body horizontal overflow가 없어야 한다.
- 1024px 목록 표는 wrapper horizontal overflow 없이 승인된 현재 breakpoint 열을 보여준다.
- 1920px 두 route의 실제 작업 프레임은 1600px를 넘지 않는다.

## 9. 기능 보존 계약

다음 동작은 전후가 동일해야 한다.

1. query string의 검색, 상태, Device Type, Project Category 복원
2. 250ms query replace와 명시적 filter history push
3. cursor `더 보기`, loading/error/empty/retry 상태
4. inactive/unknown filter code 보존과 선택 해제
5. 상세 이동 시 `from` state와 Back focus 복귀
6. 잘못된 project ID와 detail retry
7. Profile drawer 잠금 획득, 저장, 충돌, 복구, focus 반환
8. Layer 교체 modal과 완료 후 detail query 반영
9. 모든 Profile 필드와 inactive choice의 읽기 가능성

## 10. 구현 경계

- 수정 중심 파일:
  - `frontend/src/shared/components/SearchableChoice.tsx`
  - `frontend/src/shared/components/SearchableChoice.test.tsx`
  - `frontend/src/features/projects/ProjectListPage.tsx`
  - `frontend/src/features/projects/ProjectListPage.test.tsx`
  - `frontend/src/features/projects/ProjectTable.tsx`
  - `frontend/src/features/projects/ProjectTable.test.tsx`
  - `frontend/src/features/projects/ProjectDetailPage.tsx`
  - `frontend/src/features/projects/ProjectDetailPage.test.tsx`
- API, query key, route state, drawer, modal, backend는 수정하지 않는다.
- 단발 layout wrapper를 shared component로 올리지 않는다.
- 표시 metadata가 중복되지 않는 한 새 abstraction을 만들지 않는다.

## 11. 검증과 완료 조건

### 자동 검증

- SearchableChoice의 empty-status 시각 축소와 live semantics 회귀 테스트
- 목록 URL/filter/history 및 표 열/긴 값 테스트
- 상세 여섯 Profile group, 전체 필드, 읽기 전용 Identity, drawer trigger, Layer 표 테스트
- 전체 frontend Vitest, lint, typecheck, production build
- `git diff --check`

### 브라우저 검증

- 목록·상세 각각 1024×768, 1440×900, 1920×1080 캡처
- body 및 목록 표 wrapper overflow 측정
- 1920px 작업 프레임 폭 측정
- 1440×900 상세의 Layer header/첫 행 최초 viewport 노출 확인
- details 기본 닫힘, keyboard toggle, 편집 trigger 접근 확인
- 예상하지 않은 console/network/static failure 0건

## 12. 후속 slice

이 slice 검증과 병합 후 다음 순서로 진행한다.

1. 공통 PageHeader와 App Shell의 계층 일관성
2. 조건표 header·category 선택·검증 workbench의 시각 소음
3. Glide grid 고정 열, 상태 표시, 선택/오류 대비
