# App Shell·PageHeader 계층 명료화 설계

- **Status:** Approved
- **Approved:** 2026-07-16
- **Selected direction:** A — 실제 주 제목에 route focus
- **Design authority:** [`DESIGN.md`](../../../DESIGN.md)
- **Implementation scope:** 일반 App Shell의 공통 `PageHeader`와 route focus 계약

## 1. 배경과 문제

프로젝트 생성과 탐색 화면을 정리한 뒤 공통 shell을 다시 검토했다. 일반 route는 이동 후
주 제목으로 focus를 보내는 접근성 계약을 이미 지키지만, 현재 `data-page-title`과
`tabIndex={-1}`가 `PageHeader`의 바깥 `<header>`에 붙는다. `PageHeader`도 focus outline을
전체 surface에 그리므로, route 진입 직후 제목·설명·행동 전체를 감싼 큰 청록색 사각형이
나타난다.

이 결합은 다음 문제를 만든다.

1. 실제 focus 목적은 주 제목 안내인데 전체 header가 하나의 선택된 카드처럼 보인다.
2. 모든 route가 `data-page-title`과 `tabIndex`를 반복해 공통 접근성 계약을 각자 소유한다.
3. `PageHeader`의 얇은 구분선보다 focus surface가 강해져 전역 내비 → 페이지 제목 → 본문
   순서가 흐려진다.
4. query만 바뀌는 목록과 browser Back focus 복귀처럼 더 구체적인 focus 계약과 공통 route
   focus의 우선순위를 계속 보존해야 한다.

검토 근거:

- `DESIGN.md`
- `docs/superpowers/specs/2026-07-13-phase-2-5-ui-ux-design.md`
- `docs/superpowers/specs/2026-07-16-project-creation-clarity-design.md`
- `docs/superpowers/specs/2026-07-16-project-browse-clarity-design.md`
- `frontend/src/shared/layout/RootLayout.tsx`
- `frontend/src/shared/layout/AppLayout.tsx`
- `frontend/src/shared/layout/FocusLayout.tsx`
- `frontend/src/shared/components/PageHeader.tsx`
- `frontend/src/features/sheets/SheetView.tsx`
- `docs/evidence/project-creation-clarity/`
- `docs/evidence/project-browse-clarity/`

## 2. 목표와 비목표

### 목표

1. primary screen path 이동 후 실제 `<h1>`으로 focus를 보낸다.
2. focus 표시는 제목 경계에만 2px로 제한해 전체 header를 카드처럼 보이게 하지 않는다.
3. `PageHeader`가 route 제목 marker와 focusability를 중앙에서 소유하게 한다.
4. 전역 App Shell, 페이지 header, 본문 section의 시각 계층을 더 분명하게 만든다.
5. query 입력 focus, browser Back row focus, 조건표 focus header, Skip Link 계약을 보존한다.
6. 모든 공통 header 사용 route에서 같은 구조와 반응형 행동을 검증한다.

### 비목표

- 52px 전역 navigation의 메뉴·정보 구조·active route 규칙 변경
- 40px 조건표 Focus Header의 lock/save/category/workbench 재설계
- route별 검색, 표, form, action 구성 변경
- Parameter section navigation 또는 ChoiceSet breadcrumb 순서 변경
- App Shell에 sidebar, 사용자 메뉴, sticky 동작, 전역 max-width 추가
- typography scale, 색 token, button, badge, drawer, dialog 재설계
- API, query key, route state, backend 변경
- 새 dependency, font, icon package 추가

## 3. 선택한 방향

사용자가 선택한 **A — 실제 주 제목에 route focus**를 적용한다.

- `PageHeader` 내부 `<h1>`이 `data-page-title`과 `tabIndex={-1}`를 직접 소유한다.
- `RootLayout`은 pathname이 바뀔 때 기존 selector로 주 제목을 focus한다.
- 바깥 `<header>`는 focusable surface가 아니라 제목·설명·행동을 배열하는 semantic container다.
- focus outline은 `<h1>`에만 밝은 surface용 `brand-700` 2px와 2px offset으로 표시한다.

