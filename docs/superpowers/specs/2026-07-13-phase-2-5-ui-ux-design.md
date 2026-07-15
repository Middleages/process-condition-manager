# Phase 2.5 UI/UX 구조개편 및 디자인 시스템 설계

- **Status:** Approved design; implementation pending
- **Approved:** 2026-07-13
- **Design authority:** [`DESIGN.md`](../../../DESIGN.md)
- **Roadmap position:** Phase 2 조건표 편집기 완료 후, Phase 3 검증 엔진 착수 전

## 1. 배경

Phase 2에서 조건표 조회·편집·자동저장·잠금·Excel 붙여넣기·조건 행 관리가 완성됐다.
그러나 UI는 기능 검증 중심으로 성장해 실제 업무 구조와 화면 책임이 어긋난다.

- `AppLayout`이 모든 화면을 `max-w-6xl`로 제한해 200컬럼 조건표가 브라우저 폭을 쓰지
  못한다.
- `/projects` 한 화면에 프로젝트 생성, 목록, 선택 상세가 함께 있어 직접 링크, 새로고침,
  브라우저 history가 실제 선택 상태를 표현하지 못한다.
- 파라미터 관리에서 CSV, 카테고리 추가, 편집 폼, 목록이 세로로 쌓여 가장 중요한 목록이
  첫 화면 아래로 밀린다.
- 화면마다 Tailwind utility가 직접 반복되고 공통 규칙은 input과 버튼 세 종류뿐이다.
- 향후 Phase 3~6의 검증·이력·코멘트·출력을 붙일 일관된 작업 패널과 상태 표현이 없다.

이 Phase는 기능을 늘리는 단계가 아니라 **기존 기능을 운영 가능한 정보 구조와 시각 계약에
재배치하는 단계**다.

### 1.1 검토한 근거

- `plan/05-ui-wireframe.md`: Project List/Create/Detail/Sheet가 분리된 원래 화면 지도
- `plan/phase-2-tasks.md`: 현재 기능과 회귀 금지 계약
- `plan/phase-3-tasks.md`~`plan/phase-6-tasks.md`: 미래 패널과 route 요구
- `frontend/src/shared/layout/AppLayout.tsx`: 중앙 폭 제한과 상단 내비 구현
- `frontend/src/features/projects/ProjectWorkspacePage.tsx`: 생성/목록/상세 결합
- `frontend/src/features/projects/ProjectCreateWizard.tsx`: 기존 3단계 데이터 흐름
- `frontend/src/features/parameters/ParameterAdminPage.tsx`: 관리 UI 수직 적층
- `frontend/src/features/processes/ProcessExplorerPage.tsx`: 유지 가능한 master-detail 구조
- `frontend/src/features/sheets/SheetView.tsx`: 조건표 orchestration과 상호작용
- `frontend/src/features/sheets/useSheetEditing.ts`: 잠금·자동저장·write queue 계약
- `frontend/src/grid/GlideConditionGrid.tsx`: Canvas grid와 viewport 계약

## 2. 승인된 결정

| 코드 | 결정 | 승인 내용 |
|---|---|---|
| Scope B | 전체 구조개편 | route 분리와 디자인 시스템, 전체 visual polish를 함께 수행 |
| A2 | 적응형 상단 내비 | 일반 화면은 상단 전역 내비, 조건표는 40px 집중 헤더 |
| V1 | Precision Teal | Ink + Teal + 밝은 canvas의 정밀하고 차분한 시각 언어 |
| P1 | 프로젝트 표 중심 | 대시보드보다 검색·상태 필터가 가능한 프로젝트 표 우선 |
| W1 | 단계형 생성 | Process → 백본 → 매칭 확인의 독립 전체 화면 wizard |
| M1 | 목록 + 드로어 | 파라미터 목록은 유지하고 생성·수정은 오른쪽 drawer |
| S1-C | 하단 워크벤치 | future 검증·이력·코멘트는 접이식 하단 패널에 수용하고 검증은 반응형 타일로 표시 |

### 2.1 S1-C 후속 조정

- 고정 2열 카드와 고정 폭 table은 기각한다.
- 오류 타일은 가용 폭을 모두 쓰는 반응형 흐름을 사용한다.
- 열 수는 1024px에서 3개, 1440px에서 4개, 1920px에서 5개로 명시해 초광폭에서
  지나치게 많은 좁은 열이 생기지 않게 한다.
- 기본 타일 높이는 48~52px이고 안내는 한 줄로 자른다.
- 선택한 긴 항목만 확장해 전체 안내를 표시한다.
- 항목 선택은 대상 셀 점프와 focus 이동을 수행한다.

## 3. 목표와 비목표

### 3.1 목표

