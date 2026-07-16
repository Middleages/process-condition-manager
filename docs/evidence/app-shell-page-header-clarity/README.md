# App Shell and PageHeader Clarity Browser Evidence

> **Historical visual evidence:** 이 캡처는 PR #78의 title-only ring 구현을 기록한다.
> 2026-07-16 실화면 후속 검토에서 공통 PageHeader h1의 보이는 ring은 제거하기로 했으며,
> h1 marker·programmatic focus와 아래 geometry/focus-flow 검증은 계속 유효하다.

- Build commit: `9b06e376378f34afcb83d7e124ab4f08c90b6d6c`
- Runtime: Playwright 1.57.0 / Chromium 143.0.7499.4
- Fixture: 8 list projects, 12 detail layers, backbone projects #41 and #44

## Geometry and focus measurements

| Route | Viewport | Body overflow | Table overflow | Frame width | Details open | Layer heading bottom | Layer header bottom | Layer first row bottom | Active tag | Title focused | Header focused | Markers | Title outline | Title width | Header width |
| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | --- | --- | --- | ---: | --- | ---: | ---: |
| `/projects` | 1024x768 | 0px | 0px | 976px | n/a | n/a | n/a | n/a | H1 | true | false | 1 | 2px solid | 316.3px | 976px |
| `/projects/42` | 1024x768 | 0px | n/a | 976px | false | 908.3px | 979.3px | 1015.3px | H1 | true | false | 1 | 2px solid | 398.8px | 976px |
| `/projects` | 1440x900 | 0px | 0px | 1376px | n/a | n/a | n/a | n/a | H1 | true | false | 1 | 2px solid | 316.3px | 1376px |
| `/projects/42` | 1440x900 | 0px | n/a | 1376px | false | 686.3px | 757.3px | 793.3px | H1 | true | false | 1 | 2px solid | 398.8px | 1376px |
| `/projects` | 1920x1080 | 0px | 0px | 1600px | n/a | n/a | n/a | n/a | H1 | true | false | 1 | 2px solid | 316.3px | 1600px |
| `/projects/42` | 1920x1080 | 0px | n/a | 1600px | false | 666.3px | 737.3px | 773.3px | H1 | true | false | 1 | 2px solid | 398.8px | 1600px |

All six captures have one focused h1 marker, a visible 2px title outline, a non-focused outer header, and a title box narrower than its header surface.

## Focus-flow assertions

- Query typing retained search focus at 1440x900: true.
- Skip Link focused `#main-content` at 1440x900: true.
- Filtered list browser Back: query=true, search draft=true, device choice=true, category choice=true, project-link focus=true.
- Native details: closed initially on every detail capture; Enter opened=true; Space closed=true.
- Profile edit drawer: dialog opened=true; trigger focus returned=true.
- Condition-sheet browser run: not executed. The unchanged custom title contract is covered by the focused `src/features/sheets/SheetView.test.tsx` suite (17 tests passed in the Task 2 adjacent run).

## Captures

- `project-list-1024x768.png`
- `project-list-1440x900.png`
- `project-list-1920x1080.png`
- `project-detail-1024x768.png`
- `project-detail-1440x900.png`
- `project-detail-1920x1080.png`

## Runtime health

- Unexpected console warnings/errors: 0.
- Unexpected page errors: 0.
- Failed static/browser requests: 0.
- Unexpected API requests/failures: 0.

## Original-resolution visual review

- Current-model review completed for all six PNGs at original resolution on 2026-07-16.
- The teal route-entry outline is bounded to the h1 box; it never encloses the description, actions, or full PageHeader surface. The list title box is 316.3px and the detail title box is 398.8px, versus 976–1600px outer headers.
- At 1024px, title/description alignment and both list/detail action groups remain legible without body or table overflow.
- At 1440px, global navigation remains visually separate and the detail Layer heading, table header, and first row remain above the 900px fold.
- At 1920px, both route frames remain capped at 1600px and the surrounding canvas preserves the approved browse-layout hierarchy.
