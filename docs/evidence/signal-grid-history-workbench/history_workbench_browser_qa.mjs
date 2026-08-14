#!/usr/bin/env node

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require('/home/appuser/.npm/_npx/fd3bca3c548369c0/node_modules/playwright')

const BASE_URL = process.env.HISTORY_QA_BASE_URL ?? 'http://127.0.0.1:4185'
const OUTPUT = path.resolve(
  process.env.HISTORY_QA_OUTPUT ?? 'docs/evidence/signal-grid-history-workbench',
)
const CHROMIUM =
  process.env.HISTORY_QA_CHROMIUM ??
  '/home/appuser/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome'
const VIEWPORTS = [
  { name: '1024x768', width: 1024, height: 768, inspectorWidth: 320, visualState: 'current-cell-history' },
  { name: '1440x900', width: 1440, height: 900, inspectorWidth: 520, visualState: 'expanded-batch-detail' },
  { name: '1920x1080', width: 1920, height: 1080, inspectorWidth: 520, visualState: 'timeline-ledger' },
]

const PROJECT_ID = 42
const LAYER_A = 'L1::HISTORY::010::ETCH'
const LAYER_B = 'L1::HISTORY::020::CLEAN'
const LONG_ACTOR = `operator_${'x'.repeat(88)}`
const LONG_PARAMETER = 'gas_flow_rate_with_extended_identifier_for_history_verification'
const LONG_OLD_CODE = `old_code_${'7'.repeat(96)}`
const LONG_NEW_VALUE = `new_value_${'9'.repeat(96)}`
const now = '2026-08-14T05:00:00Z'

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' }
const json = (route, body, status = 200) =>
  route.fulfill({ status, headers: jsonHeaders, body: JSON.stringify(body) })

