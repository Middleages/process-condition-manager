# Invalid condition-cell drafts — verification evidence

Captured on 2026-08-14 from `feat/condition-cell-invalid-drafts`. Tasks 1–4 were verified at
`464272a`; the initial editor repair is `136ea8a`, and review-round product corrections are the
separate commits `0213539` and `c99b63f`. The fixture, result transcript, and PNGs in this evidence
set are reproducible without a live backend, package installation, or browser download.

## Automated gates

Initial Tasks 1–4 gate at `464272a`:

```text
cd frontend
npm test -- --run src/features/sheets/editStore.test.ts \
  src/features/sheets/sheetAdapter.test.ts src/grid/cellValue.test.ts \
  src/grid/decimalCell.test.tsx src/grid/GlideConditionGrid.test.tsx \
  src/features/sheets/SheetView.test.tsx \
  src/shared/navigation/useUnsavedChanges.test.ts
7 files / 164 tests passed

npm run typecheck
passed

npm run lint
passed

npm test -- --run
99 files / 1,086 tests passed

npm run build
passed
```

The bounded visual pass found that reopening a retained invalid Text projection gave Glide's editor
the accessibility description instead of the raw draft. The regression was written first and
failed with `expected undefined to be defined` because no editor override existed.

Review then exposed two additional boundaries. The first RED run had 32 existing passes and three
new failures: printable-key `initialValue="9"` opened as retained raw `abc`, placement used a 0 px
gap instead of 8 px, and visible-region refresh read bounds immediately. The first GREEN introduced
the editor authority, fixed popover geometry, and a deferred bounds read. Screenshot comparison then
proved that one animation frame could still observe Glide's preceding scroll transform. A tightened
component RED failed because `getBounds` was called on that first frame; `c99b63f` moved the read to
the second cancellable frame without adding a global listener. Final gates after both corrections:

```text
cd frontend
npm test -- --run src/grid/GlideConditionGrid.test.tsx
1 file / 35 tests passed

npm run typecheck
passed

npm run lint
passed

npm test -- --run
99 files / 1,089 tests passed

npm run build
passed in 6.46s
```

The final build emitted only the pre-existing third-party Glide PURE-comment messages and bundle
size advisory. No new dependency, external font, CDN, or network runtime was introduced.

## Impeccable detector

The detector was run exactly once after confirming the Tasks 1–4 production UI and before browser
fixes. It was not rerun after the bounded repair.

```text
node /home/appuser/.codex/skills/impeccable/scripts/detect.mjs --json \
  frontend/src/grid/decimalCell.tsx \
  frontend/src/grid/GlideConditionGrid.tsx \
  frontend/src/features/sheets/SheetView.tsx
[]
```

The raw JSON result is `[]`.

## Deterministic browser fixture

The Browser plugin was not available, so the brief-authorized local Playwright path was used. The
fixture serves the production Vite build and intercepts `/api/**` with one mutable in-memory project:
3 Layers, 18 condition rows, and 60 number Parameters. `PARAM_001` accepts `0–100 Torr` and
`PARAM_002` is required with a `1–300 s` range.

Existing caches reused without downloads:

```text
Playwright 1.55.0
/home/appuser/.npm/_npx/fd3bca3c548369c0/node_modules/playwright

Chromium 140.0.7339.16
/home/appuser/.cache/ms-playwright/chromium-1187/chrome-linux/chrome
```

Reproduce after `cd frontend && npm run build`:

```bash
cd ..
PLAYWRIGHT_PACKAGE_ROOT=/home/appuser/.npm/_npx/fd3bca3c548369c0/node_modules/playwright \
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/home/appuser/.cache/ms-playwright/chromium-1187/chrome-linux/chrome \
node docs/superpowers/evidence/condition-cell-invalid-drafts/browser-fixture.cjs
```

The final run passed 37/37 recorded assertions and made 12 fixture API calls. Exactly one call used
`PATCH /api/projects/7/cells`, with the single correction
`{ condition_id: 101, parameter_code: "PARAM_001", value: "55" }`.

The single batched scenario covered all required interactions:

1. `1e3` remains visible with a red inset marker and problem/repair popover; zero PATCH calls.
2. Moving away closes the popover while the retained invalid accessibility state and marker remain.
3. Returning to the coordinate reopens the popover with the same raw `1e3`.
4. `999` exposes `0–100 Torr 범위로 입력하세요`; clearing the required value exposes
   `필수값을 입력하세요`.
5. Correcting only `PARAM_001` to `55` sends one PATCH while the required draft remains.
6. Dismissing route confirmation keeps the draft and current Sheet session.
7. Accepting route confirmation, returning through Projects → Detail → Sheet, restores the
   server-backed required value.
8. Editing the bottom-visible row flips the popover above when needed.
9. The debounced Grid accessibility cell contains `Trial 6`, `Chamber pressure`,
   `숫자로 입력하세요`, and `저장되지 않음`.

There were zero page errors and zero unexpected console errors or warnings. The allowlist accepts
only a `warning` whose complete text exactly equals Chromium's known Canvas2D readback advice; a
synthetic same-text `error`, suffixed warning, and substring-only warning were all rejected by the
fixture assertion. Three exact advice messages are expected fixture instrumentation because marker
assertions read pixels with `getImageData`; application code does not perform those reads.

## Viewport measurements

The active-cell bounds are the fixture's fixed-grid/scroller geometry record; Glide anchor bounds
come from the production popover state, and popover bounds are Playwright DOM bounds. Every anchor
matches its active cell within Glide's 1 px rule, and the active-cell/popover intersection area is
exactly zero. `marker pixels` counts red pixels in the active Canvas cell.

| Viewport | Document client / scroll / overflow | Grid scroller client / scroll / left / top | Active / Glide anchor | Popover placement and bounds | Intersection / inside | Marker pixels |
| --- | --- | --- | --- | --- | --- | ---: |
| 1024×768 | 1024 / 1024 / 0 px | 804 / 9372 / 0 / 103 px | x592 y736 w150 h32 / x592 y736 w151 h33 | above · x592 y624 w280 h104 | 0 px² / yes | 721 |
| 1440×900 | 1440 / 1440 / 0 px | 1220 / 9372 / 0 / 0 px | x592 y797 w150 h32 / x592 y797 w151 h33 | above · x592 y685 w280 h104 | 0 px² / yes | 721 |
| 1920×1080 | 1920 / 1920 / 0 px | 1700 / 9372 / 0 / 0 px | x592 y797 w150 h32 / x592 y797 w151 h33 | below · x592 y838 w280 h104 | 0 px² / yes | 721 |

At every width, document horizontal overflow is zero, the Grid scroller owns the 9,372 px virtual
sheet width, the same invalid coordinate remains selected, and the popover stays within the viewport.
The captured popover colors are ink `rgb(23, 47, 53)`, error surface `rgb(254, 242, 242)`, and error
border `rgb(185, 28, 28)`. Their text/surface contrast is 12.85:1 and border/surface contrast is
5.91:1; the Grid teal focus against white is 5.47:1.

## PNG evidence and visual review

- `.impeccable/review/condition-cell-invalid-draft-1024.png` — SHA-256
  `337e6ee4954671dd81f568f1c2fd24170f1e13f8a1a6087e9af08d183e603d6c`
- `.impeccable/review/condition-cell-invalid-draft-1440.png` — SHA-256
  `bb9258bf53e1416599769f6a76ffb7b37ba631356a4b6136cfa80523ef328c36`
- `.impeccable/review/condition-cell-invalid-draft-1920.png` — SHA-256
  `ad964ee01a43a37d3007d757e85308639c2d996c84abc263fda999c4301f55e3`

All three regenerated PNGs were inspected together at original resolution after the review-round
correction. The Drafting Table remains a flat 1 px-rule workspace with stable 32 px Grid rows. The
invalid raw value, marker, selected-cell focus, and Korean problem/repair copy remain legible without
document overflow. At 1024 and 1440 the popover ends 8 px above the active cell; at 1920 it begins
9 px below the fixture's 32 px cell (8 px below Glide's inclusive 33 px bound). The first-pass full
accessibility-description editor overlay is absent; reopening the editor starts from raw `1e3`.

## Scope hygiene

The product repairs change only `GlideConditionGrid.tsx` and its regression test. The evidence
commit contains only this directory and the three requested PNGs. `.superpowers/sdd/**` artifacts
remain untracked by design.
