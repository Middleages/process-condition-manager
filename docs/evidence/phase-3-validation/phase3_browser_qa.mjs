#!/usr/bin/env node

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { chromium } = require('/home/appuser/.npm/_npx/fd3bca3c548369c0/node_modules/playwright')
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../../..')
const OUTPUT = HERE
const SCREENSHOTS = path.join(OUTPUT, 'screenshots')
const ARIA = path.join(OUTPUT, 'aria')
const BASE_URL = (process.env.PHASE3_BASE_URL ?? 'http://127.0.0.1:15175').replace(/\/$/, '')
const API_URL = (process.env.PHASE3_API_URL ?? 'http://127.0.0.1:18002/api').replace(/\/$/, '')
const CHROMIUM_PATH = process.env.PHASE3_CHROMIUM_PATH ?? '/home/appuser/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome'
const VIEWPORTS = [
  { name: '1024x768', width: 1024, height: 768, columns: 3 },
  { name: '1440x900', width: 1440, height: 900, columns: 4 },
  { name: '1920x1080', width: 1920, height: 1080, columns: 5 },
]
const RUNTIME_SOURCE_PATHS = [
  'frontend/src/features/sheets/useSheetEditing.ts',
  'frontend/src/features/sheets/ValidationWorkbench.tsx',
  'frontend/src/features/sheets/validationState.ts',
  'frontend/src/grid/GlideConditionGrid.tsx',
]
const fixture = JSON.parse(await readFile(path.join(OUTPUT, 'fixture.json'), 'utf8'))
const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
const startedAt = new Date().toISOString()
const consoleEntries = []
const networkEntries = []
const observations = {}
const screenshots = []
const ariaArtifacts = []
let browser

function sha256(data) {
  return createHash('sha256').update(data).digest('hex')
}

function now() {
  return new Date().toISOString()
}

function isDeliberateConsoleResourceError(entry) {
  if (entry.type !== 'error' || !/Failed to load resource:.*503 \(Service Unavailable\)/.test(entry.text)) return false
  const locationUrl = entry.location?.url
  if (typeof locationUrl !== 'string' || locationUrl.length === 0) return false
  const pathname = new URL(locationUrl).pathname
  return (
    (entry.scenario === 'lifecycle' && pathname.endsWith('/cells')) ||
    (entry.scenario === 'issues-1440x900' && pathname.endsWith('/validate')) ||
    (entry.scenario === 'configuration-unavailable' && pathname.includes(`/choice-sets/${fixture.choice_set_code}/options`))
  )
}

function apiPath(relative) {
  return `${API_URL}${relative}`
}

async function api(relative, { method = 'GET', body, headers = {}, expected = [200] } = {}) {
  const url = apiPath(relative)
  const requestBody = body === undefined ? undefined : JSON.stringify(body)
  const began = performance.now()
  const response = await fetch(url, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    body: requestBody,
  })
  const text = await response.text()
  networkEntries.push({
    at: now(), scenario: 'fixture-api', phase: 'response', method, url,
    path: new URL(url).pathname, status: response.status,
    elapsed_ms: Number((performance.now() - began).toFixed(3)),
    request_body_sha256: requestBody === undefined ? null : sha256(requestBody),
    response_body_sha256: sha256(text), deliberate_failure: false,
  })
  assert(expected.includes(response.status), `${method} ${relative}: ${response.status} ${text}`)
  if (response.status === 204 || text === '') return null
  return JSON.parse(text)
}

function observePage(page, scenario) {
  page.on('console', (message) => {
    consoleEntries.push({
      at: now(), scenario, type: message.type(), text: message.text(), location: message.location(),
    })
  })
  page.on('pageerror', (error) => {
    consoleEntries.push({ at: now(), scenario, type: 'pageerror', text: error.message })
  })
  page.on('requestfailed', (request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/')) {
      networkEntries.push({
        at: now(), scenario, phase: 'requestfailed', method: request.method(), url: request.url(),
        path: url.pathname, status: null, failure: request.failure()?.errorText ?? 'unknown',
        deliberate_failure: false,
      })
    }
  })
  page.on('response', (response) => {
    const url = new URL(response.url())
    if (!url.pathname.startsWith('/api/')) return
    const status = response.status()
    const deliberate =
      status === 503 && (
        (scenario === 'lifecycle' && url.pathname.endsWith('/cells')) ||
        (scenario === 'issues-1440x900' && url.pathname.endsWith('/validate')) ||
        (scenario === 'configuration-unavailable' && url.pathname.includes('/choice-sets/qa_validation_choices/options'))
      )
    networkEntries.push({
      at: now(), scenario, phase: 'response', method: response.request().method(),
      url: response.url(), path: url.pathname, status, deliberate_failure: deliberate,
    })
  })
}

async function newPage(scenario, viewport = VIEWPORTS[1]) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    locale: 'ko-KR',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    permissions: ['clipboard-read', 'clipboard-write'],
  })
  const page = await context.newPage()
  observePage(page, scenario)
  return { context, page }
}

async function screenshot(page, name) {
  const file = path.join(SCREENSHOTS, name)
  await page.screenshot({ path: file, animations: 'disabled' })
  const bytes = await readFile(file)
  const artifact = { file: path.relative(OUTPUT, file), bytes: bytes.length, sha256: sha256(bytes) }
  screenshots.push(artifact)
  return artifact
}

async function ariaSnapshot(locator, name) {
  const content = `${(await locator.ariaSnapshot()).trim()}\n`
  const file = path.join(ARIA, name)
  await writeFile(file, content)
  const artifact = { file: path.relative(OUTPUT, file), bytes: Buffer.byteLength(content), sha256: sha256(content) }
  ariaArtifacts.push(artifact)
  return artifact
}