const profile = {
  project_id: PROJECT_ID,
  process_name: 'History verification process',
  device_type: { code: 'LOGIC', label: 'Logic', is_active: true },
  project_category: { code: 'QA', label: 'Browser QA', is_active: true },
  comment: 'Deterministic history workbench fixture',
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
  layer_total: '2',
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

const layers = [
  {
    id: 4201,
    layer_key: LAYER_A,
    step_seq: '010',
    layer_id: 'ETCH',
    eqp_type: 'ETCHER',
    eqp_type_desc: 'Etcher',
    area_name: 'FAB-A',
    sort_order: 1,
    condition_count: 1,
    cell_count: 4,
    source_project_id: null,
    source_layer_key: null,
  },
  {
    id: 4202,
    layer_key: LAYER_B,
    step_seq: '020',
    layer_id: 'CLEAN',
    eqp_type: 'WET',
    eqp_type_desc: 'Wet clean',
    area_name: 'FAB-B',
    sort_order: 2,
    condition_count: 1,
    cell_count: 4,
    source_project_id: null,
    source_layer_key: null,
  },
]

const project = {
  id: PROJECT_ID,
  line_id: 'L1',
  process_id: 'HISTORY',
  part_id: 'PART-HISTORY-QA',
  name: 'Signal Grid History Workbench QA',
  status: 'draft',
  version: 3,
  revision_root_id: PROJECT_ID,
  predecessor_project_id: null,
  successor_project_id: null,
  allowed_actions: ['request_review'],
  profile,
  layers,
}

function column(parameterCode, displayName, sortOrder, unit = null) {
  return {
    parameter_code: parameterCode,
    display_name: displayName,
    value_type: 'number',
    category_code: 'process',
    unit,
    min_value: '0',
    max_value: '1000',
    required: false,
    pattern: null,
    pattern_hint: null,
    description: `Browser fixture ${displayName}`,
    choice_set_code: null,
    choice_set_version: null,
    sort_order: sortOrder,
  }
}

const sheet = {
  columns: [
    column('pressure', 'Pressure', 1, 'mTorr'),
    column(LONG_PARAMETER, 'Gas flow rate with extended identifier', 2, 'sccm'),
    column('temperature', 'Temperature', 3, 'C'),
    column('duration', 'Duration', 4, 's'),
  ],
  rows: [
    {
      condition_id: 101,
      layer_key: LAYER_A,
      step_seq: '010',
      layer_id: 'ETCH',
      layer_label: 'ETCH (010)',
      condition_label: 'POR',
      is_por: true,
      layer_sort_order: 1,
      condition_index: 0,
      cells: {
        pressure: '50.0',
        [LONG_PARAMETER]: '125.000000000000000000000000000000000000000000000000000000000001',
        temperature: '240',
        duration: '60',
      },
    },
    {
      condition_id: 202,
      layer_key: LAYER_B,
      step_seq: '020',
      layer_id: 'CLEAN',
      layer_label: 'CLEAN (020)',
      condition_label: 'POR',
      is_por: true,
      layer_sort_order: 2,
      condition_index: 0,
      cells: {
        pressure: '25.0',
        [LONG_PARAMETER]: '250',
        temperature: '80',
        duration: '90',
      },
    },
  ],
  lock: {
    locked_by: null,
    locked_at: null,
    expires_at: null,
    is_mine: false,
    heartbeat_seconds: 45,
  },
  validation_rules: [],
  validation_basis_hash: `sha256:${'a'.repeat(64)}`,
  frozen_choice_sets: [],
}

const jump = (layerKey, conditionId, parameterCode, jumpStatus = 'available') => ({
  layer_key: layerKey,
  condition_id: conditionId,
  parameter_code: parameterCode,
  cell_ref: `${conditionId}:${parameterCode}`,
  jump_status: jumpStatus,
})

function eventItem({
  id,
  summary,
  layerKey = LAYER_A,
  target = jump(LAYER_B, 202, LONG_PARAMETER),
  metadataStatus = 'complete',
}) {
  return {
    kind: 'event',
    cursor_id: id,
    event_types: ['cell_update'],
    actors: [LONG_ACTOR],
    origins: ['manual'],
    started_at: `2026-08-14T04:${String(id).padStart(2, '0')}:00Z`,
    occurred_at: `2026-08-14T04:${String(id).padStart(2, '0')}:00Z`,
    layer_keys: [layerKey],
    source_project_id: null,
    batch_id: null,
    matched_event_count: 1,
    total_event_count: 1,
    summary,
    jump_target: target,
    detail_status: 'not_applicable',
    detail_scope: null,
    metadata_status: metadataStatus,
  }
}

function batchItem({ id, summary, batchId, scope, matched = 2, detailStatus = 'available' }) {
  return {
    kind: 'batch',
    cursor_id: id,
    event_types: ['cell_update'],
    actors: [LONG_ACTOR],
    origins: ['paste'],
    started_at: `2026-08-14T03:${String(id).padStart(2, '0')}:00Z`,
    occurred_at: `2026-08-14T03:${String(id).padStart(2, '0')}:00Z`,
    layer_keys: [LAYER_A],
    source_project_id: 17,
    batch_id: batchId,
    matched_event_count: matched,
    total_event_count: matched,
    summary,
    jump_target: null,
    detail_status: detailStatus,
    detail_scope: detailStatus === 'available' ? scope : null,
    metadata_status: detailStatus === 'legacy_unavailable' ? 'legacy_partial' : 'complete',
  }
}

const ROOT_TIMELINE_ITEMS = [
  eventItem({ id: 9, summary: 'Metrology review recorded' }),
  eventItem({
    id: 8,
    summary: 'Removed condition remains visible in history',
    target: jump(LAYER_A, 999, 'pressure', 'deleted'),
    metadataStatus: 'legacy_partial',
  }),
  batchItem({
    id: 7,
    summary: 'Cached batch detail fixture',
    batchId: 'batch-cache',
    scope: 'scope-cache',
    matched: 3,
  }),
  batchItem({
    id: 6,
    summary: 'Batch detail retry fixture',
    batchId: 'batch-retry',
    scope: 'scope-retry',
    matched: 2,
  }),
  batchItem({
    id: 5,
    summary: 'Legacy batch detail coverage',
    batchId: 'batch-legacy',
    scope: 'scope-legacy',
    matched: 4,
    detailStatus: 'legacy_unavailable',
  }),
]

const coverage = {
  legacy_unresolved_layer_count: 2,
  legacy_detail_unavailable_count: 1,
}

const detailEntry = ({
  id,
  oldCode,
  newCode,
  layerKey = LAYER_A,
  conditionId = 101,
  parameterCode = 'pressure',
}) => ({
  event_id: id,
  old_code: oldCode,
  new_code: newCode,
  copied_value: null,
  choice_label: null,
  actor: LONG_ACTOR,
  origin: 'paste',
  created_at: `2026-08-14T02:${String(id).padStart(2, '0')}:00Z`,
  layer_key: layerKey,
  jump_target: jump(layerKey, conditionId, parameterCode),
  domain_coordinate: {
    layer_key: layerKey,
    condition_id: conditionId,
    parameter_code: parameterCode,
    cell_ref: `${conditionId}:${parameterCode}`,
  },
  capture_tuple: {
    target_layer_sort: layerKey === LAYER_A ? 1 : 2,
    target_layer_key: layerKey,
    source_condition_index: 0,
    source_condition_id: conditionId,
    parameter_sort: 1,
    parameter_code: parameterCode,
    event_id: id,
  },
  metadata_status: 'complete',
})

const cellHistory = {
  items: [
    {
      event_id: 902,
      old_code: LONG_OLD_CODE,
      new_code: LONG_NEW_VALUE,
      choice_label: null,
      actor: LONG_ACTOR,
      origin: 'manual',
      created_at: '2026-08-14T04:10:00Z',
      layer_key: LAYER_A,
      jump_status: 'available',
      metadata_status: 'complete',
    },
    {
      event_id: 901,
      old_code: '48.0',
      new_code: '50.0',
      choice_label: null,
      actor: LONG_ACTOR,
      origin: 'manual',
      created_at: '2026-08-14T04:09:00Z',
      layer_key: LAYER_A,
      jump_status: 'available',
      metadata_status: 'complete',
    },
    {
      event_id: 900,
      old_code: '47.5',
      new_code: '48.0',
      choice_label: null,
      actor: null,
      origin: 'system',
      created_at: '2026-08-13T23:00:00Z',
      layer_key: LAYER_A,
      jump_status: 'deleted',
      metadata_status: 'legacy_partial',
    },
  ],
  baseline_entry: { code: '45.0', label: null },
  initial_entry: { code: '47.5', label: null },
  initial_state_unavailable: false,
  next_cursor: null,
}

function createFixtureState({ injectFailures = true } = {}) {
  return {
    timelineNextFailuresRemaining: injectFailures ? 2 : 0,
    batchRetryFailuresRemaining: injectFailures ? 1 : 0,
    calls: {
      auth: 0,
      project: 0,
      sheet: 0,
      timeline_root: 0,
      timeline_next: 0,
      cell_history: 0,
      batch_cache: 0,
      batch_retry: 0,
      comments: 0,
      lock: 0,
    },
    timelineQueries: [],
  }
}

async function installApiMock(page, state, evidence) {
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const method = request.method()
    const pathname = url.pathname.replace(/^\/api/, '')
    evidence.network.push({ method, pathname, search: url.search })

    if (method === 'GET' && pathname === '/auth/me') {
      state.calls.auth += 1
      return json(route, {
        id: 'oidc:history-browser-qa',
        display_name: 'History Browser QA',
        email: 'history.qa@example.test',
        roles: ['admin', 'reviewer', 'editor'],
        permissions: ['business.read', 'project.edit', 'project.comment'],
      })
    }
    if (method === 'GET' && pathname === `/projects/${PROJECT_ID}`) {
      state.calls.project += 1
      return json(route, project)
    }
    if (method === 'GET' && pathname === `/projects/${PROJECT_ID}/sheet`) {
      state.calls.sheet += 1
      return json(route, sheet)
    }
    if (method === 'GET' && pathname === `/projects/${PROJECT_ID}/comments`) {
      state.calls.comments += 1
      return json(route, { items: [], next_cursor: null })
    }
    if (
      (method === 'POST' || method === 'DELETE') &&
      (pathname === `/projects/${PROJECT_ID}/lock` ||
        pathname === `/projects/${PROJECT_ID}/lock/heartbeat` ||
        pathname === `/projects/${PROJECT_ID}/lock/release`)
    ) {
      state.calls.lock += 1
      if (method === 'DELETE' || pathname.endsWith('/release')) {
        return route.fulfill({ status: 204, body: '' })
      }
      return json(route, {
        locked_by: 'oidc:history-browser-qa',
        lock_token: 'history-browser-qa-lock-token',
        locked_at: now,
        expires_at: '2026-08-14T06:00:00Z',
      })
    }
    if (method === 'GET' && pathname === `/projects/${PROJECT_ID}/events`) {
      const query = Object.fromEntries(url.searchParams.entries())
      const cursor = url.searchParams.get('cursor')
      state.timelineQueries.push({
        layer_key: url.searchParams.get('layer_key'),
        actor: url.searchParams.get('actor'),
        cursor,
        query,
      })
      if (cursor === 'timeline-page-2') {
        state.calls.timeline_next += 1
        if (state.timelineNextFailuresRemaining > 0) {
          state.timelineNextFailuresRemaining -= 1
          return json(
            route,
            { code: 'fixture_timeline_next_failure', message: '다음 페이지 fixture 실패' },
            503,
          )
        }
        return json(route, {
          items: [
            eventItem({
              id: 4,
              summary: 'Recovered next-page event',
              layerKey: url.searchParams.get('layer_key') ?? LAYER_A,
            }),
          ],
          coverage,
          next_cursor: null,
        })
      }
      state.calls.timeline_root += 1
      return json(route, {
        items: ROOT_TIMELINE_ITEMS.map((item) => ({
          ...item,
          layer_keys:
            url.searchParams.get('layer_key') === null
              ? item.layer_keys
              : [url.searchParams.get('layer_key')],
        })),
        coverage,
        next_cursor: 'timeline-page-2',
      })
    }
    if (method === 'GET' && pathname === `/projects/${PROJECT_ID}/cell-history`) {
      state.calls.cell_history += 1
      return json(route, cellHistory)
    }
    if (method === 'GET' && pathname === `/projects/${PROJECT_ID}/event-batches/batch-cache`) {
      state.calls.batch_cache += 1
      return json(route, {
        order_kind: 'capture_asc',
        detail_status: 'available',
        items: [
          detailEntry({
            id: 700,
            oldCode: LONG_OLD_CODE,
            newCode: LONG_NEW_VALUE,
            parameterCode: LONG_PARAMETER,
          }),
          detailEntry({ id: 701, oldCode: '48.0', newCode: '50.0' }),
          detailEntry({ id: 702, oldCode: '49.0', newCode: '50.0' }),
        ],
        reason: 'Authoritative captured batch detail',
        next_cursor: null,
      })
    }
    if (method === 'GET' && pathname === `/projects/${PROJECT_ID}/event-batches/batch-retry`) {
      state.calls.batch_retry += 1
      if (state.batchRetryFailuresRemaining > 0) {
        state.batchRetryFailuresRemaining -= 1
        return json(
          route,
          { code: 'fixture_batch_detail_failure', message: '상세 조회 fixture 실패' },
          503,
        )
      }
      return json(route, {
        order_kind: 'capture_asc',
        detail_status: 'available',
        items: [detailEntry({ id: 601, oldCode: '49.0', newCode: '50.0' })],
        reason: 'Recovered batch detail',
        next_cursor: null,
      })
    }

    evidence.unexpectedRequests.push({ method, pathname, search: url.search })
    return json(route, { code: 'qa_unmocked', message: `${method} ${pathname}` }, 500)
  })
}

