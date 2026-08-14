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
const port = Number(process.env.PCM_FIXTURE_PORT ?? '4181')
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
  comment: 'Deterministic invalid-draft browser fixture',
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
  layer_total: '3',
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

const layerDefinitions = [
  layer(1, 'L1', '010', 'ETCH', 0, 101),
  layer(2, 'L2', '020', 'CVD', 1, 201),
  layer(3, 'L3', '030', 'CMP', 2, 301),
]

const project = {
  id: 7,
  line_id: 'LINE-SG',
  process_id: 'ETCH',
  part_id: 'PART-007',
  name: 'Signal Grid invalid draft lab',
  status: 'draft',
  version: 4,
  revision_root_id: 7,
  predecessor_project_id: null,
  successor_project_id: null,
  allowed_actions: ['request_review'],
  profile,
  layers: layerDefinitions,
}

const columns = Array.from({ length: 60 }, (_, index) => {
  const number = String(index + 1).padStart(3, '0')
  return {
    parameter_code: `PARAM_${number}`,
    display_name:
      index === 0 ? 'Chamber pressure' : index === 1 ? 'Endpoint time' : `Parameter ${number}`,
    value_type: 'number',
    category_code: index < 20 ? 'DEPOSITION' : index < 40 ? 'THERMAL' : 'METROLOGY',
    unit: index === 0 ? 'Torr' : index === 1 ? 's' : index % 3 === 0 ? '°C' : null,
    min_value: index === 0 ? '0' : index === 1 ? '1' : null,
    max_value: index === 0 ? '100' : index === 1 ? '300' : null,
    required: index === 1,
    pattern: null,
    pattern_hint: null,
    description: `Deterministic parameter ${number}`,
    choice_set_code: null,
    choice_set_version: null,
    sort_order: index + 1,
  }
})

const sheetRows = layerDefinitions.flatMap((definition, layerIndex) =>
  Array.from({ length: 6 }, (_, conditionIndex) =>
    row(
      definition.id * 100 + conditionIndex + 1,
      definition.layer_key,
      definition.step_seq,
      definition.layer_id,
      conditionIndex === 0 ? 'POR' : `Trial ${conditionIndex + 1}`,
      conditionIndex === 0,
      layerIndex,
      conditionIndex + 1,
    ),
  ),
)

let phase = 'bootstrap'
const apiCalls = []
const assertions = []
const consoleMessages = []
const pageErrors = []
const measurements = {}
let debugPage = null

function layer(id, layerKey, stepSeq, layerId, sortOrder, firstConditionId) {
  return {
    id,
    layer_key: layerKey,
    step_seq: stepSeq,
    layer_id: layerId,
    eqp_type: `${layerId}-EQP`,
    eqp_type_desc: `${layerId} equipment`,
    area_name: 'FAB-A',
    sort_order: sortOrder,
    condition_count: 6,
    cell_count: 360,
    source_project_id: null,
    source_layer_key: null,
    first_condition_id: firstConditionId,
  }
}

function row(id, layerKey, stepSeq, layerId, conditionLabel, isPor, layerSortOrder, conditionIndex) {
  const base = (id % 100) + 10
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
    cells: Object.fromEntries(
      columns.map((column, index) => [column.parameter_code, String(base + index)]),
    ),
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
    validation_basis_hash: 'sha256:invalid-draft-fixture-v1',
    comment_counts: [],
  }
}

function currentProject() {
  return {
    ...project,
    layers: project.layers.map((candidate) => ({ ...candidate })),
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
    device_type: profile.device_type,
    project_category: profile.project_category,
    layer_total: '3',
    updated_at: now,
    layer_count: 3,
    cell_count: sheetRows.length * columns.length,
  }
}

function json(route, status, body) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

