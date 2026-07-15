import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ARTIFACT_FILES,
  EXPECTED_PROJECT_HEADERS,
  PHASE26_SCENARIOS,
  VIEWPORTS,
  capturedEditLock,
  isBoxInsideViewport,
  isGridFocusTarget,
  isSameOriginResourceFailure,
  parseBrowserQaArgs,
  safeArtifactName,
} from './phase26_browser_qa.mjs'

test('CLI requires isolated HTTP endpoints and an output directory', () => {
  assert.deepEqual(
    parseBrowserQaArgs([
      '--base-url',
      'http://127.0.0.1:15174',
      '--api-url',
      'http://127.0.0.1:18000/api',
      '--output',
      '/tmp/evidence',
    ]),
    {
      baseUrl: 'http://127.0.0.1:15174',
      apiUrl: 'http://127.0.0.1:18000/api',
      output: '/tmp/evidence',
      help: false,
    },
  )
  assert.throws(
    () => parseBrowserQaArgs(['--base-url', 'https://example.invalid', '--api-url', 'x', '--output', 'y']),
    /loopback HTTP/,
  )
  assert.throws(
    () => parseBrowserQaArgs(['--base-url', 'http://127.0.0.1:5173', '--api-url', 'http://127.0.0.1:18000/api', '--output', '/tmp/evidence']),
    /15174/,
  )
  assert.throws(
    () => parseBrowserQaArgs(['--base-url', 'http://127.0.0.1:15174', '--api-url', 'http://127.0.0.1:8000/api', '--output', '/tmp/evidence']),
    /18000/,
  )
  assert.throws(() => parseBrowserQaArgs(['--base-url', 'http://127.0.0.1:15174']), /Missing/)
})

test('captures only successful browser edit-lock acquisitions for deterministic cleanup', () => {
  assert.deepEqual(capturedEditLock({
    scenario: 'sheet.choice-keyboard-focus-a11y',
    method: 'POST',
    path: '/api/projects/42/lock',
    status: 200,
    body: { lock_token: 'opaque-task15-token' },
  }), {
    scenario: 'sheet.choice-keyboard-focus-a11y',
    projectId: 42,
    lockToken: 'opaque-task15-token',
  })
  assert.equal(capturedEditLock({
    scenario: 'sheet.choice-keyboard-focus-a11y',
    method: 'POST',
    path: '/api/projects/42/lock/heartbeat',
    status: 200,
    body: { lock_token: 'opaque-task15-token' },
  }), null)
  assert.equal(capturedEditLock({
    scenario: 'project.profile-lock-fencing-recovery',
    method: 'POST',
    path: '/api/projects/42/lock',
    status: 409,
    body: { lock_token: 'not-acquired' },
  }), null)
})

test('accepts both Glide canvas and its semantic gridcell as restored grid focus', () => {
  assert.equal(isGridFocusTarget({ tag: 'CANVAS', role: null, inGrid: true }), true)
  assert.equal(isGridFocusTarget({ tag: 'TD', role: 'gridcell', inGrid: true }), true)
  assert.equal(isGridFocusTarget({ tag: 'BODY', role: null, inGrid: false }), false)
  assert.equal(isGridFocusTarget({ tag: 'INPUT', role: null, inGrid: true }), false)
})

test('requires responsive overlay bounds to settle fully inside the viewport', () => {
  const viewport = { width: 1024, height: 768 }
  assert.equal(isBoxInsideViewport({ x: 622, y: 163, width: 384, height: 108 }, viewport), true)
  assert.equal(isBoxInsideViewport({ x: 700, y: 163, width: 384, height: 108 }, viewport), false)
  assert.equal(isBoxInsideViewport(null, viewport), false)
})

test('fails same-origin static resource errors even when an intentional API fault is active', () => {
  const baseUrl = 'http://127.0.0.1:15174'
  assert.equal(isSameOriginResourceFailure({ url: `${baseUrl}/assets/app.js`, status: 404 }, baseUrl), true)
  assert.equal(isSameOriginResourceFailure({ url: `${baseUrl}/projects/1`, status: 200 }, baseUrl), false)
  assert.equal(isSameOriginResourceFailure({ url: 'https://example.invalid/app.js', status: 500 }, baseUrl), false)
})

test('manifest covers every serial acceptance lane without duplicate IDs or skips', () => {
  const ids = PHASE26_SCENARIOS.map(({ id }) => id)
  assert.equal(new Set(ids).size, ids.length)
  assert.deepEqual([...new Set(PHASE26_SCENARIOS.map(({ lane }) => lane))].sort(), [
    'accessibility',
    'choice-admin',
    'project',
    'responsive',
    'sheet',
  ])

  for (const required of [
    'project.wizard-required-choice-retry-create',
    'project.list-history-collapse',
    'project.profile-lock-fencing-recovery',
    'choice.lifecycle-search-reorder-warning',
    'choice.csv-preview-atomic-conflict',
    'choice.pagination-version-restart',
    'sheet.choice-keyboard-focus-a11y',
    'sheet.fail-closed-cache-version-refresh',
    'sheet.inactive-raw-decimal-paste',
    'sheet.shared-resource-live-discovery',
    'responsive.three-viewports',
    'accessibility.aria-focus-overflow',
  ]) {
    assert(ids.includes(required), `missing scenario ${required}`)
  }
  assert(PHASE26_SCENARIOS.every(({ required }) => required === true))
})

test('viewport and artifact contracts are deterministic', () => {
  assert.deepEqual(VIEWPORTS, [
    { name: '1024x768', width: 1024, height: 768 },
    { name: '1440x900', width: 1440, height: 900 },
    { name: '1920x1080', width: 1920, height: 1080 },
  ])
  assert.deepEqual(ARTIFACT_FILES, {
    results: 'results.json',
    network: 'network.jsonl',
    console: 'console.jsonl',
    ariaDirectory: 'aria',
    screenshotDirectory: 'screenshots',
  })
  assert.deepEqual(EXPECTED_PROJECT_HEADERS, {
    '1024x768': ['프로젝트명', 'LINE / Process', 'PARTID', 'Device Type', 'Category', '상태'],
    '1440x900': ['프로젝트명', 'LINE / Process', 'PARTID', 'Device Type', 'Category', '상태', 'Updated'],
    '1920x1080': ['프로젝트명', 'LINE / Process', 'PARTID', 'Device Type', 'Category', 'Layer Total', '상태', 'Updated'],
  })
  assert.equal(safeArtifactName('sheet.choice / 1024×768'), 'sheet.choice-1024x768')
  assert.throws(() => safeArtifactName('../escape'), /artifact name/)
})
