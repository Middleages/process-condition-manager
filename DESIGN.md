# Design

## Source of truth

- **Status:** Active
- **Last refreshed:** 2026-07-17
- **Primary product surfaces:** 프로젝트 목록·생성·상세, Process Catalog, 조건표 편집기,
  조건표 워크벤치/이력 탐색, 파라미터 레지스트리·ChoiceSet 관리
- **Detailed Phase 2.5 specification:**
  [`docs/superpowers/specs/2026-07-13-phase-2-5-ui-ux-design.md`](./docs/superpowers/specs/2026-07-13-phase-2-5-ui-ux-design.md)
- **Detailed Phase 2.6 specification:**
  [`docs/superpowers/specs/2026-07-14-phase-2-6-project-profile-managed-choice-design.md`](./docs/superpowers/specs/2026-07-14-phase-2-6-project-profile-managed-choice-design.md)
- **Project creation clarity specification:**
  [`docs/superpowers/specs/2026-07-16-project-creation-clarity-design.md`](./docs/superpowers/specs/2026-07-16-project-creation-clarity-design.md)
- **Project browse clarity specification:**
  [`docs/superpowers/specs/2026-07-16-project-browse-clarity-design.md`](./docs/superpowers/specs/2026-07-16-project-browse-clarity-design.md)
- **App Shell and PageHeader clarity specification:**
  [`docs/superpowers/specs/2026-07-16-app-shell-page-header-clarity-design.md`](./docs/superpowers/specs/2026-07-16-app-shell-page-header-clarity-design.md)
- **Evidence reviewed:**
  - `plan/05-ui-wireframe.md` — 화면 지도와 업무 흐름
  - `plan/phase-2-tasks.md` — 현재 편집기 기능·제약과 Phase 2 완료 근거
  - `plan/phase-3-tasks.md`~`plan/phase-6-tasks.md` — 향후 검증·이력·승인·출력 UI 슬롯
  - `frontend/src/app/routes.tsx` — 일반 App Shell과 조건표 Focus Shell route 경계
  - `frontend/src/features/projects/ProjectListPage.tsx` — 검색·표 중심 목록
  - `frontend/src/features/projects/ProjectCreateWizard.tsx` — W1 생성 흐름
  - `frontend/src/features/projects/ProjectDetailPage.tsx` — 프로젝트 상세와 Layer 문맥
  - `frontend/src/features/parameters/ParameterAdminPage.tsx` — M1 파라미터 레지스트리
  - `frontend/src/features/sheets/SheetView.tsx` — 조건표 편집·잠금·붙여넣기 흐름
  - `frontend/src/features/sheets/SheetWorkbench.tsx` / `HistoryWorkbench.tsx` —
    공통 워크벤치 호스트와 이력 패널
  - `frontend/src/features/sheets/useHistoryWorkbenchController.ts` — SheetView에서 이력
    조회·상세·셀 범위를 한 컨트롤러로 연결하는 경계
  - 2026-07-13 사용자 승인: A2 / V1 / P1 / W1 / M1 / S1-C
  - 2026-07-14 사용자 승인: 고정 Project Profile / 공유 ChoiceSet / searchable choice
  - 2026-07-16 사용자 승인: A — 작업 집중형 3단계 프로젝트 생성 명료화
  - 2026-07-16 사용자 승인: A — 핵심정보 우선 프로젝트 목록·상세 명료화
  - 2026-07-16 사용자 승인: A — 실제 주 제목에 route focus
  - 2026-07-16 실화면 후속 승인: 공통 PageHeader의 h1 focus ring 제거
  - 2026-07-17 실화면 후속 승인: 조건표 dark Focus Header의 h1 focus ring 제거

이 문서는 PCM UI/UX와 디자인 시스템의 정본이다. 구현 중 충돌이 발견되면 화면별
임시 예외를 늘리기 전에 이 문서와 상세 스펙을 갱신한다.

## Brand

- **Personality:** 정밀하고 차분하며 신뢰할 수 있는 제조 데이터 작업 도구.
- **Trust signals:** 저장·잠금·검증 상태의 명시적 표시, 일관된 용어, 데이터 보존을
  설명하는 피드백, 예측 가능한 화면 이동.
- **Avoid:** 장식적 그라디언트, 과도한 카드·그림자, 불필요한 대시보드 지표, 색만으로
  상태를 표현하는 UI, 설비 제어실처럼 지나치게 어두운 화면, 개발자용 문구 노출.

## Product goals