function recordAssertion(evidence, name, actual, expected) {
  evidence.assertionCount += 1
  assert.deepEqual(actual, expected, name)
  evidence.assertions[name] = actual
}

async function check(evidence, name, operation) {
  const started = Date.now()
  try {
    const details = await operation()
    evidence.checks.push({ name, status: 'pass', duration_ms: Date.now() - started, details })
    return details
  } catch (error) {
    evidence.checks.push({
      name,
      status: 'fail',
      duration_ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

function attachPageDiagnostics(page, evidence) {
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      evidence.console.push({ type: message.type(), text: message.text() })
    }
  })
  page.on('pageerror', (error) => evidence.pageErrors.push(error.message))
  page.on('dialog', (dialog) => dialog.accept())
}

async function openHistoryWorkbench(page) {
  await page.goto(`${BASE_URL}/projects/${PROJECT_ID}/sheet`, { waitUntil: 'networkidle' })
  await page.getByTestId('sheet-workbench-toggle').waitFor()
  if ((await page.getByTestId('sheet-workbench-toggle').getAttribute('aria-expanded')) !== 'true') {
    await page.getByTestId('sheet-workbench-toggle').click()
  }
  await page.getByRole('tab', { name: '이력', exact: true }).click()
  await page.locator('[data-history-item]').first().waitFor()
}

async function activeLayerKey(page) {
  return page.locator('[data-layer-row][aria-selected="true"]').getAttribute('data-layer-row')
}

async function historyNavigationStatus(page) {
  return page.locator('[data-history-workbench] [role="status"]').first().textContent()
}

async function longTextOverflow(page) {
  return page.locator('[data-history-workbench]').evaluate((workbench) => {
    const candidates = Array.from(
      workbench.querySelectorAll('p, dd, dt, h4, button, span, strong, li'),
    ).filter((element) => {
      if (!(element instanceof HTMLElement)) return false
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width > 1 &&
        rect.height > 1 &&
        element.textContent !== null &&
        element.textContent.trim().length > 24
      )
    })

    const items = candidates
      .map((element) => {
        const rect = element.getBoundingClientRect()
        let clippingAncestor = element.parentElement
        let clippedByAncestor = false
        while (clippingAncestor !== null && clippingAncestor !== workbench.parentElement) {
          const overflowX = getComputedStyle(clippingAncestor).overflowX
          if (['auto', 'clip', 'hidden', 'scroll'].includes(overflowX)) {
            const ancestorRect = clippingAncestor.getBoundingClientRect()
            clippedByAncestor = rect.left < ancestorRect.left - 1 || rect.right > ancestorRect.right + 1
            if (clippedByAncestor) break
          }
          clippingAncestor = clippingAncestor.parentElement
        }
        const ownOverflow = element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1
        if (!ownOverflow && !clippedByAncestor) return null
        return {
          tag: element.tagName,
          text: element.textContent?.trim().slice(0, 160) ?? '',
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          clippedByAncestor,
        }
      })
      .filter(Boolean)

    return { scannedElementCount: candidates.length, items }
  })
}

