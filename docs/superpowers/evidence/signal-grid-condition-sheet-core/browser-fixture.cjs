#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const repoRoot = path.resolve(__dirname, '../../../..')
const frontendRoot = path.join(repoRoot, 'frontend')
const reviewRoot = path.join(repoRoot, '.impeccable/review')
const resultPath = path.join(__dirname, 'browser-results.json')
const playwrightRoot = process.env.PLAYWRIGHT_PACKAGE_ROOT
const browserExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
const port = Number(process.env.PCM_FIXTURE_PORT ?? '4179')
const baseUrl = `http://127.0.0.1:${port}`

if (!playwrightRoot || !browserExecutable) {
  throw new Error(
    'Set PLAYWRIGHT_PACKAGE_ROOT and PLAYWRIGHT_CHROMIUM_EXECUTABLE to existing local caches.',
  )
}
if (!fs.existsSync(path.join(playwrightRoot, 'index.js')) || !fs.existsSync(browserExecutable)) {
  throw new Error('The configured Playwright package or Chromium executable does not exist.')
}

const { chromium } = require(path.join(playwrightRoot, 'index.js'))

const now = '2026-08-14T00:00:00Z'
const profile = {
  project_id: 7,
  process_name: 'Signal Etch',
  device_type: { code: 'FOUNDRY', label: 'Foundry', is_active: true },
  project_category: { code: 'LOGIC', label: 'Logic', is_active: true },
  comment: 'Deterministic browser fixture',
  active_direction: null,
  gate_direction: null,
  gross_die: null,
  pitch_x: null,
  pitch_y: null,
  shot_x: null,
  shot_y: null,
  slit_occupancy: null,
  lens_occupancy: null,
  map_offset_x: null,
  map_offset_y: null,
  scribe_lane_x: null,
  scribe_lane_y: null,
  shot_count: null,
  full_shot: null,
  layer_total: null,
  euv: null,
  imm: null,
  arf: null,
  krf: null,
  iline: null,
  soh: null,
  pspi: null,
  metal_layer_count: null,
  created_at: now,
  updated_at: now,
}

const sourceProjects = new Map([
  [17, sourceProject(17, 'LINE-A', 'INGEST', 'SRC-A', '001', 'SOURCE-A')],
  [18, sourceProject(18, 'LINE-B', 'COATING', 'SRC-B', '002', 'SOURCE-B')],
  [19, sourceProject(19, 'LINE-C', 'POLISH', 'SRC-C', '003', 'SOURCE-C')],
])

const project = {
  id: 7,
  line_id: 'LINE-SG',
  process_id: 'ETCH',
  part_id: 'PART-007',
  name: 'Signal Grid condition sheet',
  status: 'draft',
  version: 4,
  revision_root_id: 7,
  predecessor_project_id: null,
  successor_project_id: null,
  allowed_actions: ['request_review'],
  profile,
  layers: [
    layer(1, 'L1', '010', 'ETCH', 0, 17, 'SRC-A'),
    layer(2, 'L2', '020', 'CVD', 1, 18, 'SRC-B'),
    layer(3, 'L3', '030', 'CMP', 2, 19, 'SRC-C'),
  ],
}

const columns = Array.from({ length: 60 }, (_, index) => {
  const number = String(index + 1).padStart(3, '0')
  return {
    parameter_code: `PARAM_${number}`,
    display_name: `Parameter ${number}`,
    value_type: 'number',
    category_code: index < 20 ? 'DEPOSITION' : index < 40 ? 'THERMAL' : 'METROLOGY',
    unit: index % 3 === 0 ? '°C' : index % 3 === 1 ? 's' : null,
    min_value: null,
    max_value: null,
    required: index === 1,
    pattern: null,
    pattern_hint: null,
    description: `Deterministic parameter ${number}`,
    choice_set_code: null,
    choice_set_version: null,
    sort_order: index + 1,
  }
})