1. 일반 화면과 조건표가 각 업무에 필요한 viewport를 사용한다.
2. 프로젝트 목록·생성·상세·시트가 고유 URL과 단일 책임을 갖는다.
3. 프로젝트와 파라미터를 조밀한 표에서 빠르게 검색·비교한다.
4. 현재 mutation·잠금·붙여넣기 데이터 흐름을 시각 재배치와 분리한다.
5. Phase 3~6 기능이 현재 작업 문맥을 유지하며 들어올 UI 슬롯을 마련한다.
6. 반복되는 버튼·폼·배지·상태·drawer/dialog 접근성 규칙을 공통화한다.

### 3.2 비목표

- validation rule 엔진, 검증 API, 오류 문구 mapper 구현
- change history, approval, comment, revision, export 기능 구현
- backend schema/API 변경
- Glide Data Grid 교체
- 실시간 협업이나 WebSocket
- 모바일 조건표 편집 최적화
- 새 UI dependency, 외부 font, icon library 추가
- Phase 2의 persistence/domain/lock/autosave 정책 변경

붙여넣기 review mode, 숨겨진 category 검색 이동, read-only/POR 안내는 데이터 정책을 바꾸는
기능 추가가 아니라 이번 구조개편에 포함된 안전성·발견성 보완이다.

## 4. 사용자와 핵심 작업

### 4.1 공정 엔지니어

- 수십~수백 개 프로젝트 중 대상 조건표를 찾는다.
- Process 구조와 백본을 선택해 프로젝트를 생성한다.
- 넓은 데스크톱 화면에서 조건표를 장시간 편집한다.
- 붙여넣기, 조건 행, 잠금, 저장 상태를 놓치지 않아야 한다.

### 4.2 파라미터 관리자

- 레지스트리 항목을 검색하고 연속 수정한다.
- 카테고리와 choice options를 관리한다.
- CSV dry-run 결과를 확인하고 적용한다.

### 4.3 향후 검토자

- 검증·이력·코멘트에서 대상 셀로 이동한다.
- 조건표와 보조 정보를 번갈아 보면서 작업 문맥을 유지한다.

## 5. 정보 구조와 route 계약

```text
App Shell (top navigation)
├─ /projects                         Project List (P1)
│  ├─ /projects/new                 Project Create Wizard (W1)
│  └─ /projects/:projectId          Project Detail
│     └─ /projects/:projectId/sheet Sheet Focus Mode (A2)
├─ /processes                        Process Catalog
└─ /parameters                       Parameter Registry (M1 drawer)
```

### 5.1 일반 App Shell

- 52px 상단 header에 PCM brand, 프로젝트, 공정 카탈로그, 파라미터 관리를 둔다. 현재 API에
  current-user 정보가 없으므로 가짜 사용자 영역은 만들지 않는다.
- sidebar를 두지 않는다.
- main의 전역 `max-w-6xl`을 제거한다.
- 표·그리드 화면은 full-width + responsive gutter를 사용한다.
- 긴 form이나 설명 콘텐츠만 화면 내부에서 국소 max-width를 적용한다.
- active route는 색과 underline/border를 함께 사용한다.

### 5.2 조건표 Focus Shell

- 전역 header를 40px focus header로 교체한다.
- 포함 항목: 프로젝트 상세로 돌아가기, PCM mark, 프로젝트명, 상태, lock/save 상태,
  현재 Phase에서 실제 가능한 핵심 action.
- 전역 navigation 항목은 표시하지 않는다. PCM mark 또는 뒤로가기로 프로젝트 상세에 복귀한다.
- 조건표 본문은 남은 viewport를 채운다. 고정 `70vh`를 사용하지 않는다.
- grid wrapper가 최소 높이를 보장하고 viewport resize에 반응한다.
- shell은 `100dvh` 기반 `auto / auto / minmax(0, 1fr) / auto` grid rows를 사용하고,
  body-level horizontal scroll과 중첩 vertical scroll을 만들지 않는다.
- focus header의 lock/save 정보는 현재 `SheetView`/`useSheetEditing`이 소유한 같은 편집 세션에서
  slot 또는 outlet context로 전달한다. 상태 표시를 위해 두 번째 editing hook이나 별도 lock
  session을 만들지 않는다.
- focus shell 전환 때문에 `SheetEditor`를 새 key로 remount하지 않는다. remount는 lock release,
  dirty reset과 cached sheet 손실을 일으킬 수 있다.

### 5.3 URL 상태

- `/projects?query=&status=`: 검색과 상태를 복원한다. `status`는 현재 `all|draft`만 허용하고,
  `all`이면 API의 status parameter를 생략한다. 실제 상태가 draft 하나뿐인 동안 control은
  숨긴다. unknown status는 `all`로 정규화한다. 서버가 제공하지 않는 전체 정렬은 Phase 2.5에서
  추가하지 않는다.
