# Project Creation Clarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the existing three-step project creation behavior while making each decision, the matching review, and the final create action visually obvious.

**Architecture:** Keep `ProjectCreateWizard` as the state/query owner and change only its presentational composition. Use existing semantic tokens and shared components, add accessible region headings instead of test-only hooks, and keep all route/API/persistence contracts untouched. The final step becomes a responsive CSS grid whose matching summary, required-information aside, and scroll-bounded Layer detail retain a sensible DOM order.

**Tech Stack:** React 18, React Router 7, TanStack Query 5, Tailwind CSS 4, Vitest 4, Vite 6

## Global Constraints

- Follow `DESIGN.md` and `docs/superpowers/specs/2026-07-16-project-creation-clarity-design.md`.
- Do not change backend code, request payloads, matching logic, route serialization, dirty-state behavior, or query keys.
- Do not add dependencies, external fonts, raw colors, or a new shared design-system layer.
- Preserve WCAG 2.2 AA semantics, focus movement, `aria-current="step"`, `aria-pressed`, and 36px minimum primary controls.
- Keep 1024×768 free of body horizontal overflow; use internal overflow for the Layer table only.
- Use test-first red/green cycles before each production edit.
- Every implementation commit must follow the repository Lore trailer protocol.

---

## File map

- `frontend/src/features/projects/ProjectCreatePage.tsx`
  - Owns the route-level centered work frame, page title, description, and project-list return action.
- `frontend/src/features/projects/ProjectCreateWizard.tsx`
  - Continues to own all Wizard state and data flow; changes only semantic structure and classes for progress, choices, review regions, and action placement.
- `frontend/src/features/projects/ProjectCreateWizard.test.tsx`
  - Locks route restoration plus the new semantic hierarchy and responsive composition.
- `docs/evidence/project-creation-clarity/`
  - Stores final 1024/1440/1920 screenshots and a concise browser observation record produced during final verification.

No new production component file is planned. The Wizard is large, but splitting stateful step props during a visual-only change would widen review scope and make behavior preservation harder.

---

### Task 1: Lock the approved page and progress hierarchy

**Files:**
- Modify: `frontend/src/features/projects/ProjectCreateWizard.test.tsx`
- Modify: `frontend/src/features/projects/ProjectCreatePage.tsx`
- Modify: `frontend/src/features/projects/ProjectCreateWizard.tsx:523-698,1345-1363`

**Interfaces:**
- Consumes: existing `ProjectCreateWizard({ onCreated })`, `WizardStepper`, and `StepHeading` behavior.
- Produces: route frame `max-w-[1440px]`, project-list return link, compact progress navigation, and non-repeated step headings.

- [ ] **Step 1: Write failing semantic/layout tests**

Add assertions to the existing route-restoration render:

```tsx
it('uses one restrained work frame and a compact step progress contract', () => {
  const params = new URLSearchParams({ step: '3', process: directProcess.key })
  const html = renderWizard(`/projects/new?${params}`, true)

  expect(html).toContain('aria-label="프로젝트 생성 진행"')
  expect(html).toContain('aria-current="step"')
  expect(html).toContain('현재 3/3')
  expect(html).not.toContain('>3단계<')
  expect(html).not.toContain('shadow-sm')
})
```

Refactor the existing test render helper to accept a route element, import `ProjectCreatePage`, and render it with the same seeded `QueryClient`. Add a second assertion that the full page contains `새 프로젝트 만들기`, a `/projects` return link, and `max-w-[1440px]`.

- [ ] **Step 2: Run the focused test and observe the expected failure**

Run:

```bash
cd frontend
npm test -- src/features/projects/ProjectCreateWizard.test.tsx
```

Expected: FAIL because `프로젝트 생성 진행`, `현재 3/3`, the new page title/frame, and shadow removal do not exist yet.

- [ ] **Step 3: Implement the minimal route frame and compact progress**

In `ProjectCreatePage.tsx`, wrap the page in the approved width and add a visible return action:

```tsx
<section className="mx-auto w-full max-w-[1440px] space-y-5">
  <PageHeader
    actions={
      <Link className="btn-secondary" to="/projects">
        <ArrowLeft aria-hidden="true" size={16} />
        프로젝트 목록
      </Link>
    }
    eyebrow="프로젝트"
    title="새 프로젝트 만들기"
    description="Process와 백본을 차례로 확인하고 새 조건표를 만듭니다."
  />
</section>
```

In `ProjectCreateWizard.tsx`:

- change the progress accessible name to `프로젝트 생성 진행`;
- reduce its height, borders, and background hierarchy;
- show `현재 N/3`, `완료`, or `대기` without rendering large nested cards;
- remove the outer `shadow-sm`;
- replace visible `N단계` in `StepHeading` with `현재 N/3` and keep the `h2` focus contract.

- [ ] **Step 4: Run focused tests and typecheck**