async function waitForSheet(page) {
  await page.goto(`${BASE_URL}/projects/${fixture.project_id}/sheet`, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-testid="sheet-view-grid"]').waitFor({ timeout: 30_000 })
  await page.waitForFunction(() => document.querySelector('[data-testid="sheet-view-grid"] canvas'))
  await page.waitForFunction(() => (document.querySelector('[data-testid="sheet-view-grid"]')?.clientHeight ?? 0) > 100)
  await page.getByText('편집 잠금', { exact: true }).waitFor({ timeout: 30_000 })
  await page.waitForTimeout(400)
}

async function closeAndUnlock(context, page) {
  // Keep the browser context alive while pagehide/beforeunload sends the lock-release beacon.
  // Closing the context first can kill that best-effort request and would make later scenarios
  // wait for the intentional TTL safety net instead of exercising an isolated session.
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' })
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const sheet = await api(`/projects/${fixture.project_id}/sheet`)
    if (sheet.lock.locked_by === null) {
      await context.close()
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error('browser context did not release its isolated edit lock')
}

async function gridPoint(page, parameterIndex, rowIndex = 0) {
  const box = await page.locator('[data-testid="sheet-view-grid"]').boundingBox()
  assert(box, 'grid bounds unavailable')
  return {
    x: box.x + 190 + 84 + 96 + parameterIndex * 150 + 75,
    y: box.y + 34 + rowIndex * 32 + 16,
  }
}

async function assertGridFocus(page) {
  await page.waitForFunction(() => {
    const active = document.activeElement
    const grid = document.querySelector('[data-testid="sheet-view-grid"]')
    return grid?.contains(active) === true &&
      (active?.tagName === 'CANVAS' || active?.getAttribute('role') === 'gridcell')
  }, null, { timeout: 8_000 })
  return page.evaluate(() => ({
    tag: document.activeElement?.tagName ?? null,
    role: document.activeElement?.getAttribute('role') ?? null,
    in_grid: document.querySelector('[data-testid="sheet-view-grid"]')?.contains(document.activeElement) ?? false,
  }))
}

async function editDecimal(page, point, value) {
  await page.mouse.dblclick(point.x, point.y)
  const input = page.locator('input[inputmode="decimal"]')
  await input.waitFor({ timeout: 10_000 })
  await input.fill(value)
  await input.press('Enter')
  await input.waitFor({ state: 'detached', timeout: 10_000 })
}

async function waitForStrip(page, text) {
  await page.locator('[data-testid="validation-summary-strip"]').filter({ hasText: text }).waitFor({ timeout: 20_000 })
}

async function lifecycleScenario(sheet) {
  const { context, page } = await newPage('lifecycle')
  await waitForSheet(page)
  const idle = await page.evaluate(() => {
    const frame = document.querySelector('[data-sheet-focus-frame]')
    const grid = document.querySelector('[data-sheet-grid-host]')
    const frameStyle = frame ? getComputedStyle(frame) : null
    return {
      sheet_workbench_count: document.querySelectorAll('[data-sheet-workbench]').length,
      validation_workbench_count: document.querySelectorAll('[data-validation-workbench]').length,
      frame_height: frame?.getBoundingClientRect().height ?? null,
      grid_height: grid?.getBoundingClientRect().height ?? null,
      computed_grid_rows: frameStyle?.gridTemplateRows ?? null,
      document_horizontal_overflow: document.documentElement.scrollWidth > innerWidth,
    }
  })
  assert.equal(idle.sheet_workbench_count, 0)
  assert.equal(idle.validation_workbench_count, 0)
  assert.equal(idle.document_horizontal_overflow, false)
  const zeroBefore = await screenshot(page, 'zero-before-explicit-1440x900.png')

  await page.locator('main#main-content').focus()
  let validationTabSteps = null
  const focusTrail = []
  for (let step = 1; step <= 30; step += 1) {
    await page.keyboard.press('Tab')
    const active = await page.evaluate(() => ({
      testid: document.activeElement?.getAttribute('data-testid') ?? null,
      text: document.activeElement?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 80) ?? null,
    }))
    focusTrail.push(active)
    if (active.testid === 'sheet-explicit-validation') {
      validationTabSteps = step
      break
    }
  }
  assert(validationTabSteps !== null, '검증 button was not keyboard discoverable')
  await page.keyboard.press('Enter')
  await waitForStrip(page, '검증 완료 · 문제 없음')
  const success = await page.evaluate(() => {
    const host = document.querySelector('[data-sheet-workbench]')
    const workbench = document.querySelector('[data-validation-workbench]')
    const strip = document.querySelector('[data-testid="validation-summary-strip"]')
    return {
      host_height: host?.getBoundingClientRect().height ?? null,
      workbench_height: workbench?.getBoundingClientRect().height ?? null,
      strip_height: strip?.getBoundingClientRect().height ?? null,
      strip_text: strip?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
      green_surface: strip?.className.includes('bg-success-surface') ?? false,
    }
  })
  assert(success.strip_height >= 28 && success.strip_height <= 32)
  assert.match(success.strip_text, /오류 0.*경고 0.*검증 완료 · 문제 없음/)
  const zeroSuccess = await screenshot(page, 'zero-success-1440x900.png')
  const zeroAria = await ariaSnapshot(page.locator('main#main-content'), 'zero-success-main.yaml')

  const rangeColumn = sheet.columns.findIndex((column) => column.parameter_code === 'qa_range')
  const rangeRow = sheet.rows.findIndex((row) => row.condition_id === fixture.conditions.l1_r2)
  assert(rangeColumn >= 0 && rangeRow >= 0)
  const point = await gridPoint(page, rangeColumn, rangeRow)
  let releasePatch
  const patchGate = new Promise((resolve) => { releasePatch = resolve })
  let heldPatch = false
  let heldPatchRequestAt = null
  let heldPatchResponseAt = null
  page.on('response', (response) => {
    if (
      heldPatchResponseAt === null &&
      response.request().method() === 'PATCH' &&
      new URL(response.url()).pathname.endsWith('/cells')
    ) {
      heldPatchResponseAt = Date.now()
    }
  })
  await page.route(`**/api/projects/${fixture.project_id}/cells`, async (route) => {
    if (route.request().method() !== 'PATCH' || heldPatch) return route.continue()
    heldPatch = true
    heldPatchRequestAt = Date.now()
    await patchGate
    await route.continue()
  })

  await editDecimal(page, point, '99')
  await waitForStrip(page, '로컬 임시 결과 · 서버 확인 대기')
  const lifecycleExpand = page.getByRole('button', { name: '펼치기', exact: true })
  await lifecycleExpand.focus()
  await lifecycleExpand.press('Enter')
  await page.getByRole('button', { name: /오류.*노광량.*20 이하/ }).waitFor({ timeout: 10_000 })
  await page.mouse.move(1, 1)
  await page.mouse.move(point.x, point.y)
  const tooltip = page.locator('[data-testid="header-tooltip"]')
  await tooltip.waitFor({ timeout: 10_000 })
  const dirtyValidationTooltip = (await tooltip.textContent())?.replace(/\s+/g, ' ').trim()
  assert.match(dirtyValidationTooltip, /오류 1건/)
  assert.match(dirtyValidationTooltip, /저장되지 않은 변경/)

  const explicit = page.locator('[data-testid="sheet-explicit-validation"]')
  await explicit.focus()
  await explicit.press('Enter')
  await waitForStrip(page, '저장 완료를 기다리는 중')
  releasePatch()
  await page.waitForFunction(() => document.querySelector('[data-sheet-editing-status]')?.textContent?.includes('저장됨'), null, { timeout: 15_000 })
  await waitForStrip(page, '서버 확인됨')
  assert(heldPatchResponseAt !== null)
  const validateResponses = networkEntries.filter((entry) => entry.scenario === 'lifecycle' && entry.path?.endsWith('/validate') && entry.status === 200)
  assert(validateResponses.length >= 2)
  const authoritativeIssue = await screenshot(page, 'range-authoritative-1440x900.png')
  await page.unroute(`**/api/projects/${fixture.project_id}/cells`)

  await editDecimal(page, point, '15')
  await page.waitForFunction(() => ![...document.querySelectorAll('[data-validation-workbench] button[aria-label]')].some((node) => node.getAttribute('aria-label')?.includes('노광량')))
  const provisionalCorrectionAt = Date.now()
  await page.waitForFunction(() => document.querySelector('[data-sheet-editing-status]')?.textContent?.includes('저장됨'), null, { timeout: 15_000 })
  await waitForStrip(page, '검증 완료 · 문제 없음')
  const correction = await screenshot(page, 'range-corrected-1440x900.png')

  const failureSentinel = 'RAW_PERSISTENCE_SENTINEL [A-Z]{99} SELECT * FROM secret'
  let persistenceFailures = 0
  await page.route(`**/api/projects/${fixture.project_id}/cells`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue()
    persistenceFailures += 1
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'qa_forced_persistence_failure', message: failureSentinel }),
    })
  })
  await editDecimal(page, point, '99')
  await page.getByRole('button', { name: /오류.*노광량.*20 이하/ }).waitFor({ timeout: 10_000 })
  await page.waitForFunction(() => document.querySelector('[data-sheet-editing-status]')?.textContent?.includes('실패'), null, { timeout: 15_000 })
  await explicit.focus()
  await explicit.press('Enter')
  await waitForStrip(page, '저장 후 검증해 주세요.')
  await page.locator('[data-testid="sheet-view-grid"] canvas').first().focus()
  await assertGridFocus(page)
  await page.evaluate(() => navigator.clipboard.writeText(''))
  await page.keyboard.press('Control+C')
  const preservedClipboard = (await page.evaluate(() => navigator.clipboard.readText())).trim()
  assert.equal(preservedClipboard, '99')
  const persistenceFailure = await screenshot(page, 'persistence-failure-preserves-edit-1440x900.png')
  const renderedText = await page.locator('main#main-content').innerText()
  assert.equal(renderedText.includes(failureSentinel), false)
  await page.unroute(`**/api/projects/${fixture.project_id}/cells`)
  await page.getByRole('button', { name: '재시도', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[data-sheet-editing-status]')?.textContent?.includes('저장됨'), null, { timeout: 15_000 })

  observations.lifecycle = {
    idle,
    keyboard_validation_button: { tab_steps: validationTabSteps, focus_trail: focusTrail },
    success,
    immediate_edit: {
      value: '99', provisional_issue_before_persistence: true,
      patch_was_held: heldPatch, patch_request_at_epoch_ms: heldPatchRequestAt,
      patch_response_at_epoch_ms: heldPatchResponseAt,
      dirty_validation_tooltip: dirtyValidationTooltip,
      explicit_waited_for_persistence: true,
      server_confirmed_issue: true,
    },
    correction: {
      value: '15', provisional_clear_at_epoch_ms: provisionalCorrectionAt,
      server_confirmed_zero: true,
    },
    failed_persistence: {
      injected_503_count: persistenceFailures,
      exact_guidance: '저장 후 검증해 주세요.',
      preserved_clipboard_value: preservedClipboard,
      raw_sentinel_rendered: false,
      retry_after_capture_saved_edit: true,
    },
    artifacts: [zeroBefore, zeroSuccess, zeroAria, authoritativeIssue, correction, persistenceFailure],
  }
  await closeAndUnlock(context, page)
}

async function createIssues() {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const sheet = await api(`/projects/${fixture.project_id}/sheet`)
    if (sheet.lock.locked_by === null) break
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  const lock = await api(`/projects/${fixture.project_id}/lock`, { method: 'POST' })
  const patch = await api(`/projects/${fixture.project_id}/cells`, {
    method: 'PATCH',
    headers: { 'x-lock-token': lock.lock_token },
    body: {
      origin: 'manual',
      cells: [
        { condition_id: fixture.conditions.l1_r1, parameter_code: 'qa_required', value: null },
        { condition_id: fixture.conditions.l1_r2, parameter_code: 'qa_range', value: '99' },
        { condition_id: fixture.conditions.l2_r1, parameter_code: 'qa_pattern', value: 'bad' },
        { condition_id: fixture.conditions.l2_r1, parameter_code: 'qa_source', value: 'MISSING' },
        { condition_id: fixture.conditions.l2_r2, parameter_code: 'qa_trigger', value: 'Y' },
        { condition_id: fixture.conditions.l2_r2, parameter_code: 'qa_target', value: null },
      ],
    },
  })
  await api(`/projects/${fixture.project_id}/lock`, {
    method: 'DELETE', body: { lock_token: lock.lock_token }, expected: [204],
  })
  const choiceMutation = await api(`/choice-sets/${fixture.choice_set_code}/options/${fixture.stored_choice_to_deactivate}`, {
    method: 'PATCH', body: { expected_version: 1, is_active: false },
  })
  const validation = await api(`/projects/${fixture.project_id}/validate`, { method: 'POST' })
  assert.deepEqual(validation.summary, { error_count: 5, warning_count: 1 })
  assert.equal(validation.issues.length, 6)
  const sheet = await api(`/projects/${fixture.project_id}/sheet`)
  const parameters = await api('/parameters')
  const rules = await api('/validation-rules')
  await writeFile(path.join(OUTPUT, 'fixture-sheet.json'), `${JSON.stringify(sheet, null, 2)}\n`)
  await writeFile(path.join(OUTPUT, 'fixture-validation.json'), `${JSON.stringify(validation, null, 2)}\n`)
  await writeFile(path.join(OUTPUT, 'fixture-parameters.json'), `${JSON.stringify(parameters, null, 2)}\n`)
  await writeFile(path.join(OUTPUT, 'fixture-rules.json'), `${JSON.stringify(rules, null, 2)}\n`)
  observations.fixture_mutation = {
    patch_cell_count: patch.cells.length,
    choice_set_version_after_deactivation: choiceMutation.choice_set.version,
    stored_inactive_choice: choiceMutation.option,
    summary: validation.summary,
    issue_codes: validation.issues.map((issue) => issue.code),
    basis_hash: validation.basis_hash,
    rule_versions: validation.rule_versions,
    sheet_basis_matches: sheet.validation_basis_hash === validation.basis_hash,
  }
  assert.equal(observations.fixture_mutation.sheet_basis_matches, true)
}

async function expandedLayout(page, viewport) {
  const expand = page.getByRole('button', { name: '펼치기', exact: true })
  await expand.focus()
  await expand.press('Enter')
  const collapse = page.getByRole('button', { name: '접기', exact: true })
  await collapse.waitFor()
  assert.equal(await collapse.getAttribute('aria-expanded'), 'true')
  const layout = await page.evaluate(() => {
    const workbench = document.querySelector('[data-validation-workbench]')
    const grid = workbench?.querySelector('.grid')
    const tiles = [...(grid?.querySelectorAll('button[aria-label]') ?? [])]
    const gridStyle = grid ? getComputedStyle(grid) : null
    const issueScroller = grid?.parentElement
    const body = document.body
    return {
      computed_grid_template_columns: gridStyle?.gridTemplateColumns ?? null,
      computed_column_count: (gridStyle?.gridTemplateColumns ?? '').split(/\s+/).filter(Boolean).length,
      tile_heights: tiles.map((tile) => Number(tile.getBoundingClientRect().height.toFixed(3))),
      tile_count: tiles.length,
      grid_client_width: grid?.clientWidth ?? null,
      grid_scroll_width: grid?.scrollWidth ?? null,
      workbench_client_width: workbench?.clientWidth ?? null,
      workbench_scroll_width: workbench?.scrollWidth ?? null,
      issue_scroller_overflow_y: issueScroller ? getComputedStyle(issueScroller).overflowY : null,
      document_horizontal_overflow: document.documentElement.scrollWidth > innerWidth,
      body_horizontal_overflow: body.scrollWidth > body.clientWidth,
    }
  })
  assert.equal(layout.computed_column_count, viewport.columns)
  assert.equal(layout.tile_count, 6)
  assert(layout.tile_heights.every((height) => height >= 48 && height <= 52))
  assert.equal(layout.document_horizontal_overflow, false)
  assert.equal(layout.body_horizontal_overflow, false)
  assert(layout.grid_scroll_width <= layout.grid_client_width + 1)
  assert(layout.workbench_scroll_width <= layout.workbench_client_width + 1)
  return layout
}

async function exercise1440(page) {
  const workbench = page.locator('[data-validation-workbench]')
  const errorFilter = workbench.getByRole('button', { name: '오류 5', exact: true })
  const warningFilter = workbench.getByRole('button', { name: '경고 1', exact: true })
  const countStatus = workbench.getByText(/표시 \d+ \/ 전체 6/, { exact: true })
  const filterStates = []
  async function captureFilter(label) {
    filterStates.push({
      label,
      errors: await errorFilter.getAttribute('aria-pressed'),
      warnings: await warningFilter.getAttribute('aria-pressed'),
      count: (await countStatus.textContent())?.trim(),
    })
  }
  await captureFilter('initial')
  await errorFilter.focus(); await errorFilter.press('Space'); await captureFilter('errors-off')
  await warningFilter.focus(); await warningFilter.press('Space'); await captureFilter('both-off')
  await errorFilter.focus(); await errorFilter.press('Space'); await captureFilter('errors-on')
  await warningFilter.focus(); await warningFilter.press('Space'); await captureFilter('both-on')
  assert.deepEqual(filterStates.map((state) => state.count), [
    '표시 6 / 전체 6', '표시 1 / 전체 6', '표시 0 / 전체 6', '표시 5 / 전체 6', '표시 6 / 전체 6',
  ])

  const priorTile = workbench.getByRole('button', { name: /오류.*현재 마스크.*앞선 레이어.*앞선 POR 값을 추가하거나 현재 값을 수정/ })
  const priorLabel = await priorTile.getAttribute('aria-label')
  const priorTitle = await priorTile.getAttribute('title')
  const beforeHeight = (await priorTile.boundingBox()).height
  await priorTile.focus(); await priorTile.press('Enter')
  assert.equal(await priorTile.getAttribute('aria-expanded'), 'true')
  const afterEnterHeight = (await priorTile.boundingBox()).height
  await priorTile.focus(); await priorTile.press('Space')
  assert.equal(await priorTile.getAttribute('aria-expanded'), 'false')
  assert.match(priorLabel, /앞선 POR 값을 추가하거나 현재 값을 수정/)
  assert.match(priorTitle, /앞선 POR 값을 추가하거나 현재 값을 수정/)

  const separator = workbench.getByRole('separator', { name: '검증 패널 높이 조절' })
  const separatorInitial = {
    orientation: await separator.getAttribute('aria-orientation'),
    min: Number(await separator.getAttribute('aria-valuemin')),
    max: Number(await separator.getAttribute('aria-valuemax')),
    now: Number(await separator.getAttribute('aria-valuenow')),
  }
  await separator.focus(); await separator.press('ArrowUp')
  const afterUp = Number(await separator.getAttribute('aria-valuenow'))
  await separator.press('ArrowDown')
  const afterDown = Number(await separator.getAttribute('aria-valuenow'))
  for (let i = 0; i < 30; i += 1) await separator.press('ArrowDown')
  const minClamp = Number(await separator.getAttribute('aria-valuenow'))
  for (let i = 0; i < 40; i += 1) await separator.press('ArrowUp')
  const maxClamp = Number(await separator.getAttribute('aria-valuenow'))
  assert.equal(afterUp - separatorInitial.now, 24)
  assert.equal(afterDown, separatorInitial.now)
  assert.equal(minClamp, separatorInitial.min)
  assert.equal(maxClamp, separatorInitial.max)
  for (let i = 0; i < 10; i += 1) await separator.press('ArrowDown')
  assert.equal(Number(await separator.getAttribute('aria-valuenow')), 280)
  // React has committed aria-valuenow by this point, but the dependent frame geometry can settle
  // on the following paint after the long keyboard clamp sequence.
  await page.waitForTimeout(100)
  const separatorBox = await separator.boundingBox()
  assert(separatorBox)
  const gridHeightBeforeDrag = await page.locator('[data-sheet-grid-host]').evaluate((node) => node.getBoundingClientRect().height)
  const dragX = separatorBox.x + 10
  const dragY = separatorBox.y + separatorBox.height / 2
  await separator.evaluate((node) => {
    globalThis.__phase3PointerEvents = []
    for (const type of ['pointerdown', 'gotpointercapture', 'pointermove', 'pointerup', 'lostpointercapture']) {
      node.addEventListener(type, (event) => {
        globalThis.__phase3PointerEvents.push({
          type: event.type, pointer_id: event.pointerId, client_y: event.clientY, buttons: event.buttons,
        })
      })
    }
  })
  await separator.hover({ position: { x: 10, y: separatorBox.height / 2 } })
  await page.waitForTimeout(50)
  await page.mouse.down()
  await page.waitForTimeout(50)
  await page.mouse.move(dragX, dragY - 48, { steps: 5 })
  await page.waitForTimeout(100)
  await page.mouse.up()
  await page.waitForTimeout(200)
  const afterDragUp = Number(await separator.getAttribute('aria-valuenow'))
  const pointerEventsAfterUp = await page.evaluate(() => globalThis.__phase3PointerEvents)
  const gridHeightAfterDragUp = await page.locator('[data-sheet-grid-host]').evaluate((node) => node.getBoundingClientRect().height)
  assert.equal(afterDragUp, 328, JSON.stringify({ separatorBox, dragX, dragY, pointerEvents: pointerEventsAfterUp }))
  assert(gridHeightAfterDragUp < gridHeightBeforeDrag)

  const separatorBoxAfterUp = await separator.boundingBox()
  assert(separatorBoxAfterUp)
  const dragDownX = separatorBoxAfterUp.x + 10
  const dragDownY = separatorBoxAfterUp.y + separatorBoxAfterUp.height / 2
  await separator.hover({ position: { x: 10, y: separatorBoxAfterUp.height / 2 } })
  await page.mouse.down()
  await page.mouse.move(dragDownX, dragDownY + 48, { steps: 5 })
  await page.mouse.up()
  await page.waitForTimeout(200)
  const afterDragDown = Number(await separator.getAttribute('aria-valuenow'))
  const pointerEvents = await page.evaluate(() => globalThis.__phase3PointerEvents)
  const gridHeightAfterDragDown = await page.locator('[data-sheet-grid-host]').evaluate((node) => node.getBoundingClientRect().height)
  assert.equal(afterDragDown, 280)
  assert(Math.abs(gridHeightAfterDragDown - gridHeightBeforeDrag) <= 1)

  const primary = page.getByRole('button', { name: 'qa_primary', exact: true })
  const hidden = page.getByRole('button', { name: 'qa_hidden', exact: true })
  await primary.click()
  assert.equal(await primary.getAttribute('aria-pressed'), 'true')
  const hiddenTile = workbench.getByRole('button', { name: /오류.*현재 마스크.*MISSING/ })
  await hiddenTile.focus(); await hiddenTile.press('Enter')
  await page.waitForFunction(() => document.activeElement && document.querySelector('[data-testid="sheet-view-grid"]')?.contains(document.activeElement))
  assert.equal(await hidden.getAttribute('aria-pressed'), 'true')
  const hiddenCategoryPressed = await hidden.getAttribute('aria-pressed')
  const hiddenGridFocus = await assertGridFocus(page)
  await page.evaluate(() => navigator.clipboard.writeText(''))
  await page.keyboard.press('Control+C')
  const hiddenTargetClipboard = (await page.evaluate(() => navigator.clipboard.readText())).trim()
  assert.equal(hiddenTargetClipboard, 'MISSING')
  const hiddenNavigationStatus = (await workbench.getByText('검증 대상 셀로 이동했습니다.', { exact: true }).textContent())?.trim()
  const hiddenScreenshot = await screenshot(page, 'hidden-category-focus-1440x900.png')

  await primary.click()
  const visibleTile = workbench.getByRole('button', { name: /오류.*노광량/ })
  await visibleTile.focus(); await visibleTile.press('Space')
  assert.equal(await primary.getAttribute('aria-pressed'), 'true')
  const visibleGridFocus = await assertGridFocus(page)
  await page.evaluate(() => navigator.clipboard.writeText(''))
  await page.keyboard.press('Control+C')
  const visibleTargetClipboard = (await page.evaluate(() => navigator.clipboard.readText())).trim()
  assert.equal(visibleTargetClipboard, '99')

  // Re-enter and escape the real Glide editor to establish the same clipboard selection path a
  // user gets after clicking a cell; the preceding tile-navigation assertion remains independent.
  const pastePoint = await gridPoint(page, 1, 1)
  await page.mouse.dblclick(pastePoint.x, pastePoint.y)
  const pasteTargetEditor = page.locator('input[inputmode="decimal"]')
  await pasteTargetEditor.waitFor({ timeout: 10_000 })
  await pasteTargetEditor.press('Escape')
  await pasteTargetEditor.waitFor({ state: 'detached' })
  await page.locator('[data-testid="sheet-view-grid"] canvas').first().focus()
  await assertGridFocus(page)
  await page.evaluate(() => navigator.clipboard.writeText('11'))
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '11')
  await page.keyboard.press('Control+V')
  const paste = page.locator('[data-testid="paste-staging-panel"]')
  await paste.waitFor({ timeout: 10_000 })
  const categoryBeforeGuard = await primary.getAttribute('aria-pressed')
  await hiddenTile.focus(); await hiddenTile.press('Enter')
  const guardGuidance = (await workbench.getByText('붙여넣기를 적용 또는 취소한 뒤 이동해 주세요.', { exact: true }).textContent())?.trim()
  const categoryAfterGuard = await primary.getAttribute('aria-pressed')
  assert.equal(categoryBeforeGuard, 'true')
  assert.equal(categoryAfterGuard, 'true')
  await paste.getByRole('button', { name: '취소', exact: true }).click()
  await paste.waitFor({ state: 'detached' })

  let failNextValidation = true
  let injectedFailures = 0
  const failureSentinel = 'RAW_VALIDATE_SENTINEL Traceback SELECT [A-Z]{99}'
  await page.route(`**/api/projects/${fixture.project_id}/validate`, async (route) => {
    if (route.request().method() !== 'POST' || !failNextValidation) return route.continue()
    failNextValidation = false
    injectedFailures += 1
    await route.fulfill({
      status: 503, contentType: 'application/json',
      body: JSON.stringify({ code: 'qa_forced_validation_failure', message: failureSentinel }),
    })
  })
  await page.locator('[data-testid="sheet-explicit-validation"]').click()
  await waitForStrip(page, '최신 상태 확인 실패 · 다시 시도')
  assert.equal(await workbench.locator('button[aria-label]').count(), 6)
  const failureText = await workbench.innerText()
  assert.equal(failureText.includes(failureSentinel), false)
  const failureScreenshot = await screenshot(page, 'network-failure-retry-1440x900.png')
  await workbench.getByRole('button', { name: '다시 시도', exact: true }).click()
  await waitForStrip(page, '서버 확인됨')
  assert.equal(injectedFailures, 1)
  await page.unroute(`**/api/projects/${fixture.project_id}/validate`)

  const aria = await ariaSnapshot(workbench, 'issues-workbench-1440x900.yaml')
  const safeText = await workbench.innerText()
  for (const forbidden of ['Traceback', 'SELECT', '[A-Z]{2}-[0-9]{4}', 'qa_required_if', 'qa_prior_por']) {
    assert.equal(safeText.includes(forbidden), false, `rendered forbidden internal text: ${forbidden}`)
  }
  return {
    filters: filterStates,
    tile_keyboard: {
      enter_toggled_once: true, space_toggled_once: true,
      before_height: beforeHeight, after_enter_height: afterEnterHeight,
      full_guidance_in_aria_label: priorLabel,
      full_guidance_in_title: priorTitle,
    },
    separator: {
      ...separatorInitial, after_up: afterUp, after_down: afterDown,
      step: afterUp - separatorInitial.now, min_clamp: minClamp, max_clamp: maxClamp,
      pointer_drag_start: 280, pointer_drag_up_end: afterDragUp,
      pointer_drag_down_end: afterDragDown,
      pointer_events: pointerEvents,
      grid_height_before_drag: gridHeightBeforeDrag,
      grid_height_after_drag_up: gridHeightAfterDragUp,
      grid_height_after_drag_down: gridHeightAfterDragDown,
    },
    navigation: {
      hidden_category_pressed: hiddenCategoryPressed,
      hidden_grid_focus: hiddenGridFocus, hidden_clipboard_value: hiddenTargetClipboard,
      hidden_status: hiddenNavigationStatus,
      visible_grid_focus: visibleGridFocus, visible_clipboard_value: visibleTargetClipboard,
      paste_guard_guidance: guardGuidance,
      paste_guard_kept_category: categoryAfterGuard,
    },
    failure_retry: {
      injected_503_count: injectedFailures, retained_issue_tiles: 6,
      exact_failure_copy: '최신 상태 확인 실패 · 다시 시도', raw_sentinel_rendered: false,
      retry_server_confirmed: true,
    },
    safe_rendering: {
      text: safeText.replace(/\s+/g, ' ').trim(),
      forbidden_internal_tokens_absent: true,
    },
    artifacts: [failureScreenshot, hiddenScreenshot, aria],
  }
}