- `/projects/new?step=&process=&backbone=`: wizard 단계와 서버 entity 선택을 복원한다.
  `process`는 `ProcessOut.key`(`line_id::process_id`)를 `URLSearchParams`로 인코딩한 값이다.
- `/projects/:projectId`: 상세 선택을 path가 소유한다.
- `/parameters?query=&category=&type=&active=&edit=`: 목록과 열린 drawer를 복원한다.
  `edit=new`은 생성, 양의 정수는 기존 parameter ID다.
- transient input과 manual match draft는 local state가 소유한다. entity ID가 URL에 있으면 서버
  preview를 다시 계산할 수 있어야 한다.
- URL parser/serializer는 page component 안에 흩어 두지 않고 순수 함수로 둔다.
- query typing은 history entry를 계속 쌓지 않도록 debounce 후 `replace`하고, 명시적 filter/step
  변경은 의미 있는 history entry만 `push`한다. query/filter 변경 시 in-memory cursor와 누적
  page를 초기화한다.
- 프로젝트의 `더 보기` cursor는 URL에 쓰지 않는다. 첫 page와 이어 붙인 page는 TanStack Query
  cache가 소유하며, browser Back에서는 같은 location의 cache·scroll anchor로 복원한다. 직접
  URL 진입과 새로고침은 항상 현재 query/status의 첫 page부터 시작한다.
- unknown step, non-numeric backbone/edit, stale/deleted ID는 정규화된 오류 상태로 처리하고
  첫 entity를 임의 선택하지 않는다.
- 상세에서 목록으로 돌아가면 query와 가능한 scroll 위치를 복원한다.

## 6. 화면별 설계

### 6.1 프로젝트 목록 — P1

#### 목적

대시보드 수치가 아니라 프로젝트 탐색과 비교가 첫 화면의 주 작업이다. 현재 API가 반환하지
않는 전체 결과 수, 수정 시각, 소유자, 잠금 정보는 표시하지 않는다.

#### 구조

1. `프로젝트` 제목과 짧은 사용자 중심 설명
2. 우측 primary action `새 프로젝트`
3. 검색, 상태 filter, cursor 기반 더 보기
4. compact table

#### 기본 열

- 프로젝트명 + 선택적 description
- line/process + 보조 part 식별자
- 상태
- Layer 수
- cell 수
- row affordance

프로젝트명은 실제 focusable link로 상세 route를 가리킨다. 행 click은 그 link를 보조하는
progressive enhancement일 뿐 click-only `<tr>`를 만들지 않는다. 내부 action이 생기면 row
navigation과 event bubbling을 분리한다. Back으로 돌아오면 기존 query/scroll을 복원하고 해당
row가 남아 있으면 project link, 없으면 목록 제목으로 focus를 보낸다. 빈 상태에는
`새 프로젝트 만들기` 하나만 primary action으로 둔다.
목록 순서는 현재 API의 안정적인 ID 내림차순을 그대로 사용하고 `next_cursor`가 있으면
`더 보기`로 이어 붙인다. 일부 page만 client-side로 재정렬하지 않는다.
현재 Phase 2처럼 실제 status가 하나뿐이면 의미 없는 status filter를 숨긴다. total count를
표시하지 않으며 필요하면 `불러온 N개`로만 표현한다.

#### 제외

- Phase 5 전 의미가 부족한 KPI card
- 목록과 상세의 상시 split view
- local component state만으로 유지되는 선택 프로젝트

### 6.2 프로젝트 생성 — W1

현재 `ProjectCreateWizard`의 data flow와 API를 재사용하되 독립 `/projects/new` route로 옮긴다.

#### 단계

1. **Process 확인**
   - cursor/search 기반 선택, step 수, area, 기존 프로젝트 유무
   - query에 지정된 Process는 첫 200개 목록에 없어도 detail API로 직접 복원
   - 잘못되거나 사라진 key는 임의의 첫 항목으로 바꾸지 않고 1단계 오류와 재선택을 표시
   - D-17에 따라 `ProcessDetailOut.has_project`가 true이면 현재 UI처럼 신규 생성을 막고
     기존 프로젝트 목록으로 안내
   - `ProcessDetailOut`에는 project ID가 없고 하나의 Process에 여러 project가 있을 수 있으므로,
     생성 차단 action은 `/projects?query=<process_id>`로 이동해 사용자가 대상을 고르게 한다.
2. **백본 선택**
   - `백본 없이 시작`과 후보 목록
   - match count/rate를 함께 표시
3. **매칭 확인 + 프로젝트 정보**
   - 자동/수동/미매칭, 복사 예정 cell 수
   - manual override
   - part ID와 프로젝트명
   - 최종 생성 action