```bash
cd frontend
npm test -- src/features/projects/ProjectCreateWizard.test.tsx src/shared/components/primitives.test.tsx
npm run typecheck
```

Expected: both test files pass and TypeScript reports no errors.

- [ ] **Step 5: Commit Task 1**

Stage only the three Task 1 files and commit with a Lore message whose intent is to remove repeated navigation hierarchy without changing Wizard state.

---

### Task 2: Replace Process and backbone card walls with decision lists

**Files:**
- Modify: `frontend/src/features/projects/ProjectCreateWizard.test.tsx`
- Modify: `frontend/src/features/projects/ProjectCreateWizard.tsx:700-997,1375-1416`

**Interfaces:**
- Consumes: `onChooseProcess`, `onChooseBackbone`, `selectedProcessKey`, `selectedBackboneId`, `aria-pressed`, and existing status data.
- Produces: single-scan Process list, compact backbone comparison list, and sticky selected-Process context without changing callbacks.

- [ ] **Step 1: Add failing tests for list semantics and selection context**

Render step 1 and step 2 fixtures and assert the resulting HTML has named regions/lists:

```tsx
expect(stepOneHtml).toContain('aria-label="Process 선택 목록"')
expect(stepOneHtml).toContain('aria-label="선택한 Process 요약"')
expect(stepTwoHtml).toContain('aria-label="백본 선택 목록"')
expect(stepTwoHtml).toContain('백본 없이 시작')
expect(stepTwoHtml).toContain('aria-pressed="true"')
```

Also assert the Process results no longer use the two-column card grid and the selected summary contains the desktop sticky class.

- [ ] **Step 2: Run focused tests and verify red**

```bash
cd frontend
npm test -- src/features/projects/ProjectCreateWizard.test.tsx
```

Expected: FAIL on the missing region names and old card-grid/sticky composition.

- [ ] **Step 3: Implement compact decision lists**

Process step:

- keep the search as the primary first control;
- use one bordered `ul` with `divide-y` and full-width borderless row buttons;
- retain display name, stable key, project-exists badge, selection check, and `aria-pressed`;
- label the list `Process 선택 목록`;
- label the summary `선택한 Process 요약` and apply `xl:sticky xl:top-5`;
- keep the success/duplicate messages and existing-project link unchanged.

Backbone step:

- label the option container `백본 선택 목록`;
- render a compact two-column-at-wide-screen comparison surface using one outer border and gap/divider styling;
- keep `백본 없이 시작` first and all candidate metrics visible;
- retain `aria-pressed`, callback wiring, loading/error recovery, and navigation actions.

- [ ] **Step 4: Run focused and adjacent behavior tests**

```bash
cd frontend
npm test -- \
  src/features/projects/ProjectCreateWizard.test.tsx \
  src/features/projects/wizardState.test.ts \
  src/features/projects/urlState.test.ts
```

Expected: all tests pass; no route/state assertions change.

- [ ] **Step 5: Commit Task 2**

Commit only the Wizard and its test with Lore trailers. Record that grid cards were rejected because they obscure comparison order.

---

### Task 3: Separate matching review from required project information

**Files:**
- Modify: `frontend/src/features/projects/ProjectCreateWizard.test.tsx`
- Modify: `frontend/src/features/projects/ProjectCreateWizard.tsx:999-1373,1417-1479`

**Interfaces:**
- Consumes: current preview result, manual override callbacks, Profile field resources, disabled reason, submit callback, and retry behavior.
- Produces: regions named `매칭 요약`, `프로젝트 필수 정보`, and `Layer 매칭 상세`, with a sticky 360–420px action panel at `xl`.

- [ ] **Step 1: Add failing review-layout tests**

Extend the seeded step-3 render assertions:

```tsx
it('separates matching review, required information, and bounded Layer detail', () => {
  const html = renderAutomaticBackbonePreview()

  expect(html).toContain('aria-labelledby="project-match-summary-title"')
  expect(html).toContain('aria-labelledby="project-required-info-title"')
  expect(html).toContain('aria-labelledby="project-layer-matches-title"')
  expect(html).toContain('xl:grid-cols-[minmax(0,1fr)_minmax(22.5rem,26.25rem)]')
  expect(html).toContain('xl:sticky')
  expect(html).toContain('max-h-[26rem]')
  expect(html).toMatch(
    /project-required-info-title[\s\S]*project-part-id[\s\S]*project-category[\s\S]*project-create-action/,
  )
})
```

Add `id="project-create-action"` to the existing create button. This is an interaction anchor as well as a stable browser-QA target.

- [ ] **Step 2: Run the test and verify it fails for the missing regions**

```bash
cd frontend
npm test -- src/features/projects/ProjectCreateWizard.test.tsx
```

Expected: FAIL because the current markup is one vertical form and the table is not scroll-bounded.

- [ ] **Step 3: Implement the responsive three-region grid**

Inside `PreviewStep`, keep the existing `<form>` and data operations but reorganize its children:

```tsx
<div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(22.5rem,26.25rem)] xl:items-start">
  <section
    aria-labelledby="project-match-summary-title"
    className="order-1 min-w-0 xl:col-start-1 xl:row-start-1"
  >
    {/* Process/backbone identity and one compact metric strip */}
  </section>

  <aside
    aria-labelledby="project-required-info-title"
    className="order-2 rounded-lg border border-border-subtle bg-canvas p-4 xl:sticky xl:top-5 xl:col-start-2 xl:row-span-2 xl:row-start-1"
  >
    {/* single-column fields, local alerts, disabled reason, create action */}
  </aside>

  <section
    aria-labelledby="project-layer-matches-title"
    className="order-3 min-w-0 xl:col-start-1 xl:row-start-2"
  >
    <div className="max-h-[26rem] overflow-auto rounded-lg border border-border-subtle">
      {/* existing matching table and override selects */}
    </div>
  </section>
</div>
```

Implementation requirements:

- replace four `DetailStat` cards with a single compact definition-list strip;
- keep the matching table rows, override defaults, retry alerts, and error mapping byte-for-byte where possible;
- make all Profile fields one column in the sticky aside;
- keep field-specific choice alerts directly below their controls;
- place disabled reason and create error immediately before the button;
- place the back action outside or below the grid without moving create ownership out of the required-information aside;
- preserve DOM order: summary → required info → Layer detail at narrow widths.

- [ ] **Step 4: Run focused, adjacent, and full frontend verification**

```bash
cd frontend
npm test -- \
  src/features/projects/ProjectCreateWizard.test.tsx \
  src/features/projects/wizardState.test.ts \
  src/features/projects/urlState.test.ts \
  src/features/choiceSets/useChoiceSetOptions.test.ts
npm test
npm run lint
npm run typecheck
npm run build
```

Expected: all Vitest files pass; lint/typecheck/build exit 0. Only the repository's pre-existing Glide/Rollup and large-chunk build warnings may remain.

- [ ] **Step 5: Commit Task 3**

Commit production and test changes with Lore trailers. Record the preserved API/state boundary and the deliberate internal table scroll.

---

### Task 4: Browser evidence and current-model review

**Files:**
- Create: `docs/evidence/project-creation-clarity/README.md`
- Create: `docs/evidence/project-creation-clarity/project-create-1024x768.png`
- Create: `docs/evidence/project-creation-clarity/project-create-1440x900.png`
- Create: `docs/evidence/project-creation-clarity/project-create-1920x1080.png`
- Modify only if review finds a real defect: Task 1–3 production/test files

**Interfaces:**
- Consumes: built frontend, deterministic mocked project-creation API responses, and the three semantic region IDs.
- Produces: visual evidence and an explicit pass/fail record for responsive layout, focus, overflow, and action visibility.

- [ ] **Step 1: Run a deterministic local browser fixture**

Build the frontend, serve it on a loopback-only port, and intercept only `/api/**` with fixed Process, backbone, preview, and ChoiceSet resources. The fixture must open step 3 with at least six Layer rows and active required choices.

- [ ] **Step 2: Capture and inspect three viewports**

For 1024×768, 1440×900, and 1920×1080, record:

- body/document horizontal overflow;
- computed review grid column count;
- required-info panel width;
- create-action bounding box and whether it is inside the initial viewport at 1440×900;
- Layer detail scroll height versus scroll height;
- unexpected console errors/warnings and failed requests.

Save the exact accepted screenshots and write the values to `docs/evidence/project-creation-clarity/README.md`.

- [ ] **Step 3: Current-model visual and code review**

Inspect all screenshots at original detail and review the complete branch diff against the approved spec. Reject and fix:

- clipped or off-screen primary action;
- body overflow;
- repeated card walls or headings;
- unreadably wide inputs;
- incorrect DOM/focus order;
- hidden error/disabled reason;
- any change to route/API/persistence behavior.

- [ ] **Step 4: Re-run final verification after any review fix**

```bash
cd frontend
npm test
npm run lint
npm run typecheck
npm run build
cd ..
git diff --check
git status --short
```

Expected: all commands pass and only intentional evidence/implementation files are changed.

- [ ] **Step 5: Commit evidence and final review fixes**

Use a Lore commit whose intent is to make the visual improvement independently reviewable. Include exact test counts and browser viewport evidence in `Tested:` and any known visual limits in `Not-tested:`.

---

## Plan self-review

- **Spec coverage:** Tasks 1–3 cover the frame/progress, Process/backbone decisions, and final review/action hierarchy. Task 4 covers all responsive, visual, focus, and overflow acceptance criteria.
- **Scope control:** No backend, state-machine, API, shared-component, or dependency work is included.
- **Type consistency:** Existing callback and resource types remain unchanged; all new contracts are semantic IDs/names and CSS layout only.
- **Placeholder scan:** The plan contains no deferred implementation placeholders; browser fixture resources and recorded measurements are explicitly named.
