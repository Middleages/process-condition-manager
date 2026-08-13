# Signal Grid project list verification evidence

Status: `DONE`

This record verifies the Signal Grid foundation and `/projects` slice at source commit
`f938e33c00b0ca65170b298640abac5bcd402d6b` using the production frontend build. The browser
fixture is local and deterministic; it does not assert a live backend, production identity provider,
or production data set.

## Frontend checks

All commands ran from `frontend/` on 2026-08-13 (Asia/Seoul).

| Command | Result |
| --- | --- |
| `npm test -- --run src/shared/components/primitives.test.tsx src/shared/layout/AppLayout.test.tsx src/features/projects/ProjectTable.test.tsx src/features/projects/ProjectListPage.test.tsx` | Exit 0; 4 files, 22 tests passed |
| `npm test -- --run` | Exit 0; 97 files, 1,021 tests passed |
| `npm run typecheck` | Exit 0 |
| `npm run lint` | Exit 0; the repository lint script delegates to typecheck |
| `npm run build` | Exit 0; 2,216 modules transformed |

No React warnings appeared in either test run. The build retained the known third-party
`@glideapps/glide-data-grid` PURE-annotation warnings and the existing 500 kB chunk-size warning;
the built main chunk was 1,082.98 kB (332.05 kB gzip).

## Mechanical detector

The required detector was run exactly once:

```bash
node /home/appuser/.codex/skills/impeccable/scripts/detect.mjs --json \
  frontend/src/styles.css \
  frontend/src/shared/components/Button.tsx \
  frontend/src/shared/layout/AppLayout.tsx \
  frontend/src/features/projects/ProjectListPage.tsx \
  frontend/src/features/projects/ProjectTable.tsx
```

Result: exit 0 with `[]`; no detector-driven source edits were needed.

## Browser/runtime inventory

- No `chromium`, `chromium-browser`, `google-chrome`, `firefox`, `agent-browser`, or equivalent
  browser executable was on `PATH`.
- `npx --no-install playwright --version` reported Playwright 1.62.1.
- `npx --no-install playwright install --list` found existing, locally cached Playwright 1.54.1
  and 1.55.0 Chromium installations. No browser or package was downloaded.
- Evidence used the cached Playwright 1.55.0 module and its matching executable at
  `/home/appuser/.cache/ms-playwright/chromium-1187/chrome-linux/chrome`.
- `frontend/package.json` provides `build` and `preview` scripts; no slice-specific browser fixture
  was present.

### Reproduction boundary

The Playwright fixture program used for this capture was a temporary, uncommitted script. It was
not retained in the worktree or evidence commit, and its exact `node` invocation is therefore not
recoverable from the committed branch. Consequently, the screenshots and browser-interaction
assertions below cannot be reproduced exactly from this repository alone. There is no honest
committed Playwright command or script to provide; recreating one would be a new fixture rather than
reproduction of the recorded run.

The exact retained runtime inventory commands were:

```bash
npx --no-install playwright --version
npx --no-install playwright install --list
```

## Production-equivalent local fixture

The source-under-test is retained at `f938e33c00b0ca65170b298640abac5bcd402d6b`. Its frontend
build and the exact preview command used by the temporary fixture were:

```bash
cd frontend
npm run build
npm run preview -- --host 127.0.0.1 --port 4175 --strictPort
```

Headless Chromium opened `http://127.0.0.1:4175/projects`. Playwright intercepted only same-origin
`/api/auth/me`, `/api/projects`, and `/api/projects/:id` requests. The auth fixture represented one
engineer with project edit/review/revision permissions. The project-list fixture contained four
projects spanning draft, review, approved, and rejected states. API interception was in-memory:
no real credentials, backend service, database, or external network was used or modified.

The error scenario intentionally returned two HTTP 503 responses (the initial request and the
configured automatic retry) before the user-triggered retry succeeded. Chromium logged the two
expected failed-resource messages. There were zero unexpected console warnings, console errors,
or page errors; the normal captures at all three viewports emitted no console messages.

## Viewport evidence

| Viewport | Document `clientWidth / scrollWidth` | Table container `clientWidth / scrollWidth` | Focus evidence | Artifact |
| --- | --- | --- | --- | --- |
| 1024x768 | `1024 / 1024` | `898 / 898` | `새 프로젝트` link, `:focus-visible`, solid 2 px outline | [`signal-grid-project-list-1024.png`](../../../../.impeccable/review/signal-grid-project-list-1024.png) |
| 1440x900 | `1440 / 1440` | `1298 / 1298` | `새 프로젝트` link, `:focus-visible`, solid 2 px outline | [`signal-grid-project-list-1440.png`](../../../../.impeccable/review/signal-grid-project-list-1440.png) |
| 1920x1080 | `1920 / 1920` | `1778 / 1778` | `새 프로젝트` link, `:focus-visible`, solid 2 px outline | [`signal-grid-project-list-1920.png`](../../../../.impeccable/review/signal-grid-project-list-1920.png) |

The width deltas were 0 px for both the document and table container at every viewport. Visual
inspection confirmed that the rail, command header, search, five status controls, loaded count,
five-column table, and disclosure controls remain visible and unclipped.

Artifact integrity:

| Artifact | Dimensions | SHA-256 |
| --- | --- | --- |
| `signal-grid-project-list-1024.png` | 1024x768 | `d69dc72d88ab271fde8a3ace709359ebe01306d262db58827991f22728d6cf1e` |
| `signal-grid-project-list-1440.png` | 1440x900 | `edce35e480cedc8b4bee56ba9e0b7191dfc36f085ba63311ea1e94972b15442b` |
| `signal-grid-project-list-1920.png` | 1920x1080 | `d0282174ee8f1ac03ef5d23b87397a675d80746fde02ed6569fc3a58d2c7024a` |

## Browser interaction assertions

- Status-only filtering: selecting `검토중` navigated to `?status=review`; the resulting API request
  contained `status=review&limit=50` and no device-type or project-category parameters.
- Row expansion: the first disclosure changed `aria-expanded` to `true` and revealed
  `#project-details-42`.
- Search debounce: no list request occurred after 100 ms; the `query=etch` request arrived after
  344 ms and returned one result.
- Empty state: `query=empty` rendered `조건에 맞는 프로젝트가 없습니다.`.
- Error/retry: after the two intentional 503 responses, `다시 시도` succeeded while the search
  value remained `retry`.
- Back focus restoration: opening project 42 from `?query=coat`, then navigating Back, focused the
  anchor with `data-project-id="42"`.

## Performance and diff hygiene

- No global event listener was added in the slice targets.
- The three list-page effects remain bounded to URL/draft synchronization, the 250 ms debounce,
  and one-shot Back focus restoration; each has cleanup where it owns a timer or animation frame.
- The only page-wide derived project array is a linear flatten of fetched pagination pages. Static
  navigation and status definitions are module-scoped. No unjustified memoization or repeated
  expensive derivation was found.
- `useSearchParams` plus `parseProjectListSearch`/`serializeProjectListSearch` remains the single
  URL-state boundary; hidden legacy parameters are not duplicated into a second visible state.
- `git diff --check` exited 0. Before evidence authoring, the worktree contained no unrelated tracked
  changes; the evidence commit is limited to this README and the three PNG files.

## Known assumptions and limits

This is frontend-slice evidence, not end-to-end production-backend certification. Live auth headers,
backend filtering, database pagination, and deployment proxy behavior remain outside this fixture.
The production bundle and browser runtime were fully local, preserving the closed-network assumption.