let sheetRows = [
  row(101, 'L1', '010', 'ETCH', 'POR', true, 0, 1),
  row(102, 'L1', '010', 'ETCH', 'Experiment', false, 0, 2),
  row(201, 'L2', '020', 'CVD', 'POR', true, 1, 1),
  row(202, 'L2', '020', 'CVD', 'Qualification', false, 1, 2),
  row(301, 'L3', '030', 'CMP', 'POR', true, 2, 1),
  row(302, 'L3', '030', 'CMP', 'Validation gap', false, 2, 2, true),
]

let nextConditionId = 900
let failSaves = true
let failNextStructural = false
let readonlyLock = false
let phase = 'bootstrap'
const apiCalls = []
const assertions = []
const consoleMessages = []
const pageErrors = []
const measurements = {}
let debugPage = null

function sourceProject(id, line, process, part, stepSeq, layerId) {
  return {
    id,
    line_id: line,
    process_id: process,
    part_id: part,
    name: `${line} Backbone`,
    status: 'approved',
    version: 2,
    revision_root_id: id,
    predecessor_project_id: null,
    successor_project_id: null,
    allowed_actions: [],
    profile: { ...profile, project_id: id, process_name: process },
    layers: [layer(id * 10, part, stepSeq, layerId, 0, null, null)],
  }
}

function layer(id, key, stepSeq, layerId, sortOrder, sourceProjectId, sourceLayerKey) {
  return {
    id,
    layer_key: key,
    step_seq: stepSeq,
    layer_id: layerId,
    eqp_type: `${layerId}-EQP`,
    eqp_type_desc: `${layerId} equipment`,
    area_name: 'FAB-A',
    sort_order: sortOrder,
    condition_count: 2,
    cell_count: 120,
    source_project_id: sourceProjectId,
    source_layer_key: sourceLayerKey,
  }
}

function row(id, layerKey, stepSeq, layerId, conditionLabel, isPor, layerSortOrder, conditionIndex, requiredGap = false) {
  const cells = Object.fromEntries(
    columns.map((column, index) => [column.parameter_code, String(id + index)]),
  )
  if (requiredGap) delete cells.PARAM_002
  return {
    condition_id: id,
    layer_key: layerKey,
    step_seq: stepSeq,
    layer_id: layerId,
    layer_label: `${layerId} (${stepSeq})`,
    condition_label: conditionLabel,
    is_por: isPor,
    layer_sort_order: layerSortOrder,
    condition_index: conditionIndex,
    cells,
  }
}

function currentSheet() {
  return {
    columns,
    rows: sheetRows,
    lock: {
      locked_by: null,
      locked_at: null,
      expires_at: null,
      is_mine: false,
      heartbeat_seconds: 45,
    },
    validation_rules: [],
    validation_basis_hash: 'sha256:signal-grid-fixture-v1',
    comment_counts: [],
  }
}

function projectSummary() {
  return {
    id: project.id,
    line_id: project.line_id,
    process_id: project.process_id,
    part_id: project.part_id,
    name: project.name,
    status: project.status,
    version: project.version,
    revision_root_id: project.revision_root_id,
    predecessor_project_id: null,
    successor_project_id: null,
    allowed_actions: project.allowed_actions,
    device_type: project.profile.device_type,
    project_category: project.profile.project_category,
    layer_total: '3',
    updated_at: now,
    layer_count: 3,
    cell_count: sheetRows.length * columns.length,
  }
}

function currentProject() {
  return {
    ...project,
    layers: project.layers.map((candidate) => {
      const rows = sheetRows.filter((rowCandidate) => rowCandidate.layer_key === candidate.layer_key)
      return {
        ...candidate,
        condition_count: rows.length,
        cell_count: rows.reduce((count, rowCandidate) => count + Object.keys(rowCandidate.cells).length, 0),
      }
    }),
  }
}

function json(route, status, body) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

function errorBody(code, message, details = {}) {
  return { code, message, details, request_id: 'fixture-request' }
}

