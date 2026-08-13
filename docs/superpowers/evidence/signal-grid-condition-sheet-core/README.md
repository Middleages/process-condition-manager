# Signal Grid condition sheet core — verification evidence

Captured on 2026-08-14 from the `feat/signal-grid-sheet-core` worktree. The fixture and recorded results in this directory make the browser run reproducible without a live backend or browser download.

## Automated checks

The PostgreSQL checks used both of these variables:

```text
APP_TEST_DATABASE_URL=postgresql+asyncpg://pcm_user:pcm_pass@localhost:15442/pcm_test
APP_DATABASE_URL=postgresql+asyncpg://pcm_user:pcm_pass@localhost:15442/pcm_test
```

Focused commands and results:

```text
cd backend
APP_TEST_DATABASE_URL=... APP_DATABASE_URL=... uv run pytest tests/features/test_sheets_api.py tests/features/test_conditions_api.py -q
30 passed in 7.30s

cd ../frontend
npm test -- --run src/features/sheets/sheetAdapter.test.ts src/features/sheets/layerViewportState.test.ts src/features/sheets/LayerNavigator.test.tsx src/features/sheets/LayerBackboneContext.test.tsx src/features/sheets/SheetView.test.tsx src/grid/model.test.ts src/grid/GlideConditionGrid.test.tsx
7 files / 150 tests passed
```

Full repository commands and results:

```text
cd backend
uv run ruff check .
All checks passed!

uv run pyright
0 errors, 0 warnings, 0 informations

APP_TEST_DATABASE_URL=... APP_DATABASE_URL=... uv run pytest -q
834 passed, 1 skipped, 70 warnings in 383.27s; 93% coverage

cd ../frontend
npm run typecheck
passed

npm run lint
passed

npm test -- --run
99 files / 1,056 tests passed in 11.65s

npm run build
passed in 8.25s
```

The backend warnings are the existing Alembic `prepend_sys_path` deprecation. The build emitted only the existing third-party Glide PURE-comment messages and the existing bundle-size advisory. The performance gate passed in the full backend suite, so its allowed isolated confirmation was not needed.

## Browser fixture

`browser-fixture.cjs` serves the production build with Vite preview and intercepts `/api/**` in Playwright. Its mutable in-memory API starts with project 7, three Layers, six condition rows, 60 Parameters, one POR per Layer, three distinct Backbone sources, and a required-value validation gap. It deliberately returns bounded 500, 422, and 409 responses for the failure paths under test. No application data or external service is used.

The run reused these existing caches; it did not install a package or download a browser:

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
node docs/superpowers/evidence/signal-grid-condition-sheet-core/browser-fixture.cjs
```

The run passed 27/27 recorded assertions and made 69 fixture API calls. It covered page identity; default all-Layer visibility; navigator jumps without filtering; current-only on/off; switching to L3 while current-only remained on and seeing Backbone change to `LINE-C / POLISH / SRC-C · 003 / SOURCE-C`; Step Seq/Layer repeat suppression; horizontal Parameter scrolling; cell/navigator/Backbone synchronization; failed and retried dirty save; failed structural mutation; add, duplicate, non-POR delete, POR transfer, and blocked POR delete; validation/history/Backbone-diff jumps; read-only lock recovery; and native Back focus restoration. See `browser-results.json` for each assertion and the request transcript.

The seven console error entries are expected browser resource messages for four bounded save 500s, one structural 500, one blocked-POR 422, and one read-only 409. There were zero page errors and zero unexpected console errors or warnings.

| Viewport | Document client/scroll/overflow | Grid scroller client/scroll | Active context |
| --- | --- | --- | --- |
| 1024×768 | 1024 / 1024 / 0 px | 424 / 9372 px | L3 / LINE-C Backbone |
| 1440×900 | 1440 / 1440 / 0 px | 840 / 9372 px | L3 / LINE-C Backbone |
| 1920×1080 | 1920 / 1920 / 0 px | 1320 / 9372 px | L3 / LINE-C Backbone |

Captured PNGs:

- `.impeccable/review/signal-grid-condition-sheet-1024.png` — SHA-256 `d3d8bcfb4faaf960a23e05de8b652ed0c2d94c5ac90275b56b2d39293214c987`
- `.impeccable/review/signal-grid-condition-sheet-1440.png` — SHA-256 `dce2e318210bd02f6033a6b42ced06c1d5a93cbc80a13bed8cfabace8415c762`
- `.impeccable/review/signal-grid-condition-sheet-1920.png` — SHA-256 `cd2a8da83cec66b7d5a385146a7798def501203f5aaf767cf8423843cb51b3c9`

Visual inspection confirmed the page stays bounded at all three sizes, the Grid owns wide-column scrolling, the navigator/Backbone/validation surfaces remain legible, and the final one-column validation issue tile is readable in the fixed-width inspector.

## Browser-found defect and fix

The first screenshot set exposed an unreadable validation issue tile: page-width media queries divided the fixed-width inspector into three, four, or five columns. TDD reproduced the defect by requiring the rendered inspector issue list to stay single-column; the test failed on the responsive classes, then passed after the list was reduced to `grid-cols-1`. The final frontend suite/build and the single bounded browser confirmation above passed after the one-line product fix.

## Detector and scope hygiene

The required detector was run exactly once after Tasks 1–5 and returned an empty JSON array:

```text
node /home/appuser/.codex/skills/impeccable/scripts/detect.mjs --json frontend/src/features/sheets/LayerNavigator.tsx frontend/src/features/sheets/LayerBackboneContext.tsx frontend/src/features/sheets/SheetView.tsx frontend/src/grid/GlideConditionGrid.tsx
[]
```

Diff review from the pre-slice baseline confirms the only new frontend product modules are `layerViewportState.ts` and `LayerBackboneContext.tsx`. There is no new store, context provider, global listener, dependency, or Glide import outside the existing Grid boundary. `SheetView` still composes the existing hooks/controllers. `git diff --check` passed and the slice contains no unrelated files.
