# App Shell·PageHeader Clarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move route-entry focus from the whole common PageHeader surface to its actual h1, while keeping App Shell, Focus Shell, query focus, browser-Back focus, and overlay focus contracts intact.

**Architecture:** `PageHeader` becomes the single owner of the common route-title marker and negative tab index. `RootLayout` keeps its pathname-only selector, so ordinary route transitions focus the internal h1 while query-only transitions remain focus-stable; the condition sheet retains its custom title target. Existing App/Focus shell geometry is locked with regression tests rather than redesigned.

**Tech Stack:** React 18, TypeScript 5.7, React Router 7, Tailwind CSS 4, Vitest 4 SSR tests, Vite production build, Playwright 1.57/Chromium.

## Global Constraints

- Follow [`docs/superpowers/specs/2026-07-16-app-shell-page-header-clarity-design.md`](../specs/2026-07-16-app-shell-page-header-clarity-design.md) and root [`DESIGN.md`](../../../DESIGN.md).
- Preserve the 52px normal App Shell and 40px condition-sheet Focus Header.
- Preserve pathname-only route focus, query input focus, project browser-Back row focus, Skip Links, drawer/dialog return focus, and sheet/grid focus.
- Do not change route content, Parameter section navigation, ChoiceSet breadcrumb ordering, API/query/state/backend contracts, or install dependencies.
- Use semantic Tailwind tokens only; the light-surface h1 ring remains 2px `brand-700` with a 2px offset.
- Keep production changes centered on `PageHeader` plus removal of duplicated caller props; do not introduce a title-props abstraction without a real caller.
- Implementation may use the requested faster executor model, but spec/code/architecture review and final merge judgment stay with the current leader model.
- Use Lore commit messages with contiguous Git trailers for every commit.
- Verify at 1024x768, 1440x900, and 1920x1080; unexpected console, page, static, and API failures must be zero.

## File Structure and Ownership

- Create `frontend/src/shared/layout/AppLayout.test.tsx`: locks the existing normal-shell height, navigation, responsive menu, Skip Link, and full-width main boundary.
- Modify `frontend/src/shared/components/PageHeader.tsx`: owns the common h1 route-focus target and flat header presentation.
- Modify `frontend/src/shared/components/primitives.test.tsx`: proves focus ownership belongs to h1 rather than the outer header.
- Modify the seven PageHeader route callers only to remove duplicated `data-page-title` and `tabIndex` props:
  - `frontend/src/features/projects/ProjectListPage.tsx`
  - `frontend/src/features/projects/ProjectCreatePage.tsx`
  - `frontend/src/features/projects/ProjectDetailPage.tsx`
  - `frontend/src/features/processes/ProcessExplorerPage.tsx`
  - `frontend/src/features/parameters/ParameterAdminPage.tsx`
  - `frontend/src/features/choiceSets/ChoiceSetListPage.tsx`
  - `frontend/src/features/choiceSets/ChoiceSetDetailPage.tsx`
- Preserve `frontend/src/shared/layout/RootLayout.tsx`, `frontend/src/shared/layout/FocusLayout.tsx`, and `frontend/src/features/sheets/SheetView.tsx` unless a verified regression requires a minimal correction.
- Create `docs/evidence/app-shell-page-header-clarity/README.md` and six list/detail screenshots for final production-build evidence.

---

### Task 1: Lock the Existing App/Focus Shell Boundary Before Cleanup

**Files:**
- Create: `frontend/src/shared/layout/AppLayout.test.tsx`
- Verify: `frontend/src/shared/layout/FocusLayout.test.tsx`
- Verify: `frontend/src/app/routes.test.tsx`
- Verify: `frontend/src/features/sheets/SheetView.test.tsx`

**Interfaces:**
- Consumes: `AppLayout(): JSX.Element`, `FocusLayout(): JSX.Element`, and the current route tree.
- Produces: regression evidence that Task 2 may simplify PageHeader focus without changing normal/focus shell ownership.

- [ ] **Step 1: Add the normal App Shell regression test**