상단 stepper는 완료/현재/미완료를 문구와 숫자로 함께 표현한다. 이전 단계로 돌아가도 후속
선택을 무조건 지우지 않으며, Process 변경처럼 계약상 종속 데이터가 무효가 되는 경우에만
백본과 override를 초기화한다. Backbone 변경도 이전 backbone 기준 manual override를
초기화한다.

최종 생성은 현재 `process + backbone + manual overrides`와 정확히 일치하는 preview가 성공한
뒤에만 활성화한다. preview가 fetching/stale/error이면 생성 action을 막고 이유를 표시한다.
선택한 backbone이 삭제되면 선택을 지우고 2단계로 돌려보내며, 후보가 비어 있어도
`백본 없이 시작`은 유효하다. mutation 중에는 action을 잠가 double submit을 막는다.
3단계 새로고침은 URL의 Process/backbone과 서버 preview만 복원한다. local state인 프로젝트명,
part ID, manual override draft는 복원되지 않음을 명확히 하고 빈 입력으로 다시 시작한다.

#### 성공과 실패

- 성공: `/projects/:id`로 replace navigation한다.
- 실패: 현재 단계, 입력, manual override를 유지하고 form 가까이에 재시도 가능한 오류를 보인다.
- duplicate 409: race를 포함한 중복 차단을 설명한다. 현재 구조화된 응답의
  `details.existing_project_id`가 있으면 `/projects/:id` 직접 action을 제공하고, 없거나 해석할
  수 없으면 `/projects?query=<process_id>` 검색 목록으로 fallback한다.
- 이탈: 사용자가 입력이나 override를 바꾼 뒤 닫기/route 이동을 시도하면 확인한다.

### 6.3 프로젝트 상세

프로젝트 상세는 목록과 조건표 사이의 기준점이다.

- 헤더: 프로젝트명, line/process/part, 상태, 조건표 열기
- 요약: Layer 수, 조건 행 수, cell 수, 백본 요약
- 본문: Layer/Step, area, 백본 source, 조건 행, cell, 교체 action
- future tabs: history와 export가 실제 구현되는 Phase에서만 추가

기존 `LayerReplaceModal` 동작은 유지한다. modal trigger와 완료 후 focus 복귀를 명시한다.

### 6.4 Process Catalog

현재 검색 목록 + 구조 preview의 master-detail 패턴은 업무와 맞으므로 유지한다.

- 상단 App Shell과 token만 통일한다.
- `이 구조로 프로젝트 생성`은 `/projects/new?process=...`로 이동한다.
- 이미 프로젝트가 있으면 `/projects?query=<process_id>`로 이동해 일치 목록에서 고르게 한다.
- Process Catalog 안에 별도 생성 form을 복제하지 않는다.

### 6.5 파라미터 관리 — M1

#### 기본 화면

- 목록이 첫 viewport의 중심이다.
- 상단 action: CSV 가져오기, 카테고리 관리, 새 파라미터.
- filter: query, category, value type, active/inactive.
- compact table: code, display name, type, category, unit/constraint summary, active state.
- `/api/parameters`가 server-side로 지원하는 filter는 `include_inactive`뿐이다. `active=all|inactive`
  일 때만 `include_inactive=true`로 조회하고, query/category/type/active는 반환된 registry에
  적용하는 client-side 파생 filter다. unknown 값은 기본 `active`와 전체 category/type으로
  정규화한다.

#### 편집 drawer

- `/parameters?edit=:id`로 열린 대상을 표현한다.
- `edit=new`은 생성 drawer, 양의 정수 ID는 `GET /parameters/:id`로 직접 조회하는 수정
  drawer다. inactive parameter도 deep link로 열 수 있고 상태를 명시한다.
- 잘못된 `edit` 값이나 존재하지 않는 ID는 목록·filter를 유지한 채 drawer 안에 not-found
  상태를 표시한다. 임의의 첫 row를 대신 열지 않는다.
- 권장 폭 420~480px, 넓은 화면에서 최대 40vw.
- 좁은 화면에서는 full-width dialog로 전환한다.
- code와 immutable type은 기존 backend 계약에 맞춰 read-only 처리한다.
- choice options, range, description을 section으로 구분한다. `required`와 `pattern`은 현재
  schema에 없으므로 Phase 2.5에서 field나 빈 placeholder를 렌더링하지 않는다.
- 저장 성공 후 drawer를 닫고 목록을 invalidate한 뒤 수정된 row로 focus를 복귀한다.
- dirty 상태에서 닫기, browser back, 다른 row 열기는 확인한다.
- 열릴 때 drawer 제목(검증 오류가 있으면 첫 오류/field)으로 focus를 보내고, 배경은 inert로
  처리하며 focus trap과 Escape를 지원한다. 닫을 때는 시작 row로 복귀하고, direct-entry라
  trigger가 없거나 row가 filter에서 사라졌으면 parameter 목록 제목으로 복귀한다.