async function geometrySnapshot(page) {
  const panel = await page.locator('[data-sheet-evidence-panel]').boundingBox()
  const separator = await page.getByRole('separator', { name: '증거 패널 너비 조절' }).boundingBox()
  const grid = await page.locator('[data-sheet-grid-host]').boundingBox()
  const content = await page.locator('[data-history-workbench]').boundingBox()
  assert(panel !== null && separator !== null && grid !== null && content !== null)
  return {
    panel,
    separator,
    grid,
    content,
    gridSeparatorOverlapPx: Math.max(0, grid.x + grid.width - separator.x),
    separatorContentOverlapPx: Math.max(0, separator.x + separator.width - content.x),
  }
}

async function largestCanvas(page) {
  const canvases = page.locator('[data-sheet-grid-host] canvas')
  let result = null
  for (let index = 0; index < (await canvases.count()); index += 1) {
    const box = await canvases.nth(index).boundingBox()
    if (box !== null && (result === null || box.width * box.height > result.width * result.height)) {
      result = box
    }
  }
  assert(result !== null, 'Glide canvas bounding box is unavailable')
  return result
}

async function openCurrentCellScope(page) {
  const canvas = await largestCanvas(page)
  await page.mouse.click(canvas.x + Math.min(445, canvas.width - 24), canvas.y + 55)
  const cellScope = page.getByRole('radio', { name: '현재 셀만' })
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('button[role="radio"]')).some(
        (button) => button.textContent?.trim() === '현재 셀만' && !button.disabled,
      ),
  )
  await cellScope.click()
  await page.getByText('condition #101', { exact: true }).waitFor()
  await page.getByText('parameter pressure', { exact: true }).waitFor()
  await page.getByText(LONG_OLD_CODE, { exact: true }).waitFor()
}

async function measureLongLedgerEntry(page, entry) {
  const text = await entry.textContent()
  const box = await entry.boundingBox()
  const viewport = page.viewportSize()
  assert(box !== null && viewport !== null, 'Long ledger entry is not measurable')
  return {
    includesLongActor: text?.includes(LONG_ACTOR) ?? false,
    includesLongOldCode: text?.includes(LONG_OLD_CODE) ?? false,
    includesLongNewValue: text?.includes(LONG_NEW_VALUE) ?? false,
    relevantDescendantCount: await entry.locator('p, dd, dt, span, strong, li').count(),
    intersectsViewport:
      box.x < viewport.width &&
      box.x + box.width > 0 &&
      box.y < viewport.height &&
      box.y + box.height > 0,
    box,
  }
}

