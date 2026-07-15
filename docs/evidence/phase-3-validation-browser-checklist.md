# Phase 3 validation workbench browser checklist

This is the executable browser checklist for Phase 3 Task 8. A checked item must have a linked
artifact or an exact observation in the execution record. **No browser scenario was executed while
writing Task 8**; the unchecked matrix below is intentionally not evidence. Task 9 owns the final
full-stack run and may copy the proven results into its dated evidence report.

## 1. Isolated local stack prerequisites

Use an isolated Compose project and ports; do not reuse or reset the default development volumes.
The Phase 2.6 browser harness in `scripts/qa/phase26_browser_qa.mjs` is the reference for Chromium,
console/network capture, ARIA snapshots, and the exact 1024/1440/1920 viewport constants. It does
not currently contain Phase 3 scenarios, so passing it alone does not satisfy this checklist.

```bash
cd /home/appuser/process-condition-manager
export COMPOSE_PROJECT_NAME=pcm-phase3-validation-qa
export APP_DB_PORT=15434 INGEST_DB_PORT=15435 BACKEND_PORT=18002 FRONTEND_PORT=15175
APP_DB_PORT=$APP_DB_PORT INGEST_DB_PORT=$INGEST_DB_PORT \
BACKEND_PORT=$BACKEND_PORT FRONTEND_PORT=$FRONTEND_PORT \
  docker compose -p "$COMPOSE_PROJECT_NAME" up -d --build app-db ingest-db backend frontend

docker compose -p "$COMPOSE_PROJECT_NAME" exec -T backend alembic upgrade head
docker compose -p "$COMPOSE_PROJECT_NAME" exec -T backend python -m scripts.seed_dev
curl --fail --silent --show-error "http://127.0.0.1:${BACKEND_PORT}/health"
curl --fail --silent --show-error "http://127.0.0.1:${FRONTEND_PORT}/" >/dev/null
```

Before browser work, record:

```bash
git rev-parse HEAD
git status --short
node --version
npm --version
find "$HOME/.cache/ms-playwright" -maxdepth 2 -type f \( -name chrome -o -name chromium \) | head
curl --fail --silent "http://127.0.0.1:${BACKEND_PORT}/api/parameters" > /tmp/phase3-parameters.json
curl --fail --silent "http://127.0.0.1:${BACKEND_PORT}/api/validation-rules" > /tmp/phase3-rules.json
```

Create or select fixtures through the API using codes discovered from the responses above; never
hardcode a product parameter code into the UI or browser harness. The fixture set must provide:

- one valid project with at least two categories and two ordered Layer/POR groups;
- a required standalone parameter and a bounded/pattern parameter;
- a ChoiceSet value that is stored and then deactivated;
- one `required_if` rule and one `value_exists_in_prior_por` rule;
- a valid zero-issue state plus edits that deterministically create and correct each issue.

Record fixture project ID, parameter codes, categories, rule versions, and validation basis hash in
the run artifact. Verify fixture truth directly before opening the browser:

```bash
export PROJECT_ID='<recorded fixture project id>'
curl --fail --silent "http://127.0.0.1:${BACKEND_PORT}/api/projects/${PROJECT_ID}/sheet" \
  > /tmp/phase3-sheet.json
curl --fail --silent -X POST \
  "http://127.0.0.1:${BACKEND_PORT}/api/projects/${PROJECT_ID}/validate" \
  > /tmp/phase3-validation.json
```

## 2. Required browser matrix

Capture each assertion with a screenshot, ARIA snapshot or DOM observation, plus relevant network
requests. Use Chromium viewports **1024x768**, **1440x900**, and **1920x1080**.

### Lifecycle and truthfulness

- [ ] With a valid zero-issue sheet before any explicit action, `[data-sheet-workbench]` and
  `[data-validation-workbench]` are absent and the grid consumes the unreserved height.
- [ ] The `검증` button is keyboard discoverable outside the absent host.
- [ ] A successful explicit zero-issue request mounts a 28–32px success strip showing `오류 0`,
  `경고 0`, and `검증 완료 · 문제 없음`.
- [ ] Definition/configuration unavailability shows the safe project-level alert, renders no green
  success state, and exposes no raw exception, SQL detail, regex source, or stack text.
- [ ] A failed persistence attempt shows exactly `저장 후 검증해 주세요.` and preserves edits.

### Issue coverage and confirmation lifecycle