- **Goals:**
  - 프로젝트를 빠르게 찾고 직접 링크로 다시 열 수 있게 한다.
  - 약 200개 parameter 조건표가 브라우저의 수평·수직 공간을 최대한 사용하게 한다.
  - 프로젝트 생성과 파라미터 관리를 한 화면에 쌓인 폼이 아니라 명확한 작업 흐름으로
    분리한다.
  - 프로젝트 생성은 짧게 유지하고 전체 기본정보는 상세의 잠금 기반 편집으로 제공한다.
  - 업무용 선택지는 안정적 code와 가변 label을 갖는 재사용 ChoiceSet으로 관리한다.
  - Phase 3~6의 검증·이력·코멘트·출력을 현재 작업 문맥을 해치지 않고 수용한다.
  - 공통 상태·폼·버튼·테이블·접근성 규칙을 재사용 가능한 계약으로 만든다.
- **Non-goals:**
  - Phase 3 검증 엔진이나 사용자 문구 매퍼 구현
  - Phase 5~6의 승인·출력 기능 선행 구현
  - 실제 PARTID 원천 DB 연동과 Project Profile 자동 재동기화
  - 모바일 조건표 편집 최적화
  - 새 UI 프레임워크나 외부 폰트 도입
- **Success signals:**
  - 일반 화면에는 전역 사이드바와 고정 `max-w-6xl` 제약이 없다.
  - 프로젝트 목록·생성·상세가 독립 URL을 갖는다.
  - 파라미터 목록이 페이지 첫 화면에 보이고 편집은 드로어에서 수행된다.
  - 조건표는 집중 모드에서 사용 가능한 viewport를 채운다.
  - 기존 생성·잠금·자동저장·붙여넣기·조건 행 동작이 회귀하지 않는다.
  - 프로젝트 상세에서 고정 Profile 전체를 조회·편집할 수 있다.
  - 수백 개 Choice를 code와 label로 검색하고 비활성 기존값도 식별할 수 있다.

## Personas and jobs

- **Primary personas:**
  - 공정 엔지니어: 프로젝트를 찾고 조건표를 장시간 편집·검토한다.
  - 파라미터 관리자: 레지스트리 항목·카테고리·공유 ChoiceSet을 반복 관리한다.
  - 검토자/승인자(향후 Phase 5): 검증 상태와 변경 근거를 확인한다.
- **User jobs:**
  - Process 구조와 백본을 선택해 새 프로젝트를 안전하게 생성한다.
  - 프로젝트 기본정보를 확인하고 잠금 아래에서 수정한다.
  - 재사용 선택지의 code·label·활성 상태와 영향 범위를 관리한다.
  - 수십~수백 개 프로젝트에서 대상 조건표를 검색·필터한다.
  - 100개 미만 Layer × 약 200개 parameter를 키보드 중심으로 편집한다.
  - 오류·이력·코멘트에서 대상 셀로 이동하고 작업 문맥을 유지한다.
- **Key contexts of use:** 폐쇄망의 데스크톱 브라우저, 넓은 모니터, 긴 편집 세션,
  잠금 기반 단일 편집자 모델.

## Information architecture

- **Primary navigation:** 상단 전역 내비게이션 — 프로젝트 / 공정 카탈로그 /
  파라미터 관리. 조건표에서는 전역 내비 대신 40px 집중 헤더를 사용한다.
- **Core routes/screens:**
  - `/projects` — 검색·표 중심 프로젝트 목록
  - `/projects/new` — Process → 백본 → 매칭 확인 단계형 생성
  - `/projects/:projectId` — 프로젝트 요약과 Layer/백본 상세
  - `/projects/:projectId/sheet` — 조건표 집중 모드
  - `/processes` — Process 검색과 구조 preview
  - `/parameters` — 목록 중심 레지스트리 관리와 편집 드로어
  - `/parameters/choice-sets` — 공유 ChoiceSet 목록
  - `/parameters/choice-sets/:setCode` — 수백 개 option을 다루는 전체 페이지 관리
- **Content hierarchy:** 작업 제목·상태·주요 행동 → 검색/필터/도구 → 데이터 표·그리드
  → 필요할 때만 보조 패널.
- **URL ownership:** 선택된 프로젝트와 생성 단계는 path/query로 표현한다. 목록 검색,
  상태와 파라미터 편집 대상도 query로 복원 가능해야 한다.

## Design principles

1. **데이터가 주인공이다.** 장식보다 표·그리드·상태의 가독성을 우선한다.
2. **작업 문맥을 보존한다.** 오류나 mutation이 발생해도 검색, 입력, dirty 셀과 선택을
   가능한 한 유지한다.
3. **고빈도 화면에는 공간을 돌려준다.** 조건표는 full-width/full-height를 기본으로 하고,
   보조 정보는 접을 수 있어야 한다.