Create `frontend/src/shared/layout/AppLayout.test.tsx` with this complete content:

```tsx
import { renderToStaticMarkup } from 'react-dom/server'
import { Route, Routes, StaticRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { AppLayout } from './AppLayout'

function renderLayout(): string {
  return renderToStaticMarkup(
    <StaticRouter location="/projects">
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="projects" element={<div>project child</div>} />
        </Route>
      </Routes>
    </StaticRouter>,
  )
}

describe('AppLayout', () => {
  it('keeps the approved 52px global shell, navigation, and full-width main boundary', () => {
    const html = renderLayout()
    const headerTag = html.match(/<header[^>]*>/)?.[0]
    const mainTag = html.match(/<main[^>]*id="main-content"[^>]*>/)?.[0]

    expect(headerTag).toBeDefined()
    expect(headerTag).toContain('h-[52px]')
    expect(html).toContain('href="#main-content"')
    expect(html).toContain('본문으로 건너뛰기')
    expect(html).toContain('aria-label="주요 메뉴"')
    expect(html).toContain('aria-label="좁은 화면 주요 메뉴"')
    expect(html).toContain('aria-label="PCM 프로젝트"')
    expect(html).toContain('aria-current="page"')
    expect(html).toContain('프로젝트')
    expect(html).toContain('공정 카탈로그')
    expect(html).toContain('파라미터 관리')
    expect(html).toContain('lg:hidden')
    expect(mainTag).toBeDefined()
    expect(mainTag).toContain('w-full')
    expect(mainTag).not.toContain('max-w-')
    expect(html).toContain('project child')
  })
})
```

- [ ] **Step 2: Run the new baseline lock**

Run:

```bash
cd frontend
npm test -- src/shared/layout/AppLayout.test.tsx
```

Expected: one test passes on the unchanged shell. This is a behavior lock, not a RED test, because Task 2 must not edit `AppLayout`.

- [ ] **Step 3: Run the adjacent shell/focus baseline**

Run:

```bash
cd frontend
npm test -- \
  src/shared/layout/AppLayout.test.tsx \
  src/shared/layout/FocusLayout.test.tsx \
  src/app/routes.test.tsx \
  src/features/sheets/SheetView.test.tsx
```

Expected: all selected tests pass; the normal and focus shells remain separate, the Focus Shell keeps its Skip Link, and the sheet fallback header remains 40px.

- [ ] **Step 4: Commit the baseline contract**

```bash
git add frontend/src/shared/layout/AppLayout.test.tsx
git diff --cached --check
git commit -F - <<'EOF'
Protect the approved shell boundary during header cleanup

The normal App Shell now has direct regression coverage for its 52px navigation, responsive menu, Skip Link, and full-width main so route-title focus can move without widening the visual refactor.

Constraint: App Shell and Focus Shell geometry are outside the PageHeader focus correction.
Confidence: high
Scope-risk: narrow
Reversibility: clean
Directive: Do not satisfy PageHeader tests by changing global shell width or navigation ownership.
Tested: AppLayout, FocusLayout, route-shell, and SheetView focused Vitest suites; git diff --cached --check.
EOF
```

---

### Task 2: Transfer Common Route Focus Ownership to the Actual h1

**Files:**
- Modify: `frontend/src/shared/components/PageHeader.tsx:5-27`
- Modify: `frontend/src/shared/components/primitives.test.tsx:95-117`
- Modify: the seven route callers listed in File Structure and Ownership
- Verify: existing feature route tests that render PageHeader

**Interfaces:**
- Consumes: `RootLayout` selector `[data-page-title]` and existing `PageHeaderProps` domain slots.
- Produces: `PageHeader` with exactly one internal `<h1 data-page-title tabIndex={-1}>`; outer header stays semantic and non-focusable.
- Preserves: custom `SheetView` h1 marker and every caller's `title`, `eyebrow`, `description`, `actions`, `className`, and ordinary header attributes.

- [ ] **Step 1: Replace the primitive assertion with the failing ownership contract**

Replace the current PageHeader case in `frontend/src/shared/components/primitives.test.tsx` with:

```tsx
  it('keeps route focus on the h1 instead of the entire PageHeader surface', () => {
    const html = renderToStaticMarkup(
      <PageHeader
        eyebrow={<Badge tone="draft">초안</Badge>}
        title="프로젝트"
        description="조건표 작업을 선택하세요."
        actions={<Button>프로젝트 생성</Button>}
      />,
    )
    const headerTag = html.match(/<header[^>]*>/)?.[0]
    const headingTag = html.match(/<h1[^>]*>/)?.[0]

    expect(headerTag).toBeDefined()
    expect(headerTag).toContain('gap-3')
    expect(headerTag).toContain('pb-4')
    expect(headerTag).not.toContain('data-page-title')
    expect(headerTag).not.toContain('tabindex')
    expect(headerTag).not.toContain('focus:outline')
    expect(headerTag).not.toContain('rounded-sm')

    expect(headingTag).toBeDefined()
    expect(headingTag).toContain('data-page-title="true"')
    expect(headingTag).toContain('tabindex="-1"')
    expect(headingTag).toContain('rounded-sm')
    expect(headingTag).toContain('focus:outline-2')
    expect(headingTag).toContain('focus:outline-offset-2')
    expect(headingTag).toContain('focus:outline-brand-700')

    expect(html).toContain('초안')
    expect(html).toContain('프로젝트')
    expect(html).toContain('조건표 작업을 선택하세요.')
    expect(html).toContain('프로젝트 생성')
  })
```

- [ ] **Step 2: Run the ownership test and verify RED**

Run:

```bash
cd frontend
npm test -- src/shared/components/primitives.test.tsx
```

Expected: FAIL because the current h1 lacks `data-page-title`/`tabindex`, the outer header still owns focus classes, and spacing is still `gap-4 pb-5`.

- [ ] **Step 3: Implement the minimal centralized PageHeader contract**

Replace `frontend/src/shared/components/PageHeader.tsx` with:

```tsx
import type { HTMLAttributes, ReactNode } from 'react'

import { cn } from '../lib/cn'

export interface PageHeaderProps extends Omit<HTMLAttributes<HTMLElement>, 'title' | 'tabIndex'> {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
  ...headerProps
}: PageHeaderProps) {
  return (
    <header
      {...headerProps}
      className={cn(
        'flex flex-col gap-3 border-b border-border-subtle pb-4 sm:flex-row sm:items-end sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? <div className="mb-1 text-xs font-semibold text-brand-700">{eyebrow}</div> : null}
        <h1
          className="rounded-sm text-2xl font-bold tracking-tight text-ink-950 focus:outline-2 focus:outline-offset-2 focus:outline-brand-700 sm:text-[1.75rem]"
          data-page-title
          tabIndex={-1}
        >
          {title}
        </h1>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}
```

- [ ] **Step 4: Remove duplicated marker props from all seven PageHeader callers**

In each listed caller, remove only these two props wherever they appear:

```tsx
-        data-page-title
-        tabIndex={-1}
```

The resulting call shape must retain its route-owned content, for example:

```tsx
      <PageHeader
        title="프로젝트"
        description="프로젝트를 검색하고 조건표 작업으로 이동합니다."
        actions={
          <Link className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-brand-700 px-4 text-sm font-semibold text-white transition-colors hover:bg-ink-950" to="/projects/new">
            <Plus aria-hidden="true" size={16} strokeWidth={2} />
            새 프로젝트
          </Link>
        }
      />
```

Do not alter the direct condition-sheet heading:

```tsx
        <h1
          ref={titleRef}
          className="min-w-0 truncate rounded-sm text-sm font-semibold focus:outline-2 focus:outline-offset-2 focus:outline-brand-500"
          data-page-title
          tabIndex={-1}
          title={title}
        >
```

- [ ] **Step 5: Run the focused GREEN test**

Run:

```bash
cd frontend
npm test -- src/shared/components/primitives.test.tsx
```

Expected: all primitive tests pass, including the new h1 ownership case.

- [ ] **Step 6: Prove caller centralization and condition-sheet preservation**

