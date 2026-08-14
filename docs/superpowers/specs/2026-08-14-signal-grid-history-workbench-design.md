# Signal Grid History Workbench Design

## Status

- Approved: 2026-08-14
- Surface: `/projects/:projectId/sheet` 우측 증거 패널의 `이력` 탭
- Selected direction: **연속 리비전 장부**
- Visual authority: `opendesign/design-systems/pcm-signal-grid/`

## 1. Job and audience

공정 엔지니어는 조건표를 편집하거나 검토하는 도중 현재 Layer에서 무엇이, 언제, 누구에 의해 바뀌었는지 확인하고 필요하면 해당 셀로 돌아가야 한다. 이력 확인 때문에 그리드, Layer, 선택 셀과 필터 문맥을 잃어서는 안 된다.

이 화면의 주 작업은 감사 보고서 작성이 아니라 **현재 작업 문맥 안에서 변경 근거를 빠르게 확인하고 대상 셀로 이동하는 것**이다. 전체 프로젝트를 가로지르는 별도 타임라인이나 분석 화면은 제공하지 않는다.

## 2. Outcome and proof

사용자는 이력 탭을 열고 다음 흐름을 중단 없이 수행할 수 있어야 한다.

1. 현재 Layer의 최신 변경을 바로 확인한다.
2. 현재 셀 이력과 펼친 batch 상세에서 이전 값과 변경 값을 같은 항목에서 비교한다.
3. 필요하면 `현재 셀만`으로 범위를 좁힌다.
4. 붙여넣기나 백본 반영처럼 묶인 변경을 해당 행에서 펼친다.
5. 명시적인 `셀로 이동` 행동으로 그리드 위치를 바꾼다.
6. 그리드에 다녀와도 이력 범위, 필터, 펼친 항목과 스크롤 위치를 유지한다.

성공 기준은 변경 확인과 셀 이동을 위해 별도 페이지를 열거나 이력 모드를 다시 구성하지 않는 것이다.

## 3. Selected direction

### 3.1 Continuous revision ledger

이력은 최신순의 연속 장부로 표현한다. 현재 Layer의 각 항목은 기존 timeline API가 제공하는 다음 정보를 한 번에 보여준다.

- 변경 시각과 작업자
- Parameter 이름 또는 code
- Layer/Step 좌표
- 입력 방식 또는 origin
- 가능한 경우 `셀로 이동`

timeline API가 이전 값과 변경 값을 제공하지 않는 개별 Layer 항목에서는 값을 추측하거나 summary 문자열에서 파싱하지 않는다. 정확한 `이전 값 → 변경 값`은 현재 셀 범위와 펼친 batch 상세에서만 표시한다.

반복 카드 대신 1px 구분선으로 항목을 나눈다. 값과 좌표는 monospace, 설명과 작업자 문구는 sans를 사용한다. Cobalt는 현재 범위, 선택 항목과 이동 행동에만 사용하고 amber는 실제 변경 전·후의 차이에만 사용한다.

### 3.2 One ledger, two scopes

현재의 `타임라인/셀 이력` 이중 화면은 하나의 장부와 두 범위로 통합한다.

- 기본값: `현재 Layer`
- 선택 범위: `현재 셀만`

이력 탭을 열 때 선택 셀이 있더라도 자동으로 셀 범위로 전환하지 않는다. 셀을 선택하지 않은 상태에서는 `현재 셀만`을 비활성화하고 `그리드에서 셀을 선택하면 사용할 수 있습니다.`를 제공한다.

Layer가 바뀌면 범위는 새 현재 Layer로 갱신한다. `현재 셀만`이 켜져 있었다면 셀 선택이 새 Layer에 유효할 때만 유지하고, 유효하지 않으면 `현재 Layer`로 되돌리며 이를 polite status로 알린다.

### 3.3 Explicit navigation

이력 행 클릭은 항목 선택 또는 묶음 상세 펼치기만 수행한다. 그리드 이동은 `셀로 이동` 버튼으로만 실행한다. 사용자가 이력을 훑는 동안 작업 위치가 우발적으로 바뀌지 않아야 한다.

셀 이동에 성공하면 이력 탭, 범위, 상세 필터, 펼친 batch, 선택 항목과 스크롤 위치를 유지한다. 삭제되었거나 현재 조건표에 없는 대상은 값과 이력을 계속 보여주되 이동 버튼을 비활성화하고 이유를 인접 문구로 제공한다.

## 4. Information architecture

패널의 세로 순서는 고정한다.