async function exercisePrimaryFlow(browser, evidence) {
  const state = createFixtureState()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  attachPageDiagnostics(page, evidence)
  await installApiMock(page, state, evidence)

  try {
    await check(evidence, 'page-and-default-scope', async () => {
      await openHistoryWorkbench(page)
      const title = await page.title()
      const layerScope = page.getByRole('radio', { name: '현재 Layer' })
      const cellScope = page.getByRole('radio', { name: '현재 셀만' })
      recordAssertion(evidence, 'defaultScope', await layerScope.textContent(), '현재 Layer')
      recordAssertion(evidence, 'defaultScopeAriaChecked', await layerScope.getAttribute('aria-checked'), 'true')
      recordAssertion(evidence, 'currentCellInitiallyDisabled', await cellScope.isDisabled(), true)
      const filterPanelInitiallyHidden = (await page.locator('#history-filter-panel').count()) === 0
      recordAssertion(evidence, 'filterPanelInitiallyHidden', filterPanelInitiallyHidden, true)
      const requestedLayer = state.timelineQueries.at(-1)?.layer_key
      recordAssertion(evidence, 'initialTimelineLayerAuthority', requestedLayer, LAYER_A)
      recordAssertion(evidence, 'initialTimelineQueryCount', state.timelineQueries.length, 1)
      recordAssertion(
        evidence,
        'initialUnscopedTimelineQueryCount',
        state.timelineQueries.filter((query) => query.layer_key === null).length,
        0,
      )

      await page.keyboard.press('Tab')
      assert.equal(await layerScope.evaluate((element) => document.activeElement === element), true)
      evidence.assertionCount += 1
      const focusStyle = await layerScope.evaluate((element) => {
        const style = getComputedStyle(element)
        return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth }
      })
      assert.notEqual(focusStyle.outlineStyle, 'none')
      assert(Number.parseFloat(focusStyle.outlineWidth) >= 2)
      evidence.assertionCount += 2
      evidence.assertions.visibleKeyboardFocus = focusStyle
      return { title, focusStyle, initial_items: await page.locator('[data-history-item]').count() }
    })

    await check(evidence, 'ledger-browsing-does-not-navigate', async () => {
      const beforeLayer = await activeLayerKey(page)
      const beforeNavigationStatus = await historyNavigationStatus(page)
      const firstRow = page.locator('[data-history-item]').first()
      await firstRow.locator('h4').click()
      await page.waitForTimeout(50)
      const afterLayer = await activeLayerKey(page)
      const afterNavigationStatus = await historyNavigationStatus(page)
      const ordinaryRowClickNavigationChanges = Number(
        afterNavigationStatus !== beforeNavigationStatus,
      )
      recordAssertion(
        evidence,
        'ordinaryRowClickNavigationChanges',
        ordinaryRowClickNavigationChanges,
        0,
      )

      const timelineTexts = await page.locator('[data-history-item]').allTextContents()
      const timelineInventedDiffCount = timelineTexts.filter((text) =>
        /48\.0\s*→\s*50\.0|이전 값|변경 값/.test(text),
      ).length
      recordAssertion(evidence, 'timelineInventedDiffCount', timelineInventedDiffCount, 0)
      const roundedLedgerRows = await page.locator('[data-history-item][class*="rounded"]').count()
      recordAssertion(evidence, 'roundedLedgerRowCount', roundedLedgerRows, 0)
      return {
        beforeLayer,
        afterLayer,
        rows: timelineTexts.length,
        navigation_status_changes: ordinaryRowClickNavigationChanges,
      }
    })

    await check(evidence, 'filter-validation-preserves-rows', async () => {
      const disclosure = page.locator('[aria-controls="history-filter-panel"]')
      await disclosure.click()
      await page.getByLabel('Source project').fill('0')
      const beforeRows = await page.locator('[data-history-item]').count()
      const beforeRootCalls = state.calls.timeline_root
      await page.getByRole('button', { name: '적용', exact: true }).click()
      await page.getByRole('alert').filter({ hasText: 'Source project' }).waitFor()
      recordAssertion(evidence, 'filterFailureRowsPreserved', await page.locator('[data-history-item]').count(), beforeRows)
      recordAssertion(evidence, 'filterFailureNetworkCalls', state.calls.timeline_root - beforeRootCalls, 0)

      await page.getByLabel('Source project').fill('')
      await page.getByLabel('작업자').fill('qa-operator')
      await page.getByRole('button', { name: '적용', exact: true }).click()
      await page.locator('[aria-controls="history-filter-panel"]').filter({ hasText: 'qa-operator' }).waitFor()
      assert(state.timelineQueries.some((query) => query.actor === 'qa-operator'))
      evidence.assertionCount += 1
      evidence.assertions.appliedActorFilter = 'qa-operator'
      return { beforeRows, applied_actor: 'qa-operator' }
    })

    await check(evidence, 'layer-switch-retains-user-filters', async () => {
      await page.locator(`[data-layer-row="${LAYER_B}"]`).click()
      await page.locator('[data-history-workbench]').filter({ hasText: 'LAYER 020 · CLEAN' }).waitFor()
      const authoritativeQuery = state.timelineQueries.find(
        (query) => query.layer_key === LAYER_B && query.actor === 'qa-operator',
      )
      assert(authoritativeQuery !== undefined)
      evidence.assertionCount += 1
      recordAssertion(
        evidence,
        'layerSwitchFilterSummaryRetained',
        (await page.locator('[aria-controls="history-filter-panel"]').textContent())?.includes('qa-operator'),
        true,
      )
      await page.locator(`[data-layer-row="${LAYER_A}"]`).click()
      await page.locator('[data-history-workbench]').filter({ hasText: 'LAYER 010 · ETCH' }).waitFor()
      return { layer_key: authoritativeQuery.layer_key, actor: authoritativeQuery.actor }
    })

    await check(evidence, 'timeline-next-page-failure-and-retry', async () => {
      const beforeRows = await page.locator('[data-history-item]').count()
      await page.getByRole('button', { name: '다음 페이지 불러오기', exact: true }).click()
      await page.getByRole('button', { name: '다음 페이지 다시 시도', exact: true }).waitFor({ timeout: 12_000 })
      recordAssertion(evidence, 'timelineNextFailureRowsPreserved', await page.locator('[data-history-item]').count(), beforeRows)
      const ordinaryVisible = await page.getByRole('button', { name: '다음 페이지 불러오기', exact: true }).isVisible()
      const retryVisible = await page.getByRole('button', { name: '다음 페이지 다시 시도', exact: true }).isVisible()
      evidence.visualDiagnostics.duplicateNextPageControls = Number(ordinaryVisible && retryVisible)
      recordAssertion(evidence, 'ordinaryNextPageControlDuringError', ordinaryVisible, false)
      recordAssertion(evidence, 'retryNextPageControlDuringError', retryVisible, true)
      await page.screenshot({ path: '/tmp/signal-grid-history-pagination-error.png', fullPage: false })

      await page.getByRole('button', { name: '다음 페이지 다시 시도', exact: true }).click()
      await page.getByText('Recovered next-page event', { exact: true }).waitFor()
      recordAssertion(evidence, 'timelineNextPageCalls', state.calls.timeline_next, 3)
      recordAssertion(evidence, 'timelineRecoveredRowCount', await page.locator('[data-history-item]').count(), beforeRows + 1)
      return {
        beforeRows,
        afterRows: await page.locator('[data-history-item]').count(),
        duplicate_controls_during_error: evidence.visualDiagnostics.duplicateNextPageControls,
      }
    })

    await check(evidence, 'batch-detail-cache-and-authoritative-diff', async () => {
      const row = page.locator('[data-history-item]', { hasText: 'Cached batch detail fixture' })
      await row.getByRole('button', { name: /3개 변경 펼치기/ }).click()
      await row.getByText('Authoritative captured batch detail', { exact: true }).waitFor()
      recordAssertion(evidence, 'batchDetailFetchCount', state.calls.batch_cache, 1)
      const batchDiffText = `${await row.getByText('48.0', { exact: true }).textContent()} → ${await row.getByText('50.0', { exact: true }).first().textContent()}`
      recordAssertion(evidence, 'batchDiffText', batchDiffText, '48.0 → 50.0')
      await row.getByRole('button', { name: /3개 변경 접기/ }).click()
      await row.getByRole('button', { name: /3개 변경 펼치기/ }).click()
      await row.getByText('Authoritative captured batch detail', { exact: true }).waitFor()
      recordAssertion(evidence, 'batchDetailFetchCountAfterReopen', state.calls.batch_cache, 1)
      return { batch_cache_calls: state.calls.batch_cache, diff: batchDiffText }
    })

    await check(evidence, 'batch-detail-failure-and-retry', async () => {
      const preservedRows = await page.locator('[data-history-item]').count()
      const row = page.locator('[data-history-item]', { hasText: 'Batch detail retry fixture' })
      await row.getByRole('button', { name: /2개 변경 펼치기/ }).click()
      await row.getByRole('button', { name: '상세 다시 시도', exact: true }).waitFor()
      recordAssertion(evidence, 'batchFailureRowsPreserved', await page.locator('[data-history-item]').count(), preservedRows)
      await row.getByRole('button', { name: '상세 다시 시도', exact: true }).click()
      await row.getByText('Recovered batch detail', { exact: true }).waitFor()
      recordAssertion(evidence, 'batchDetailRetryCalls', state.calls.batch_retry, 2)
      return { batch_retry_calls: state.calls.batch_retry }
    })

    await check(evidence, 'legacy-and-deleted-contracts', async () => {
      await page
        .getByText(/필터에서 위치를 확인할 수 없는 과거 항목 2개.*상세를 불러올 수 없는 레거시 항목 1개/)
        .waitFor()
      const legacy = page.locator('[data-history-item]', { hasText: 'Legacy batch detail coverage' })
      recordAssertion(evidence, 'legacyDetailUnavailable', await legacy.getByText('상세 미지원', { exact: true }).isVisible(), true)
      const deleted = page.locator('[data-history-item]', { hasText: 'Removed condition remains visible in history' })
      const deletedButton = deleted.getByRole('button', { name: '삭제됨', exact: true })
      recordAssertion(evidence, 'deletedTargetDisabled', await deletedButton.isDisabled(), true)
      recordAssertion(
        evidence,
        'deletedTargetExplained',
        await deleted.getByText('삭제된 대상이라 위치로 이동할 수 없습니다.', { exact: true }).isVisible(),
        true,
      )
      return { legacy_coverage: coverage, deleted_button_disabled: true }
    })

    await check(evidence, 'explicit-navigation-only', async () => {
      const targetRow = page.locator('[data-history-item]', { hasText: 'Metrology review recorded' })
      const beforeNavigationStatus = await historyNavigationStatus(page)
      await targetRow.getByRole('button', { name: '셀로 이동', exact: true }).click()
      await page.locator(`[data-layer-row="${LAYER_B}"][aria-selected="true"]`).waitFor()
      await page.getByRole('status').filter({ hasText: '대상 셀로 이동했습니다.' }).waitFor()
      const afterNavigationStatus = await historyNavigationStatus(page)
      const explicitMoveNavigationChanges = Number(
        afterNavigationStatus !== beforeNavigationStatus &&
          afterNavigationStatus?.includes('대상 셀로 이동했습니다.') === true,
      )
      recordAssertion(
        evidence,
        'explicitMoveNavigationChanges',
        explicitMoveNavigationChanges,
        1,
      )
      recordAssertion(evidence, 'explicitMoveLayerTarget', await activeLayerKey(page), LAYER_B)
      recordAssertion(
        evidence,
        'explicitMoveFilterRetained',
        (await page.locator('[aria-controls="history-filter-panel"]').textContent())?.includes('qa-operator'),
        true,
      )
      return {
        target_layer: await activeLayerKey(page),
        navigation_status: '대상 셀로 이동했습니다.',
        navigation_status_changes: explicitMoveNavigationChanges,
      }
    })

    await check(evidence, 'current-cell-enabled-and-authoritative-diff', async () => {
      await openCurrentCellScope(page)
      const cellScope = page.getByRole('radio', { name: '현재 셀만' })
      recordAssertion(evidence, 'currentCellEnabledAfterGridSelection', await cellScope.isEnabled(), true)
      const oldValue = await page.getByText('48.0', { exact: true }).first().textContent()
      const newValue = await page.getByText('50.0', { exact: true }).first().textContent()
      const cellDiffText = `${oldValue} → ${newValue}`
      recordAssertion(evidence, 'cellDiffText', cellDiffText, '48.0 → 50.0')
      const deletedCellButton = page.getByRole('button', { name: '삭제됨', exact: true })
      recordAssertion(evidence, 'deletedCellHistoryTargetDisabled', await deletedCellButton.isDisabled(), true)

      await cellScope.focus()
      await cellScope.press('ArrowLeft')
      const layerScope = page.getByRole('radio', { name: '현재 Layer' })
      recordAssertion(evidence, 'scopeKeyboardSelectsLayer', await layerScope.getAttribute('aria-checked'), 'true')
      recordAssertion(evidence, 'scopeKeyboardFocusesLayer', await layerScope.evaluate((element) => document.activeElement === element), true)
      await layerScope.press('ArrowRight')
      recordAssertion(evidence, 'scopeKeyboardSelectsCell', await cellScope.getAttribute('aria-checked'), 'true')
      return { cell_history_calls: state.calls.cell_history, diff: cellDiffText }
    })

    await check(evidence, 'inspector-keyboard-resize-bounds', async () => {
      const separator = page.getByRole('separator', { name: '증거 패널 너비 조절' })
      await separator.focus()
      for (let index = 0; index < 5; index += 1) await separator.press('ArrowRight')
      recordAssertion(evidence, 'inspectorKeyboardMinimum', await separator.getAttribute('aria-valuenow'), '320')
      for (let index = 0; index < 14; index += 1) await separator.press('ArrowLeft')
      recordAssertion(evidence, 'inspectorKeyboardMaximum', await separator.getAttribute('aria-valuenow'), '520')
      const geometry = await geometrySnapshot(page)
      recordAssertion(evidence, 'gridSeparatorOverlapPx', geometry.gridSeparatorOverlapPx, 0)
      recordAssertion(evidence, 'separatorContentOverlapPx', geometry.separatorContentOverlapPx, 0)
      return geometry
    })

    evidence.apiCallCounts.primary = state.calls
    evidence.primaryTimelineQueries = state.timelineQueries
  } finally {
    await context.close()
  }
}