async function layoutScenario(viewport) {
  const scenario = `issues-${viewport.name}`
  const { context, page } = await newPage(scenario, viewport)
  await waitForSheet(page)
  await page.locator('[data-validation-workbench]').waitFor({ timeout: 15_000 })
  await page.locator('[data-testid="sheet-explicit-validation"]').click()
  await waitForStrip(page, '서버 확인됨')
  const layout = await expandedLayout(page, viewport)
  let interactive = null
  if (viewport.name === '1440x900') interactive = await exercise1440(page)
  let wideSelectedGuidance = null
  if (viewport.name === '1920x1080') {
    const longTile = page.locator('[data-validation-workbench]').getByRole('button', {
      name: /오류.*현재 마스크.*앞선 POR 값을 추가하거나 현재 값을 수정/,
    })
    await longTile.focus()
    await longTile.press('Enter')
    assert.equal(await longTile.getAttribute('aria-expanded'), 'true')
    const box = await longTile.boundingBox()
    assert(box && box.height > 50)
    wideSelectedGuidance = await page.evaluate(() => {
      const workbench = document.querySelector('[data-validation-workbench]')
      return {
        selected_tile_height: document.querySelector('[data-validation-workbench] button[aria-label][aria-expanded="true"]')?.getBoundingClientRect().height ?? null,
        document_horizontal_overflow: document.documentElement.scrollWidth > innerWidth,
        workbench_horizontal_overflow: (workbench?.scrollWidth ?? 0) > (workbench?.clientWidth ?? 0) + 1,
      }
    })
    assert.equal(wideSelectedGuidance.document_horizontal_overflow, false)
    assert.equal(wideSelectedGuidance.workbench_horizontal_overflow, false)
  }
  const shot = await screenshot(page, `issues-${viewport.name}.png`)
  observations.layouts ??= {}
  observations.layouts[viewport.name] = { viewport, layout, interactive, wide_selected_guidance: wideSelectedGuidance, screenshot: shot }
  await closeAndUnlock(context, page)
}

