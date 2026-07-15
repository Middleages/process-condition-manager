# Phase 3 validation workbench browser checklist

This checklist originated in Phase 3 Task 8. A checked item has a machine-readable observation in
[`phase-3-validation/run.json`](phase-3-validation/run.json), a linked screenshot/ARIA artifact, or
both. Task 8 itself ran no browser scenario; the checked matrix below records the isolated Task 9
Chromium execution. Two deliberately unchecked compound assertions retain their uncovered portion
instead of treating nearby automated coverage as browser evidence.

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

- [x] With a valid zero-issue sheet before any explicit action, `[data-sheet-workbench]` and
  `[data-validation-workbench]` are absent and the grid consumes the unreserved height.
- [x] The `검증` button is keyboard discoverable outside the absent host.
- [x] A successful explicit zero-issue request mounts a 28–32px success strip showing `오류 0`,
  `경고 0`, and `검증 완료 · 문제 없음`.
- [x] Definition/configuration unavailability shows the safe project-level alert, renders no green
  success state, and exposes no raw exception, SQL detail, regex source, or stack text.
- [x] A failed persistence attempt shows exactly `저장 후 검증해 주세요.` and preserves edits.

### Issue coverage and confirmation lifecycle

- [x] Standalone required/range/pattern errors show non-color `오류` labels and safe Korean guidance.
- [x] `required_if` anchors the required target cell and uses display names rather than fixed codes.
- [x] Prior-POR failure anchors the current source cell and explains both valid recovery choices.
- [x] A stored inactive choice shows a non-color `경고` label and does not increment the error count.
- [x] Immediate accepted edit updates the provisional result before persistence.
- [x] Edit → autosave → 500ms server confirmation changes wording to server-confirmed without losing
  the issue; correcting the value removes it and the matching confirmation remains fenced to the
  current generation.
- [x] Blocking or aborting the validation request retains the latest usable issues and local
  provisional changes, shows exactly `최신 상태 확인 실패 · 다시 시도`, and retry recovers.
- [x] Error and warning filters toggle independently; `표시 N / 전체 M` always matches visible tiles.

### Keyboard, resize, and navigation

- [x] Keyboard only: focus the expand/collapse control and verify `aria-expanded` changes.
- [x] Keyboard only: toggle both severity filters and verify `aria-pressed` plus truthful counts.
- [x] Keyboard only: Enter and Space activate a tile once; the selected tile exposes
  `aria-expanded=true` and expands the formerly truncated guidance.
- [x] The complete truncated guidance is present in the tile accessible name/description.
- [x] Focus the horizontal `role=separator`; verify `aria-orientation`, min/max/current values,
  ArrowUp growth, ArrowDown shrink, deterministic step, and min/max clamp.
- [x] Pointer-drag the separator up/down; only the workbench issue area scrolls and the grid retains
  its minmax geometry.
- [x] Activating a target in the visible category scrolls directly and selects/focuses the exact
  condition/parameter cell.
- [x] Activating a hidden-category target first changes the category, then after the visible columns
  commit scrolls/selects/focuses the exact cell; no timer race or stale-column jump occurs.
- [x] While paste review is open, tile navigation cannot bypass the category/paste guard and gives
  the apply-or-cancel guidance.

### Responsive, console, network, and overflow

For each viewport, expand the panel with at least five issues and inspect computed
`grid-template-columns` (not only class text):

- [x] 1024x768: 3 tile columns; collapsed tiles are 48–52px; no horizontal card/body overflow.
- [x] 1440x900: 4 tile columns; grid and workbench controls remain reachable.
- [x] 1920x1080: 5 tile columns; long selected guidance expands without horizontal scrolling.
- [ ] Validation cells retain dirty/comment markers underneath error/warning surface priority, and
  their hover text names severity plus independent dirty/comment facts. *(Validation + dirty was
  observed; no comment-bearing Phase 3 browser fixture exists.)*
- [x] Console capture has no uncaught error or React warning during lifecycle, filter, resize,
  category reveal, failure, and retry scenarios.
- [ ] Network capture shows no stale response adopted after a newer edit/project switch and no
  unexpected 4xx/5xx outside the deliberately injected failure. *(A newer-edit timeline and zero
  unexpected failures were observed; an in-flight project-switch race was not browser-exercised.)*
- [x] Screenshots contain no clipped primary action, covered focus ring, or viewport overflow.

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

## 5. Task 9 execution record — 2026-07-15 UTC / 2026-07-15–16 KST

**Result:** passed in an isolated `pcm-phase3-validation-qa` Compose project. The final run started
at `2026-07-15T14:58:34.568Z` (`23:58:34.568+09:00`) and completed at
`2026-07-15T14:59:02.045Z` (`23:59:02.045+09:00`) against base source SHA
`43a95b92986a2bb4ba2e0130e17f9c26c4379734`. The run records the dirty source paths and SHA-256
hashes of every runtime file changed by browser-discovered fixes, so the captured result is tied to
actual uncommitted source rather than only to the base commit.

