# PCM Drafting Table Redesign

## Status

- Approved visual world: **Drafting Table**
- Approved composition: **Grid-first Inspector with Layer Navigator**
- Approved comp: `.impeccable/mocks/drafting-table/option-2b-layer-navigator.png`
- Target: desktop web only

## Product objective

PCM을 Process 구조 이해, 대규모 조건표 편집, 잠금·검증·이력 추적이 끊기지 않는 공정 엔지니어용 통합 작업 환경으로 재설계한다. 폐쇄망, 기존 기능과 URL, Glide Data Grid 가상화, WCAG 2.2 AA, 한국어 도메인 문체를 보존한다.

## Primary flow

이번 구현의 대표 흐름은 다음과 같다.

1. 공정 엔지니어가 프로젝트 조건표를 연다.
2. 약 100개 Layer 중 대상을 검색하거나 목록에서 한 번 클릭해 즉시 이동한다.
3. 중앙 고밀도 그리드에서 조건을 편집한다.
4. 우측 증빙 레일에서 검증 오류를 선택해 대응 셀로 이동한다.
5. 같은 레일과 하단 리비전 룰러에서 변경 이력과 변경 전·후 값을 확인한다.

## Information architecture

### Global rail

가장 왼쪽의 얇은 전역 레일은 제품 수준 이동과 공통 도구만 소유한다. 현재 작업인 조건표를 명확히 표시하되 Layer 이동을 중복 제공하지 않는다.

### Layer Navigator

전역 레일 옆 210–230px 영역에 항상 보이는 Layer Navigator를 둔다.

- 약 100개 Layer를 DOM에 전부 렌더링하지 않고 가상화한다.
- Layer의 보이는 행 전체가 단일 클릭 타깃이다.
- 클릭 즉시 해당 Layer로 이동하며 확인 버튼이나 2단계 드롭다운을 사용하지 않는다.
- 각 행은 두 자리 번호, 한국어 이름, 검증 오류 개수, 현재/dirty 상태를 표시할 수 있다.
- 현재 Layer는 틸 선택선과 옅은 트레이싱 페이퍼 배경으로 구분한다.
- 상단 검색은 번호와 이름을 같은 목록 안에서 즉시 필터링한다.
- 최근 방문 Layer 세 개를 빠른 이동 영역으로 제공한다.
- 키보드 `ArrowUp`/`ArrowDown`으로 활성 행을 이동하고 `Enter`로 전환한다.
- 접기 동작은 Navigator 폭을 그리드에 돌려주며 현재 Layer 문맥은 상단에 남긴다.
- 기존 상단 Layer 드롭다운은 제거한다.

### Condition grid

중앙 그리드가 화면의 주인공이며 남은 가로·세로 공간을 최대한 사용한다. 기존 Glide Data Grid 가상화, 셀 편집, 잠금, 붙여넣기, 자동저장 계약을 유지한다. 선택, 포커스, hover, 오류, dirty, read-only 상태는 선과 배경의 조합으로 구분하며 색만 사용하지 않는다.

### Evidence inspector

우측 26–28% 영역은 검증 오류와 변경 이력을 쌓아 보여주는 증빙 레일이다.

- 검증 오류를 우선 배치한다.
- 오류 항목은 문제, 위치, 영향을 짧게 보여주고 `셀로 이동`을 제공한다.
- 선택된 오류와 대상 셀은 동일한 번호/상태 문법으로 연결한다.
- 변경 이력은 최신순 기본값과 현재 셀 필터를 제공한다.
- 선택 이력은 변경 전·후, 작성자, 시각을 보여준다.
- 패널은 접거나 폭을 조절할 수 있지만 열렸을 때 그리드 포커스를 가리지 않는다.

### Revision ruler

그리드 아래의 얇은 리비전 룰러는 주요 변경 시점을 제도 눈금처럼 보여준다. 선택 시 해당 변경 이력을 우측 레일에서 열고 관련 셀로 이동한다. 전체 이력 표를 대체하지 않고 시간적 방향 감각을 제공한다.

## Visual system

- Background: warm off-white `#F7F7F3`
- Primary ink: `#12232A`
- Drafting teal: `#196B67`
- Revision amber: `#D18B2C`
- Error: 기존 AA 기준을 충족하는 명시적 red semantic token
- One locally available/system sans family for UI; system monospace for coordinates and identifiers
- 4px spacing base, compact 34–36px data rows, 36–40px controls
- Hairline drafting rules and coordinate labels; 1px default borders, 2px focus/selected emphasis
- Radius is restrained at 2–6px. Repeated rounded cards and decorative shadows are prohibited.
- Motion is functional only, 150–200ms. Panel resize, selection, focus transfer, reveal에 사용하며 `prefers-reduced-motion`을 준수한다.

## Interaction states

모든 클릭 가능한 요소는 default, hover, focus-visible, active, disabled를 갖는다. 저장·잠금·검증·dirty 상태는 텍스트와 아이콘을 함께 사용한다. mutation 실패 시 선택 Layer, 검색어, 편집 값과 dirty 셀을 보존한다.

## Accessibility

- WCAG 2.2 AA를 목표로 한다.
- 주요 동작은 키보드로 수행 가능해야 한다.
- Layer 목록은 `aria-label="Layer 선택"`을 가진 탐색 영역과 현재 항목의 `aria-current="true"`를 제공한다. 검색 결과 개수 변화는 polite live region으로 알린다.
- 포커스 이동은 예측 가능해야 하며 오류에서 셀로 이동한 뒤 대상 셀을 명확히 알린다.
- 클릭 타깃은 조밀한 데스크톱 도구 문맥에서도 최소 36px 행 높이를 유지한다.
- hover 전용 정보는 허용하지 않는다.

## Responsive scope

모바일은 지원하지 않는다. 최소 지원 viewport는 1024px 데스크톱이며, 1440px 이상을 주 최적화 대상으로 한다. 좁은 데스크톱에서는 Layer Navigator와 증빙 레일을 각각 접어 그리드 공간을 확보할 수 있어야 한다.

## Implementation boundaries

- 기존 route와 API 계약을 변경하지 않는다.
- 외부 폰트, 런타임 CDN, 신규 네트워크 의존성을 추가하지 않는다.
- Glide Grid 데이터를 복제하거나 매 렌더마다 전체 변환하지 않는다.
- 공통 토큰은 `frontend/src/styles.css`, 공유 UI는 `frontend/src/shared`, 조건표 조합은 `frontend/src/features/sheets`가 소유한다.
- 기존 `frontend/vite.config.ts`의 사용자 변경을 수정하거나 되돌리지 않는다.

## Verification

- Layer 100개 fixture에서 검색, 가상 스크롤, 최근 항목, 단일 클릭 이동, 키보드 이동을 검증한다.
- 검증 오류 → 셀 이동 → 변경 이력 확인의 대표 흐름을 컴포넌트/E2E 수준에서 검증한다.
- TypeScript typecheck, Vitest 전체, production build를 실행한다.
- 로컬 실행 후 1024px, 1440px, 1920px 데스크톱 화면을 캡처한다.
- Vision 검사 기준은 시각적 위계, 간격, 대비, 텍스트 가독성, 데스크톱 레이아웃, hover/클릭 명확성, 사용자 흐름의 자연스러움이다.
- 승인 컴프와 브라우저 렌더를 동일 크기로 비교하고 최대 두 번의 일괄 수정 패스를 수행한다.
