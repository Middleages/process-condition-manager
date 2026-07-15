# Project Browse Clarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the project list faster to scan and the project detail surface the Layer workflow before nullable advanced Profile fields, without changing any data or navigation behavior.

**Architecture:** Keep the existing route components as query and interaction owners, and change only their semantic composition and Tailwind classes. Add one opt-in presentation prop to `SearchableChoice`, derive the backbone summary from the already-loaded layers, and use native `details` for the default-collapsed advanced Profile so no new UI state is owned. Implement the independent list and detail slices in separate test-first commits, then validate them together with deterministic browser fixtures.

**Tech Stack:** React 18, React Router 7, TanStack Query 5, Tailwind CSS 4, lucide-react, Vitest 4, Vite 6, Playwright 1.57 in a temporary QA directory

## Global Constraints

- Follow `DESIGN.md` and `docs/superpowers/specs/2026-07-16-project-browse-clarity-design.md`.
- Do not change backend code, API requests, query keys, cursor behavior, URL serialization, route state, drawers, modals, locks, or save payloads.
- Do not add dependencies, external fonts, raw colors, decorative KPI cards, or a new shared layout abstraction.
- Preserve all eight project-list columns and their order; keep Layer Total at `2xl` and Updated at `xl`.
- Preserve all six `data-profile-group` values and every fixed Profile field, including inactive/raw managed-choice values.
- Keep `SearchableChoice` live-region semantics, retry/error/loading behavior, historical filter codes, clear actions, focus return, and keyboard behavior.
- At 1024×768, neither route may create body horizontal overflow and the project-list table wrapper must not scroll horizontally.
- At 1440×900, the detail Layer heading, table header, and first row must be inside the initial viewport for the approved normal fixture.
- At 1920×1080, both route work frames must be no wider than 1600px.
- Use test-first RED/GREEN cycles before production edits, and keep the list and detail implementations in separate Lore-protocol commits.

---

## File map

- `frontend/src/shared/components/SearchableChoice.tsx`
  - Adds the opt-in `visuallyHideEmptyStatus` presentation contract while keeping the live region mounted and unchanged for every non-empty state.
- `frontend/src/shared/components/SearchableChoice.test.tsx`
  - Locks the screen-reader-visible empty status and the visually restored selected status.
- `frontend/src/features/projects/ProjectListPage.tsx`
  - Owns the centered 1600px work frame and the semantic three-control `프로젝트 찾기` region.
- `frontend/src/features/projects/ProjectListPage.test.tsx`
  - Locks the work frame, filter heading/count placement, and project-filter use of the opt-in empty-status treatment while retaining URL/historical-choice coverage.
- `frontend/src/features/projects/ProjectTable.tsx`
  - Keeps the existing table contract and reduces only its minimum width from 1040px to 920px.
- `frontend/src/features/projects/ProjectTable.test.tsx`
  - Locks the approved 920px width in addition to the existing column, breakpoint, truncation, and inactive-value contracts.
- `frontend/src/features/projects/ProjectDetailPage.tsx`
  - Owns the centered 1600px frame, four-item summary, one core Profile surface, native advanced-Profile disclosure, and unchanged Layer workflow.
- `frontend/src/features/projects/ProjectDetailPage.test.tsx`
  - Locks summary derivation, semantic order, default-collapsed disclosure, all Profile fields, and existing Layer behavior.
- `docs/evidence/project-browse-clarity/`
  - Stores six deterministic viewport screenshots and the measured browser acceptance record.

No production file is split in this slice. The route components already own the relevant query and modal/drawer state, and extracting presentation-only wrappers would widen the API surface without reducing behavioral risk.

---

### Task 1: Compact the project finder and preserve managed-choice semantics

**Files:**
- Modify: `frontend/src/shared/components/SearchableChoice.test.tsx`
- Modify: `frontend/src/shared/components/SearchableChoice.tsx:29-50,90-111,376-407`
- Modify: `frontend/src/features/projects/ProjectListPage.test.tsx`
- Modify: `frontend/src/features/projects/ProjectListPage.tsx:129-224,228-263`
- Modify: `frontend/src/features/projects/ProjectTable.test.tsx`
- Modify: `frontend/src/features/projects/ProjectTable.tsx:12-16`

**Interfaces:**
- Consumes: existing `SearchableChoiceProps`, `ProjectChoiceFilter`, route/filter state, `ProjectTable`, and accumulated `projects.length`.
- Produces: optional `visuallyHideEmptyStatus?: boolean` with default `false`; `project-filter-title`; work-frame class `max-w-[1600px]`; table class `min-w-[920px]`.