async function configurationUnavailableScenario() {
  const { context, page } = await newPage('configuration-unavailable')
  const sentinel = 'RAW_CONFIGURATION_SENTINEL Traceback SELECT [A-Z]{99}'
  let failures = 0
  await page.route(`**/api/choice-sets/${fixture.choice_set_code}/options**`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    failures += 1
    await route.fulfill({
      status: 503, contentType: 'application/json',
      body: JSON.stringify({ code: 'qa_config_failure', message: sentinel }),
    })
  })
  await waitForSheet(page)
  const alert = page.locator('[data-testid="validation-configuration-alert"]')
  await alert.waitFor({ timeout: 30_000 })
  const text = (await alert.innerText()).replace(/\s+/g, ' ').trim()
  assert.match(text, /검증 규칙을 불러오지 못했습니다. 관리자에게 확인을 요청해 주세요./)
  assert.equal(text.includes(sentinel), false)
  assert.equal(await page.locator('.bg-success-surface').count(), 0)
  assert.equal(await page.locator('[data-validation-workbench]').count(), 0)
  const shot = await screenshot(page, 'configuration-unavailable-1440x900.png')
  observations.configuration_unavailable = {
    injected_503_count: failures,
    safe_alert: text,
    raw_sentinel_rendered: false,
    green_success_count: 0,
    workbench_count: 0,
    screenshot: shot,
  }
  await closeAndUnlock(context, page)
}