async function handleApi(route) {
  const request = route.request()
  const url = new URL(request.url())
  const pathname = url.pathname
  const method = request.method()
  const body = request.postDataJSON?.() ?? null
  apiCalls.push({ phase, method, pathname, search: url.search, body })

  if (pathname === '/api/auth/me' && method === 'GET') {
    return json(route, 200, {
      id: 'fixture-engineer',
      display_name: 'Fixture Engineer',
      email: 'fixture@example.test',
      roles: ['engineer'],
      permissions: ['project.edit', 'project.review.request', 'project.comment'],
    })
  }
  if (pathname === '/api/projects' && method === 'GET') {
    return json(route, 200, { items: [projectSummary()], next_cursor: null })
  }
  if (pathname === '/api/projects/7' && method === 'GET') return json(route, 200, currentProject())
  const sourceMatch = pathname.match(/^\/api\/projects\/(17|18|19)$/)
  if (sourceMatch && method === 'GET') return json(route, 200, sourceProjects.get(Number(sourceMatch[1])))
  if (pathname === '/api/projects/7/sheet' && method === 'GET') return json(route, 200, currentSheet())
  if (pathname === '/api/projects/7/lock' && method === 'POST') {
    if (readonlyLock) {
      return json(route, 409, errorBody('lock_conflict', '다른 사용자가 편집 중입니다.', { locked_by: 'Review Owner' }))
    }
    return json(route, 200, {
      locked_by: 'Fixture Engineer',
      lock_token: 'fixture-lock-token',
      locked_at: now,
      expires_at: '2026-08-14T01:00:00Z',
    })
  }
  if (pathname === '/api/projects/7/lock/heartbeat' && method === 'POST') {
    return json(route, 200, {
      locked_by: 'Fixture Engineer',
      lock_token: 'fixture-lock-token',
      locked_at: now,
      expires_at: '2026-08-14T01:00:00Z',
    })
  }
  if ((pathname === '/api/projects/7/lock' && method === 'DELETE') || pathname.endsWith('/lock/release')) {
    return route.fulfill({ status: 204, body: '' })
  }
  if (pathname === '/api/projects/7/cells' && method === 'PATCH') {
    if (failSaves) return json(route, 500, errorBody('fixture_save_failure', 'Fixture save failure'))
    for (const cell of body.cells) {
      const target = sheetRows.find((candidate) => candidate.condition_id === cell.condition_id)
      if (target) target.cells[cell.parameter_code] = cell.value
    }
    return json(route, 200, { cells: body.cells, batch_id: 'fixture-batch' })
  }
  const addMatch = pathname.match(/^\/api\/projects\/7\/layers\/([^/]+)\/conditions$/)
  if (addMatch && method === 'POST') {
    if (failNextStructural) {
      failNextStructural = false
      return json(route, 500, errorBody('fixture_structural_failure', 'Fixture structural failure'))
    }
    const layerKey = decodeURIComponent(addMatch[1])
    const layerRows = sheetRows.filter((candidate) => candidate.layer_key === layerKey)
    const source = body?.source_condition_id == null
      ? null
      : sheetRows.find((candidate) => candidate.condition_id === body.source_condition_id)
    const layerDefinition = project.layers.find((candidate) => candidate.layer_key === layerKey)
    const created = row(
      nextConditionId++,
      layerKey,
      layerDefinition.step_seq,
      layerDefinition.layer_id,
      source ? `${source.condition_label} copy` : `Condition ${layerRows.length + 1}`,
      false,
      layerDefinition.sort_order,
      Math.max(...layerRows.map((candidate) => candidate.condition_index)) + 1,
    )
    if (source) created.cells = { ...source.cells }
    const insertAt = sheetRows.findLastIndex((candidate) => candidate.layer_key === layerKey) + 1
    sheetRows.splice(insertAt, 0, created)
    return json(route, 201, {
      id: created.condition_id,
      layer_key: created.layer_key,
      label: created.condition_label,
      condition_index: created.condition_index,
      is_por: created.is_por,
    })
  }
  const conditionMatch = pathname.match(/^\/api\/projects\/7\/conditions\/(\d+)(\/por)?$/)
  if (conditionMatch && method === 'PUT' && conditionMatch[2] === '/por') {
    const id = Number(conditionMatch[1])
    const target = sheetRows.find((candidate) => candidate.condition_id === id)
    for (const candidate of sheetRows) {
      if (candidate.layer_key === target.layer_key) candidate.is_por = candidate.condition_id === id
    }
    return json(route, 200, {
      id: target.condition_id,
      layer_key: target.layer_key,
      label: target.condition_label,
      condition_index: target.condition_index,
      is_por: true,
    })
  }
  if (conditionMatch && method === 'DELETE' && !conditionMatch[2]) {
    const id = Number(conditionMatch[1])
    const target = sheetRows.find((candidate) => candidate.condition_id === id)
    if (target?.is_por) {
      return json(route, 422, errorBody('domain_validation_error', 'POR 조건 행은 다른 행에 POR을 지정한 후 삭제할 수 있다', {
        layer_key: target.layer_key,
        condition_id: id,
      }))
    }
    sheetRows = sheetRows.filter((candidate) => candidate.condition_id !== id)
    return route.fulfill({ status: 204, body: '' })
  }
  if (pathname === '/api/projects/7/validate' && method === 'POST') {
    return json(route, 200, {
      summary: { error_count: 1, warning_count: 0 },
      issues: [validationIssue()],
      evaluated_at: now,
      basis_hash: 'sha256:signal-grid-fixture-v1',
      rule_versions: {},
    })
  }
  if (pathname === '/api/projects/7/events' && method === 'GET') {
    return json(route, 200, {
      items: [{
        kind: 'event', cursor_id: 77, event_types: ['CELL_UPDATE'], actors: ['fixture-engineer'],
        origins: ['manual'], started_at: now, occurred_at: now, layer_keys: ['L2'],
        source_project_id: null, batch_id: null, matched_event_count: 1, total_event_count: 1,
        summary: 'Fixture history jump', jump_target: { layer_key: 'L2', condition_id: 201, parameter_code: 'PARAM_055', cell_ref: '201:PARAM_055', jump_status: 'available' },
        detail_status: 'not_applicable', detail_scope: null, metadata_status: 'complete',
      }],
      coverage: { legacy_unresolved_layer_count: 0, legacy_detail_unavailable_count: 0 },
      next_cursor: null,
    })
  }
  if (pathname === '/api/projects/7/backbone-diff' && method === 'GET') return json(route, 200, backboneRoot())
  const branchMatch = pathname.match(/^\/api\/projects\/7\/backbone-diff\/layers\/([^/]+)\/conditions$/)
  if (branchMatch && method === 'GET') return json(route, 200, backboneConditions())
  const cellMatch = pathname.match(/^\/api\/projects\/7\/backbone-diff\/layers\/([^/]+)\/conditions\/([^/]+)\/cells$/)
  if (cellMatch && method === 'GET') return json(route, 200, backboneCells())
  if (pathname === '/api/projects/7/comments' && method === 'GET') return json(route, 200, { items: [], next_cursor: null })

  return json(route, 404, errorBody('fixture_route_missing', `No fixture route for ${method} ${pathname}`))
}