Run:

```bash
cd frontend
test "$(rg -l '<PageHeader' src/features --glob '*.tsx' | wc -l)" -eq 7
test "$(rg -n 'data-page-title' src/features --glob '*.tsx' | wc -l)" -eq 1
rg -n -C 3 'data-page-title' src/features/sheets/SheetView.tsx
npm run typecheck
```

Expected: seven PageHeader caller files; the only feature-owned marker is the custom SheetView h1; TypeScript passes and therefore no caller still supplies the omitted `tabIndex` prop.

- [ ] **Step 7: Run focused and adjacent regressions**

Run:

```bash
cd frontend
npm test -- \
  src/shared/components/primitives.test.tsx \
  src/shared/layout/AppLayout.test.tsx \
  src/shared/layout/FocusLayout.test.tsx \
  src/app/routes.test.tsx \
  src/features/projects/ProjectListPage.test.tsx \
  src/features/projects/ProjectDetailPage.test.tsx \
  src/features/processes/ProcessExplorerPage.test.tsx \
  src/features/parameters/ParameterAdminPage.test.tsx \
  src/features/choiceSets/ChoiceSetListPage.test.tsx \
  src/features/choiceSets/ChoiceSetDetailPage.test.tsx \
  src/features/sheets/SheetView.test.tsx
```

Expected: all selected suites pass; rendered feature routes still expose `data-page-title="true"` through the internal h1, while Focus Shell coverage remains green.

- [ ] **Step 8: Commit the independently reviewable focus transfer**

```bash
git add \
  frontend/src/shared/components/PageHeader.tsx \
  frontend/src/shared/components/primitives.test.tsx \
  frontend/src/features/projects/ProjectListPage.tsx \
  frontend/src/features/projects/ProjectCreatePage.tsx \
  frontend/src/features/projects/ProjectDetailPage.tsx \
  frontend/src/features/processes/ProcessExplorerPage.tsx \
  frontend/src/features/parameters/ParameterAdminPage.tsx \
  frontend/src/features/choiceSets/ChoiceSetListPage.tsx \
  frontend/src/features/choiceSets/ChoiceSetDetailPage.tsx
git diff --cached --check
git commit -F - <<'EOF'
Keep route-entry emphasis on the actual page title

PageHeader now owns the common route marker and negative tab index on its h1, removing the large focus surface and duplicated caller setup without changing RootLayout or the condition-sheet title contract.

Constraint: Query-only transitions and specialized Back/drawer/sheet focus must keep their existing owners.
Rejected: Suppress the route focus ring entirely | sighted keyboard users would lose the navigation destination.
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Common PageHeader callers provide domain content only; do not move the marker back to the outer header.
Tested: Primitive ownership, seven-caller, App/Focus shell, route, project, process, parameter, ChoiceSet, and SheetView focused Vitest suites; TypeScript typecheck; git diff --cached --check.
EOF
```

---

### Task 3: Prove Responsive Route Focus and Preserve Specialized Focus Flows

**Files:**
- Create: `docs/evidence/app-shell-page-header-clarity/README.md`
- Create: `docs/evidence/app-shell-page-header-clarity/project-list-1024x768.png`
- Create: `docs/evidence/app-shell-page-header-clarity/project-list-1440x900.png`
- Create: `docs/evidence/app-shell-page-header-clarity/project-list-1920x1080.png`
- Create: `docs/evidence/app-shell-page-header-clarity/project-detail-1024x768.png`
- Create: `docs/evidence/app-shell-page-header-clarity/project-detail-1440x900.png`
- Create: `docs/evidence/app-shell-page-header-clarity/project-detail-1920x1080.png`
- Temporary only: `/tmp/pcm-app-shell-page-header-qa.mjs`, `/tmp/pcm-app-shell-page-header-metrics.json`

**Interfaces:**
- Consumes: the production Vite build, existing deterministic project fixtures, `[data-page-title]`, `#main-content`, project query/history state, and `data-project-id` return focus.
- Produces: measured evidence that the active element and visible outline are the h1 at all approved widths without breaking query, Back, Skip Link, or runtime health.