async function writeArtifacts(error = null) {
  await writeFile(path.join(OUTPUT, 'console.jsonl'), consoleEntries.map((entry) => JSON.stringify(entry)).join('\n') + (consoleEntries.length ? '\n' : ''))
  await writeFile(path.join(OUTPUT, 'network.jsonl'), networkEntries.map((entry) => JSON.stringify(entry)).join('\n') + (networkEntries.length ? '\n' : ''))
  const deliberateConsoleResourceErrors = consoleEntries.filter(isDeliberateConsoleResourceError)
  const consoleProblems = consoleEntries.filter((entry) =>
    ['error', 'warning', 'pageerror'].includes(entry.type) && !isDeliberateConsoleResourceError(entry))
  const unexpectedHttpFailures = networkEntries.filter((entry) => entry.status >= 400 && !entry.deliberate_failure)
  const unexpectedRequestFailures = networkEntries.filter((entry) => entry.phase === 'requestfailed' && !/ERR_ABORTED/.test(entry.failure ?? ''))
  const harnessBytes = await readFile(fileURLToPath(import.meta.url))
  const seedBytes = await readFile(path.join(OUTPUT, 'seed_validation_fixture.py'))
  const runtimeSources = {}
  for (const relativePath of RUNTIME_SOURCE_PATHS) {
    const bytes = await readFile(path.join(ROOT, relativePath))
    runtimeSources[relativePath] = { bytes: bytes.length, sha256: sha256(bytes) }
  }
  const result = {
    schema_version: 1,
    source_sha: sourceSha,
    branch: execFileSync('git', ['branch', '--show-current'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    started_at_utc: startedAt,
    completed_at_utc: now(),
    timezone: 'Asia/Seoul',
    status: error === null ? 'passed' : 'failed',
    error: error === null ? null : { name: error.name, message: error.message, stack: error.stack },
    environment: {
      base_url: BASE_URL,
      api_url: API_URL,
      chromium_executable: CHROMIUM_PATH,
      chromium_version: browser ? await browser.version() : null,
      node: process.version,
      npm: execFileSync('npm', ['--version'], { cwd: path.join(ROOT, 'frontend'), encoding: 'utf8' }).trim(),
      git_status_short: execFileSync('git', ['status', '--short'], { cwd: ROOT, encoding: 'utf8' }).trimEnd().split('\n').filter(Boolean),
      harness: { bytes: harnessBytes.length, sha256: sha256(harnessBytes) },
      fixture_seed: { bytes: seedBytes.length, sha256: sha256(seedBytes) },
      runtime_sources: runtimeSources,
    },
    fixture,
    observations,
    assertions: {
      console_error_or_warning_count: consoleProblems.length,
      console_problems: consoleProblems,
      deliberate_console_resource_errors: deliberateConsoleResourceErrors,
      unexpected_http_failure_count: unexpectedHttpFailures.length,
      unexpected_http_failures: unexpectedHttpFailures,
      unexpected_request_failure_count: unexpectedRequestFailures.length,
      unexpected_request_failures: unexpectedRequestFailures,
      deliberate_http_failures: networkEntries.filter((entry) => entry.status >= 400 && entry.deliberate_failure),
    },
    artifacts: { screenshots, aria: ariaArtifacts, console: 'console.jsonl', network: 'network.jsonl' },
    explicit_gaps: [
      'No comment-bearing cell fixture exists in Phase 3, so combined validation+dirty+comment hover was not browser-exercised; validation+dirty was exercised.',
      'No project switch was raced against an in-flight validation request in this bounded run; generation fencing remains covered by Vitest.',
      'No real backend configuration row was corrupted; definition unavailability used a deliberate ChoiceSet-options 503 and verified safe rendering.',
    ],
  }
  await writeFile(path.join(OUTPUT, 'run.json'), `${JSON.stringify(result, null, 2)}\n`)
  return result
}

await rm(path.join(OUTPUT, 'console.jsonl'), { force: true })
await rm(path.join(OUTPUT, 'network.jsonl'), { force: true })
await rm(path.join(OUTPUT, 'run.json'), { force: true })
await rm(SCREENSHOTS, { force: true, recursive: true })
await rm(ARIA, { force: true, recursive: true })
await mkdir(SCREENSHOTS, { recursive: true })
await mkdir(ARIA, { recursive: true })

let failure = null
try {
  browser = await chromium.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  const sheet = await api(`/projects/${fixture.project_id}/sheet`)
  const initialValidation = await api(`/projects/${fixture.project_id}/validate`, { method: 'POST' })
  assert.deepEqual(initialValidation.summary, { error_count: 0, warning_count: 0 })
  assert.equal(initialValidation.issues.length, 0)
  observations.fixture_initial_truth = {
    columns: sheet.columns.length,
    rows: sheet.rows.length,
    categories: [...new Set(sheet.columns.map((column) => column.category_code))],
    layer_count: new Set(sheet.rows.map((row) => row.layer_key)).size,
    summary: initialValidation.summary,
    basis_hash: initialValidation.basis_hash,
    rule_versions: initialValidation.rule_versions,
    sheet_basis_matches: sheet.validation_basis_hash === initialValidation.basis_hash,
  }
  await lifecycleScenario(sheet)
  await createIssues()
  for (const viewport of VIEWPORTS) await layoutScenario(viewport)
  await configurationUnavailableScenario()
  const consoleProblems = consoleEntries.filter((entry) =>
    ['error', 'warning', 'pageerror'].includes(entry.type) && !isDeliberateConsoleResourceError(entry))
  const unexpectedHttpFailures = networkEntries.filter((entry) => entry.status >= 400 && !entry.deliberate_failure)
  const unexpectedRequestFailures = networkEntries.filter((entry) => entry.phase === 'requestfailed' && !/ERR_ABORTED/.test(entry.failure ?? ''))
  assert.equal(consoleProblems.length, 0, JSON.stringify(consoleProblems))
  assert.equal(unexpectedHttpFailures.length, 0, JSON.stringify(unexpectedHttpFailures))
  assert.equal(unexpectedRequestFailures.length, 0, JSON.stringify(unexpectedRequestFailures))
} catch (error) {
  failure = error instanceof Error ? error : new Error(String(error))
} finally {
  const result = await writeArtifacts(failure)
  if (browser) await browser.close()
  if (failure !== null) {
    process.stderr.write(`${failure.stack}\n`)
    process.exitCode = 1
  } else {
    assert.equal(result.assertions.console_error_or_warning_count, 0, JSON.stringify(result.assertions.console_problems))
    assert.equal(result.assertions.unexpected_http_failure_count, 0, JSON.stringify(result.assertions.unexpected_http_failures))
    assert.equal(result.assertions.unexpected_request_failure_count, 0, JSON.stringify(result.assertions.unexpected_request_failures))
    process.stdout.write(`${JSON.stringify({ status: result.status, observations: Object.keys(observations), screenshots: screenshots.length, aria: ariaArtifacts.length }, null, 2)}\n`)
  }
}
