# Invalid condition-cell drafts — verification evidence

Captured on 2026-08-14 from `feat/condition-cell-invalid-drafts`. The final whole-branch product,
test, and design-spec correction is commit `0c2da03`. The fixture transcript and three PNGs in this
evidence set are reproducible without a live backend, package installation, or browser download.

## Final automated gates

The final-review regressions were written before the product correction. The first focused run had
102 passes and 11 expected failures: two Sheet persistence-authority failures; Decimal, Text, and
Choice exact-raw failures; two accessibility failures; three editor-preservation failures; and one
popover-copy failure. The final gate on `0c2da03` was:

```text
cd frontend
npm test -- --run src/features/sheets/editStore.test.ts \
  src/features/sheets/sheetAdapter.test.ts src/grid/cellValue.test.ts \
  src/grid/decimalCell.test.tsx src/grid/GlideConditionGrid.test.tsx \
  src/features/sheets/SheetView.test.tsx \
  src/shared/navigation/useUnsavedChanges.test.ts
7 files / 176 tests passed

npm run typecheck
passed

npm run lint
passed (the project lint script delegates to typecheck)

npm test -- --run
99 files / 1,098 tests passed

npm run build
passed in 8.44s; 2,218 modules transformed
```

The build emitted only the pre-existing third-party Glide PURE-comment messages and bundle-size
advisory (`index-DPq9hFD4.js`, 1,095.92 kB / 335.53 kB gzip). No new dependency, external font,
CDN, or network runtime was introduced.

## Impeccable detector

The detector was run exactly once during the original UI implementation and was intentionally not
rerun for this final review fix, as required by the final-review brief.

```text
node /home/appuser/.codex/skills/impeccable/scripts/detect.mjs --json \
  frontend/src/grid/decimalCell.tsx \
  frontend/src/grid/GlideConditionGrid.tsx \
  frontend/src/features/sheets/SheetView.tsx
[]
```

The preserved raw detector result is `[]`.

## Deterministic browser fixture

Browser plugin classification: unavailable. The permitted local Playwright path serves the
production Vite build and intercepts `/api/**` with one mutable in-memory project: 3 Layers, 18
condition rows, and 60 number Parameters. `PARAM_001` accepts `0–100 Torr`; `PARAM_002` is required
with a `1–300 s` range.

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

The final run passed 38/38 recorded assertions and made 12 fixture API calls. Exactly one call used
`PATCH /api/projects/7/cells`, with the single correction
`{ condition_id: 101, parameter_code: "PARAM_001", value: "55" }`.

The browser transcript directly verifies these rendered Chromium contracts:

1. Invalid numeric form `1e3` appears in the Grid cell's accessible output, paints the red inset
   marker, opens the complete problem/state/action popover, and sends zero PATCH calls.
2. Reopening that retained cell uses the Decimal editor with `inputmode="decimal"` and exact input
   `1e3`; moving away hides only the popover, and returning reopens it.
3. Parseable out-of-range input `00501.0` remains exact in cell accessibility output while the
   popover exposes `0–100 Torr 범위로 입력하세요`.
4. Clearing the required value exposes the explicit accessible description `입력값 비어 있음` and
   the full `입력값은 저장되지 않았습니다` / `값을 수정하면 저장됩니다` popover copy.
5. Correcting only `PARAM_001` to `55` sends one PATCH while the required draft remains.
6. Dismissing route confirmation keeps the draft; accepting it and returning through Projects →
   Detail → Sheet restores the server-backed value.
7. The bottom-row accessible cell includes `Layer: CMP (030)`, `Trial 6`, `Chamber pressure`, exact
   raw `입력값 "1e3"`, `숫자로 입력하세요`, and `저장되지 않음`.
8. At 1024, 1440, and 1920 widths the active invalid cell stays selected/marked, the Grid owns
   horizontal overflow, the popover uses fresh Glide bounds, remains inside the viewport, and has
   exactly zero intersection with the active cell.

Choice picker/loading/retry and Text-editor preservation are exercised by the focused component
suite; this all-number deterministic browser fixture does not claim browser coverage for Choice or
Text columns.

There were zero page errors and zero unexpected console errors or warnings. The allowlist accepts
only a `warning` whose complete text exactly equals Chromium's known Canvas2D readback advice; a
synthetic same-text `error`, suffixed warning, and substring-only warning were all rejected. Three
exact advice messages are expected fixture instrumentation because marker assertions read pixels
with `getImageData`; application code does not perform those reads.

## Viewport measurements

The active-cell bounds are the fixture's fixed-grid/scroller geometry; Glide anchor bounds come
from the production popover state; popover bounds come from Playwright DOM measurement. Every
anchor matches its active cell within Glide's inclusive 1 px rule, and active-cell/popover
intersection is exactly zero. `Marker pixels` counts red pixels in the active Canvas cell.

| Viewport | Document client / scroll / overflow | Grid scroller client / scroll / left / top | Active / Glide anchor | Popover placement and bounds | Intersection / inside | Marker pixels |
| --- | --- | --- | --- | --- | --- | ---: |
| 1024×768 | 1024 / 1024 / 0 px | 804 / 9372 / 0 / 103 px | x592 y736 w150 h32 / x592 y736 w151 h33 | above · x592 y624 w280 h104 | 0 px² / yes | 732 |
| 1440×900 | 1440 / 1440 / 0 px | 1220 / 9372 / 0 / 0 px | x592 y797 w150 h32 / x592 y797 w151 h33 | above · x592 y685 w280 h104 | 0 px² / yes | 732 |
| 1920×1080 | 1920 / 1920 / 0 px | 1700 / 9372 / 0 / 0 px | x592 y797 w150 h32 / x592 y797 w151 h33 | below · x592 y838 w280 h104 | 0 px² / yes | 732 |

At every width, document horizontal overflow is zero, the Grid scroller owns the 9,372 px virtual
sheet width, and the popover stays within the viewport. Popover colors remain ink
`rgb(23, 47, 53)`, error surface `rgb(254, 242, 242)`, and error border `rgb(185, 28, 28)`.

## PNG evidence and one-pass visual review

- `.impeccable/review/condition-cell-invalid-draft-1024.png` — SHA-256
  `cd71d23ae3ced564e375f8755c43e73e78d78fd7e744a687461b34154b0e5111`
- `.impeccable/review/condition-cell-invalid-draft-1440.png` — SHA-256
  `f7fceb70c28cfdf042b4a0a63db1c6e1d7fabf208953d0241d4225888b5eb43f`
- `.impeccable/review/condition-cell-invalid-draft-1920.png` — SHA-256
  `7dc9f6f878fb60264f8d586dc152bc8d80c44c0a85053b0ae59ec3257dd41615`

All three regenerated PNGs were inspected together once at original resolution. The flat Drafting
Table, fixed 32 px rows, exact raw `1e3`, red inset/non-color marker, teal selected-cell focus, and
three-line no-constraint popover are legible at every width. The popover carries the complete
problem/state/action copy and never obscures the selected value. No further visual changes or
screenshot regeneration followed this inspection.

## Scope hygiene

The product correction is confined to the existing Sheet/Grid/editor boundaries and their tests,
plus the approved 32 px design-spec reconciliation. No store, context, state machine, persistence
path, or architecture layer was added. This evidence commit contains only this directory and the
three requested PNGs. `.superpowers/sdd/**` artifacts remain untracked by design.