Durable evidence:

- [machine-readable run and assertions](phase-3-validation/run.json)
- [fixture identity](phase-3-validation/fixture.json), [parameter definitions](phase-3-validation/fixture-parameters.json),
  [rules](phase-3-validation/fixture-rules.json), [Sheet](phase-3-validation/fixture-sheet.json), and
  [mutated six-issue validation result](phase-3-validation/fixture-validation.json)
- [browser harness](phase-3-validation/phase3_browser_qa.mjs) and
  [fixture seeder](phase-3-validation/seed_validation_fixture.py)
- [console capture](phase-3-validation/console.jsonl),
  [network capture](phase-3-validation/network.jsonl), and
  [runtime provenance](phase-3-validation/runtime.txt)
- [zero-success ARIA](phase-3-validation/aria/zero-success-main.yaml) and
  [issue-workbench ARIA](phase-3-validation/aria/issues-workbench-1440x900.yaml)
- [screenshots](phase-3-validation/screenshots/) and
  [artifact SHA-256 manifest](phase-3-validation/artifact-manifest.sha256)

Exact observations supporting the checked items:

- Before explicit validation both workbench hosts were absent and the grid was 723px high. Keyboard
  Tab reached `검증` in six steps. The explicit zero result mounted a 30px strip with `오류 0`,
  `경고 0`, and `검증 완료 · 문제 없음`.
- A held range edit displayed a provisional issue before persistence. The PATCH request occurred at
  epoch ms `1784127517004`, its held response at `1784127517042`, and the later correction cleared
  provisionally at `1784127517997`; authoritative confirmation followed both durable states.
- Four deliberately failed persistence attempts retained clipboard value `99`, showed exactly
  `저장 후 검증해 주세요.`, and a subsequent retry persisted the edit.
- The six-issue fixture produced five errors and one warning: `required`, `range_max`,
  `pattern_mismatch`, `value_not_found_in_prior_por`, `required_if`, and `choice_inactive`.
  Rendered text used display names/action guidance and contained none of the forbidden internal
  sentinel, raw pattern, SQL, or stack content.
- A deliberate validation 503 retained all six tiles, showed exactly
  `최신 상태 확인 실패 · 다시 시도`, and recovered on retry. A deliberate ChoiceSet-definition
  failure showed `검증 규칙을 불러오지 못했습니다. 관리자에게 확인을 요청해 주세요.`, with no
  workbench and no green success state.
- Filter states were `6/6`, `1/6`, `0/6`, `5/6`, then `6/6`; Enter and Space each toggled once.
  The selected prior-POR tile expanded from 50px to 74px and retained the complete Korean guidance
  in its accessible label and title.
- The horizontal separator exposed min `180`, max `520`, current `300`; ArrowUp/ArrowDown moved by
  24 and both clamps were reached. Pointer drag changed panel height `280→328→280` and grid height
  `443→395→443` while the issue area remained the scroll owner.
- Hidden-category activation selected `qa_hidden`, focused the grid canvas, and copied exact target
  value `MISSING`; visible-category activation copied `99`. Open paste review kept the current
  category and showed `붙여넣기를 적용 또는 취소한 뒤 이동해 주세요.`
- Computed tile columns were exactly 3/4/5 at 1024/1440/1920. All collapsed tile heights were 50px;
  the selected 1920 tile was 74px. Document, body, grid, and workbench had no horizontal overflow.
- Chromium `143.0.7499.4` recorded zero unexpected console warnings/errors/page errors, zero
  unexpected HTTP failures, and zero unexpected request failures. Seven deliberately injected 503
  responses and their seven browser resource-error messages remain explicitly categorized in the
  captures rather than filtered away.
- Manual visual inspection of the zero, issue, hidden-focus, wide-selected, configuration-failure,
  and retry screenshots found no clipped primary action, covered focus ring, or viewport overflow.

Explicit browser gaps retained as unchecked:

1. No comment-bearing cell fixture exists, so browser coverage proves validation + dirty marker
   coexistence but not the future comment marker in the same cell. Unit tests cover composite state.
2. No project switch was raced against an in-flight validation request. The run proves a newer-edit
   timeline and zero unexpected failures; project/mount/persisted-generation fencing remains covered
   by Vitest.
3. Configuration unavailability used a deliberately failed ChoiceSet-options request rather than a
   physically corrupted database JSON row. Backend tests cover corrupt active rule handling.

The full automated, PostgreSQL, migration, performance, design-audit, and remaining-risk record is
in [`phase-3-validation-verification.md`](phase-3-validation-verification.md).