async function captureViewport(browser, evidence, viewport) {
  const state = createFixtureState({ injectFailures: false })
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
  })
  await context.addInitScript(
    ({ inspectorWidth }) => {
      localStorage.setItem('pcm:sheet-inspector-width', String(inspectorWidth))
    },
    { inspectorWidth: viewport.inspectorWidth },
  )
  const page = await context.newPage()
  attachPageDiagnostics(page, evidence)
  await installApiMock(page, state, evidence)

  try {
    await openHistoryWorkbench(page)
    const separator = page.getByRole('separator', { name: '증거 패널 너비 조절' })
    const actualInspectorWidth = Number(await separator.getAttribute('aria-valuenow'))
    recordAssertion(
      evidence,
      `viewport-${viewport.name}-inspectorWidth`,
      actualInspectorWidth,
      viewport.inspectorWidth,
    )

    let visualState = 'timeline-ledger'
    let longContentMeasurement = null
    if (viewport.name === '1024x768') {
      visualState = 'current-cell-history'
      await openCurrentCellScope(page)
      const longEntry = page.locator('[data-history-workbench] article', { hasText: LONG_OLD_CODE })
      await longEntry.scrollIntoViewIfNeeded()
      longContentMeasurement = await measureLongLedgerEntry(page, longEntry)
    } else if (viewport.name === '1440x900') {
      visualState = 'expanded-batch-detail'
      const row = page.locator('[data-history-item]', { hasText: 'Cached batch detail fixture' })
      await row.getByRole('button', { name: /3개 변경 펼치기/ }).click()
      await row.getByText('Authoritative captured batch detail', { exact: true }).waitFor()
      const longEntry = row.locator('li', { hasText: LONG_OLD_CODE })
      await longEntry.scrollIntoViewIfNeeded()
      longContentMeasurement = await measureLongLedgerEntry(page, longEntry)
      await page.keyboard.press('Tab')
    }
    if (longContentMeasurement !== null) {
      recordAssertion(
        evidence,
        `viewport-${viewport.name}-longActorMeasured`,
        longContentMeasurement.includesLongActor,
        true,
      )
      recordAssertion(
        evidence,
        `viewport-${viewport.name}-longOldCodeMeasured`,
        longContentMeasurement.includesLongOldCode,
        true,
      )
      recordAssertion(
        evidence,
        `viewport-${viewport.name}-longNewValueMeasured`,
        longContentMeasurement.includesLongNewValue,
        true,
      )
      recordAssertion(
        evidence,
        `viewport-${viewport.name}-longEntryCaptured`,
        longContentMeasurement.intersectsViewport,
        true,
      )
    }
    recordAssertion(
      evidence,
      `viewport-${viewport.name}-visualState`,
      visualState,
      viewport.visualState,
    )
    const geometry = await geometrySnapshot(page)
    recordAssertion(evidence, `viewport-${viewport.name}-gridOverlap`, geometry.gridSeparatorOverlapPx, 0)
    recordAssertion(evidence, `viewport-${viewport.name}-contentOverlap`, geometry.separatorContentOverlapPx, 0)

    const layout = await page.evaluate(() => ({
      documentOverflowPx: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      documentWidth: document.documentElement.clientWidth,
      documentHeight: document.documentElement.clientHeight,
    }))
    const textOverflow = await longTextOverflow(page)
    evidence.visualDiagnostics.longTextOverflow.push({
      viewport: viewport.name,
      visual_state: visualState,
      scanned_element_count: textOverflow.scannedElementCount,
      items: textOverflow.items,
    })

    const screenshotPath = path.join(OUTPUT, 'screenshots', `history-${viewport.name}.png`)
    const screenshot = await page.screenshot({ path: screenshotPath, fullPage: false })
    evidence.screenshots.push({
      file: path.relative(OUTPUT, screenshotPath),
      width: viewport.width,
      height: viewport.height,
      inspector_width: actualInspectorWidth,
      visual_state: visualState,
      sha256: createHash('sha256').update(screenshot).digest('hex'),
      document_overflow_px: layout.documentOverflowPx,
      long_text_scanned_count: textOverflow.scannedElementCount,
      long_text_overflow_count: textOverflow.items.length,
      long_content_measurement: longContentMeasurement,
      geometry,
    })
    evidence.apiCallCounts[`viewport-${viewport.name}`] = state.calls
  } finally {
    await context.close()
  }
}