function validationIssue() {
  return {
    key: 'required:302:PARAM_002', code: 'required', rule_code: null, rule_version: null,
    severity: 'error', condition_id: 302, layer_key: 'L3', parameter_code: 'PARAM_002', details: {},
  }
}

function backboneRoot() {
  return {
    scope: 'root-scope', basis_hash: 'fixture-basis',
    counts: { layer_count: 1, available_layer_count: 1, unavailable_layer_count: 0, row_count: 1, cell_count: 1, full_row_count: 1, full_cell_count: 1, ambiguous_lineage_count: 0, added_count: 0, changed_count: 1, cleared_count: 0, removed_count: 0, unchanged_count: 0 },
    layer_summaries: [{ layer_key: 'L3', layer_sort: 2, layer_status: 'available', baseline_condition_count: 2, current_condition_count: 2, row_count: 1, cell_count: 1, full_row_count: 1, full_cell_count: 1, ambiguous_lineage_count: 0, changed_count: 1, branch_scope: 'branch-scope' }],
    changed_preview: [{ item_kind: 'cell', classification: 'changed', layer_key: 'L3', effective_condition_index: 1, item_sort_key: [2, 1, 'PARAM_060'], status_rank: 1, row_ref: 'row-301', cell_scope: 'cell-scope', row_status: 'matched', parameter_code: 'PARAM_060' }],
  }
}