- [ ] **Step 1: Build the exact production artifact**

Run:

```bash
cd frontend
npm run build
```

Expected: TypeScript and Vite succeed. Existing Glide PURE-annotation and >500kB chunk warnings may remain, but no new build error is allowed.

- [ ] **Step 2: Start the production preview**

Run in a background PTY and retain its session id:

```bash
cd frontend
npm run preview -- --host 127.0.0.1 --port 15178
```

Then verify:

```bash
curl --fail --silent http://127.0.0.1:15178/ >/dev/null
```

Expected: HTTP 200.

- [ ] **Step 3: Reuse the deterministic project fixture and add focus measurements**

Copy the last reviewed fixture runner, then change its output title/paths and add this function before the browser loop:

```bash
cp /tmp/pcm-project-browse-playwright/project_browse_clarity_qa.mjs \
  /tmp/pcm-app-shell-page-header-qa.mjs
```

The source runner recorded the previous checkout explicitly. Replace that hard-coded cwd with the
isolated worktree executing this command:

```js
const repoRoot = process.cwd()
```

```js
const buildCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: repoRoot,
  encoding: 'utf8',
}).trim()
```

```js
async function measureRouteTitleFocus(page, route, viewport) {
  return page.evaluate(({ route, viewport }) => {
    const title = document.querySelector('[data-page-title]')
    const header = title?.closest('header')
    if (!(title instanceof HTMLHeadingElement) || !(header instanceof HTMLElement)) {
      throw new Error('route title/header target missing')
    }
    const titleRect = title.getBoundingClientRect()
    const headerRect = header.getBoundingClientRect()
    const style = getComputedStyle(title)
    return {
      route,
      viewport,
      activeTag: document.activeElement?.tagName ?? null,
      titleFocused: document.activeElement === title,
      headerFocused: document.activeElement === header,
      titleMarkerCount: document.querySelectorAll('[data-page-title]').length,
      titleOutlineWidth: style.outlineWidth,
      titleOutlineStyle: style.outlineStyle,
      titleWidth: Math.round(titleRect.width * 10) / 10,
      headerWidth: Math.round(headerRect.width * 10) / 10,
    }
  }, { route, viewport: viewport.name })
}
```

Immediately after each list/detail `page.goto(..., { waitUntil: 'networkidle' })` and route heading wait, append:

```js
focusMeasurements.push(
  await measureRouteTitleFocus(page, '/projects', viewport),
)
```

and:

```js
focusMeasurements.push(
  await measureRouteTitleFocus(page, '/projects/42', viewport),
)
```

Declare `const focusMeasurements = []`, then add these assertions after the existing measurements:

```js
assert.equal(focusMeasurements.length, 6)
for (const focus of focusMeasurements) {
  assert.equal(focus.activeTag, 'H1', `${focus.route} ${focus.viewport}: active tag`)
  assert.equal(focus.titleFocused, true, `${focus.route} ${focus.viewport}: title focus`)
  assert.equal(focus.headerFocused, false, `${focus.route} ${focus.viewport}: outer header focus`)
  assert.equal(focus.titleMarkerCount, 1, `${focus.route} ${focus.viewport}: marker count`)
  assert.equal(focus.titleOutlineWidth, '2px', `${focus.route} ${focus.viewport}: outline width`)
  assert.notEqual(focus.titleOutlineStyle, 'none', `${focus.route} ${focus.viewport}: outline style`)
  assert(focus.titleWidth < focus.headerWidth, `${focus.route} ${focus.viewport}: outline still spans header`)
}
```

Include `focusMeasurements` in the metrics JSON. Change screenshot names to the six declared evidence paths and set the README title to `# App Shell and PageHeader Clarity Browser Evidence`.

- [ ] **Step 4: Add explicit query and Skip Link focus assertions**

After the 1440px list focus measurement, run:

```js
const searchInput = page.getByRole('searchbox', { name: '프로젝트 검색' })
await searchInput.focus()
await searchInput.fill('Photo')
await page.waitForTimeout(300)
assert.equal(await searchInput.evaluate((node) => document.activeElement === node), true)

const skipLink = page.getByRole('link', { name: '본문으로 건너뛰기' })
await skipLink.focus()
await skipLink.press('Enter')
await page.waitForFunction(() => document.activeElement?.id === 'main-content')
```

Keep the existing filtered detail → browser Back assertions exactly: URL query, search draft, both managed-choice values, and `data-project-id="42"` focus must all restore.

- [ ] **Step 5: Run the browser suite and generate evidence**

Run:

```bash
node /tmp/pcm-app-shell-page-header-qa.mjs \
  http://127.0.0.1:15178 \
  docs/evidence/app-shell-page-header-clarity \
  /tmp/pcm-app-shell-page-header-metrics.json
```

Expected:

- 6/6 route-width captures have exactly one focused h1 marker and a 2px title-only outline.
- The outer header is never the active element.
- Body/list-table overflow remains zero and approved browse frame/fold metrics do not regress.
- Query typing keeps search focus.
- Skip Link focuses `#main-content`.
- Filtered browser Back restores URL, search draft, choices, and project-link focus.
- Unexpected console/page/static/API failures: 0.

- [ ] **Step 6: Review all six screenshots at original resolution**

Use `view_image` with `detail="original"` for every PNG. Confirm:

- the route focus ring hugs only the visible title text box;
- no large card-like outline surrounds description/actions;
- global navigation remains visually separate from PageHeader;
- action wrapping and title/description alignment remain legible at 1024px;
- 1440px project detail still shows the Layer heading/header/first row;
- 1920px route frames and blank canvas match their approved local contracts.

Record these observations plus exact metrics, build commit, Playwright/Chromium versions, and the zero-error counts in the evidence README. Do not claim a condition-sheet browser run unless it was actually executed; cite focused SheetView tests for the unchanged custom title contract.

- [ ] **Step 7: Stop preview and commit evidence**

Stop the retained preview PTY, then run:

```bash
git add docs/evidence/app-shell-page-header-clarity
git diff --cached --check
git commit -F - <<'EOF'
Prove route focus stays visible without becoming a header surface

Production-build browser evidence now measures the h1 focus target and outline across approved widths while rechecking query, Skip Link, browser-Back, overflow, and runtime-health contracts.

Constraint: Visual simplification cannot remove the visible navigation destination or specialized focus restoration.
Confidence: high
Scope-risk: narrow
Reversibility: clean
Directive: Re-capture all six views when common PageHeader spacing or focus ownership changes.
Tested: Playwright at 1024x768, 1440x900, and 1920x1080; original-resolution review; zero unexpected console, page, static, and API failures.
Not-tested: Live production font-rendering variance.
EOF
```

---

### Task 4: Current-Model Review, Full Verification, and Delivery

**Files:**
- Review: every file in `main..HEAD`
- Modify only if review finds a reproducible defect
- Deliver: GitHub pull request targeting `main`

**Interfaces:**
- Consumes: Tasks 1-3 commits, design spec, implementation plan, and browser metrics.
- Produces: merge-ready current-model code/architecture verdict, fresh full-suite evidence, CI-green PR, and merged `main`.

- [ ] **Step 1: Run fresh full verification**

Run:

```bash
cd frontend
npm test
npm run lint
npm run typecheck
npm run build
cd ..
git diff --check main..HEAD
git status --short --branch
```

Expected: all frontend tests pass; lint/typecheck/build exit 0; only documented pre-existing build warnings remain; branch worktree is clean.

- [ ] **Step 2: Audit every Lore trailer**

Run:

```bash
for commit in $(git rev-list --reverse main..HEAD); do
  printf '\n%s %s\n' "$commit" "$(git show -s --format=%s "$commit")"
  git show -s --format=%B "$commit" | git interpret-trailers --parse
done
```

Expected: every commit has contiguous parseable decision/test trailers and an intent-first subject.

- [ ] **Step 3: Run two independent current-model review lanes**