4. **한 화면은 한 책임을 가진다.** 목록·생성·상세·편집을 한 페이지에 동시에 쌓지 않는다.
5. **상태는 행동을 안내한다.** 시스템 판정문 대신 문제·영향·다음 행동을 보여준다.
- **Tradeoffs:** 조건표 편집은 모바일보다 데스크톱 작업 효율을 우선한다. 일반 관리 화면은
  좁은 viewport에서도 조회 가능하게 하되 동일한 정보 밀도를 강제하지 않는다.

## Visual language

- **Color — Precision Teal:**
  - Ink `#172F35`
  - Brand strong `#0F766E` (light-surface focus 포함)
  - Brand accent `#14B8A6` (dark-surface focus와 nonessential selection/icon accent)
  - Brand subtle `#CCFBF1`
  - Canvas `#F4F7F8`, Surface `#FFFFFF`, Border subtle `#D7E1E5`,
    Control border `#81979E`
  - Text muted `#52656A`
  - Success `#166534` / `#DCFCE7`
  - Warning `#92400E` / `#FEF3C7`
  - Error `#B91C1C` / `#FEF2F2`
- **Typography:** 네트워크 의존 없는 system sans-serif. 코드·Layer·parameter 식별자는
  system monospace. 화면 제목은 700~800, 본문은 400~500 중심.
- **Spacing/layout rhythm:** 4px 기반. 일반 control 34~36px, 조밀한 table row 34~36px,
  전역 header 52px, 조건표 집중 header 40px.
- **Shape/radius/elevation:** control 6~8px, surface 10~12px. 기본 surface는 border 중심이며
  drawer/dialog 같은 겹침 계층에서만 그림자를 강하게 쓴다.
- **Motion:** 120~180ms의 상태 전환만 사용한다. `prefers-reduced-motion`에서 이동·확대
  효과를 제거한다.
- **Imagery/iconography:** 장식 이미지는 사용하지 않는다. 이미 설치된 Lucide의 16/18px
  outline icon을 쓰며, 아이콘 단독 버튼에는 accessible name과 tooltip을 제공한다.

## Components

- **Existing components/patterns to reuse:** Glide grid adapter, React Query status handling,
  Zustand dirty store, `.input`/button 스타일의 의미, `StatusMessage`의 역할.
- **New/changed shared components:** AppHeader, FocusHeader, PageHeader, Button, IconButton,
  Badge, Field, InlineAlert, Drawer, Dialog, EmptyState, Skeleton, compact table primitives,
  accessible searchable combobox.
- **Variants and states:** default, hover, focus-visible, active/selected, disabled, loading,
  success, warning, error, read-only.
- **Token/component ownership:** semantic token은 `frontend/src/styles.css`; 범용 UI는
  `frontend/src/shared/`; 도메인 조합은 각 `features/*`가 소유한다. 실제 반복이 없는
  단발성 wrapper를 공통 abstraction으로 승격하지 않는다.
- **Approved patterns:**
  - P1 검색·표 중심 프로젝트 목록
  - P1-A 핵심정보 우선 탐색: 조밀한 filter 도구, 핵심 Profile 상시 노출, 고급 Profile 기본 접힘
  - W1 전체 화면 단계형 프로젝트 생성
  - W1-A 작업 집중형 생성: 얇은 진행 표시, 단계당 한 결정, 마지막 단계의 매칭 검토/필수 정보 분리
  - H1-A route focus: 공통 PageHeader의 실제 주 제목만 programmatic focus하고 별도 ring은 그리지 않음
  - M1 목록 + 오른쪽 편집 드로어
  - 고정 Project Profile definition grid + 잠금 기반 오른쪽 편집 드로어
  - ChoiceSet 목록 + option 전체 페이지 관리
  - S1-C 반응형 오류 타일 스트림: 1024/1440/1920에서 3/4/5열, 기본 48~52px,
    한 줄 안내, 선택 시 확장

## Accessibility

- **Target standard:** WCAG 2.2 AA.
- **Keyboard/focus behavior:** 모든 전역/관리 동작은 키보드로 접근한다. primary screen path
  이동 후 주 제목으로 focus를 보내고 검색 query 변경은 입력 focus를 유지한다. App Shell은
  본문 건너뛰기 link를 제공한다. Drawer/Dialog는 focus를 가두고 닫을 때 시작점으로 복귀한다.
- **Contrast/readability:** 텍스트·상태 색은 AA 대비를 충족한다. 상태는 색과 함께 문구·아이콘을
  사용한다. 흰색 본문/작은 글자의 primary background는 `#0F766E`을 사용하며 `#14B8A6`
  위 흰색 글자는 normal text 조합으로 사용하지 않는다. 상호작용 control의 Focus ring은 밝은
  surface에서 `#0F766E`, Ink header에서 `#14B8A6` 또는 white inverse token을 사용한다.
  route 안내용 공통 PageHeader와 조건표 dark Focus Header의 h1은 programmatic focus semantics만
  유지하고 별도 ring을 그리지 않는다.
