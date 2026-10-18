# Issue 89 rendered browser evidence

Recorded 13-scenario candidate: `7c1ea916c3fee6306f9aa7208184702cbdca9a69`.

Actual frontend source rendered by Vite on 15187 using retained Playwright and Chromium1208. **All backend APIs intercepted and mocked.** This is UI interaction evidence, not real backend/DB/fencing enforcement. The URL is automation-only and is not a usable regular-browser preview.

Recorded outcome: **13 scenarios pass**, zero browser `pageerror` events, zero unhandled API requests, zero duplicate lock acquisitions. `results.json` combines the main candidate run and the targeted empty/error rerun; raw results remain in `final-main-results.json` and `final-recheck-results.json`. Console event stream was not recorded, so no blanket zero-console-error claim is made. Intentional 503s cover release and metadata/sheet failures.

[PR #90](https://github.com/Middleages/process-condition-manager/pull/90) is the primary readiness and current candidate record. These files preserve browser evidence at the SHA above; they do not imply the full scenarios were rerun on subsequent commits.

## Recorded harness and reproduction prerequisites

The original commands were `node /tmp/pcm-issue89-qa/run.mjs`, then `QA_SCENARIOS=empty,error node /tmp/pcm-issue89-qa/run.mjs`, and `node /tmp/pcm-issue89-qa/console-check.mjs`. The targeted rerun replaced the empty/error results in the combined report; raw reports remain alongside it.

The archived scripts require Node.js, the retained Playwright module at `/home/appuser/.npm/_npx/fd3bca3c548369c0/node_modules/playwright`, Chromium at `/home/appuser/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome`, and this candidate's frontend served at `http://127.0.0.1:15187`. Those are environment-specific paths, not portable dependencies. The fixture intercepts `**/api/**` inside Playwright only. A regular browser at that address does not receive fixture data. No backend or database is supplied by these scripts.

From the repository root, with those prerequisites already available:

```bash
QA_OUTPUT_DIR=/tmp/pcm-issue89-reproduction node docs/evidence/product-workspace-89/run.mjs
QA_OUTPUT_DIR=/tmp/pcm-issue89-recheck QA_SCENARIOS=empty,error node docs/evidence/product-workspace-89/run.mjs
QA_OUTPUT_DIR=/tmp/pcm-issue89-reproduction node docs/evidence/product-workspace-89/console-check.mjs
```

The archived copies add only `QA_OUTPUT_DIR` so reproduction need not overwrite original evidence. They were not rerun during documentation preparation. Their candidate labels record the historical run and must be updated before testing a different commit. Run serially and stop the temporary frontend afterward; no regular-browser preview is promised.

## Recorded passing behavior

1. Actual numeric `1e3` invalid draft retained across basic/history/sheet; profile edit blocked; no cell PATCH; canceled list navigation stays, confirmed leave exits.
2. Actual numeric cell edit saves `75` after the existing three-second debounce.
3. Basic profile save waits for delayed sheet lock release, takes a different token, persists comment, releases, then sheet reacquires; no concurrent ownership.
4. Failed release keeps old lock, blocks opening profile editor, and explicit retry recovers editing.
5. CLEAN history event returns to sheet tab and preserves CLEAN selection.
6. Actual clipboard `88\t99` stages two cells; tab navigation retains preview; basic editor blocked; apply sends paste-origin cell save.
7. List Open enters sheet directly; LINE/query URL and original Open focus restore; browser Back restores list URL.
8. Approved read-only sheet acquires no lock and history loads.
9. Empty sheet acquires no lock; basic/history remain available and two fixed history events load.
10. Sheet GET error acquires no lock; basic/history remain available and history loads.
11. Keyboard editing resumes after tab return and commits `80` (canvas click, Enter; fallback Enter/type opens visible decimal editor).
12. Profile save followed by metadata refetch503 retains context and saved comment; explicit retry resumes actual cell editing and commits `82`.
13. Old `/projects/42` bookmark redirects to `/projects/42/sheet`.

Harness corrections were not product fixes: early autosave wait below3s, missing choice-set metadata mocks, outdated history action label, immediate focus assertion before effect, and strict locator expecting one aggregate history item. Earlier diagnostics are excluded from this evidence folder. Product readonly/empty history defect identified on prior candidate was fixed by implementation owner; this candidate's real UI now requests and displays history.

## Actual screenshot image inspection

Image-capable QA child `/root/browser_fixture` opened final images with `view_image`, not merely DOM inspection:

- `sheet-1440`, `sheet-1024`: shared identity/version/status readable; primary tabs clear; layers and numeric cells meaningful. At1024 grid viewport scrolls horizontally for later columns, without header/tab clipping.
- `profile-1440`, `profile-1024`: 1440 side-by-side groups become stacked readable groups at1024; secondary details collapsed; review action visible in1440; no overlapping text.
- `history-1440`, `history-1024`: current layer, consistent event coordinates and return action readable; 1440 retained-draft warning remains visible; long actor text stays contained.
- `invalid-retained-1440`, `paste-retained-1440`: red raw numeric error and green staged cells visibly survive tab navigation; explanations and apply controls readable.
- `profile-edit-1440`: reused drawer renders dirty comment and fixed save/cancel footer; narrow choice fields truncate existing control text, with full selected value repeated beneath.
- `readonly-1024`, `empty-1024`, `error-1024`: approved badge/read-only explanation and empty/error text remain under common navigation.
- `release-error-1440`, `profile-refresh-error-1440`: visible warning and retry controls; existing product context retained while editing suspended.
- `history-jump-1024`: sheet selection returns to CLEAN.

The Feature Leader owns final review, PR readiness and temporary-server cleanup. No real backend behavior, full workflow transitions, or production deployment claimed.

## Supplementary console and history-image check

Same candidate `7c1ea916c3fee6306f9aa7208184702cbdca9a69`. Command: `node /tmp/pcm-issue89-qa/console-check.mjs`. Scope deliberately narrow: normal sheet → basic information → history, approved sheet → history, empty sheet → history, all at1024×768; no injected failures. **All three passed with zero console errors/warnings and zero pageerrors.** Normal and approved history each displayed one filtered event; empty-sheet history displayed both fixed historical events. Evidence: `console-results.json`. Original13 scenario results are unchanged; this supplementary check covers console behavior only for these three paths, not the earlier injected503 scenarios.

QA child opened and visually inspected `readonly-history-1024.png` and `empty-history-1024.png` with `view_image`. Approved history shows green approved badge, current ETCH scope, consistent event coordinate and condition-sheet return action. Empty history shows both ETCH101 and CLEAN202 events. The fixture marks historical targets available, so return buttons render; this narrow check did not exercise missing-coordinate button behavior. Both screenshots retain common identity/navigation, readable rows and contained long actor text without clipping or overlap.

## Final badge-only followup

Candidate `27aa42777d4a1dedf3154ada58f293c6a358bfe0`. Command: `node /tmp/pcm-issue89-qa/badge-check.mjs`. Limited to basic-information surface at1440×900 and1024×768 after status-badge reuse change; original13 scenarios were not rerun. Both checks pass: common header and workflow each say `작성 중`, have equal computed text/background/border colors and14px/700 typography, and no `초안` badge remains. Zero console errors/warnings, pageerrors or unexpected API requests on these two surface checks. Evidence: `badge-results.json`.

`profile-1440.png` and `profile-1024.png` are replaced with this final candidate; `profile-workflow-1024.png` is an additional scrolled workflow capture. QA child opened all three with `view_image`: header/workflow badges consistently neutral and legible, common context/tabs stay visible while1024 basic panel scrolls, and review action remains a distinct rectangular button. Other images retain their earlier documented7c1ea91 revision. Backend remains mocked.

Archived command (same environment prerequisites, served frontend at this later SHA):

```bash
QA_OUTPUT_DIR=/tmp/pcm-issue89-badge node docs/evidence/product-workspace-89/badge-check.mjs
```

## Screenshot files

- [empty-1024](screenshots/empty-1024.png)
- [empty-history-1024](screenshots/empty-history-1024.png)
- [empty-profile-1024](screenshots/empty-profile-1024.png)
- [error-1024](screenshots/error-1024.png)
- [error-profile-1024](screenshots/error-profile-1024.png)
- [history-1024](screenshots/history-1024.png)
- [history-1440](screenshots/history-1440.png)
- [history-jump-1024](screenshots/history-jump-1024.png)
- [invalid-retained-1440](screenshots/invalid-retained-1440.png)
- [paste-retained-1440](screenshots/paste-retained-1440.png)
- [profile-1024](screenshots/profile-1024.png)
- [profile-1440](screenshots/profile-1440.png)
- [profile-edit-1440](screenshots/profile-edit-1440.png)
- [profile-refresh-error-1440](screenshots/profile-refresh-error-1440.png)
- [profile-workflow-1024](screenshots/profile-workflow-1024.png)
- [readonly-1024](screenshots/readonly-1024.png)
- [readonly-history-1024](screenshots/readonly-history-1024.png)
- [readonly-profile-1024](screenshots/readonly-profile-1024.png)
- [release-error-1440](screenshots/release-error-1440.png)
- [sheet-1024](screenshots/sheet-1024.png)
- [sheet-1440](screenshots/sheet-1440.png)