function backboneConditions() {
  return {
    scope: 'branch-scope', basis_hash: 'fixture-basis', next_cursor: null,
    items: [{ row_ref: 'row-301', row_status: 'matched', effective_condition_index: 1, identity: 301,
      baseline_condition: { condition_id: 501, source_condition_id: 501, label: 'POR', condition_index: 1, is_por: true },
      current_condition: { condition_id: 301, source_condition_id: 501, label: 'POR', condition_index: 1, is_por: true },
      row_metadata: { label_changed: false, index_changed: false, por_changed: false }, filtered_cell_count: 1, full_cell_count: 1, jump_status: 'available', cell_scope: 'cell-scope' }],
  }
}

function backboneCells() {
  return {
    scope: 'cell-scope', basis_hash: 'fixture-basis', row_ref: 'row-301', next_cursor: null,
    items: [{ classification: 'changed', reason: 'fixture value changed', parameter_code: 'PARAM_060', parameter_sort: 60, baseline_value: '10', current_value: '20', baseline_metadata: null, current_metadata: null, jump_status: 'available' }],
  }
}

function record(name, passed, details = {}) {
  assertions.push({ name, passed, ...details })
  if (!passed) throw new Error(`Assertion failed: ${name} ${JSON.stringify(details)}`)
}

async function expectText(page, text, locator = page.locator('body')) {
  await locator.filter({ hasText: text }).first().waitFor({ state: 'visible' })
}

async function metricText(page) {
  return page.locator('[data-testid="sheet-category-tabs"]').innerText()
}

async function clickCanvasCell(page, col, rowIndex, clickCount = 1) {
  const canvas = page.locator('[data-testid="data-grid-canvas"]').first()
  const box = await canvas.boundingBox()
  if (!box) throw new Error('Grid canvas has no bounds')
  const starts = [0, 84, 204, 308, 372]
  const widths = [84, 120, 104, 64, 150]
  const x = starts[col] + widths[col] / 2
  const y = 34 + rowIndex * 32 + 16
  await page.mouse.click(box.x + x, box.y + y, { clickCount })
}

async function waitForSheet(page) {
  await page.locator('[data-sheet-editor]').waitFor({ state: 'visible' })
  await expectText(page, '편집 잠금', page.locator('[data-sheet-editing-status]'))
  await page.locator('[data-testid="data-grid-canvas"]').first().waitFor({ state: 'visible' })
}

