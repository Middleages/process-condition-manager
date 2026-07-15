import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
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
  classifySameOriginResponse,
  parseBrowserQaArgs,
  resetEvidenceArtifacts,
  safeArtifactName,
  summarizeChromiumGridAccessibility,
  validateAriaSnapshot,
  validateBackendContainerInspection,
  validateGlideGridDomContract,
  verifyStaticResponseEvidence,
} from './phase26_browser_qa.mjs'

test('CLI requires isolated HTTP endpoints and an output directory', () => {
  const valid = [
    '--base-url', 'http://127.0.0.1:15174',
    '--api-url', 'http://127.0.0.1:18000/api',
    '--manifest', '/tmp/evidence/build-manifest.json',
    '--backend-container', 'pcm-phase26-qa-backend-1',
    '--output', '/tmp/evidence',
  ]
  assert.deepEqual(
    parseBrowserQaArgs(valid),
    {
      baseUrl: 'http://127.0.0.1:15174',
      apiUrl: 'http://127.0.0.1:18000/api',
      manifest: '/tmp/evidence/build-manifest.json',
      backendContainer: 'pcm-phase26-qa-backend-1',
      output: '/tmp/evidence',
      help: false,
    },
  )
  assert.throws(
    () => parseBrowserQaArgs(valid.map((value) => value === 'http://127.0.0.1:15174' ? 'https://example.invalid' : value)),
    /loopback HTTP/,
  )
  assert.throws(
    () => parseBrowserQaArgs(valid.map((value) => value === 'http://127.0.0.1:15174' ? 'http://127.0.0.1:5173' : value)),
    /15174/,
  )
  assert.throws(
    () => parseBrowserQaArgs(valid.map((value) => value === 'http://127.0.0.1:18000/api' ? 'http://127.0.0.1:8000/api' : value)),
    /18000/,
  )
  assert.throws(() => parseBrowserQaArgs(['--base-url', 'http://127.0.0.1:15174']), /Missing/)
})

test('evidence cleanup preserves the exact build manifest bytes while removing prior artifacts', async (t) => {
  const output = await mkdtemp(path.join(tmpdir(), 'pcm-phase26-evidence-cleanup-'))
  t.after(() => rm(output, { recursive: true, force: true }))
  const manifest = path.join(output, 'build-manifest.json')
  const manifestBytes = Buffer.from('{"manifest_sha256":"immutable"}\n')
  await writeFile(manifest, manifestBytes)
  await writeFile(path.join(output, 'results.json'), '{"stale":true}\n')
  await mkdir(path.join(output, 'screenshots'))
  await writeFile(path.join(output, 'screenshots', 'stale.png'), 'stale')

  await resetEvidenceArtifacts(output, manifest)

  assert.deepEqual(await readFile(manifest), manifestBytes)
  await assert.rejects(readFile(path.join(output, 'results.json')), /ENOENT/)
  await assert.rejects(readFile(path.join(output, 'screenshots', 'stale.png')), /ENOENT/)
})