function errorBody(code, message) {
  return { code, message, details: {}, request_id: 'fixture-request' }
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
  if (pathname === '/api/projects/7/sheet' && method === 'GET') return json(route, 200, currentSheet())
  if (pathname === '/api/projects/7/lock' && method === 'POST') {
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
  if (pathname === '/api/projects/7/lock' && method === 'DELETE') {
    return route.fulfill({ status: 204, body: '' })
  }
  if (pathname === '/api/projects/7/cells' && method === 'PATCH') {
    for (const cell of body.cells) {
      const target = sheetRows.find((candidate) => candidate.condition_id === cell.condition_id)
      if (target) target.cells[cell.parameter_code] = cell.value
    }
    return json(route, 200, { cells: body.cells, batch_id: 'fixture-batch' })
  }
  if (pathname === '/api/projects/7/validate' && method === 'POST') {
    return json(route, 200, {
      summary: { error_count: 0, warning_count: 0 },
      issues: [],
      evaluated_at: now,
      basis_hash: 'sha256:invalid-draft-fixture-v1',
      rule_versions: {},
    })
  }
  if (pathname === '/api/projects/7/events' && method === 'GET') {
    return json(route, 200, {
      items: [],
      coverage: { legacy_unresolved_layer_count: 0, legacy_detail_unavailable_count: 0 },
      next_cursor: null,
    })
  }
  if (pathname === '/api/projects/7/backbone-diff' && method === 'GET') {
    return json(route, 200, {
      scope: 'root-scope',
      basis_hash: 'fixture-basis',
      counts: {
        layer_count: 0,
        available_layer_count: 0,
        unavailable_layer_count: 0,
        row_count: 0,
        cell_count: 0,
        full_row_count: 0,
        full_cell_count: 0,
        ambiguous_lineage_count: 0,
        added_count: 0,
        changed_count: 0,
        cleared_count: 0,
        removed_count: 0,
        unchanged_count: 0,
      },
      layer_summaries: [],
      changed_preview: [],
    })
  }
  if (pathname === '/api/projects/7/comments' && method === 'GET') {
    return json(route, 200, { items: [], next_cursor: null })
  }

  return json(route, 404, errorBody('fixture_route_missing', `No fixture route for ${method} ${pathname}`))
}

function record(name, passed, details = {}) {
  assertions.push({ name, passed, ...details })
  if (!passed) throw new Error(`Assertion failed: ${name} ${JSON.stringify(details)}`)
}

async function waitForSheet(page) {
  await page.locator('[data-sheet-editor]').waitFor({ state: 'visible' })
  await page.locator('[data-sheet-editing-status]').filter({ hasText: '편집 잠금' }).waitFor({
    state: 'visible',
  })
  await page.locator('[data-testid="data-grid-canvas"]').first().waitFor({ state: 'visible' })
  await page.waitForFunction(() => document.querySelector('#glide-cell-4-0') !== null)
}

async function editCell(page, col, rowIndex, rawValue) {
  await clickCanvasCell(page, col, rowIndex)
  const editor = page.locator('#portal input:visible, #portal textarea:visible').last()
  if (!(await editor.isVisible())) await page.keyboard.press('Enter')
  await editor.waitFor({ state: 'visible' })
  await editor.fill(rawValue)
  await editor.press('Enter')
}

async function clickCanvasCell(page, col, rowIndex) {
  const geometry = await cellGeometry(page, col, rowIndex)
  await page.mouse.click(geometry.x + Math.min(geometry.width / 2, 36), geometry.y + geometry.height / 2)
}

async function cellGeometry(page, col, rowIndex) {
  return page.evaluate(({ col, rowIndex }) => {
    const scroller = document.querySelector('.dvn-scroller')
    if (!(scroller instanceof HTMLElement)) throw new Error('Grid scroller is unavailable')
    const rect = scroller.getBoundingClientRect()
    const starts = [0, 84, 204, 308, 372]
    const x = col < 4
      ? rect.left + starts[col]
      : rect.left + starts[4] + (col - 4) * 150 - scroller.scrollLeft
    return {
      x,
      y: rect.top + 34 + rowIndex * 32 - scroller.scrollTop,
      width: col === 0 ? 84 : col === 1 ? 120 : col === 2 ? 104 : col === 3 ? 64 : 150,
      height: 32,
    }
  }, { col, rowIndex })
}

async function markerPixelCount(page, col, rowIndex) {
  const geometry = await cellGeometry(page, col, rowIndex)
  return page.evaluate((cell) => {
    let count = 0
    for (const canvas of document.querySelectorAll('canvas')) {
      const rect = canvas.getBoundingClientRect()
      const left = Math.max(cell.x, rect.left)
      const top = Math.max(cell.y, rect.top)
      const right = Math.min(cell.x + cell.width, rect.right)
      const bottom = Math.min(cell.y + cell.height, rect.bottom)
      if (right <= left || bottom <= top) continue
      const context = canvas.getContext('2d')
      if (context === null) continue
      const scaleX = canvas.width / rect.width
      const scaleY = canvas.height / rect.height
      const x = Math.max(0, Math.floor((left - rect.left) * scaleX))
      const y = Math.max(0, Math.floor((top - rect.top) * scaleY))
      const width = Math.max(1, Math.min(canvas.width - x, Math.ceil((right - left) * scaleX)))
      const height = Math.max(1, Math.min(canvas.height - y, Math.ceil((bottom - top) * scaleY)))
      const pixels = context.getImageData(x, y, width, height).data
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index] > 145 && pixels[index + 1] < 70 && pixels[index + 2] < 70) count += 1
      }
    }
    return count
  }, geometry)
}