기각한 대안:

- **본문 `<main>` focus:** 큰 outline은 사라지지만 화면 이름보다 일반 landmark를 먼저
  안내하고, 조건표의 구체적인 제목 focus 계약과도 달라진다.
- **전체 header focus를 유지하고 ring만 약화:** 시각 증상만 줄이고 실제 제목과 focus
  대상이 어긋난 구조 및 route별 marker 반복은 남는다.

## 4. Shell 계층 계약

일반 route의 계층은 다음 순서를 유지한다.

1. **App Shell:** 52px 전역 header, PCM brand, 세 개의 primary navigation
2. **선택적 route-family 문맥:** 기존 Parameter section navigation 또는 detail breadcrumb
3. **Route header:** eyebrow(있을 때), 실제 `<h1>`, 한 문장 설명, 현재 route의 행동
4. **Route tools/content:** 검색·filter·form·table·detail

App Shell은 전역 문맥이고 `PageHeader`는 현재 route의 문맥이다. 이번 변경은 App Shell의
폭이나 메뉴를 바꾸지 않고, route 진입 focus와 시각적 강조가 두 계층을 뒤섞지 않게 한다.
일반 main은 계속 full-width responsive gutter를 제공하고 route가 필요한 경우에만 자체
`max-width`를 소유한다.

조건표 route는 예외가 아니라 별도의 승인된 shell이다. `FocusLayout`과 `SheetView`의 40px
header, 직접 구현된 `<h1 data-page-title tabIndex={-1}>`, dark-surface focus token은 그대로
유지한다.

## 5. PageHeader 시각·컴포넌트 계약

### 5.1 바깥 header

- semantic `<header>`와 얇은 `border-bottom`을 유지한다.
- route focus marker, negative tab index, focus outline, focus radius를 소유하지 않는다.
- 기본 vertical gap은 12px, bottom padding은 16px로 줄여 본문과의 계층은 남기되 불필요한
  높이를 만들지 않는다.
- `sm` 이상에서 제목 영역과 행동은 기존처럼 좌우로 배치하고 bottom alignment를 유지한다.
- action wrapping, custom `className`, 일반 header attributes 전달은 유지한다.

### 5.2 실제 제목

- `<h1>`이 항상 `data-page-title`과 `tabIndex={-1}`를 가진다.
- 제목 typography는 현재 24px/28px, bold, tight tracking을 유지한다.
- focus된 제목에만 `rounded-sm`, 2px `brand-700` outline, 2px offset을 적용한다.
- eyebrow, description, actions는 focus target 안에 포함하지 않는다.

### 5.3 호출부

- 모든 `PageHeader` 호출부에서 반복하던 `data-page-title`과 `tabIndex={-1}`를 제거한다.
- route는 title/description/eyebrow/actions 같은 domain content만 제공한다.
- `PageHeader`를 쓰지 않는 조건표 제목은 기존 marker를 직접 유지한다.
- 새 `focusTargetProps`, title ref, variant API는 실제 caller가 없으므로 추가하지 않는다.

## 6. Focus 흐름과 우선순위

1. `RootLayout`은 `pathname` 변경에만 반응한다.
2. query/filter 변경은 pathname을 바꾸지 않으므로 현재 input/combobox focus를 유지한다.
3. 일반 route 진입 시 공통 `<h1>`이 먼저 focus된다.
4. 프로젝트 상세에서 browser Back으로 목록에 복귀하면 목록의 기존 POP 복원 effect가 해당
   project link로 focus를 옮긴다.
5. 해당 row가 없으면 목록의 `<h1>`이 안전한 fallback으로 남는다.
6. drawer/dialog는 기존 trap과 trigger/fallback 복귀를 계속 소유한다.
7. Skip Link는 계속 `#main-content`를 대상으로 하며 route 제목 focus와 역할을 섞지 않는다.
8. 조건표의 live title과 grid focus 복구는 기존 `SheetView` 계약을 유지한다.