test('backend provenance requires the bound running labeled image and zero mounts', () => {
  const sha = 'a'.repeat(40)
  const container = {
    Id: 'container-id',
    Name: '/pcm-phase26-qa-backend-1',
    Image: 'sha256:image-id',
    State: { Running: true },
    HostConfig: { ReadonlyRootfs: true },
    Mounts: [],
    NetworkSettings: {
      Ports: { '8000/tcp': [{ HostIp: '127.0.0.1', HostPort: '18000' }] },
    },
  }
  const image = {
    Id: 'sha256:image-id',
    Config: { Labels: { 'org.process-condition-manager.phase26.git-sha': sha } },
  }

  assert.deepEqual(validateBackendContainerInspection({ container, image, expectedGitSha: sha }), {
    container_id: 'container-id',
    container_name: 'pcm-phase26-qa-backend-1',
    image_id: 'sha256:image-id',
    git_sha_label: sha,
    running: true,
    readonly_rootfs: true,
    mounts: [],
    published_endpoint: {
      container_port: '8000/tcp',
      host_ip: '127.0.0.1',
      host_port: 18000,
    },
  })
  assert.throws(() => validateBackendContainerInspection({
    container: { ...container, Mounts: [{ Type: 'bind', Source: '/worktree/backend', Destination: '/app' }] },
    image,
    expectedGitSha: sha,
  }), /must not have mounts/i)
  assert.throws(() => validateBackendContainerInspection({
    container: { ...container, Mounts: [{ Type: 'volume', Source: 'override', Destination: '/app/config' }] },
    image,
    expectedGitSha: sha,
  }), /must not have mounts/i)
  assert.throws(() => validateBackendContainerInspection({
    container: { ...container, Mounts: [{ Type: 'volume', Source: 'qa-cache', Destination: '/cache' }] },
    image,
    expectedGitSha: sha,
  }), /must not have mounts/i)
  assert.throws(() => validateBackendContainerInspection({
    container,
    image: { ...image, Config: { Labels: {} } },
    expectedGitSha: sha,
  }), /image label/i)
  assert.throws(() => validateBackendContainerInspection({
    container: { ...container, State: { Running: false } },
    image,
    expectedGitSha: sha,
  }), /running/i)
  assert.throws(() => validateBackendContainerInspection({
    container: { ...container, HostConfig: { ReadonlyRootfs: false } },
    image,
    expectedGitSha: sha,
  }), /read-only root filesystem/i)
  assert.throws(() => validateBackendContainerInspection({
    container: {
      ...container,
      NetworkSettings: { Ports: { '8000/tcp': [{ HostIp: '0.0.0.0', HostPort: '18000' }] } },
    },
    image,
    expectedGitSha: sha,
  }), /127\.0\.0\.1:18000/)
  assert.throws(() => validateBackendContainerInspection({
    container: {
      ...container,
      NetworkSettings: { Ports: { '8000/tcp': [{ HostIp: '127.0.0.1', HostPort: '18001' }] } },
    },
    image,
    expectedGitSha: sha,
  }), /127\.0\.0\.1:18000/)
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
  assert.equal(isSameOriginResourceFailure({ url: `${baseUrl}/assets/app.js`, status: 302 }, baseUrl), true)
  assert.equal(isSameOriginResourceFailure({ url: `${baseUrl}/projects/1`, status: 200 }, baseUrl), false)
  assert.equal(isSameOriginResourceFailure({ url: 'https://example.invalid/app.js', status: 500 }, baseUrl), false)
})

test('classifies same-origin API responses only by parsed pathname', () => {
  const baseUrl = 'http://127.0.0.1:15174'
  assert.equal(classifySameOriginResponse(`${baseUrl}/api`, baseUrl), 'api')
  assert.equal(classifySameOriginResponse(`${baseUrl}/api/projects?next=%2Fassets`, baseUrl), 'api')
  assert.equal(classifySameOriginResponse(`${baseUrl}/assets/app.js?next=/api/projects`, baseUrl), 'static')
  assert.equal(classifySameOriginResponse('https://example.invalid/api/projects', baseUrl), 'external')
})