- 현재 parameter update API는 nullable field를 `null`로 지우는 동작을 지원하지 않는다.
  Phase 2.5 UI는 비어 있는 값을 저장해 clear됐다고 거짓 성공을 표시하지 않고, clear 불가를
  설명하며 기존 값을 유지한다. 이 API 제한 수정은 별도 backend 범위다.
- choice 수정은 base PATCH 후 options PUT의 두 요청이다. options 단계 실패 시 base 변경의
  부분 성공 가능성을 알리고 query를 refetch한 뒤 options draft와 재시도 action을 유지한다.

#### 보조 작업

- CSV import는 dialog에서 paste → dry-run → apply 단계를 유지한다.
- category 관리는 small drawer/dialog로 분리하되 현재 UI의 create-only 범위를 유지한다.
  기존 API가 지원하는 category update/deactivate UI 추가는 별도 기능 결정이다.
- inactive parameter는 직접 조회·편집·비활성 상태 확인까지 허용하되 Phase 2.5에서 별도
  reactivate action은 추가하지 않는다.
- 두 작업 모두 기존 API와 query invalidation을 재사용한다.

### 6.6 조건표 — A2

#### 유지해야 하는 Phase 2 계약

- lock acquire/heartbeat/release와 same-user tab fencing
- dirty cell store와 3초 autosave
- shared session write queue
- staged paste preview → apply/cancel
- choice single-click activation
- condition CRUD와 POR transfer
- category tabs, frozen columns, tooltip, column search/jump

#### 화면 배치

1. 40px focus header
2. category/search/condition action toolbar
3. paste staging은 현재처럼 대상과 apply/cancel이 명확히 보이는 pre-grid 영역
4. 남은 viewport를 차지하는 Glide grid
5. content가 있을 때만 나타나는 future bottom workbench slot

#### 발견성과 안전한 편집 상태

- paste staging이 존재하면 적용/취소를 우선하는 단일 review mode로 취급한다. staging 대상과
  결과를 무효화할 셀 편집, 추가 paste, category 전환, 조건 행 구조 변경은 적용 또는 취소가
  끝날 때까지 시작하지 않는다.
- column search는 현재 보이는 category부터 찾는다. 숨겨진 column만 일치하면 해당 category로
  전환한 뒤 jump하고, 결과가 없으면 입력 가까이에 명시한다.
- POR header와 도움말은 `빈 원을 선택하면 POR 이양` 동작을 직접 설명한다.
- read-only 사용자는 paste/POR/조건 행 동작을 안내받지 않고, 잠금 확보 후 가능한 action과
  현재 잠금 상태를 안내받는다.
- 개발자용 구현 설명 대신 사용자가 지금 할 수 있는 작업과 상태를 설명한다.

Phase 2.5는 future validation/history/comment 데이터를 만들지 않는다. Workbench shell은 빈 채로
상시 노출하지 않으며, Phase 3부터 content가 있을 때 mount한다.

#### S1-C workbench 계약

- collapsed 상태는 28~32px status strip.
- expanded 높이 조절은 실제 content가 들어오는 Phase에서 구현한다. 그때 pointer drag뿐 아니라
  focus 가능한 `role="separator"`, 방향·현재값, 화살표 key 조절을 함께 제공하고 내부만 scroll한다.
- validation/history/comment tabs는 해당 기능이 구현된 뒤에만 나타난다.
- validation tile flow는 1024px `repeat(3, minmax(0, 1fr))`, 1440px 4열, 1920px 5열의
  명시적 breakpoint를 사용한다. 그 사이에서는 같은 구간의 열이 남은 폭을 균등하게 채운다.
  1024px 미만에서는 최소 읽기 폭을 기준으로 열 수를 줄이고 horizontal card scroll은 만들지
  않는다.
- 기본 tile은 48~52px, 안내 한 줄. 긴 항목은 선택 시에만 확장한다.
- tile에는 severity, Layer/조건, parameter, 현재 값, 짧은 안내를 담는다.
- 선택하거나 keyboard로 활성화하면 grid가 셀로 이동하고 focus/selection이 해당 셀에 도달한다.
- 잘린 안내의 전체 text는 accessible name/description으로 제공한다. Tile은 Enter/Space로
  선택할 수 있고 확장 상태를 `aria-expanded`로 노출한다.
- 반응형 tile 규칙은 validation 결과에 대한 계약이다. History와 comment의 최종 content
  형태는 각각 Phase 4와 Phase 5가 실제 데이터로 결정한다.

## 7. Visual system — V1 Precision Teal

### 7.1 Semantic color tokens