async function ensureBottomRowVisible(page, rowIndex) {
  await page.locator('.dvn-scroller').first().evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await page.waitForTimeout(120)
  await page.waitForFunction(
    ({ rowIndex }) => document.querySelector(`#glide-cell-4-${rowIndex}`) !== null,
    { rowIndex },
  )
}

async function viewportMeasurement(page, col, rowIndex) {
  const activeCell = await cellGeometry(page, col, rowIndex)
  const popover = await page.getByRole('alert').boundingBox()
  const facts = await page.evaluate(() => {
    const documentElement = document.documentElement
    const gridHost = document.querySelector('[data-sheet-grid-host]')
    const scroller = document.querySelector('.dvn-scroller')
    const alert = document.querySelector('[role="alert"]')
    const style = alert === null ? null : getComputedStyle(alert)
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      document: {
        clientWidth: documentElement.clientWidth,
        scrollWidth: documentElement.scrollWidth,
        overflowX: documentElement.scrollWidth - documentElement.clientWidth,
      },
      gridHost: gridHost === null ? null : {
        clientWidth: gridHost.clientWidth,
        scrollWidth: gridHost.scrollWidth,
      },
      gridScroller: scroller === null ? null : {
        clientWidth: scroller.clientWidth,
        scrollWidth: scroller.scrollWidth,
        clientHeight: scroller.clientHeight,
        scrollHeight: scroller.scrollHeight,
        scrollLeft: scroller.scrollLeft,
        scrollTop: scroller.scrollTop,
      },
      selectedCell: document.querySelector('[role="gridcell"][aria-selected="true"]')?.id ?? null,
      popoverPlacement: alert?.getAttribute('data-placement') ?? null,
      popoverColors: style === null ? null : {
        color: style.color,
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor,
      },
    }
  })
  return {
    ...facts,
    activeCell,
    popover,
    popoverInsideViewport:
      popover !== null &&
      popover.x >= 0 &&
      popover.y >= 0 &&
      popover.x + popover.width <= facts.viewport.width &&
      popover.y + popover.height <= facts.viewport.height,
    markerPixels: await markerPixelCount(page, col, rowIndex),
  }
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
    record('page identity', page.url() === `${baseUrl}/projects/7/sheet`, {
      url: page.url(),
      title: await page.title(),
    })
    record('not blank / no framework overlay', await page.locator('[data-sheet-focus-frame]').count() === 1)

    phase = 'invalid-numeric-form'
    await editCell(page, 4, 0, '1e3')
    const invalidAlert = page.getByRole('alert')
    await invalidAlert.waitFor({ state: 'visible' })
    const firstAccessibleText = await page.locator('#glide-cell-4-0').innerText()
    const firstAlertText = await invalidAlert.innerText()
    const firstMarkerPixels = await markerPixelCount(page, 4, 0)
    record(
      'invalid numeric raw value remains visible',
      firstAlertText.includes('1e3'),
      { firstAlertText, firstAccessibleText },
    )
    record('invalid numeric marker is painted', firstMarkerPixels > 0, { firstMarkerPixels })
    record(
      'invalid numeric popover explains problem and repair',
      firstAlertText.includes('Chamber pressure') &&
        firstAlertText.includes('숫자로 입력하세요') &&
        firstAlertText.includes('저장되지 않음'),
      { firstAlertText },
    )
    record(
      'invalid numeric sends zero PATCH calls',
      apiCalls.filter((call) => call.method === 'PATCH').length === 0,
    )

    phase = 'move-away'
    await clickCanvasCell(page, 5, 0)
    await invalidAlert.waitFor({ state: 'hidden' })
    await page.waitForFunction(
      () => document.querySelector('#glide-cell-4-0')?.textContent?.includes('숫자로 입력하세요'),
    )
    const retainedAccessibleText = await page.locator('#glide-cell-4-0').innerText()
    const retainedMarkerPixels = await markerPixelCount(page, 4, 0)
    record(
      'moving away closes popover but keeps raw draft and marker',
      retainedAccessibleText.includes('숫자로 입력하세요') &&
        retainedAccessibleText.includes('저장되지 않음') &&
        retainedMarkerPixels > 0,
      { retainedAccessibleText, retainedMarkerPixels },
    )

    phase = 'return-to-invalid'
    await clickCanvasCell(page, 4, 0)
    await invalidAlert.waitFor({ state: 'visible' })
    record('returning to invalid cell reopens popover', (await invalidAlert.innerText()).includes('1e3'))

    phase = 'range-and-required'
    await editCell(page, 4, 0, '999')
    await page.waitForFunction(
      () => document.querySelector('#glide-cell-4-0')?.textContent?.includes('허용 범위를 벗어났습니다'),
    )
    await invalidAlert.waitFor({ state: 'visible' })
    const rangeAlertText = await invalidAlert.innerText()
    record(
      'out-of-range draft provides repair copy',
      rangeAlertText.includes('허용 범위를 벗어났습니다') &&
        rangeAlertText.includes('0–100 Torr 범위로 입력하세요'),
      { rangeAlertText },
    )
    await editCell(page, 5, 0, '')
    await invalidAlert.waitFor({ state: 'visible' })
    const requiredAlertText = await invalidAlert.innerText()
    record(
      'required draft provides repair copy',
      requiredAlertText.includes('Endpoint time') &&
        requiredAlertText.includes('필수값을 입력하세요') &&
        requiredAlertText.includes('저장되지 않음'),
      { requiredAlertText },
    )

    phase = 'correct-one-draft'
    await editCell(page, 4, 0, '55')
    await page.waitForFunction(() => document.querySelector('[data-sheet-editing-status]')?.textContent?.includes('미저장 1'))
    await page.waitForFunction(() => document.querySelector('[data-sheet-editing-status]')?.textContent?.includes('저장됨'), null, { timeout: 8_000 })
    await page.waitForFunction(
      () => document.querySelector('#glide-cell-5-0')?.textContent?.includes('필수값을 입력하세요'),
    )
    const patchCalls = apiCalls.filter((call) => call.method === 'PATCH')
    const requiredRawAfterCorrection = await page.locator('#glide-cell-5-0').innerText()
    record(
      'one valid correction sends exactly one PATCH and leaves the other draft',
      patchCalls.length === 1 &&
        patchCalls[0].body.cells.length === 1 &&
        patchCalls[0].body.cells[0].parameter_code === 'PARAM_001' &&
        requiredRawAfterCorrection.includes('필수값을 입력하세요'),
      { patchCalls, requiredRawAfterCorrection },
    )

    phase = 'cancel-navigation'
    page.once('dialog', (dialog) => dialog.dismiss())
    await page.getByRole('link', { name: 'PCM 프로젝트 목록' }).click()
    await page.waitForTimeout(100)
    const cancelledDraftText = await page.locator('#glide-cell-5-0').innerText()
    record(
      'cancelled route navigation preserves invalid draft',
      page.url() === `${baseUrl}/projects/7/sheet` &&
        cancelledDraftText.includes('필수값을 입력하세요'),
      { url: page.url(), cancelledDraftText },
    )

    phase = 'confirm-navigation'
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('link', { name: 'PCM 프로젝트 목록' }).click()
    await page.waitForURL(`${baseUrl}/projects`)
    await page.locator('[data-project-id="7"]').click()
    await page.getByRole('link', { name: '조건표 열기' }).click()
    await waitForSheet(page)
    const restoredRequiredText = await page.locator('#glide-cell-5-0').innerText()
    record(
      'confirmed departure discards draft and re-entry restores server value',
      restoredRequiredText.includes('12'),
      { restoredRequiredText },
    )

    phase = 'bottom-popover'
    const bottomRowIndex = sheetRows.length - 1
    await ensureBottomRowVisible(page, bottomRowIndex)
    await editCell(page, 4, bottomRowIndex, '1e3')
    await invalidAlert.waitFor({ state: 'visible' })
    record(
      'bottom-visible invalid edit flips popover above',
      await invalidAlert.getAttribute('data-placement') === 'above',
      { placement: await invalidAlert.getAttribute('data-placement') },
    )
    await page.waitForFunction(
      ({ bottomRowIndex }) =>
        document.querySelector(`#glide-cell-4-${bottomRowIndex}`)?.textContent?.includes('숫자로 입력하세요'),
      { bottomRowIndex },
    )
    const accessibleDescription = await page.locator(`#glide-cell-4-${bottomRowIndex}`).innerText()
    record(
      'accessible description includes coordinate reason and unsaved state',
      accessibleDescription.includes('Trial 6') &&
        accessibleDescription.includes('Chamber pressure') &&
        accessibleDescription.includes('숫자로 입력하세요') &&
        accessibleDescription.includes('저장되지 않음'),
      { accessibleDescription },
    )

    phase = 'viewport-batch'
    const viewports = [
      { width: 1024, height: 768 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ]
    for (const viewport of viewports) {
      await page.setViewportSize(viewport)
      await ensureBottomRowVisible(page, bottomRowIndex)
      const selectedCellId = await page.locator('[role="gridcell"][aria-selected="true"]').getAttribute('id')
      if (selectedCellId !== `glide-cell-4-${bottomRowIndex}`) {
        await clickCanvasCell(page, 4, bottomRowIndex)
      }
      await invalidAlert.waitFor({ state: 'visible' })
      const key = `${viewport.width}x${viewport.height}`
      measurements[key] = await viewportMeasurement(page, 4, bottomRowIndex)
      record(
        `document overflow bounded at ${key}`,
        measurements[key].document.overflowX === 0,
        measurements[key].document,
      )
      record(
        `Grid owns horizontal overflow at ${key}`,
        measurements[key].gridScroller?.scrollWidth > measurements[key].gridScroller?.clientWidth,
        measurements[key].gridScroller,
      )
      record(
        `active invalid cell remains selected and marked at ${key}`,
        measurements[key].selectedCell === `glide-cell-4-${bottomRowIndex}` &&
          measurements[key].markerPixels > 0,
        {
          selectedCell: measurements[key].selectedCell,
          markerPixels: measurements[key].markerPixels,
          activeCell: measurements[key].activeCell,
        },
      )
      record(
        `popover stays inside viewport at ${key}`,
        ['above', 'below'].includes(measurements[key].popoverPlacement) &&
          measurements[key].popoverInsideViewport,
        {
          popoverPlacement: measurements[key].popoverPlacement,
          popover: measurements[key].popover,
          popoverInsideViewport: measurements[key].popoverInsideViewport,
        },
      )
      await page.screenshot({
        path: path.join(reviewRoot, `condition-cell-invalid-draft-${viewport.width}.png`),
        fullPage: false,
      })
    }

    record('no page errors', pageErrors.length === 0, { pageErrors })
    const unexpectedConsole = consoleMessages.filter(
      (entry) => !entry.text.includes('Multiple readback operations using getImageData'),
    )
    record('no unexpected console errors/warnings', unexpectedConsole.length === 0, {
      expectedFixtureConsole: consoleMessages.filter((entry) => !unexpectedConsole.includes(entry)),
      unexpectedConsole,
    })
    record(
      'fixture makes exactly one persistence call overall',
      apiCalls.filter((call) => call.method === 'PATCH').length === 1,
    )

    const results = {
      generatedAt: new Date().toISOString(),
      baseUrl,
      browser: {
        playwrightRoot,
        browserExecutable,
        version: require(path.join(playwrightRoot, 'package.json')).version,
      },
      fixture: {
        projectId: 7,
        layers: 3,
        rows: sheetRows.length,
        parameters: columns.length,
        mutableInMemoryApi: true,
      },
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
  const failure = {
    error: error.stack ?? String(error),
    assertions,
    measurements,
    consoleMessages,
    pageErrors,
    pageHtml,
    apiCalls,
  }
  fs.writeFileSync(resultPath, `${JSON.stringify(failure, null, 2)}\n`)
  process.stderr.write(`${error.stack ?? error}\n`)
  process.exitCode = 1
})