## 7. 콘텐츠와 반응형

- 화면 제목, 설명, eyebrow, action 문구는 변경하지 않는다.
- 1024px에서는 기존 action wrapping과 main gutter 안에서 body overflow가 없어야 한다.
- 1440px에서는 focus outline이 제목 주변에만 나타나고 header 전체 경계를 만들지 않아야 한다.
- 1920px에서는 App Shell은 full-width 전역 계층, route별 frame은 해당 route가 승인받은 폭을
  유지한다.
- 공통 header 높이 축소가 프로젝트 상세의 Layer fold, 프로젝트 생성 action 노출, 관리
  화면의 첫 table row를 악화시키지 않아야 한다.

## 8. 기능 보존 계약

다음 동작은 전후가 동일해야 한다.

1. pathname route 전환 후 주 제목 focus
2. query typing/debounce/filter 변경 중 input focus 유지
3. 프로젝트 목록 query/history와 Back row focus 복귀
4. 프로젝트 생성 단계 heading focus와 unsaved-change 보호
5. Profile/parameter/ChoiceSet drawer·dialog focus trap과 반환
6. 조건표 focus header, live title, grid focus, lock/save 상태
7. 일반/조건표 Skip Link와 `#main-content` landmark
8. 전역 navigation의 route, active state, desktop/mobile 전환

## 9. 구현 경계

수정 중심 파일:

- `frontend/src/shared/components/PageHeader.tsx`
- `frontend/src/shared/components/primitives.test.tsx`
- `frontend/src/shared/layout/RootLayout.tsx` 또는 그 focus 계약 테스트
- `frontend/src/shared/layout/AppLayout.tsx`의 shell 회귀 테스트
- 현재 `PageHeader`를 사용하는 일곱 route의 중복 marker 정리와 기존 테스트

가능한 한 production 변경은 `PageHeader`와 호출부에 제한한다. `AppLayout`, `FocusLayout`,
`SheetView`, route state와 feature data flow는 회귀가 발견되지 않는 한 수정하지 않는다.
접근성 계약을 중앙화하기 위한 테스트 외에 새 abstraction을 만들지 않는다.

## 10. 검증과 완료 조건

### 자동 검증

- `PageHeader`의 `<h1>`이 유일한 `data-page-title`/`tabIndex=-1` 소유자임을 회귀 테스트
- 바깥 `<header>`에 focus outline·marker·tab index가 없음을 회귀 테스트
- 모든 PageHeader route가 하나의 `<h1>`과 기존 content/actions를 유지하는지 확인
- App Shell의 52px header, primary navigation, Skip Link, full-width main 계약 확인
- Focus Shell의 40px 제목 marker와 Skip Link 계약 확인
- 프로젝트 목록 Back focus, route/query, wizard, drawer/dialog 인접 테스트
- 전체 frontend Vitest, lint, typecheck, production build
- `git diff --check`

### 브라우저 검증

- 1024×768, 1440×900, 1920×1080에서 대표 일반 route 캡처
- route 진입 후 `document.activeElement`가 `<h1 data-page-title>`인지 확인
- focus outline bounding box가 `<h1>` 경계에 제한되고 `PageHeader` 전체와 같지 않은지 측정
- primary navigation 이동과 직접 URL 진입 모두 동일한 제목 focus 확인
- query/filter 변경 중 검색 input focus 유지
- 프로젝트 상세 → browser Back에서 원래 project link focus 복귀
- 조건표 진입 시 custom title focus와 dark-surface ring 유지
- Skip Link가 일반/조건표 main으로 이동
- body overflow, 예상하지 않은 console/page/network failure 0건

## 11. 후속 slice

이 slice 검증과 병합 후 기존 순서를 이어간다.

1. 조건표 header·category 선택·검증 workbench의 시각 소음
2. Glide grid 고정 열, 상태 표시, 선택/오류 대비