| Token | Value | Use |
|---|---:|---|
| `ink-950` | `#172F35` | focus header, primary text |
| `brand-700` | `#0F766E` | primary action, active text, light-surface focus |
| `brand-500` | `#14B8A6` | dark-surface focus, nonessential selection/icon accent; white normal text background 금지 |
| `brand-100` | `#CCFBF1` | selected/subtle background |
| `canvas` | `#F4F7F8` | application background |
| `surface` | `#FFFFFF` | table/form/drawer surface |
| `border-subtle` | `#D7E1E5` | 비필수 surface 구분선 |
| `border-control` | `#81979E` | white control boundary; 3:1 이상 |
| `muted` | `#52656A` | canvas/surface 위 secondary text |
| `success-*` | `#166534` / `#DCFCE7` | success status |
| `warning-*` | `#92400E` / `#FEF3C7` | warning status |
| `error-*` | `#B91C1C` / `#FEF2F2` | error status |

Raw hex는 semantic token 정의에만 둔다. feature component는 token 또는 Tailwind semantic class를
사용한다.
Primary button과 작은 white text가 필요한 surface는 `brand-700 #0F766E`을 사용한다.
`brand-500 #14B8A6` 위 white normal text는 AA 대비를 만족하지 않으므로 허용하지 않는다.
focus indicator는 white/canvas에서 `brand-700`, `ink-950` focus header에서는 3:1 이상 대비의
`brand-500` 또는 white inverse token을 사용한다.

### 7.2 Typography and density

- system sans-serif; external font request 없음
- identifiers와 values는 system monospace
- screen title 24~28px / 700~800
- section title 16~20px / 600~700
- body 14px, compact metadata 12px
- general controls 34~36px
- compact table row 34~36px
- touch target이 필요한 action은 최소 36px
- spacing은 4px base, page gutter는 viewport에 따라 16/24/32px

### 7.3 Shape and motion

- input/button radius 6~8px
- section/surface radius 10~12px
- border를 기본 hierarchy로 사용하고 shadow는 drawer/dialog/popover에 집중
- hover/focus transition 120~180ms
- reduced motion에서는 transform/slide animation 제거

## 8. Component contract

### 8.1 Shared primitives

- `Button`: primary / secondary / ghost / danger, loading/disabled
- `IconButton`: accessible name과 tooltip 필수
- `Badge`: neutral / draft / warning / error / read-only. review/approved variant는 실제 상태가
  도입되는 Phase 5에서 추가한다.
- `Field`: visible label, help, error, described-by linkage
- `InlineAlert`: info / warning / error / success
- `Drawer`: focus trap, Escape, close confirmation, trigger focus restoration
- `Dialog`: modal semantics, focus trap, destructive confirmation
- `PageHeader`, `AppHeader`, `FocusHeader`
- `EmptyState`, `Skeleton`
- compact table style primitives; business column logic은 feature가 소유

공통 component는 두 개 이상의 실제 사용처가 있거나 접근성 계약을 중앙화할 필요가 있을 때만
추출한다. `SheetView`나 Glide adapter의 도메인 로직을 generic data-grid abstraction으로 다시
감싸지 않는다.

### 8.2 Interaction states

- hover와 focus-visible을 구분한다.
- focus ring은 2px context token + 충분한 offset을 사용한다. Light surface는 `brand-700`,
  `ink-950` header는 `brand-500` 또는 white inverse ring이다.
- disabled action은 가능한 경우 이유를 함께 표시한다.
- loading은 관련 control만 잠그고 layout을 유지한다.
- selected row는 배경과 left indicator를 함께 사용한다.
- status badge는 색과 text를 함께 사용한다.

## 9. Data and state flow

### 9.1 Server state

- TanStack Query가 project, process, parameter, sheet server state의 유일한 source다.
- route 분리 때문에 동일 데이터를 component local state로 복제하지 않는다.
- mutation success는 필요한 query key만 invalidate한다.
- cached sheet는 background refetch error에서 유지한다.

### 9.2 URL state

- path/query decoder와 encoder를 순수 함수로 테스트한다.
- back/forward가 list filter, drawer, wizard step을 의미 있게 복원한다.
- invalid ID/query는 안전한 기본값 또는 not-found/error state로 정규화한다.

### 9.3 Local interaction state

- form inputs, unsaved manual override, drawer dirty flag는 feature local state.
- Sheet dirty/paste/selection state는 현재 store와 component ownership을 유지한다.
- URL과 local state가 충돌하면 URL은 entity/route, local은 아직 저장되지 않은 draft를 소유한다.

## 10. Error handling and content

### 10.1 Error rules

- query error는 page 전체를 대체하지 않고 소유 영역에서 표시한다.
- retry action은 실패한 operation만 다시 수행한다.
- mutation error는 form, selection, dirty buffer를 지우지 않는다.
- destructive action과 unsaved navigation은 확인한다.
- disabled 상태는 막힌 이유를 사용자에게 알린다.

### 10.2 Content voice

