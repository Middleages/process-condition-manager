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

Review-fix RED/GREEN and gate sequence, run exactly as shown:

```bash
cd /home/appuser/process-condition-manager/.worktrees/signal-grid-history-workbench/frontend
npm test -- --run \
  src/features/sheets/useHistoryWorkbenchController.test.ts \
  src/grid/GlideConditionGrid.test.tsx
# RED: 2 files, 58 tests; 55 passed and the 3 intended regressions failed.

npm test -- --run \
  src/features/sheets/useHistoryWorkbenchController.test.ts \
  src/grid/GlideConditionGrid.test.tsx
# GREEN: 2/2 files, 58/58 tests.

npm test -- --run \
  src/features/sheets/useHistoryWorkbenchController.test.ts \
  src/features/sheets/SheetView.test.tsx \
  src/grid/GlideConditionGrid.test.tsx
# Affected: 3/3 files, 123/123 tests.

npm run typecheck
npm run lint
npm test -- --run
npm run build
cd ..
git diff --check
```

The full suite passed **99/99 files, 1,120/1,120 tests**. Typecheck, lint, build, and
diff-check exited 0; the build transformed 2,218 modules. The only build advisories remained the
11 existing Glide annotation removals and existing chunk-size warning (main chunk 1,100.28 kB,
336.96 kB gzip).

Browser reproduction uses two terminals because the preview command is intentionally blocking.

Terminal 1:

```bash
cd /home/appuser/process-condition-manager/.worktrees/signal-grid-history-workbench/frontend
npm run preview -- --host 127.0.0.1 --port 4185
```

Terminal 2, after Terminal 1 reports the local URL:

```bash
cd /home/appuser/process-condition-manager/.worktrees/signal-grid-history-workbench
HISTORY_QA_BASE_URL=http://127.0.0.1:4185 \
HISTORY_QA_OUTPUT=docs/evidence/signal-grid-history-workbench \
node docs/evidence/signal-grid-history-workbench/history_workbench_browser_qa.mjs
```

Stop Terminal 1 with `Ctrl-C` after the harness exits.

## Result

`results.json` reports **pass: 11/11 browser checks and 71/71 assertions**. It covers:

- Current Layer default scope with exactly one initial scoped request and zero unscoped requests;
  initially unavailable current-cell scope; grid selection enabling current-cell scope; roving
  radio keyboard behavior; visible 2px focus; and non-color `aria-checked` selection.
- Collapsed filters, local invalid-filter rejection with five rows preserved and zero new request,
  actor filter application, and Layer switching that retains the actor filter and changes only the
  authoritative `layer_key`.
- Continuous ruled timeline rows, no rounded history-row cards, no invented timeline diff, and
  direct instrumentation at the imperative Glide boundary: ordinary row browsing emitted zero
  `scrollToCell` events while explicit `셀로 이동` emitted exactly one with row 1, column 5, condition
  202, and the expected long parameter code.
- Authoritative cell and batch diffs (`48.0 → 50.0`), lazy/cached batch detail (one fetch after
  collapse/reopen), deleted targets, legacy coverage, timeline pagination failure/retry, and batch
  detail failure/retry with existing rows preserved.
- Inspector widths 320px and 520px; current-cell history captured at 1024×768, expanded batch
  detail captured at 1440×900, and the timeline ledger captured at 1920×1080. Both detailed states
  directly measured deliberately long actor, old-code, and new-value content. The overflow scan
  covered 59 visible ledger descendants—including `span`, `strong`, `dt`, `dd`, `p`, `h4`, `button`,
  and `li` candidates—with zero text overflow, zero document overflow, and zero
  grid/separator/content overlap.

Injected 503s generated three expected Chromium resource errors. Unexpected console messages:
**0**; page errors: **0**; unexpected API requests: **0**.

## API call counts

| Run | auth | project | sheet | timeline root | timeline next | cell | cached batch | retry batch | comments | lock |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Primary interaction | 1 | 1 | 1 | 3 | 3 | 1 | 1 | 2 | 1 | 1 |
| 1024×768 current-cell capture | 1 | 1 | 1 | 1 | 0 | 1 | 0 | 0 | 1 | 1 |
| 1440×900 expanded-batch capture | 1 | 1 | 1 | 1 | 0 | 0 | 1 | 0 | 0 | 1 |
| 1920×1080 timeline capture | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 1 |

The three timeline-next calls are two bounded automatic attempts for the injected failure plus one
explicit successful retry. The two retry-batch calls are one injected failure plus one explicit
successful retry.

## Screenshots

| Artifact and captured state | Inspector | Scanned | SHA-256 |
|---|---:|---:|---|
| `screenshots/history-1024x768.png` — current-cell history | 320px | 5 | `58e25b4c63662fc6eaf5f5d3eb62320981c5b409f99460b26236e6f7a1bb0b73` |
| `screenshots/history-1440x900.png` — expanded batch detail | 520px | 33 | `34bf7c35d736b8dcfc9614ab2b588d4fca644dcec182562d18737b9a4600a255` |
| `screenshots/history-1920x1080.png` — timeline ledger | 520px | 21 | `14b85745d149ed958525930229a560c4ee77ffa852dca4d8b65eae5b8c8a5cb5` |

The three regenerated PNGs were inspected together exactly once at original resolution. They show
the current-cell and expanded batch-detail states with readable wrapped actor/code/value content,
the continuous timeline ledger, visible focus/selection, and no inspector/separator/Grid overlap.

## Bounded correction

The first browser pass found clipped long actor identifiers at all three viewports and both the
ordinary load-more and retry controls present during a next-page error. A RED regression run failed
3 of 13 HistoryWorkbench tests for those contracts. One correction batch added actor wrapping in
timeline/cell/batch-detail ledgers and hides ordinary timeline/cell load-more controls while their
retry state is shown.

After the correction: the component test passed **13/13**; the affected focused gate passed **4/4
files, 99/99 tests**; the full frontend suite passed **99/99 files, 1,118/1,118 tests**; and the
production build exited 0. Commit: `636a8ea` (`fix: harden history pagination and wrapping`). The
single confirmation browser run produced the original evidence set.

The approved review correction added Layer authority to timeline-query enablement, preventing the
intermediate `layer_key: null` request, and added a browser-observable event at the exact resolved
Glide `scrollToCell` boundary. Its RED run failed the three intended assertions (55/58 passing),
then GREEN passed 58/58; affected and full results are recorded above. Product commit: `e511b90`
(`fix: scope initial history query authority`).

The first review harness attempt aborted during primary setup because the new long-value fixture
made an existing exact `50.0` locator ambiguous; it produced no regenerated visual captures and
found no product defect. The locator was narrowed to the first authoritative match. The one
completed review confirmation produced the passing `results.json` and three screenshots above.
The Impeccable detector was not rerun: its preserved single-invocation raw result remains `[]`.
