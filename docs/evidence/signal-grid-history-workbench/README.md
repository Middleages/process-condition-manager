# Signal Grid history workbench browser evidence

Verified on 2026-08-14 KST against the production Vite build. The browser fixture uses
deterministic in-memory `page.route` responses, so it proves frontend/browser behavior at the API
boundary; it does not replace backend or real-IdP integration coverage.

## Environment and commands

- Node/npm came from the existing workspace toolchain.
- The Browser plugin was not installed, so the repository convention of regular Playwright was
  used from `/home/appuser/.npm/_npx/fd3bca3c548369c0/node_modules/playwright`.
- Chromium was already cached at
  `/home/appuser/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome` (Chromium 145.0.7632.6).
- No package, browser, dependency, or network download was performed.
- The deterministic production preview was `http://127.0.0.1:4185`.

Initial automated gates, run in the required order:

```bash
cd frontend
npm test -- --run \
  src/features/sheets/historyWorkbenchState.test.ts \
  src/features/sheets/useHistoryWorkbenchController.test.ts \
  src/features/sheets/HistoryWorkbench.test.tsx \
  src/features/sheets/SheetView.test.tsx
npm run typecheck
npm run lint
npm test -- --run
npm run build
cd ..
git diff --check
```

Initial results: focused **4/4 files, 98/98 tests**; full **99/99 files, 1,117/1,117
tests**; typecheck, lint, build, and diff-check exited 0. The build transformed 2,218 modules.
Known advisories were limited to Rollup removing 11 misplaced `/*#__PURE__*/` annotations from the
existing Glide Data Grid dependency and the existing chunk-size warning (final main chunk
1,100.11 kB, 336.90 kB gzip).

The single detector invocation was:

```bash
node /home/appuser/.codex/skills/impeccable/scripts/detect.mjs --json \
  frontend/src/features/sheets/HistoryWorkbench.tsx \
  frontend/src/features/sheets/HistoryWorkbench.test.tsx \
  frontend/src/features/sheets/SheetView.tsx \
  frontend/src/features/sheets/SheetView.test.tsx
```

Raw JSON result (preserved verbatim):

```json
[]
```

The detector ran exactly once, before the bounded visual correction, and was not rerun.

Browser evidence and confirmation command:

```bash
cd frontend
npm run preview -- --host 127.0.0.1 --port 4185
cd ..
HISTORY_QA_BASE_URL=http://127.0.0.1:4185 \
HISTORY_QA_OUTPUT=docs/evidence/signal-grid-history-workbench \
node docs/evidence/signal-grid-history-workbench/history_workbench_browser_qa.mjs
```

## Result

`results.json` reports **pass: 11/11 browser checks and 57/57 assertions**. It covers:

- Current Layer default scope, initially unavailable current-cell scope, grid selection enabling
  current-cell scope, roving radio keyboard behavior, visible 2px focus, and non-color
  `aria-checked` selection.
- Collapsed filters, local invalid-filter rejection with five rows preserved and zero new request,
  actor filter application, and Layer switching that retains the actor filter and changes only the
  authoritative `layer_key`.
- Continuous ruled timeline rows, no rounded history-row cards, no invented timeline diff,
  ordinary row browsing with zero grid scroll/navigation, and one observed explicit target move.
- Authoritative cell and batch diffs (`48.0 → 50.0`), lazy/cached batch detail (one fetch after
  collapse/reopen), deleted targets, legacy coverage, timeline pagination failure/retry, and batch
  detail failure/retry with existing rows preserved.
- Inspector widths 320px and 520px; 1024×768, 1440×900, and 1920×1080 viewports; zero document
  overflow, zero long-text overflow, and zero grid/separator/content overlap.

Injected 503s generated three expected Chromium resource errors. Unexpected console messages:
**0**; page errors: **0**; unexpected API requests: **0**.

## API call counts

| Run | auth | project | sheet | timeline root | timeline next | cell | cached batch | retry batch | comments | lock |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Primary interaction | 1 | 1 | 1 | 4 | 3 | 1 | 1 | 2 | 1 | 1 |
| 1024×768 capture | 1 | 1 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 1 |
| 1440×900 capture | 1 | 1 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 1 |
| 1920×1080 capture | 1 | 1 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 1 |

The three timeline-next calls are two bounded automatic attempts for the injected failure plus one
explicit successful retry. The two retry-batch calls are one injected failure plus one explicit
successful retry.

## Screenshots

| Artifact | Inspector | SHA-256 |
|---|---:|---|
| `screenshots/history-1024x768.png` (1024×768) | 320px | `408294bf9ff9f7fe33c81de9b72ed2e436a7cbbccd860962641a9e60467ccffb` |
| `screenshots/history-1440x900.png` (1440×900) | 520px | `b1746e2aa00281d632eba31c449e31ead42fa5cf4711ee1f31c892b7fa8a9996` |
| `screenshots/history-1920x1080.png` (1920×1080) | 520px | `189f6f35f298c16c98058f2487df0fb5fe78d36463be271c7bd33e65edbee05a` |

The three PNGs were inspected together at original resolution. They show the continuous ledger,
readable scope/timestamp/actor/value/action content, wrapped long actor/parameter text, visible
focus and selected scope, and no inspector/separator/Grid overlap.

## Bounded correction

The first browser pass found clipped long actor identifiers at all three viewports and both the
ordinary load-more and retry controls present during a next-page error. A RED regression run failed
3 of 13 HistoryWorkbench tests for those contracts. One correction batch added actor wrapping in
timeline/cell/batch-detail ledgers and hides ordinary timeline/cell load-more controls while their
retry state is shown.

After the correction: the component test passed **13/13**; the affected focused gate passed **4/4
files, 99/99 tests**; the full frontend suite passed **99/99 files, 1,118/1,118 tests**; and the
production build exited 0. Commit: `636a8ea` (`fix: harden history pagination and wrapping`). The
single confirmation browser run produced the results and screenshots above.