- 새 UI는 내부 error code나 stack/transport 원문을 노출하지 않는다. 현재
  `getApiErrorMessage()`가 반환하는 사용자 이해 가능한 domain `message`는 Phase 2.5에서도
  사용할 수 있으며, 이 구조개편만으로 모든 기존 오류를 새 문구로 번역한다고 약속하지 않는다.
- `문제 + 영향 + 다음 행동`을 우선한다.
- 예: `숫자 형식이 아니다`가 아니라 `숫자로 입력해 주세요`.
- validation message mapper 구현은 Phase 3 T4가 소유한다. Phase 2.5는 alert·field·status의
  visual/semantic container만 제공한다.

## 11. Accessibility

- target: WCAG 2.2 AA
- 모든 input에 visible label
- icon-only button에 accessible name + tooltip
- Drawer/Dialog focus trap, Escape close, trigger focus restoration
- primary screen path 변경 후 main heading focus. 검색 query `replace`는 현재 입력 focus를
  유지하고, wizard step은 새 step heading으로 이동한다.
- App Shell 첫 focus target으로 `본문으로 건너뛰기` link 제공
- save/lock status에 `role="status"` 또는 polite `aria-live`
- blocking/destructive error에 `role="alert"`
- category tabs는 button semantics와 selected state를 노출
- keyboard-only project list, wizard, drawer, sheet toolbar QA
- 색만으로 selected/error/read-only를 표시하지 않음
- `prefers-reduced-motion` 지원

Canvas 기반 Glide grid의 screen-reader 한계는 숨기지 않는다. Phase 2.5에서는 현재 keyboard 편집
계약을 회귀시키지 않고, 별도 accessible summary/table이 필요한지는 실제 운영 사용자 QA 근거로
후속 판단한다.

## 12. Responsive contract

| Width | Contract |
|---|---|
| `>= 1440px` | optimal desktop; full navigation, dense tables, 4+ workbench tiles |
| `1024–1439px` | functional desktop; condensed actions, horizontal table scroll where needed |
| `< 1024px` | general screens remain readable; drawer becomes full-width; sheet is viewable with horizontal scroll but mobile editing is not a Phase 2.5 goal |

Top navigation은 좁은 화면에서 overflow menu로 축약한다. 중요한 primary action은 메뉴 안으로
숨기지 않는다. Hover-only 정보는 click/focus 대안을 제공한다.

## 13. Verification contract

### 13.1 Before structural edits

- 현재 순수 logic/API/store tests를 green baseline으로 기록한다.
- 보호되지 않은 route state, wizard transition, parameter form mapping을 먼저 test seam으로
  분리하고 회귀 테스트를 작성한다.

### 13.2 Automated gates

```bash
cd frontend
npm run lint       # 현재 package에서는 typecheck alias
npm run typecheck
npm test
npm run build
```

- URL query parsing/serialization
- W1 step guards and dependent state reset
- M1 drawer form create/update mapping
- selected/disabled/read-only state helpers
- 기존 sheet model, autosave, paste, locks, conditions regression

현재 test environment가 DOM component interaction을 충분히 지원하지 않으므로 테스트를 위해 새
dependency를 임의 도입하지 않는다. 기존 stack으로 보호 가능한 pure/view-model 경계를 우선하고,
rendered behavior는 browser verification으로 증명한다.

### 13.3 Browser verification

- widths: 1024, 1440, 1920
- 프로젝트 검색/filter/load-more → 상세 → back/scroll 복원
- `/projects/new` direct entry, Process prefill, three steps, manual match, success redirect
- parameter create/edit/deactivate, drawer back/forward, dirty close confirmation
- CSV dry-run/apply와 category management
- Process Catalog → new/existing project routing
- sheet focus viewport, lock acquire/read-only/reacquire
- autosave, unload navigation, paste preview/apply/cancel, copy/paste, choice single click
- condition add/duplicate/delete/POR transfer
- keyboard-only navigation and focus restoration
- loading, empty, query error, mutation error, success status

필수 edge-case evidence에는 invalid query 정규화, filter 변경 시 load-more 초기화,
첫 200개 밖 Process prefill, stale/deleted Process·backbone, 빈 backbone 후보, double submit 차단,
inactive parameter deep link, direct-entry drawer focus fallback, choice options PUT 부분 실패,
두 browser session의 lock/read-only 전환, focus shell 동안 `SheetEditor` 무-remount를 포함한다.

## 14. Phase 2.5 acceptance criteria

- [ ] 상단 전역 내비와 조건표 focus header가 route에 맞게 전환된다.
- [ ] 프로젝트 목록, 생성, 상세, 시트가 독립 URL을 갖는다.
- [ ] 기존 `/projects/:projectId/sheet` deep link가 그대로 동작하고, 동일 sheet route 안에서
  shell/header 상태가 바뀌어도 editor가 remount되지 않는다.