1. 기존 증거 패널 tablist: `검증 / 이력 / 백본 비교`
2. 범위 머리글: 현재 `Layer code · Step`과 `변경 이력`, 결과 건수
3. segmented scope control: `현재 Layer / 현재 셀만`
4. 접힌 필터 요약: 적용된 조건 요약과 `필터` 버튼
5. 연속 이력 장부
6. 추가 페이지 상태와 `더 보기`

필터 폼은 기본적으로 접혀 있다. 접힌 행은 예를 들어 `전체 변경 · 전체 작업자` 또는 `직접 입력 외 2개 · 김민수 · 08.01–08.14`처럼 적용 상태를 요약한다. 펼치면 기존 기간, 작업자, origin/source, source project, event type 계약을 제공한다. 현재 Layer는 범위가 소유하므로 상세 필터의 자유 입력 Layer 필드는 제거한다.

필터 적용과 초기화는 명시적 버튼을 유지한다. 초안 입력 중에는 기존 결과를 지우지 않는다. 필터 검증 실패는 폼 안에 표시하고 마지막으로 성공한 결과를 유지한다.

## 5. Event presentation

### 5.1 Individual event

현재 Layer timeline의 개별 event는 API가 제공하는 summary, 좌표, 작업자, 시각과 origin을 표시한다. timeline item에는 이전 값과 변경 값이 없으므로 이를 추측하거나 summary에서 파싱하지 않는다.

`현재 셀만` 범위의 개별 셀 변경은 이전 값과 변경 값을 즉시 표시한다. 값이 없으면 `없음`을 사용하고 단순한 em dash만으로 의미를 숨기지 않는다. Choice 값은 label을 우선 표시하고 code가 다르거나 감사에 필요하면 보조로 함께 표시한다.

### 5.2 Batch event

붙여넣기, 백본 반영 등 여러 셀을 포함한 event는 요약 행을 사용한다.

- 요약: 작업 종류와 전체 변경 셀 수
- 메타데이터: 작업자, 시각, origin, batch/source project
- 행동: `N개 변경 펼치기 / 접기`

펼친 상세는 같은 행 아래에서 개별 변경을 연속 목록으로 보여준다. 각 상세가 이동 가능한 셀을 가질 때만 `셀로 이동`을 제공한다. 이미 불러온 상세는 접었다 다시 펼칠 때 재요청하지 않으며, mutation 이후 기존 controller의 무효화 계약을 따른다.

### 5.3 Legacy and unavailable detail

레거시 상세가 없거나 대상이 삭제된 경우 해당 항목에만 설명을 붙인다. 패널 전체를 경고 surface로 바꾸지 않는다. 부분 coverage 안내는 범위 머리글 아래의 조용한 상태 문구로 한 번만 표시한다.

## 6. Layout and responsive behavior

증거 패널의 기존 320–520px 가변 폭과 저장 계약을 유지한다.

- 320px: 모든 항목은 단일 열이다. 메타데이터가 값 비교보다 먼저 공간을 차지하지 않는다.
- 321–519px: 동일한 정보 순서와 세로 리듬을 유지하고 긴 값에 더 많은 폭을 제공한다.
- 520px: 시각·작업자 메타데이터를 한 줄에 둘 수 있으나 의미 순서는 바꾸지 않는다.

텍스트는 패널 내부에서 줄바꿈하며 문서 body overflow를 만들지 않는다. 긴 code, actor, batch ID와 값은 사용 가능한 폭을 넘지 않아야 하며, 핵심 값을 단순 잘라내는 것으로 해결하지 않는다. 항목 전체에 중첩 rounded card나 shadow를 사용하지 않는다.

패널의 resize, 접기와 기존 1024/1440/1920 desktop layout 계약은 유지한다. 모바일 조건표는 범위 밖이다.

## 7. State and error handling

- **Initial loading:** 머리글과 범위 control을 유지하고 장부 영역에 안정적인 loading rows를 표시한다.
- **Initial error:** 범위와 필터를 보존하고 문제, 영향, `다시 시도`를 장부 영역에 표시한다.
- **Empty:** `현재 Layer에 기록된 변경이 없습니다.` 또는 `선택한 셀에 기록된 변경이 없습니다.`처럼 범위를 명시한다.
- **Next-page loading:** 기존 장부를 유지하고 하단 행동만 loading 상태로 바꾼다.
- **Next-page error:** 기존 장부를 유지하고 하단에서 `더 보기 다시 시도`를 제공한다.
- **Batch-detail loading/error:** 대상 batch 행 안에서만 상태와 재시도를 제공한다.
- **Filter error:** 폼 안에 표시하고 마지막 성공 결과를 유지한다.
- **Deleted target:** 이력은 유지하고 이동 불가 이유를 버튼 옆에 표시한다.
- **Legacy coverage:** 해당 범위에서 확인할 수 없는 내용과 영향만 설명한다.