async function main() {
  await mkdir(path.join(OUTPUT, 'screenshots'), { recursive: true })
  const evidence = {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    completedAt: null,
    baseUrl: BASE_URL,
    chromiumExecutable: CHROMIUM,
    chromiumVersion: null,
    browserPluginAvailability: 'absent; regular Playwright used as required by the task brief',
    mockBoundary: 'Browser/UI behavior only; API responses are deterministic Playwright route mocks.',
    detector: {
      invocationCount: 1,
      invocation:
        'node /home/appuser/.codex/skills/impeccable/scripts/detect.mjs --json frontend/src/features/sheets/HistoryWorkbench.tsx frontend/src/features/sheets/HistoryWorkbench.test.tsx frontend/src/features/sheets/SheetView.tsx frontend/src/features/sheets/SheetView.test.tsx',
      rawJson: [],
      findingCount: 0,
    },
    assertionCount: 0,
    assertions: {},
    checks: [],
    apiCallCounts: {},
    primaryTimelineQueries: [],
    network: [],
    unexpectedRequests: [],
    console: [],
    expectedConsole: [],
    unexpectedConsole: [],
    pageErrors: [],
    screenshots: [],
    visualDiagnostics: {
      duplicateNextPageControls: null,
      longTextOverflow: [],
    },
    status: 'running',
  }

  const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true })
  evidence.chromiumVersion = await browser.version()
  try {
    await exercisePrimaryFlow(browser, evidence)
    for (const viewport of VIEWPORTS) await captureViewport(browser, evidence, viewport)

    evidence.expectedConsole = evidence.console.filter((entry) =>
      entry.text.includes('Failed to load resource: the server responded with a status of 503'),
    )
    evidence.unexpectedConsole = evidence.console.filter(
      (entry) => !entry.text.includes('Failed to load resource: the server responded with a status of 503'),
    )
    const documentOverflowPx = Math.max(
      0,
      ...evidence.screenshots.map((screenshot) => screenshot.document_overflow_px),
    )
    const longTextOverflowCount = evidence.visualDiagnostics.longTextOverflow.reduce(
      (count, viewport) => count + viewport.items.length,
      0,
    )
    recordAssertion(evidence, 'documentOverflowPx', documentOverflowPx, 0)
    recordAssertion(evidence, 'longTextOverflowCount', longTextOverflowCount, 0)
    recordAssertion(
      evidence,
      'duplicateNextPageControls',
      evidence.visualDiagnostics.duplicateNextPageControls,
      0,
    )
    recordAssertion(evidence, 'unexpectedConsole.length', evidence.unexpectedConsole.length, 0)
    recordAssertion(evidence, 'pageErrors.length', evidence.pageErrors.length, 0)
    recordAssertion(evidence, 'unexpectedRequests.length', evidence.unexpectedRequests.length, 0)
    recordAssertion(evidence, 'screenshotCount', evidence.screenshots.length, 3)
    evidence.status = 'pass'
  } catch (error) {
    evidence.status = 'fail'
    evidence.failure = error instanceof Error ? error.stack ?? error.message : String(error)
    throw error
  } finally {
    evidence.completedAt = new Date().toISOString()
    await writeFile(path.join(OUTPUT, 'results.json'), `${JSON.stringify(evidence, null, 2)}\n`)
    await browser.close()
  }
}

await main()