async function runBrowser() {
  const preview = spawn('npm', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: frontendRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  let previewLog = ''
  preview.stdout.on('data', (chunk) => { previewLog += chunk })
  preview.stderr.on('data', (chunk) => { previewLog += chunk })

  const browser = await chromium.launch({ executablePath: browserExecutable, headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  debugPage = page
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      consoleMessages.push({ phase, type: message.type(), text: message.text() })
    }
  })
  page.on('pageerror', (error) => pageErrors.push({ phase, message: error.message }))
  page.on('dialog', (dialog) => dialog.accept())
  await page.route('**/api/**', handleApi)

  try {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        const response = await page.request.get(baseUrl)
        if (response.ok()) break
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100))
      if (attempt === 99) throw new Error(`Preview did not start. ${previewLog}`)
    }

    phase = 'page-identity'
    await page.goto(`${baseUrl}/projects/7/sheet`)
    await waitForSheet(page)
    record('page identity', page.url() === `${baseUrl}/projects/7/sheet`, { url: page.url(), title: await page.title() })
    record('not blank / no framework overlay', (await page.locator('[data-sheet-focus-frame]').count()) === 1)

    phase = 'layer-navigation'
    record('all Layers visible by default', (await metricText(page)).includes('행 6'))
    await expectText(page, 'LINE-A / INGEST / SRC-A · 001 / SOURCE-A')
    await page.locator('[data-layer-row="L2"]').click()
    await expectText(page, 'LINE-B / COATING / SRC-B · 002 / SOURCE-B')
    record('Layer jump does not filter default grid', (await metricText(page)).includes('행 6'))
    const currentOnly = page.getByRole('button', { name: '현재만' })
    await currentOnly.click()
    await expectText(page, '행 2', page.locator('[data-testid="sheet-category-tabs"]'))
    await page.locator('[data-layer-row="L3"]').click()
    await expectText(page, 'LINE-C / POLISH / SRC-C · 003 / SOURCE-C')
    record('current-only Layer switch updates Backbone', (await currentOnly.getAttribute('aria-pressed')) === 'true' && (await metricText(page)).includes('행 2'))
    await currentOnly.click()
    await expectText(page, '행 6', page.locator('[data-testid="sheet-category-tabs"]'))

    phase = 'grid-identity-and-scroll'
    await page.waitForFunction(() => document.querySelector('#glide-cell-0-1') !== null)
    const repeatFacts = await page.evaluate(() => ({
      step0: document.querySelector('#glide-cell-0-0')?.textContent ?? null,
      step1: document.querySelector('#glide-cell-0-1')?.textContent ?? null,
      layer0: document.querySelector('#glide-cell-1-0')?.textContent ?? null,
      layer1: document.querySelector('#glide-cell-1-1')?.textContent ?? null,
    }))
    record('Step Seq/Layer repetition suppressed', repeatFacts.step0 === '010' && repeatFacts.step1 === '' && repeatFacts.layer0 === 'ETCH' && repeatFacts.layer1 === '', repeatFacts)
    await page.locator('#sheet-column-search').fill('PARAM_060')
    await page.locator('[data-testid="sheet-column-jump"]').click()
    await expectText(page, 'Parameter 060 컬럼으로 이동했습니다.')
    const horizontalScroll = await page.locator('.dvn-scroller').first().evaluate((element) => ({ scrollLeft: element.scrollLeft, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }))
    record('horizontal Parameter scrolling', horizontalScroll.scrollLeft > 0 && horizontalScroll.scrollWidth > horizontalScroll.clientWidth, horizontalScroll)
    await page.locator('.dvn-scroller').first().evaluate((element) => { element.scrollLeft = 0 })

    phase = 'cell-sync'
    await clickCanvasCell(page, 4, 2)
    await expectText(page, 'LINE-B / COATING / SRC-B · 002 / SOURCE-B')
    record('cell selection synchronizes navigator and Backbone', (await page.locator('[data-layer-row="L2"]').getAttribute('aria-current')) === 'true')

    phase = 'dirty-save-failure'
    await page.locator('#glide-cell-4-0').focus()
    await page.keyboard.press('Enter')
    const gridInput = page.locator('input[inputmode="decimal"]').first()
    await gridInput.waitFor({ state: 'visible' })
    await gridInput.fill('111')
    await gridInput.press('Enter')
    await expectText(page, '저장 실패', page.locator('[data-sheet-editing-status]'))
    record('dirty save failure surfaced and dirty retained', (await page.locator('[data-sheet-editing-status]').innerText()).includes('미저장 1'))
    failSaves = false
    phase = 'dirty-save-retry'
    await page.locator('[data-sheet-editing-status]').getByRole('button', { name: '재시도' }).click()
    await expectText(page, '저장됨', page.locator('[data-sheet-editing-status]'))
    record('dirty save retry commits', sheetRows.find((candidate) => candidate.condition_id === 101)?.cells.PARAM_001 === '111')

    phase = 'structural-failure'
    await clickCanvasCell(page, 2, 0)
    await expectText(page, '선택:', page.locator('[data-testid="condition-row-manager"]'))
    failNextStructural = true
    await page.locator('[data-testid="condition-add"]').click()
    await expectText(page, 'Fixture structural failure', page.locator('[data-testid="condition-error"]'))
    record('structural failure surfaced', true)

    phase = 'structural-success'
    await page.locator('[data-testid="condition-add"]').click()
    await expectText(page, '행 7', page.locator('[data-testid="sheet-category-tabs"]'))
    const addedId = nextConditionId - 1
    await page.waitForFunction(() => document.querySelector('[role="grid"]')?.getAttribute('aria-rowcount') === '8')
    await clickCanvasCell(page, 2, 2)
    await expectText(page, 'Condition 3', page.locator('[data-testid="condition-row-manager"]'))
    await page.locator('[data-testid="condition-duplicate"]').click()
    await expectText(page, '행 8', page.locator('[data-testid="sheet-category-tabs"]'))
    const duplicatedId = nextConditionId - 1
    await page.waitForFunction((targetId) => {
      const rowCount = document.querySelector('[role="grid"]')?.getAttribute('aria-rowcount')
      return rowCount === '9' && targetId === 901
    }, duplicatedId)
    await clickCanvasCell(page, 2, 3)
    await expectText(page, 'copy', page.locator('[data-testid="condition-row-manager"]'))
    await page.locator('[data-testid="condition-delete"]').click()
    await expectText(page, '행 7', page.locator('[data-testid="sheet-category-tabs"]'))
    record('add, duplicate, and non-POR delete', sheetRows.some((candidate) => candidate.condition_id === addedId) && !sheetRows.some((candidate) => candidate.condition_id === duplicatedId), { addedId, duplicatedId })

    phase = 'por-transfer'
    await clickCanvasCell(page, 3, 1)
    await page.waitForFunction(() => document.querySelector('#glide-cell-3-1')?.textContent === '●')
    record('POR transfer', sheetRows.find((candidate) => candidate.condition_id === 102)?.is_por === true && sheetRows.find((candidate) => candidate.condition_id === 101)?.is_por === false)
    await clickCanvasCell(page, 2, 1)
    phase = 'por-blocked-delete'
    await page.locator('[data-testid="condition-delete"]').click()
    await expectText(page, 'POR 조건 행은 다른 행에 POR을 지정한 후 삭제할 수 있다', page.locator('[data-testid="condition-error"]'))
    record('blocked POR delete preserves row', sheetRows.some((candidate) => candidate.condition_id === 102))

    phase = 'validation-jump'
    await page.locator('[data-layer-row="L3"]').click()
    if (await page.locator('[data-sheet-evidence-panel]').count() === 0) await page.locator('[data-testid="sheet-workbench-toggle"]').click()
    await page.locator('#sheet-workbench-tab-validation').click()
    const issue = page.locator('[data-validation-workbench] button[aria-label*="CMP (030)"]').first()
    if (await issue.count() === 0) {
      throw new Error(`Validation fixture issue absent: ${await page.locator('[data-validation-workbench]').innerText()}`)
    }
    await issue.click()
    await expectText(page, '대상 셀로 이동했습니다.')
    record('validation cell jump', (await page.locator('[data-layer-row="L3"]').getAttribute('aria-current')) === 'true')

    phase = 'history-jump'
    await page.locator('#sheet-workbench-tab-history').click()
    await expectText(page, 'Fixture history jump', page.locator('[data-history-workbench]'))
    await page.locator('[data-history-workbench]').getByRole('button', { name: '위치로 이동' }).click()
    await expectText(page, '대상 셀로 이동했습니다.')
    record('history cell jump', (await page.locator('[data-layer-row="L2"]').getAttribute('aria-current')) === 'true')

    phase = 'backbone-diff-jump'
    await page.locator('#sheet-workbench-tab-backbone-diff').click()
    const diff = page.getByRole('region', { name: '백본 비교 워크벤치' })
    await expectText(page, 'L3', diff)
    await diff.getByRole('button', { name: '열기' }).click()
    await diff.getByRole('button', { name: '셀 보기' }).click()
    const availableJump = diff.getByRole('button', { name: '위치로 이동' })
    await availableJump.waitFor({ state: 'visible' })
    await availableJump.click()
    await page.waitForFunction(() => document.querySelector('[data-layer-row="L3"]')?.getAttribute('aria-current') === 'true')
    record('Backbone-diff cell jump', (await page.locator('[data-layer-row="L3"]').getAttribute('aria-current')) === 'true')

    phase = 'readonly-lock'
    readonlyLock = true
    await page.reload()
    await expectText(page, '읽기 전용 · 편집 중: Review Owner', page.locator('[data-sheet-editing-status]'))
    record('read-only lock state', (await page.locator('[data-sheet-editor]').count()) === 1 && (await page.locator('[data-testid="condition-row-manager"]').count()) === 0)
    readonlyLock = false
    await page.locator('[data-sheet-editing-status]').getByRole('button', { name: '재시도' }).click()
    await expectText(page, '편집 잠금', page.locator('[data-sheet-editing-status]'))

    phase = 'browser-back-focus'
    await page.goto(`${baseUrl}/projects?query=LINE-SG`)
    await page.locator('[data-project-id="7"]').waitFor({ state: 'visible' })
    await page.locator('[data-project-id="7"]').click()
    await expectText(page, '조건표 열기')
    await page.goBack()
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-project-id') === '7')
    record('browser Back restores project-link focus', await page.evaluate(() => document.activeElement?.getAttribute('data-project-id') === '7'))

    phase = 'screenshots'
    const viewports = [
      { width: 1024, height: 768 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ]
    for (const viewport of viewports) {
      await page.setViewportSize(viewport)
      await page.goto(`${baseUrl}/projects/7/sheet`)
      await waitForSheet(page)
      await page.locator('[data-layer-row="L3"]').click()
      if (await page.locator('[data-sheet-evidence-panel]').count() === 0) await page.locator('[data-testid="sheet-workbench-toggle"]').click()
      await page.locator('#sheet-workbench-tab-validation').click()
      await page.locator('.dvn-scroller').first().evaluate((element) => { element.scrollLeft = 0 })
      const key = `${viewport.width}x${viewport.height}`
      measurements[key] = await page.evaluate(() => {
        const documentElement = document.documentElement
        const gridHost = document.querySelector('[data-sheet-grid-host]')
        const scroller = document.querySelector('.dvn-scroller')
        return {
          document: { clientWidth: documentElement.clientWidth, scrollWidth: documentElement.scrollWidth, overflowX: documentElement.scrollWidth - documentElement.clientWidth },
          gridHost: gridHost ? { clientWidth: gridHost.clientWidth, scrollWidth: gridHost.scrollWidth } : null,
          gridScroller: scroller ? { clientWidth: scroller.clientWidth, scrollWidth: scroller.scrollWidth, scrollLeft: scroller.scrollLeft } : null,
          activeLayer: document.querySelector('[data-layer-row][aria-current="true"]')?.getAttribute('data-layer-row') ?? null,
          backbone: Array.from(document.querySelectorAll('[data-testid="sheet-category-tabs"] span')).map((node) => node.textContent).find((text) => text?.includes('LINE-C')) ?? null,
        }
      })
      record(`document overflow bounded at ${key}`, measurements[key].document.overflowX === 0, measurements[key].document)
      record(`Grid owns horizontal overflow at ${key}`, measurements[key].gridScroller?.scrollWidth > measurements[key].gridScroller?.clientWidth, measurements[key].gridScroller)
      await page.screenshot({ path: path.join(reviewRoot, `signal-grid-condition-sheet-${viewport.width}.png`), fullPage: false })
    }

    const unexpectedConsole = consoleMessages.filter((entry) => !['dirty-save-failure', 'structural-failure', 'por-blocked-delete', 'readonly-lock'].includes(entry.phase))
    record('no page errors', pageErrors.length === 0, { pageErrors })
    record('no unexpected console errors/warnings', unexpectedConsole.length === 0, { unexpectedConsole })

    const results = {
      generatedAt: new Date().toISOString(),
      baseUrl,
      browser: { playwrightRoot, browserExecutable, version: require(path.join(playwrightRoot, 'package.json')).version },
      fixture: { projectId: 7, initialLayers: 3, initialRows: 6, parameters: 60, mutableInMemoryApi: true },
      assertions,
      measurements,
      consoleMessages,
      pageErrors,
      apiCalls,
    }
    fs.writeFileSync(resultPath, `${JSON.stringify(results, null, 2)}\n`)
  } finally {
    await context.close()
    await browser.close()
    try {
      process.kill(-preview.pid, 'SIGTERM')
    } catch {}
  }
}

runBrowser().catch(async (error) => {
  const pageHtml = debugPage && !debugPage.isClosed() ? await debugPage.content().catch(() => null) : null
  const failure = { error: error.stack ?? String(error), assertions, measurements, consoleMessages, pageErrors, pageHtml, apiCalls }
  fs.writeFileSync(resultPath, `${JSON.stringify(failure, null, 2)}\n`)
  process.stderr.write(`${error.stack ?? error}\n`)
  process.exitCode = 1
})