- [ ] **Step 1: Add failing SearchableChoice live-region tests**

Add this test inside `describe('SearchableChoice SSR contract', ...)`:

```tsx
it('can visually hide only the empty selected status while keeping it live', () => {
  const emptyHtml = renderChoice({ value: null, visuallyHideEmptyStatus: true })
  const emptyStatus = emptyHtml.match(
    /<div(?=[^>]*id="equipment-mode-selected-status")(?=[^>]*role="status")[^>]*class="([^"]*)"[^>]*>[\s\S]*?<\/div>/,
  )

  expect(emptyStatus).toBeDefined()
  expect(emptyStatus?.[0]).toContain('aria-live="polite"')
  expect(emptyStatus?.[0]).toContain('선택 없음')
  expect(emptyStatus?.[1]?.split(' ')).toContain('sr-only')

  const selectedHtml = renderChoice({ visuallyHideEmptyStatus: true })
  const selectedStatus = selectedHtml.match(
    /<div(?=[^>]*id="equipment-mode-selected-status")(?=[^>]*role="status")[^>]*class="([^"]*)"[^>]*>[\s\S]*?<\/div>/,
  )

  expect(selectedStatus).toBeDefined()
  expect(selectedStatus?.[0]).toContain('FOUNDRY · Foundry')
  expect(selectedStatus?.[1]?.split(' ')).not.toContain('sr-only')
})
```

- [ ] **Step 2: Run the focused shared-component test and observe RED**

Run:

```bash
cd frontend
npm test -- src/shared/components/SearchableChoice.test.tsx
```

Expected: TypeScript compilation fails because `visuallyHideEmptyStatus` is not a `SearchableChoiceProps` member.

- [ ] **Step 3: Implement the opt-in visual treatment without removing semantics**

Insert the prop between the existing `allowClear` and `autoFocus` members:

```tsx
  allowClear?: boolean
  visuallyHideEmptyStatus?: boolean
  autoFocus?: boolean
```

Insert the default between the existing `allowClear` and `autoFocus` destructured values:

```tsx
  allowClear = false,
  visuallyHideEmptyStatus = false,
  autoFocus = false,
```

Extend only the selected-status class calculation:

```tsx
className={cn(
  'flex min-h-5 flex-wrap items-center gap-2 text-xs',
  selectedInactive ? 'text-warning' : 'text-muted',
  visuallyHideEmptyStatus && value === null && 'sr-only',
)}
```

Do not conditionally render the status element, remove its `id`, or alter `aria-describedby`, `role`, or `aria-live`.

- [ ] **Step 4: Re-run the shared-component test and observe GREEN**

Run:

```bash
cd frontend
npm test -- src/shared/components/SearchableChoice.test.tsx
```

Expected: all `SearchableChoice` tests pass, including existing error, inactive, clear, and virtualization contracts.

- [ ] **Step 5: Add failing project-list hierarchy and width tests**

Add a page test using the existing `renderList('/projects')` helper:

```tsx
it('uses one restrained work frame and one semantic three-control finder', () => {
  const html = renderList('/projects')
  const finder = html.match(
    /<section(?=[^>]*aria-labelledby="project-filter-title")[^>]*>[\s\S]*?<\/section>/,
  )?.[0]

  expect(html).toContain('max-w-[1600px]')
  expect(finder).toBeDefined()
  expect(finder).toContain('id="project-filter-title"')
  expect(finder).toContain('>프로젝트 찾기<')
  expect(finder).toContain('불러온 1개')
  expect(finder).toContain('lg:grid-cols-3')
  expect(finder).not.toContain('lg:grid-cols-[minmax(18rem,1.4fr)')
})
```

Extend the `ProjectChoiceFilter` test with an empty-value render and assert that its selected status is still present and `sr-only`:

```tsx
const emptyHtml = renderToStaticMarkup(
  <ProjectChoiceFilter
    id="project-list-device-type"
    label="Device Type"
    value={null}
    resource={resource}
    onChange={vi.fn()}
  />,
)
expect(emptyHtml).toMatch(
  /id="project-list-device-type-selected-status"[^>]*class="[^"]*sr-only[^"]*"|class="[^"]*sr-only[^"]*"[^>]*id="project-list-device-type-selected-status"/,
)
expect(emptyHtml).toContain('선택 없음')
```

Add this assertion to the approved-column test in `ProjectTable.test.tsx`:

```tsx
expect(html).toContain('min-w-[920px]')
expect(html).not.toContain('min-w-[1040px]')
```

- [ ] **Step 6: Run the list tests and observe RED**

Run:

```bash
cd frontend
npm test -- \
  src/features/projects/ProjectListPage.test.tsx \
  src/features/projects/ProjectTable.test.tsx
```

Expected: failures report the absent finder heading/frame, missing `sr-only` status, old four-column toolbar, and old 1040px table width.

- [ ] **Step 7: Implement the centered finder and narrower unchanged table**

Change the page root to:

```tsx
<section className="mx-auto w-full max-w-[1600px] space-y-5">
```

Replace the existing filter grid and separate count with this composition while retaining the exact existing handlers, query values, IDs, labels, input, and two `ProjectChoiceFilter` calls:

```tsx
<section aria-labelledby="project-filter-title" className="space-y-3">
  <div className="flex flex-wrap items-baseline justify-between gap-2">
    <h2 id="project-filter-title" className="text-base font-bold text-ink-950">
      프로젝트 찾기
    </h2>
    <p className="text-sm font-medium tabular-nums text-muted">
      불러온 {projects.length}개
    </p>
  </div>
  <div className="grid gap-3 lg:grid-cols-3 lg:items-start">
    <label className="grid w-full gap-1.5 text-sm font-semibold text-ink-950">
      프로젝트 검색
      <span className="relative block">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          size={16}
          strokeWidth={2}
        />
        <input
          className="input pl-9"
          placeholder="프로젝트명 또는 Part ID"
          type="search"
          value={queryDraft}
          onChange={(event) => setQueryDraft(event.target.value)}
        />
      </span>
    </label>
    <ProjectChoiceFilter
      id="project-list-device-type"
      label="Device Type"
      value={routeState.deviceTypeCode}
      resource={deviceTypes}
      onChange={updateDeviceTypeFilter}
    />
    <ProjectChoiceFilter
      id="project-list-category"
      label="Project Category"
      value={routeState.projectCategoryCode}
      resource={projectCategories}
      onChange={updateProjectCategoryFilter}
    />
  </div>
</section>
```

In `ProjectChoiceFilter`, keep the full existing resource mapping and pass the new prop:

```tsx
<SearchableChoice
  id={id}
  label={label}
  value={value}
  options={resource.displayOptions}
  loading={state.loading}
  error={resource.error}
  sourceActive
  sourceInactive={selectedOption?.is_active === false}
  selectionReady={state.selectionReady}
  allowInactiveSelection
  allowClear
  visuallyHideEmptyStatus
  onOpen={resource.prepareToOpen}
  onRetry={resource.retryOptions}
  onChange={onChange}
/>
```

In `ProjectTable.tsx`, change only the table minimum width:

```tsx
<table className="w-full min-w-[920px] table-fixed text-left text-sm">
```

- [ ] **Step 8: Run focused and adjacent list tests and observe GREEN**

Run:

```bash
cd frontend
npm test -- \
  src/shared/components/SearchableChoice.test.tsx \
  src/features/projects/ProjectListPage.test.tsx \
  src/features/projects/ProjectTable.test.tsx \
  src/features/projects/projectListHistory.test.ts \
  src/features/projects/urlState.test.ts
```

Expected: all selected suites pass; existing URL parsing, history, inactive/raw values, eight columns, truncation, focus links, and compact rows remain covered.

- [ ] **Step 9: Commit the independently reviewable list slice**

```bash
git add \
  frontend/src/shared/components/SearchableChoice.tsx \
  frontend/src/shared/components/SearchableChoice.test.tsx \
  frontend/src/features/projects/ProjectListPage.tsx \
  frontend/src/features/projects/ProjectListPage.test.tsx \
  frontend/src/features/projects/ProjectTable.tsx \
  frontend/src/features/projects/ProjectTable.test.tsx
git commit -m "Reduce project-list scanning noise without weakening filter state" \
  -m "Keep empty managed-choice status text in the accessibility tree while visually collapsing duplicate rows, and restrain the existing project table to the approved desktop frame." \
  -m "Constraint: Preserve all URL, history, inactive-choice, pagination, focus, and eight-column contracts.
Confidence: high
Scope-risk: narrow
Directive: visuallyHideEmptyStatus must never unmount or de-live the selected status region.
Tested: Focused SearchableChoice, project list/table, URL-state, and history Vitest suites."
```

---

### Task 2: Put core project information and Layer work ahead of advanced Profile fields