- [ ] `/projects`는 목록을 우선하며 생성·상세 form을 동시에 렌더링하지 않는다.
- [ ] `/projects/new`는 기존 API로 W1 세 단계를 완료하고 성공 시 상세로 이동한다.
- [ ] Process Catalog action이 새 대상은 생성 route에 전달하고 기존 대상은 검색된 프로젝트
  목록으로 안내한다.
- [ ] `/parameters` 첫 viewport에 목록이 보이고 편집은 M1 drawer에서 이루어진다.
- [ ] CSV와 category 작업은 목록 아래 적층 form이 아니라 보조 dialog/drawer로 분리된다.
- [ ] 조건표가 전역 width/`70vh` 제약 없이 남은 viewport를 사용한다.
- [ ] paste preview가 열린 동안 충돌하는 편집·category·조건 구조 동작이 시작되지 않는다.
- [ ] column search가 hidden category 결과로 전환·점프하거나 결과 없음 상태를 표시한다.
- [ ] read-only/POR 안내가 실제 허용 동작과 일치한다.
- [ ] future S1-C slot은 빈 상태에서 DOM이나 높이를 예약하지 않고 content가 생길 때만 mount
  가능하다.
- [ ] 디자인 token과 공통 accessibility primitive가 화면 간 일관되게 적용된다.
- [ ] API와 Phase 2의 persistence/domain/lock/autosave 정책이 변경되지 않는다.
- [ ] typecheck, full tests, production build, browser QA가 통과한다.
- [ ] 1024/1440/1920에서 알려진 overlap, clipped primary action, 가려진 focus가 없다.
- [ ] backend, API schema, dependency와 lockfile 변경이 없다.

S1-C validation tile의 3/4/5열, truncation의 accessible full text, 비색상 severity,
`aria-expanded`, keyboard 셀 이동은 §6.6의 **Phase 3 구현 handoff 계약**이며 Phase 2.5 완료를
막는 검증 항목이 아니다.

## 15. 위험과 완화

| 위험 | 완화 |
|---|---|
| route 분리 중 query/local state 유실 | URL state helper와 direct-entry/back tests를 먼저 작성 |
| Process 중복 정책이 backend identity와 다름 | Phase 2.5 UI는 D-17의 line/process 차단을 유지하고 backend 정합성은 별도 domain 수정으로 기록 |
| Parameter nullable field를 clear할 수 없음 | 거짓 성공을 막고 clear 불가를 설명하며 backend 계약 수정은 별도 범위로 기록 |
| Choice base/options 저장이 atomic하지 않음 | 부분 성공 안내, refetch, options draft·재시도 유지로 reconciliation |
| visual refactor가 sheet write lifecycle을 건드림 | `useSheetEditing`과 grid adapter는 이동하지 않고 wrapper 경계만 변경 |
| 공통 component 추출이 과도한 abstraction으로 번짐 | 두 사용처 또는 접근성 중앙화 기준 없으면 feature-local 유지 |
| Drawer/Dialog 접근성이 누락됨 | focus trap/Escape/restore를 shared primitive 계약과 browser QA에 포함 |
| S1-C를 Phase 3 기능으로 오해 | Phase 2.5는 empty-hidden slot만 제공, validation data 구현은 제외 |
| compact density가 가독성을 해침 | 34px 이하 table row 금지, 36px action target, 1024/1440/1920 QA |

## 16. 기각한 대안

- **전역 sidebar:** 조건표의 수평 공간을 지속해서 사용하므로 기각.
- **항상 동일한 상단 header:** 조건표에서 불필요한 세로 공간을 차지하므로 focus header로 대체.
- **중앙 max-width workspace:** 데이터 표·그리드의 가용 폭을 줄이므로 기각.
- **프로젝트 dashboard 우선:** Phase 5 전 효용이 낮고 목록을 밀어내므로 기각.
- **프로젝트 목록·상세 split view:** 수평 경쟁과 URL 상태 복잡도 때문에 기각.
- **파라미터 modal/dedicated page:** 각각 긴 form 확장성과 연속 편집 속도가 M1보다 낮아 기각.
- **하단 workbench 고정 2열 카드:** 넓은 화면에서 공간을 낭비하므로 가용 폭을 채우는
  3/4/5열 반응형 타일로 대체.
- **하단 workbench 고정 table:** 짧은 안내에 큰 빈 열이 생기므로 기각.
- **새 UI framework:** 기존 dependency로 충분하고 변경 범위를 키우므로 기각.

## 17. Open questions

Phase 2.5 implementation을 막는 open question은 없다.

- 조직 wordmark가 제공되면 PCM mark 자산만 교체한다.
- 실제 최소 모니터 해상도는 browser QA에서 기록해 breakpoint 근거를 보강한다.