- [ ] Standalone required/range/pattern errors show non-color `오류` labels and safe Korean guidance.
- [ ] `required_if` anchors the required target cell and uses display names rather than fixed codes.
- [ ] Prior-POR failure anchors the current source cell and explains both valid recovery choices.
- [ ] A stored inactive choice shows a non-color `경고` label and does not increment the error count.
- [ ] Immediate accepted edit updates the provisional result before persistence.
- [ ] Edit → autosave → 500ms server confirmation changes wording to server-confirmed without losing
  the issue; correcting the value removes it and the matching confirmation remains fenced to the
  current generation.
- [ ] Blocking or aborting the validation request retains the latest usable issues and local
  provisional changes, shows exactly `최신 상태 확인 실패 · 다시 시도`, and retry recovers.
- [ ] Error and warning filters toggle independently; `표시 N / 전체 M` always matches visible tiles.

### Keyboard, resize, and navigation

- [ ] Keyboard only: focus the expand/collapse control and verify `aria-expanded` changes.
- [ ] Keyboard only: toggle both severity filters and verify `aria-pressed` plus truthful counts.
- [ ] Keyboard only: Enter and Space activate a tile once; the selected tile exposes
  `aria-expanded=true` and expands the formerly truncated guidance.
- [ ] The complete truncated guidance is present in the tile accessible name/description.
- [ ] Focus the horizontal `role=separator`; verify `aria-orientation`, min/max/current values,
  ArrowUp growth, ArrowDown shrink, deterministic step, and min/max clamp.
- [ ] Pointer-drag the separator up/down; only the workbench issue area scrolls and the grid retains
  its minmax geometry.
- [ ] Activating a target in the visible category scrolls directly and selects/focuses the exact
  condition/parameter cell.
- [ ] Activating a hidden-category target first changes the category, then after the visible columns
  commit scrolls/selects/focuses the exact cell; no timer race or stale-column jump occurs.
- [ ] While paste review is open, tile navigation cannot bypass the category/paste guard and gives
  the apply-or-cancel guidance.

### Responsive, console, network, and overflow

For each viewport, expand the panel with at least five issues and inspect computed
`grid-template-columns` (not only class text):

- [ ] 1024x768: 3 tile columns; collapsed tiles are 48–52px; no horizontal card/body overflow.
- [ ] 1440x900: 4 tile columns; grid and workbench controls remain reachable.
- [ ] 1920x1080: 5 tile columns; long selected guidance expands without horizontal scrolling.
- [ ] Validation cells retain dirty/comment markers underneath error/warning surface priority, and
  their hover text names severity plus independent dirty/comment facts.
- [ ] Console capture has no uncaught error or React warning during lifecycle, filter, resize,
  category reveal, failure, and retry scenarios.
- [ ] Network capture shows no stale response adopted after a newer edit/project switch and no
  unexpected 4xx/5xx outside the deliberately injected failure.
- [ ] Screenshots contain no clipped primary action, covered focus ring, or viewport overflow.

## 3. Suggested artifact layout

```text
docs/evidence/phase-3-validation/
  run.json                 # source SHA, fixtures, browser/version, timestamps, result summary
  console.jsonl
  network.jsonl
  aria/
  screenshots/
    zero-before-explicit-1440x900.png
    zero-success-1440x900.png
    issues-1024x768.png
    issues-1440x900.png
    issues-1920x1080.png
    network-failure-retry-1440x900.png
    hidden-category-focus-1440x900.png
```

## 4. Task 8 execution record

Browser evidence: **NOT RUN in Task 8**. No screenshot, Chromium result, console log, network log, or
full-stack claim is recorded here. The fixture/harness expansion and final browser execution remain
a Task 9 verification item.

Automated results are recorded only after the final Task 8 verification run:

- [x] Focused workbench/Sheet/grid tests — 5 files, 37 tests passed (`npm test -- src/features/sheets/ValidationWorkbench.test.tsx src/features/sheets/validationWorkbenchState.test.ts src/features/sheets/SheetFocusFrame.test.tsx src/features/sheets/SheetView.test.tsx src/grid/GlideConditionGrid.test.tsx`).
- [x] Full frontend tests — 76 files, 817 tests passed (`npm test`).
- [x] Frontend lint (the repository typecheck alias), explicit typecheck, and production build passed. Build emitted only the pre-existing Glide/Rollup annotation and chunk-size warnings.
- [x] `git diff --cached --check` — passed immediately before the Task 8 commit.

After an isolated run, clean up only its named project:

```bash
docker compose -p "$COMPOSE_PROJECT_NAME" down
# Use `down -v` only after confirming COMPOSE_PROJECT_NAME is exactly pcm-phase3-validation-qa
# and its data is disposable; never run it against the repository's default Compose project.
```