**Files:**
- Modify: `frontend/src/features/projects/ProjectDetailPage.test.tsx`
- Modify: `frontend/src/features/projects/ProjectDetailPage.tsx:1-394`

**Interfaces:**
- Consumes: `ProjectOut.layers`, nullable `ProjectLayerOut.source_project_id`, all existing Profile fields, edit-trigger ref, drawer state, and replace-target modal state.
- Produces: work-frame class `max-w-[1600px]`; summary label `백본`; section title `프로젝트 정보`; native `details` labelled `상세 공정 Profile`; unchanged six `data-profile-group` values.

- [ ] **Step 1: Make the detail test fixture reusable for summary cases**

Change the helper signature and query seed without altering the base fixture:

```tsx
function renderDetail(projectData: ProjectOut = project): string {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY } },
  })
  queryClient.setQueryData(['project', projectData.id], projectData)

  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <StaticRouter location={`/projects/${projectData.id}`}>
        <Routes>
          <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
        </Routes>
      </StaticRouter>
    </QueryClientProvider>,
  )
}
```

- [ ] **Step 2: Add failing detail hierarchy, summary, and disclosure tests**

Add these tests:

```tsx
it('centers the detail frame and derives a four-item backbone summary from layers', () => {
  const single = renderDetail()
  const multiple = renderDetail({
    ...project,
    layers: [
      project.layers[0]!,
      { ...project.layers[0]!, id: 8, source_project_id: 44 },
      { ...project.layers[0]!, id: 9, source_project_id: 44 },
    ],
  })
  const none = renderDetail({
    ...project,
    layers: [{ ...project.layers[0]!, source_project_id: null, source_layer_key: null }],
  })

  expect(single).toContain('max-w-[1600px]')
  expect(single).toMatch(/>백본<[^]*?>#41</)
  expect(multiple).toMatch(/>백본<[^]*?>2개 프로젝트</)
  expect(none).toMatch(/>백본<[^]*?>없음</)
})

it('keeps core Profile visible and advanced Profile in a closed native disclosure before Layers', () => {
  const html = renderDetail()
  const coreIndex = html.indexOf('id="project-profile-title"')
  const detailsIndex = html.indexOf('data-profile-details=""')
  const layersIndex = html.indexOf('id="project-layers-title"')
  const detailsTag = html.match(/<details[^>]*data-profile-details=""[^>]*>/)?.[0]

  expect(html).toContain('>프로젝트 정보<')
  expect(coreIndex).toBeGreaterThan(-1)
  expect(detailsIndex).toBeGreaterThan(coreIndex)
  expect(layersIndex).toBeGreaterThan(detailsIndex)
  expect(detailsTag).toBeDefined()
  expect(detailsTag).not.toContain(' open')
  expect(html).toContain('<summary')
  expect(html).toContain('>상세 공정 Profile<')

  for (const group of ['identity', 'product', 'direction']) {
    expect(html.indexOf(`data-profile-group="${group}"`)).toBeLessThan(detailsIndex)
  }
  for (const group of ['die-shot', 'wafer-position', 'layer-summary']) {
    expect(html.indexOf(`data-profile-group="${group}"`)).toBeGreaterThan(detailsIndex)
    expect(html.indexOf(`data-profile-group="${group}"`)).toBeLessThan(layersIndex)
  }
  for (const group of [
    'identity',
    'product',
    'direction',
    'die-shot',
    'wafer-position',
    'layer-summary',
  ]) {
    const groupTag = html.match(
      new RegExp(`<section[^>]*data-profile-group="${group}"[^>]*>`),
    )?.[0]
    expect(groupTag, group).toBeDefined()
    expect(groupTag, group).not.toContain('rounded-xl')
    expect(groupTag, group).not.toContain('bg-surface')
  }
})
```

Retain the existing exhaustive fixed-field loop, six group checks, identity read-only assertions, compact Layer-row assertions, truncation/title assertions, and edit-trigger assertion. Change the old test name from “six explicit groups before the Layer table” to “all fixed Profile values across core and advanced groups before the Layer table”.

- [ ] **Step 3: Run the detail test and observe RED**

Run:

```bash
cd frontend
npm test -- src/features/projects/ProjectDetailPage.test.tsx
```

Expected: failures report the absent 1600px frame, absent backbone item, old `프로젝트 기본정보` title, and missing native disclosure.

- [ ] **Step 4: Implement the frame and deterministic backbone derivation**

Change the route root:

```tsx
<section className="mx-auto w-full max-w-[1600px] space-y-5">
```