test('static response evidence rejects redirects, header mismatch, and body mismatch', () => {
  const body = Buffer.from('export const ready = true\n')
  const sha256 = 'c8cc3b8229cc1798eb1418e32a71060dc19458c8a183dfd071bc43ec94a798a3'
  const manifest = {
    manifest_sha256: 'a'.repeat(64),
    source: { git_sha: 'b'.repeat(40) },
    dist: {
      identity_sha256: 'c'.repeat(64),
      files: [{ path: 'assets/app.js', bytes: body.length, sha256 }],
    },
  }
  const headers = {
    'x-phase26-manifest-sha256': manifest.manifest_sha256,
    'x-phase26-dist-identity': manifest.dist.identity_sha256,
    'x-phase26-source-git-sha': manifest.source.git_sha,
    'x-phase26-file-path': 'assets/app.js',
    'x-phase26-file-sha256': sha256,
  }
  const input = {
    url: 'http://127.0.0.1:15174/assets/app.js?next=/api/projects',
    baseUrl: 'http://127.0.0.1:15174',
    status: 200,
    headers,
    body,
    manifest,
  }

  assert.deepEqual(verifyStaticResponseEvidence(input), {
    file_path: 'assets/app.js',
    body_sha256: sha256,
  })
  assert.throws(() => verifyStaticResponseEvidence({ ...input, status: 302 }), /2xx/)
  assert.throws(() => verifyStaticResponseEvidence({
    ...input,
    headers: { ...headers, 'x-phase26-file-sha256': 'd'.repeat(64) },
  }), /file hash header/)
  assert.throws(
    () => verifyStaticResponseEvidence({ ...input, body: Buffer.from('x'.repeat(body.length)) }),
    /body hash/,
  )
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

test('ARIA evidence rejects blank captures and proves the requested semantics', () => {
  assert.throws(
    () => validateAriaSnapshot(' \n', 'sheet-main-accessibility'),
    /sheet-main-accessibility.*blank/i,
  )
  assert.throws(
    () => validateAriaSnapshot('- main:\n  - heading "Sheet"', 'sheet-main-accessibility', [
      /textbox "컬럼 검색"/,
    ]),
    /필수 접근성 의미/,
  )
  assert.equal(
    validateAriaSnapshot(
      '  - main:\n    - textbox "컬럼 검색"\n',
      'sheet-main-accessibility',
      [/- main:/, /textbox "컬럼 검색"/],
    ),
    '- main:\n    - textbox "컬럼 검색"\n',
  )
})

test('Chromium grid evidence requires one exposed Canvas-owned grid with rows, headers, and cells', () => {
  const nodes = [
    { nodeId: 'canvas', backendDOMNodeId: 41, ignored: false, role: { value: 'Canvas' }, childIds: ['grid'] },
    {
      nodeId: 'grid',
      backendDOMNodeId: 42,
      ignored: false,
      role: { value: 'grid' },
      parentId: 'canvas',
      properties: [{ name: 'multiselectable', value: { value: true } }],
    },
    { nodeId: 'head-group', ignored: false, role: { value: 'rowgroup' }, parentId: 'grid' },
    { nodeId: 'head-row', ignored: false, role: { value: 'row' }, parentId: 'head-group' },
    { nodeId: 'h1', ignored: false, role: { value: 'columnheader' }, name: { value: 'Layer / Step' }, parentId: 'head-row' },
    { nodeId: 'h2', ignored: false, role: { value: 'columnheader' }, name: { value: '조건' }, parentId: 'head-row' },
    { nodeId: 'h3', ignored: false, role: { value: 'columnheader' }, name: { value: 'POR (○ 선택)' }, parentId: 'head-row' },
    { nodeId: 'body-group', ignored: false, role: { value: 'rowgroup' }, parentId: 'grid' },
    { nodeId: 'body-row', ignored: false, role: { value: 'row' }, parentId: 'body-group' },
    { nodeId: 'cell-1', ignored: false, role: { value: 'gridcell' }, name: { value: 'LYR00 (0000)' }, parentId: 'body-row' },
    { nodeId: 'cell-2', ignored: false, role: { value: 'gridcell' }, name: { value: 'base' }, parentId: 'body-row' },
    { nodeId: 'cell-3', ignored: false, role: { value: 'gridcell' }, name: { value: '●' }, parentId: 'body-row' },
  ]
  const summary = summarizeChromiumGridAccessibility({
    nodes,
    canvasBackendNodeId: 41,
    tableBackendNodeId: 42,
    tableContract: { ariaRowCount: 122, ariaColCount: 203 },
  })
  assert.equal(summary.grid.parent_role, 'Canvas')
  assert.deepEqual(summary.exposed_descendant_counts, {
    rowgroup: 2,
    row: 2,
    columnheader: 3,
    gridcell: 3,
  })
  assert.deepEqual(summary.first_column_headers, ['Layer / Step', '조건', 'POR (○ 선택)'])
  assert.deepEqual(summary.sample_gridcells, ['LYR00 (0000)', 'base', '●'])
  assert.throws(
    () => summarizeChromiumGridAccessibility({
      nodes: nodes.filter(({ nodeId }) => nodeId !== 'grid'),
      canvasBackendNodeId: 41,
      tableBackendNodeId: 42,
      tableContract: { ariaRowCount: 122, ariaColCount: 203 },
    }),
    /exactly one.*grid/i,
  )
  assert.throws(
    () => summarizeChromiumGridAccessibility({
      nodes: nodes.map((node) => node.nodeId === 'canvas' ? { ...node, role: { value: 'generic' } } : node),
      canvasBackendNodeId: 41,
      tableBackendNodeId: 42,
      tableContract: { ariaRowCount: 122, ariaColCount: 203 },
    }),
    /Canvas-owned/,
  )
  assert.throws(
    () => summarizeChromiumGridAccessibility({
      nodes: nodes.filter(({ nodeId }) => !nodeId.startsWith('cell-')),
      canvasBackendNodeId: 41,
      tableBackendNodeId: 42,
      tableContract: { ariaRowCount: 122, ariaColCount: 203 },
    }),
    /gridcell/,
  )
})

test('Glide DOM contract rejects implicit table and non-table grid duplicates', () => {
  const contract = {
    canvases: 2,
    tables: 1,
    roleGrids: 1,
    roleGridIsOnlyTable: true,
    canvasOwnedTables: 1,
    outsideCanvasTables: 0,
    outsideHostTables: 0,
    outsideHostRoleGrids: 0,
    ariaRowCount: 122,
    ariaColCount: 203,
  }
  assert.deepEqual(validateGlideGridDomContract(contract), contract)
  assert.throws(
    () => validateGlideGridDomContract({ ...contract, tables: 2 }),
    /exactly one HTML table/,
  )
  assert.throws(
    () => validateGlideGridDomContract({ ...contract, roleGrids: 2 }),
    /exactly one.*role=grid/,
  )
  assert.throws(
    () => validateGlideGridDomContract({ ...contract, outsideHostTables: 1 }),
    /parallel HTML table/,
  )
})