모든 async 상태는 `aria-live` 또는 적절한 alert/status semantics를 사용하되 같은 메시지를 여러 live region에서 반복하지 않는다.

## 8. Architecture and data flow

기존 History API, query key, pagination, batch detail cache, navigation target과 `useHistoryWorkbenchController`가 데이터의 정본이다. 새 전역 store, 별도 context 또는 이력 row 복제 계층을 추가하지 않는다.

`HistoryWorkbench`는 다음 책임만 가진다.

- 현재 scope와 필터 UI 표현
- timeline item을 개별 또는 batch 장부 행으로 렌더링
- 기존 callback을 통해 필터, pagination, 상세 요청과 위치 이동 전달
- 성공한 데이터와 사용자 UI 문맥 보존

범위 전환은 기존 timeline query와 cell history query를 재사용한다. backend API 또는 schema를 변경하지 않는다. 컴포넌트가 viewport breakpoint를 보고 별도의 데이터 구조를 만들지 않는다.

## 9. Accessibility and interaction

- 범위 control은 단일 선택임을 드러내는 tablist 또는 radiogroup semantics를 사용한다.
- 현재 범위는 색뿐 아니라 선택 상태와 문구로 전달한다.
- 필터 펼치기 버튼은 `aria-expanded`와 대상 `aria-controls`를 제공한다.
- batch 펼치기도 동일한 disclosure 계약을 사용한다.
- 이력 항목 선택과 `셀로 이동`은 서로 다른 focusable action이다.
- 이동 성공 또는 불가 결과는 한 번만 알리고, 성공 시 Glide의 기존 셀 focus/announcement 계약을 사용한다.
- 키보드로 탭 선택, 범위 전환, 필터, batch 펼치기, 페이지 추가 로드와 셀 이동을 모두 수행할 수 있어야 한다.
- 선택, 변경, warning과 error는 색상만으로 구분하지 않는다.

## 10. Verification

### Component and controller tests

- 이력 탭의 기본 범위는 현재 Layer이다.
- 선택 셀 유무에 따라 `현재 셀만`의 활성 가능 상태가 정확하다.
- Layer 변경 시 범위와 사용자 필터 보존 규칙을 따른다.
- 상세 필터의 접기, 적용, 초기화와 검증 실패가 기존 결과를 보존한다.
- Layer 개별 event가 summary, 좌표, actor와 origin을 표시하며 제공되지 않은 값 diff를 만들지 않는다.
- 셀 이력과 batch 상세가 이전/변경 값을 표시한다.
- batch 상세는 명시적으로 펼치며 cache와 retry 계약을 지킨다.
- 행 선택은 자동 이동하지 않고 `셀로 이동`만 navigation callback을 호출한다.
- 삭제 대상, legacy coverage, empty/loading/error/next-page error를 범위별로 표시한다.
- 셀 이동 뒤 이력 탭, 범위, 필터, 펼친 batch와 scroll anchor를 유지한다.

### Browser verification

- 1024×768, 1440×900, 1920×1080 viewport에서 320px와 520px inspector 폭을 확인한다.
- 긴 actor/code/value, 많은 event type과 batch detail에서 inspector 및 document overflow가 0이다.
- 현재 Layer → 현재 셀만 → 현재 Layer 범위 전환이 그리드 선택과 동기화된다.
- batch 펼치기, 셀 이동, Back/focus 복귀, 추가 페이지 실패·재시도를 실행한다.
- 삭제 대상과 레거시 상세가 다른 성공 항목을 가리지 않는다.
- 예상하지 않은 console error, page error와 network failure가 0이다.

## 11. Scope boundaries

### Included

- `HistoryWorkbench`의 Signal Grid 정보 구조와 시각 재설계
- 현재 Layer/현재 셀 scope 통합
- 접힌 상세 필터
- 개별 및 batch 변경 장부
- 상태, 접근성, 반응형 패널과 기존 그리드 이동 통합

### Excluded

- backend History API 또는 database schema 변경
- 전체 프로젝트 글로벌 타임라인 또는 하단 revision rail
- 새로운 감사 export나 통계 dashboard
- 승인·Revision 화면 변경
- 검증 또는 백본 비교 탭의 기능 재설계
- 모바일 조건표 지원

## 12. Implementation principles

- 기존 controller와 query 계약을 먼저 재사용한다.
- 좁은 패널 안에서 성공한 정보를 숨기거나 실패 상태로 대체하지 않는다.
- 한 번만 쓰는 layout wrapper를 shared abstraction으로 올리지 않는다.
- 새 전역 상태, listener, runtime dependency를 추가하지 않는다.
- 현재 History 기능을 단순화하되 감사에 필요한 데이터는 삭제하지 않는다.