Derive the display value beside the existing counts:

```tsx
const backboneProjectIds = new Set(
  project.layers.flatMap((layer) =>
    layer.source_project_id === null ? [] : [layer.source_project_id],
  ),
)
const backboneSummary =
  backboneProjectIds.size === 0
    ? '없음'
    : backboneProjectIds.size === 1
      ? `#${[...backboneProjectIds][0]}`
      : `${backboneProjectIds.size}개 프로젝트`
```

Render four items while keeping the current definition-list semantics:

```tsx
<dl className="grid overflow-hidden rounded-xl border border-border-subtle bg-surface sm:grid-cols-4">
  <SummaryItem label="Layer" value={summary.layerCount} />
  <SummaryItem label="조건 행" value={summary.conditionCount} />
  <SummaryItem label="Cell" value={summary.cellCount} />
  <SummaryItem label="백본" value={backboneSummary} />
</dl>
```

Update `SummaryItem` to accept the already-imported `ReactNode` so numeric and text values share one component:

```tsx
function SummaryItem({ label, value }: { label: string; value: ReactNode }) {
```

- [ ] **Step 5: Implement one core surface and one native advanced disclosure**

Keep the existing section header/button/ref/onClick contract, change the title to `프로젝트 정보`, and use the one-sentence description `업무에 필요한 식별·분류·방향을 먼저 확인합니다.`. Place Identity, Product, and Direction in one surface:

```tsx
<div className="overflow-hidden rounded-xl border border-border-subtle bg-surface">
  <div className="grid divide-y divide-border-subtle xl:grid-cols-3 xl:divide-x xl:divide-y-0">
    <ProfileGroup group="identity" title="Identity">
      <DefinitionItem label="LINE" value={project.line_id} mono />
      <DefinitionItem label="Process ID" value={project.process_id} mono />
      <DefinitionItem label="PARTID" value={project.part_id} mono />
    </ProfileGroup>
    <ProfileGroup group="product" title="Product">
      <DefinitionItem label="Process Name" value={project.profile.process_name} />
      <ChoiceDefinitionItem label="Device Type" choice={project.profile.device_type} />
      <ChoiceDefinitionItem label="Category" choice={project.profile.project_category} />
      <DefinitionItem label="Comment" value={project.profile.comment} />
    </ProfileGroup>
    <ProfileGroup group="direction" title="Direction">
      <ChoiceDefinitionItem label="Active Direction" choice={project.profile.active_direction} />
      <ChoiceDefinitionItem label="Gate Direction" choice={project.profile.gate_direction} />
    </ProfileGroup>
  </div>
</div>
```

Immediately after that section, render the advanced groups in a default-closed native disclosure. Import `ChevronDown` from the already-installed `lucide-react` package:

```tsx
<details
  className="group overflow-hidden rounded-xl border border-border-subtle bg-surface"
  data-profile-details=""
>
  <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 text-left [&::-webkit-details-marker]:hidden">
    <span>
      <span className="block text-sm font-bold text-ink-950">상세 공정 Profile</span>
      <span className="mt-0.5 block text-xs text-muted">
        Die/Shot, Wafer Position, Layer Summary를 확인합니다.
      </span>
    </span>
    <ChevronDown
      aria-hidden="true"
      className="shrink-0 text-muted transition-transform group-open:rotate-180"
      size={18}
      strokeWidth={2}
    />
  </summary>
  <div className="grid divide-y divide-border-subtle border-t border-border-subtle xl:grid-cols-3 xl:divide-x xl:divide-y-0">
    <ProfileGroup group="die-shot" title="Die/Shot">
      <DefinitionItem label="Gross Die" value={project.profile.gross_die} />
      <DefinitionItem label="Pitch X" value={project.profile.pitch_x} mono />
      <DefinitionItem label="Pitch Y" value={project.profile.pitch_y} mono />
      <DefinitionItem label="Shot X" value={project.profile.shot_x} mono />
      <DefinitionItem label="Shot Y" value={project.profile.shot_y} mono />
      <DefinitionItem label="Slit Occupancy" value={project.profile.slit_occupancy} mono />
      <DefinitionItem label="Lens Occupancy" value={project.profile.lens_occupancy} mono />
      <DefinitionItem label="Shot Count" value={project.profile.shot_count} />
      <DefinitionItem label="Full Shot" value={project.profile.full_shot} />
    </ProfileGroup>
    <ProfileGroup group="wafer-position" title="Wafer Position">
      <DefinitionItem label="Map Offset X" value={project.profile.map_offset_x} mono />
      <DefinitionItem label="Map Offset Y" value={project.profile.map_offset_y} mono />
      <DefinitionItem label="Scribe Lane X" value={project.profile.scribe_lane_x} mono />
      <DefinitionItem label="Scribe Lane Y" value={project.profile.scribe_lane_y} mono />
    </ProfileGroup>
    <ProfileGroup group="layer-summary" title="Layer Summary">
      <DefinitionItem label="Layer Total" value={project.profile.layer_total} />
      <DefinitionItem label="EUV" value={project.profile.euv} />
      <DefinitionItem label="IMM" value={project.profile.imm} />
      <DefinitionItem label="ARF" value={project.profile.arf} />
      <DefinitionItem label="KRF" value={project.profile.krf} />
      <DefinitionItem label="I-line" value={project.profile.iline} />
      <DefinitionItem label="SOH" value={project.profile.soh} />
      <DefinitionItem label="PSPI" value={project.profile.pspi} />
      <DefinitionItem label="Metal Layer Count" value={project.profile.metal_layer_count} />
    </ProfileGroup>
  </div>
</details>
```

Change `ProfileGroup` so the parent surfaces own borders and backgrounds:

```tsx
function ProfileGroup({
  group,
  title,
  className,
  children,
}: {
  group: string
  title: string
  className?: string
  children: ReactNode
}) {
  return (
    <section data-profile-group={group} className={`min-w-0 p-4 ${className ?? ''}`}>
      <h3 className="text-sm font-bold text-ink-950">{title}</h3>
      <dl className="mt-3 grid gap-x-4 gap-y-3 sm:grid-cols-2">{children}</dl>
    </section>
  )
}
```

Do not touch the Layer table, replace modal, profile drawer, or their state.

- [ ] **Step 6: Run focused and adjacent project-detail tests and observe GREEN**

Run:

```bash
cd frontend
npm test -- \
  src/features/projects/ProjectDetailPage.test.tsx \
  src/features/projects/ProjectProfileDrawer.test.tsx \
  src/features/projects/LayerReplaceModal.test.tsx \
  src/features/projects/profileForm.test.ts
```

Expected: all selected suites pass; summary variants, semantic order, closed disclosure, six groups, all fields, drawer contract, and Layer replacement remain covered.

- [ ] **Step 7: Commit the independently reviewable detail slice**

```bash
git add \
  frontend/src/features/projects/ProjectDetailPage.tsx \
  frontend/src/features/projects/ProjectDetailPage.test.tsx
git commit -m "Surface Layer work before optional project profile detail" \
  -m "Keep core identity, product, and direction visible while placing nullable process detail in a native closed disclosure and deriving backbone context from the loaded layers." \
  -m "Constraint: Preserve every fixed Profile field, drawer lock flow, Layer replacement flow, and route-return contract.
Rejected: Add disclosure state persistence | the approved design requires a default-closed stateless native control.
Confidence: high
Scope-risk: moderate
Directive: Advanced Profile groups must remain in the DOM before the Layer section and accessible through native summary keyboard behavior.
Tested: Focused detail, Profile drawer, profile form, and Layer replacement Vitest suites."
```

---

### Task 3: Prove responsive clarity with deterministic browser evidence and full regression

**Files:**
- Create: `docs/evidence/project-browse-clarity/project-list-1024x768.png`
- Create: `docs/evidence/project-browse-clarity/project-list-1440x900.png`
- Create: `docs/evidence/project-browse-clarity/project-list-1920x1080.png`
- Create: `docs/evidence/project-browse-clarity/project-detail-1024x768.png`
- Create: `docs/evidence/project-browse-clarity/project-detail-1440x900.png`
- Create: `docs/evidence/project-browse-clarity/project-detail-1920x1080.png`
- Create: `docs/evidence/project-browse-clarity/README.md`

**Interfaces:**
- Consumes: the production build, existing API client routes, a deterministic browser fixture with at least eight list projects and twelve detail layers, and the merged Task 1/2 DOM contracts.
- Produces: measured overflow/frame/fold/keyboard evidence, six screenshots, zero unexpected console errors, and zero failed fixture/static requests.

- [ ] **Step 1: Run implementation-boundary and static checks before browser work**

Run:

```bash
git diff --check main...HEAD
git diff --name-only main...HEAD
cd frontend
npm run typecheck
npm run lint
npm run build
```

Expected: no whitespace errors; implementation changes are limited to the eight approved frontend source/test files plus design/plan documents; typecheck, lint, and production build exit 0. Existing Vite chunk-size or third-party annotation warnings may be recorded, but no new error is accepted.

- [ ] **Step 2: Start the production preview and deterministic Playwright harness**

Use the existing temporary Playwright 1.57 installation if present; otherwise install it outside the repository:

```bash
mkdir -p /tmp/pcm-project-browse-playwright
cd /tmp/pcm-project-browse-playwright
test -f package.json || npm init -y
test -d node_modules/playwright || npm install --no-save playwright@1.57.0
npx playwright install chromium
cd /home/appuser/process-condition-manager/frontend
npm run preview -- --host 127.0.0.1 --port 15177
```

In a temporary QA script under `/tmp/pcm-project-browse-playwright`, route every `/api/**` request used by `/projects` and `/projects/42` to deterministic JSON. Use this exact route matrix:

| Method | Path | Response contract |
| --- | --- | --- |
| GET | `/api/projects` | `{ items: eightProjectSummaries, next_cursor: null }` |
| GET | `/api/projects/42` | one `ProjectOut` with twelve layers |
| GET | `/api/projects/42/profile` | the same object's `profile` |
| POST | `/api/projects/42/lock` | `{ locked_by: 'qa-reviewer', lock_token: 'qa-lock-42', locked_at: '2026-07-16T00:00:00Z', expires_at: '2026-07-16T00:02:00Z' }` |
| DELETE | `/api/projects/42/lock` | HTTP 204 |
| GET | `/api/choice-sets/{code}` | active summary for `device_type`, `project_category`, `active_direction`, or `gate_direction` |
| GET | `/api/choice-sets/{code}/options` | `{ set_code, version: 1, items, next_cursor: null }` for the same four codes |

The eight summaries must include active, inactive, maximum-length, and raw-code classifications. The detail fixture must contain a mix of populated and empty Profile values, twelve layers, repeated backbone project `41`, and a second backbone project `44`. If the drawer remains open long enough for `/api/projects/42/lock/heartbeat`, return the same lock response. Record any route outside this matrix as `kind: 'unexpected'` and fulfill it with HTTP 404 rather than passing it through.

- [ ] **Step 3: Measure and capture the list at all approved viewports**

For each viewport `[1024,768]`, `[1440,900]`, and `[1920,1080]`, navigate to `/projects`, wait for `프로젝트 찾기` and the first project link, and collect:

```ts
const listMetrics = await page.evaluate(() => {
  const frame = document.querySelector('main > section') as HTMLElement
  const tableWrapper = document.querySelector('table')?.parentElement as HTMLElement
  return {
    bodyOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    frameWidth: frame.getBoundingClientRect().width,
    tableOverflow: tableWrapper.scrollWidth - tableWrapper.clientWidth,
  }
})
```

Assert `bodyOverflow === 0` at every viewport, `tableOverflow === 0` at 1024px, and `frameWidth <= 1600` at 1920px. Save the three list screenshots at the exact paths declared in this task.

- [ ] **Step 4: Measure disclosure, Layer fold, and interaction on the detail route**

For each approved viewport, navigate to `/projects/42`, wait for `프로젝트 정보`, and collect:

```ts
const detailMetrics = await page.evaluate(() => {
  const frame = document.querySelector('main > section') as HTMLElement
  const details = document.querySelector('[data-profile-details]') as HTMLDetailsElement
  const layerHeading = document.querySelector('#project-layers-title') as HTMLElement
  const layerTable = layerHeading.closest('section')?.querySelector('table') as HTMLTableElement
  const firstRow = layerTable.tBodies[0]?.rows[0]
  return {
    bodyOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    frameWidth: frame.getBoundingClientRect().width,
    detailsInitiallyOpen: details.open,
    layerHeadingBottom: layerHeading.getBoundingClientRect().bottom,
    layerHeaderBottom: layerTable.tHead?.getBoundingClientRect().bottom ?? Infinity,
    firstRowBottom: firstRow?.getBoundingClientRect().bottom ?? Infinity,
  }
})
```

Assert `bodyOverflow === 0` at every viewport, `detailsInitiallyOpen === false`, `frameWidth <= 1600` at 1920px, and all three Layer bottoms are `<= 900` at 1440×900. Focus the native summary, press `Enter`, assert the disclosure opens, press `Space`, assert it closes, then focus `기본정보 편집` and assert it exposes a dialog without a page error. Save the three detail screenshots before opening the disclosure.

- [ ] **Step 5: Review screenshots at original resolution and correct real defects**

Open all six PNGs with the local image viewer at original detail. Reject the implementation if any of these are visible: clipped headings or controls, overlapping filter content, accidental nested-card repetition, hidden selected/inactive filter state, truncated Layer action, unexplained blank decorative surface, or a Layer first row below the 1440×900 fold. If a defect is found, add a focused regression assertion before the smallest source correction, rerun the affected focused tests, rebuild, and replace all screenshots affected by the change.

- [ ] **Step 6: Write the evidence record from the captured metric objects**

Have the temporary QA script retain six records in `measurements`, each with `route`, `viewport`, `bodyOverflow`, `tableOverflow`, `frameWidth`, and `layerFirstRowBottom`. After all assertions pass, generate `docs/evidence/project-browse-clarity/README.md` directly from those records:

```js
const formatMetric = (value) => (value === null ? 'n/a' : `${Math.round(value * 10) / 10}px`)
const rows = measurements.map((metric) =>
  `| \`${metric.route}\` | ${metric.viewport} | ${formatMetric(metric.bodyOverflow)} | ${formatMetric(metric.tableOverflow)} | ${formatMetric(metric.frameWidth)} | ${formatMetric(metric.layerFirstRowBottom)} |`,
)
const buildCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: '/home/appuser/process-condition-manager',
  encoding: 'utf8',
}).trim()
const readme = [
  '# Project Browse Clarity Browser Evidence',
  '',
  `- Build commit: \`${buildCommit}\``,
  `- Browser: Playwright 1.57 / Chromium ${browserVersion}`,
  '- Fixture: 8 list projects, 12 detail layers, backbone projects #41 and #44',
  '',
  '| Route | Viewport | Body overflow | Table overflow | Frame width | Layer first row bottom |',
  '| --- | ---: | ---: | ---: | ---: | ---: |',
  ...rows,
  '',
  '- Native details: closed initially; Enter opened; Space closed.',
  '- Profile edit trigger: dialog opened without console or network failure.',
  `- Unexpected console errors: ${consoleErrors.length}.`,
  `- Failed fixture/static requests: ${failedRequests.length}.`,
  '',
].join('\n')
await writeFile(
  '/home/appuser/process-condition-manager/docs/evidence/project-browse-clarity/README.md',
  readme,
)
```

Import `execFileSync` from `node:child_process` and `writeFile` from `node:fs/promises` in the temporary script. Assert `measurements.length === 6`, `consoleErrors.length === 0`, and `failedRequests.length === 0` before writing. Do not commit the temporary QA script or any Playwright dependency files.

- [ ] **Step 7: Run the complete frontend regression and final repository checks**

Run:

```bash
cd /home/appuser/process-condition-manager/frontend
npm test
npm run lint
npm run typecheck
npm run build
cd /home/appuser/process-condition-manager
git diff --check main...HEAD
git status --short
```

Expected: the complete frontend suite passes with zero failed tests; lint, typecheck, and production build exit 0; no whitespace errors; only the six PNGs and evidence README remain unstaged after the two implementation commits.

- [ ] **Step 8: Commit evidence with a reproducible Lore record**

```bash
git add docs/evidence/project-browse-clarity
git commit -m "Prove project browsing stays readable across approved desktop widths" \
  -m "Capture deterministic production-build evidence for the compact finder, restrained work frames, default-closed advanced Profile, and above-fold Layer entry point." \
  -m "Constraint: Browser fixtures replace live API data so responsive evidence is deterministic and reviewable.
Confidence: high
Scope-risk: narrow
Directive: Re-capture all six viewports when project-list or project-detail layout changes.
Tested: Full frontend Vitest, lint, typecheck, production build, Playwright overflow/fold/keyboard checks, and original-resolution screenshot review.
Not-tested: Live backend latency and production font-rendering variance."
```

- [ ] **Step 9: Perform current-model review, publish, verify CI, and merge**

Review `git diff main...HEAD` for scope, behavior preservation, duplicated abstractions, accessibility regressions, and visual consistency. Confirm each commit parses Lore trailers with:

```bash
for commit in $(git rev-list --reverse main..HEAD); do
  git show -s --format=%B "$commit" | git interpret-trailers --parse
done
```

Push `agent/ui-clarity-project-browse`, open a PR containing the design decision, changed-file summary, automatic test evidence, and browser measurements. Wait until both repository CI workflows pass, merge the PR, update local `main`, delete/prune the feature branch, and confirm `git status --short --branch` is clean before beginning the common PageHeader/App Shell clarity slice.