- **Screen-reader semantics:** 저장·잠금·오류에는 적절한 `role="status"`, `role="alert"`,
  `aria-live`를 사용한다. label 없는 입력과 이름 없는 icon button을 허용하지 않는다.
- **Reduced motion and sensory considerations:** reduced-motion 지원. 깜박임, 색만의 오류 표시,
  hover에만 의존하는 도움말을 금지한다.

## Responsive behavior

- **Supported breakpoints/devices:** 일반 화면은 1024px에서 기능을 유지하고 1440px 이상을
  최적 기준으로 삼는다. 조건표 편집은 데스크톱 우선이며 1024px 미만에서도 horizontal
  scroll로 조회 가능해야 하지만 모바일 편집 품질은 Phase 2.5 목표가 아니다.
- **Layout adaptations:** 상단 내비는 좁은 화면에서 overflow menu로 축약한다. 목록 표는
  중요 열을 우선하고 보조 열을 숨기거나 horizontal scroll을 사용한다. Drawer는 좁은 화면에서
  full-width dialog로 전환한다.
- **Touch/hover differences:** hover 정보는 focus/click으로도 열 수 있어야 한다. 주요 touch
  target은 최소 36px를 유지한다.

## Interaction states

- **Loading:** 기존 레이아웃을 유지하는 skeleton. 페이지 전체 spinner를 반복하지 않는다.
- **Empty:** 비어 있는 이유와 가장 적절한 다음 행동 하나를 제시한다.
- **Error:** 해당 영역에서 원인과 재시도를 제시하고 검색·폼·dirty 상태를 보존한다.
- **Success:** 작업 위치 가까이 짧게 표시한다. 반복 toast를 피한다.
- **Disabled:** 비활성 이유가 문맥상 드러나야 한다. destructive action은 확인한다.
- **Inactive choice:** 저장된 code와 label을 `사용 중지됨`으로 계속 표시하되 새 선택은 막는다.
- **Offline/slow network:** mutation 중 관련 action만 잠근다. 저장 실패 시 입력과 dirty 셀을
  보존한다. 조건표는 기존 캐시를 유지한다.
- **Paste review:** 붙여넣기 preview가 존재하는 동안에는 적용/취소가 우선되는 단일 작업
  모드로 취급하고, 그 결과를 무효화할 셀 편집·카테고리 전환·조건 구조 변경을 막는다.

## Content voice

- **Tone:** 짧고 직접적이며 존중하는 자연스러운 한국어.
- **Terminology:** Process는 구조, Project는 조건표 단위, Layer/Step은 병기, Parameter는
  관리 맥락에서 파라미터로 표기한다. Choice code는 저장 식별자, label은 사용자 표시명이다.
- **Microcopy rules:** `문제 + 영향 + 다음 행동` 순서. 내부 error code나 stack/transport
  원문은 노출하지 않는다. 기존 사용자 이해 가능한 domain message는 유지할 수 있고 Phase 3가
  validation/editor 문구 mapper를 소유한다. 버튼은 `저장`, `프로젝트 생성`, `다시 시도`처럼
  결과가 드러나는 동사형을 사용한다.

## Implementation constraints

- **Framework/styling system:** React 18, React Router, TanStack Query, Zustand, Tailwind CSS 4,
  Glide Data Grid.
- **Design-token constraints:** semantic token을 사용하고 화면별 raw hex 복제를 피한다.
- **Performance constraints:** 그리드 virtualization과 Canvas 계약을 유지한다. UI wrapper가
  전체 sheet data를 복제하거나 매 render마다 변환하지 않는다.
- **Compatibility constraints:** 폐쇄망, 새 외부 의존성 없음. Phase 2.6 API 확장은 기존
  프로젝트 route와 조건표 저장·잠금·붙여넣기 계약을 보존한다.
- **Test/screenshot expectations:** typecheck, 전체 Vitest, production build, 1024/1440/1920
  브라우저 QA, 키보드·focus·aria-live 확인, 핵심 업무 flow 재검증.

## Open questions

- [ ] 실제 조직 브랜드 자산이 제공되면 PCM wordmark만 교체한다. 색·정보 구조는 별도 승인
  없이는 변경하지 않는다. Owner: product. Impact: visual identity only.
- [ ] PARTID Project Profile 원천 DB의 테이블·키·cardinality·필드 매핑을 연동 Phase 전에
  확정한다. Owner: data integration. Impact: provider adapter only.
- [ ] Geometry·Occupancy 필드의 단위와 범위를 실제 원천 계약 수신 후 확정한다.
  Owner: process engineering. Impact: validation and labels only.