Review `main..HEAD` with inherited/current-model `code-reviewer` and `architect` roles. The code lane checks accessibility, focus ordering, React semantics, regression risk, security, performance, and test fidelity. The architecture lane checks App/Focus shell boundaries, query/pathname ownership, Back-focus precedence, and whether the shared component remains narrow.

Expected merge gate:

- code-reviewer: `APPROVE`
- architect: `CLEAR`
- CRITICAL/HIGH/MEDIUM unresolved findings: 0

Fix any reproducible blocker test-first, rerun all affected tests plus the full verification command, and commit with a new Lore record. A PageHeader-wide outline, lost query focus, duplicate marker, or changed sheet focus owner blocks delivery.

- [ ] **Step 4: Push and create a ready PR**

Run:

```bash
git fetch origin --prune
git push -u origin agent/ui-clarity-app-shell-header
cat > /tmp/app-shell-page-header-pr.md <<'EOF'
## Summary

- move the common route-focus marker and negative tab index from the whole PageHeader surface to its actual h1
- remove duplicated focus setup from all seven common PageHeader route callers
- lock the existing 52px App Shell, 40px Focus Shell, navigation, Skip Link, query-focus, Back-focus, and condition-sheet title boundaries
- add responsive production-build evidence for title-only focus at 1024x768, 1440x900, and 1920x1080

## Why

Route transitions correctly announced the current screen, but focusing the entire PageHeader drew a large card-like outline around the title, description, and actions. The shared component now owns a precise title target without changing route, state, or shell ownership.

## Validation

- full frontend Vitest suite
- lint and TypeScript typecheck
- production Vite build
- `git diff --check`
- current-model code review: APPROVE
- current-model architecture review: CLEAR

## Browser evidence

- exactly one focused `h1[data-page-title]` on list/detail routes at all three approved widths
- 2px title-only focus outline; outer PageHeader never focused
- query input focus, Skip Link main focus, and filtered browser-Back row focus preserved
- body/table overflow and approved browse fold/frame metrics preserved
- unexpected console, page, static, and API failures: 0

Evidence: `docs/evidence/app-shell-page-header-clarity/`

## Preserved boundary

The condition sheet keeps its custom 40px dark Focus Header, title marker, lock/save state, and grid focus ownership unchanged.
EOF
gh pr create \
  --base main \
  --head agent/ui-clarity-app-shell-header \
  --title "Keep route focus on the actual page title" \
  --body-file /tmp/app-shell-page-header-pr.md
```

The PR body must summarize the h1 ownership transfer, locked shell boundaries, seven cleaned callers, full verification count, browser focus/overflow metrics, independent review verdicts, evidence directory, and the unchanged condition-sheet focus contract.

- [ ] **Step 5: Watch CI and merge only after both jobs pass**

Run:

```bash
gh pr checks --watch --interval 10
```

Expected: `Backend lint, typecheck, test` and `Frontend typecheck, build, test` both pass.

Merge with a Lore-formatted merge message using `gh pr merge --merge --delete-branch --subject ... --body ...`, then verify:

```bash
git switch main
git pull --ff-only origin main
gh pr view --json state,mergedAt,mergeCommit,url
git show -s --format=%B HEAD | git interpret-trailers --parse
git status --short --branch
```

Expected: PR state `MERGED`, local `main` equals `origin/main`, merge trailers parse, and the worktree is clean.

---

## Plan Self-Review Checklist

- [x] Spec coverage: h1 ownership, outer-header flattening, 12px/16px spacing, caller centralization, App/Focus shell preservation, query/Back/Skip/overlay/sheet focus, responsive evidence, and delivery all map to explicit tasks.
- [x] Incomplete-marker scan: every implementation, error, test, and delivery step contains an exact action and expected result.
- [x] Type consistency: `PageHeaderProps` omits `tabIndex`; all seven callers remove it; `data-page-title` stays on the shared h1 and custom SheetView h1 only.
- [x] Scope check: no AppLayout/FocusLayout/SheetView production edit is planned without a reproduced regression.
- [x] Test fidelity: baseline shell locks precede cleanup; ownership test fails before production edits; browser assertions measure the actual active element and computed outline.
