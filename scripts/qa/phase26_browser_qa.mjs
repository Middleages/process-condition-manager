#!/usr/bin/env node

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { appendFile, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const VIEWPORTS = Object.freeze([
  Object.freeze({ name: '1024x768', width: 1024, height: 768 }),
  Object.freeze({ name: '1440x900', width: 1440, height: 900 }),
  Object.freeze({ name: '1920x1080', width: 1920, height: 1080 }),
])

export const EXPECTED_PROJECT_HEADERS = Object.freeze({
  '1024x768': Object.freeze(['프로젝트명', 'LINE / Process', 'PARTID', 'Device Type', 'Category', '상태']),
  '1440x900': Object.freeze(['프로젝트명', 'LINE / Process', 'PARTID', 'Device Type', 'Category', '상태', 'Updated']),
  '1920x1080': Object.freeze(['프로젝트명', 'LINE / Process', 'PARTID', 'Device Type', 'Category', 'Layer Total', '상태', 'Updated']),
})

export const ARTIFACT_FILES = Object.freeze({
  results: 'results.json',
  network: 'network.jsonl',
  console: 'console.jsonl',
  ariaDirectory: 'aria',
  screenshotDirectory: 'screenshots',
})

export const PHASE26_SCENARIOS = Object.freeze([
  { id: 'project.wizard-required-choice-retry-create', lane: 'project', required: true },
  { id: 'project.list-history-collapse', lane: 'project', required: true },
  { id: 'project.profile-lock-fencing-recovery', lane: 'project', required: true },
  { id: 'choice.lifecycle-search-reorder-warning', lane: 'choice-admin', required: true },
  { id: 'choice.csv-preview-atomic-conflict', lane: 'choice-admin', required: true },
  { id: 'choice.pagination-version-restart', lane: 'choice-admin', required: true },
  { id: 'sheet.choice-keyboard-focus-a11y', lane: 'sheet', required: true },
  { id: 'sheet.fail-closed-cache-version-refresh', lane: 'sheet', required: true },
  { id: 'sheet.inactive-raw-decimal-paste', lane: 'sheet', required: true },
  { id: 'sheet.shared-resource-live-discovery', lane: 'sheet', required: true },
  { id: 'responsive.three-viewports', lane: 'responsive', required: true },
  { id: 'accessibility.aria-focus-overflow', lane: 'accessibility', required: true },
])

const QA_SET = 'qa_browser_choices'
const EQUIPMENT_SET = 'equipment_mode'
const DEFAULT_VIEWPORT = VIEWPORTS[1]
const JSON_HEADERS = { 'content-type': 'application/json' }

export function parseBrowserQaArgs(argv) {
  const parsed = {
    baseUrl: null,
    apiUrl: null,
    manifest: null,
    backendContainer: null,
    output: null,
    help: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help' || argument === '-h') {
      parsed.help = true
      continue
    }
    if (!['--base-url', '--api-url', '--manifest', '--backend-container', '--output'].includes(argument)) {
      throw new Error(`Unknown argument: ${argument}`)
    }
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${argument}`)
    index += 1
    if (argument === '--base-url') parsed.baseUrl = value.replace(/\/$/, '')
    if (argument === '--api-url') parsed.apiUrl = value.replace(/\/$/, '')
    if (argument === '--manifest') parsed.manifest = value
    if (argument === '--backend-container') parsed.backendContainer = value
    if (argument === '--output') parsed.output = value
  }
  if (parsed.help) return parsed
  const missing = []
  if (parsed.baseUrl === null) missing.push('--base-url')
  if (parsed.apiUrl === null) missing.push('--api-url')
  if (parsed.manifest === null) missing.push('--manifest')
  if (parsed.backendContainer === null) missing.push('--backend-container')
  if (parsed.output === null) missing.push('--output')
  if (missing.length > 0) throw new Error(`Missing required arguments: ${missing.join(', ')}`)
  assertLoopbackHttp(parsed.baseUrl, '--base-url')
  assertLoopbackHttp(parsed.apiUrl, '--api-url')
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(parsed.backendContainer)) {
    throw new Error('--backend-container must be a safe Docker container name')
  }
  return parsed
}

export function safeArtifactName(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('..')) {
    throw new Error('Unsafe artifact name')
  }
  const safe = value
    .normalize('NFKD')
    .replace(/×/g, 'x')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  if (safe.length === 0 || safe.length > 160) throw new Error('Unsafe artifact name')
  return safe
}

export function capturedEditLock({ scenario, method, path: apiPath, status, body }) {
  const match = apiPath.match(/^\/api\/projects\/(\d+)\/lock$/)
  if (
    scenario === null || method !== 'POST' || !Number.isInteger(status) || status < 200 || status >= 300 || match === null ||
    typeof body?.lock_token !== 'string' || body.lock_token.length === 0
  ) return null
  return { scenario, projectId: Number(match[1]), lockToken: body.lock_token }
}

export function isGridFocusTarget({ tag, role, inGrid }) {
  return inGrid === true && (tag === 'CANVAS' || role === 'gridcell')
}

export function isBoxInsideViewport(box, viewport) {
  return box !== null && box.x >= 0 && box.y >= 0 &&
    box.x + box.width <= viewport.width && box.y + box.height <= viewport.height
}

export function isSameOriginResourceFailure(response, baseUrl) {
  return classifySameOriginResponse(response.url, baseUrl) === 'static' &&
    (!Number.isInteger(response.status) || response.status < 200 || response.status >= 300)
}

export function classifySameOriginResponse(rawUrl, baseUrl) {
  const url = new URL(rawUrl)
  if (url.origin !== new URL(baseUrl).origin) return 'external'
  return isApiPath(url.pathname) ? 'api' : 'static'
}

export function verifyStaticResponseEvidence({ url, baseUrl, status, headers, body, manifest }) {
  assert.equal(classifySameOriginResponse(url, baseUrl), 'static', 'response is not a same-origin static response')
  assert(Number.isInteger(status) && status >= 200 && status < 300, `static response must be 2xx, got ${status}`)
  const responseHeaders = headerReader(headers)
  assert.equal(
    responseHeaders('x-phase26-manifest-sha256'),
    manifest.manifest_sha256,
    'static manifest hash header mismatch',
  )
  assert.equal(
    responseHeaders('x-phase26-dist-identity'),
    manifest.dist.identity_sha256,
    'static dist identity header mismatch',
  )
  assert.equal(
    responseHeaders('x-phase26-source-git-sha'),
    manifest.source.git_sha,
    'static source Git SHA header mismatch',
  )
  const requestUrl = new URL(url)
  const decoded = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '')
  const fileMap = new Map(manifest.dist.files.map((entry) => [entry.path, entry]))
  const expectedPath = fileMap.has(decoded)
    ? decoded
    : isAssetLikeBrowserPath(requestUrl.pathname) ? null : 'index.html'
  assert.notEqual(expectedPath, null, `static asset is absent from manifest: ${requestUrl.pathname}`)
  const expected = fileMap.get(expectedPath)
  assert(expected, `manifest has no expected static file: ${expectedPath}`)
  assert.equal(responseHeaders('x-phase26-file-path'), expectedPath, 'static file path header mismatch')
  assert.equal(responseHeaders('x-phase26-file-sha256'), expected.sha256, 'static file hash header mismatch')
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body)
  assert.equal(bytes.length, expected.bytes, 'static response body byte count mismatch')
  const bodySha256 = createHash('sha256').update(bytes).digest('hex')
  assert.equal(bodySha256, expected.sha256, 'static response body hash mismatch')
  return { file_path: expectedPath, body_sha256: bodySha256 }
}

export function validateBackendContainerInspection({ container, image, expectedGitSha }) {
  assert.equal(container?.State?.Running, true, 'backend container must be running')
  assert.equal(
    container?.HostConfig?.ReadonlyRootfs,
    true,
    'authoritative backend container must use a read-only root filesystem',
  )
  assert.equal(container?.Image, image?.Id, 'backend container image ID does not match inspected image')
  const label = image?.Config?.Labels?.['org.process-condition-manager.phase26.git-sha'] ?? null
  assert.equal(label, expectedGitSha, 'backend image label does not match the production Git SHA')
  assert(Array.isArray(container?.Mounts), 'backend container mount inspection is missing')
  const mounts = container.Mounts.map(({ Type, Source, Destination }) => ({
    type: Type,
    source: Source ?? null,
    destination: Destination,
  }))
  assert.deepEqual(mounts, [], 'authoritative backend container must not have mounts')
  const publishedBindings = container?.NetworkSettings?.Ports?.['8000/tcp']
  assert(
    Array.isArray(publishedBindings) && publishedBindings.length === 1,
    'backend container must publish exactly 127.0.0.1:18000 for 8000/tcp',
  )
  const [publishedBinding] = publishedBindings
  assert.deepEqual(
    { HostIp: publishedBinding?.HostIp, HostPort: publishedBinding?.HostPort },
    { HostIp: '127.0.0.1', HostPort: '18000' },
    'backend container must publish exactly 127.0.0.1:18000 for 8000/tcp',
  )
  assert.match(container?.Id ?? '', /.+/, 'backend container ID is missing')
  assert.match(image?.Id ?? '', /^sha256:.+/, 'backend image ID is missing')
  return {
    container_id: container.Id,
    container_name: String(container.Name ?? '').replace(/^\//, ''),
    image_id: image.Id,
    git_sha_label: label,
    running: true,
    readonly_rootfs: true,
    mounts,
    published_endpoint: {
      container_port: '8000/tcp',
      host_ip: publishedBinding.HostIp,
      host_port: Number(publishedBinding.HostPort),
    },
  }
}

function headerReader(headers) {
  if (headers && typeof headers.get === 'function') return (name) => headers.get(name)
  const normalized = Object.fromEntries(
    Object.entries(headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]),
  )
  return (name) => normalized[name.toLowerCase()] ?? null
}

function isApiPath(pathname) {
  return pathname === '/api' || pathname.startsWith('/api/')
}

function isAssetLikeBrowserPath(pathname) {
  return pathname === '/assets' || pathname.startsWith('/assets/') || path.posix.extname(pathname) !== ''
}

function assertLoopbackHttp(raw, name) {
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`${name} must be a loopback HTTP URL`)
  }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') {
    throw new Error(`${name} must be a loopback HTTP URL`)
  }
  const contract = name === '--base-url'
    ? { port: '15174', path: '/' }
    : { port: '18000', path: '/api' }
  if (url.port !== contract.port) throw new Error(`${name} must use isolated port ${contract.port}`)
  if (url.pathname !== contract.path || url.search !== '' || url.hash !== '' || url.username !== '' || url.password !== '') {
    throw new Error(`${name} must be the exact isolated Task 15 endpoint`)
  }
}

function usage() {
  return [
    'Usage: node phase26_browser_qa.mjs --base-url http://127.0.0.1:15174',
    '  --api-url http://127.0.0.1:18000/api --manifest <build-manifest.json>',
    '  --backend-container <immutable-container> --output <evidence-directory>',
    '',
  ].join('\n')
}

class BrowserQa {
  constructor(args, playwright, playwrightVersion) {
    this.args = args
    this.playwright = playwright
    this.playwrightVersion = playwrightVersion
    this.output = path.resolve(args.output)
    this.screenshots = path.join(this.output, ARTIFACT_FILES.screenshotDirectory)
    this.aria = path.join(this.output, ARTIFACT_FILES.ariaDirectory)
    this.results = []
    this.network = []
    this.console = []
    this.networkTasks = []
    this.pendingApiRequests = new Map()
    this.pageSequence = 0
    this.currentScenario = null
    this.browser = null
    this.apiContext = null
    this.provenance = null
    this.buildManifest = null
    this.seedProject = null
    this.createdProjects = []
    this.fixtureProcesses = []
    this.openContexts = new Map()
    this.lockTokens = new Map()
  }

  async run() {
    assertSafeEvidenceOutput(this.output)
    this.provenance = await sourceProvenance(this.output, this.args.manifest, this.args.backendContainer)
    assert.equal(this.provenance.worktree_clean_except_evidence, true, 'source tree must be clean except the evidence leaf')
    this.buildManifest = this.provenance.production_build
    await resetEvidenceArtifacts(this.output, this.args.manifest)
    await mkdir(this.screenshots, { recursive: true })
    await mkdir(this.aria, { recursive: true })
    this.browser = await this.playwright.chromium.launch({ headless: true })
    this.apiContext = await this.playwright.request.newContext({
      extraHTTPHeaders: { accept: 'application/json' },
    })
    const startedAt = new Date().toISOString()
    let fatal = null
    try {
      await this.prepareDeterministicState()
      const implementations = new Map([
        ['project.wizard-required-choice-retry-create', () => this.projectWizardScenario()],
        ['project.list-history-collapse', () => this.projectListScenario()],
        ['project.profile-lock-fencing-recovery', () => this.profileScenario()],
        ['choice.lifecycle-search-reorder-warning', () => this.choiceLifecycleScenario()],
        ['choice.csv-preview-atomic-conflict', () => this.choiceCsvScenario()],
        ['choice.pagination-version-restart', () => this.choicePaginationScenario()],
        ['sheet.choice-keyboard-focus-a11y', () => this.sheetChoiceScenario()],
        ['sheet.fail-closed-cache-version-refresh', () => this.sheetFailClosedScenario()],
        ['sheet.inactive-raw-decimal-paste', () => this.sheetValueScenario()],
        ['sheet.shared-resource-live-discovery', () => this.sheetLiveDiscoveryScenario()],
        ['responsive.three-viewports', () => this.responsiveScenario()],
        ['accessibility.aria-focus-overflow', () => this.accessibilityScenario()],
      ])
      for (const scenario of PHASE26_SCENARIOS) {
        await this.runScenario(scenario, implementations.get(scenario.id))
      }
      await this.assertNetworkEvidenceComplete()
      this.assertNoUnexpectedBrowserErrors()
    } catch (error) {
      fatal = serializeError(error)
    } finally {
      await this.releaseAllLocksBestEffort()
      await this.apiContext?.dispose()
      await this.browser?.close()
      await this.flushArtifacts({ startedAt, fatal })
    }
    const failures = this.results.filter((result) => result.status !== 'passed')
    if (fatal !== null || failures.length > 0) {
      throw new Error(
        `Phase 2.6 browser QA failed: fatal=${fatal?.message ?? 'none'}, scenarios=${failures.map(({ id }) => id).join(', ') || 'none'}`,
      )
    }
  }

  async runScenario(scenario, implementation) {
    const started = Date.now()
    this.currentScenario = scenario.id
    let details = null
    let failure = null
    let cleanupFailure = null
    try {
      assert.equal(typeof implementation, 'function', `No implementation for ${scenario.id}`)
      details = await implementation()
    } catch (error) {
      failure = error
    }
    try {
      await this.cleanupScenarioContexts(scenario.id)
    } catch (cleanupError) {
      cleanupFailure = cleanupError
      failure = failure === null
        ? cleanupError
        : new Error(
          `${failure instanceof Error ? failure.message : String(failure)}; scenario cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
          { cause: failure },
        )
    }
    if (failure === null) {
      this.results.push({ ...scenario, status: 'passed', duration_ms: Date.now() - started, details })
      process.stdout.write(`PASS ${scenario.id}\n`)
    } else {
      const serialized = serializeError(failure)
      this.results.push({
        ...scenario,
        status: 'failed',
        duration_ms: Date.now() - started,
        error: serialized,
      })
      process.stderr.write(`FAIL ${scenario.id}: ${serialized.message}\n`)
    }
    this.currentScenario = null
    if (cleanupFailure !== null) throw cleanupFailure
  }

  async flushArtifacts({ startedAt, fatal }) {
    await Promise.allSettled(this.networkTasks)
    const browserVersion = this.browser?.version() ?? null
    const completedProvenance = await sourceProvenance(this.output, this.args.manifest, this.args.backendContainer)
    assert.deepEqual(completedProvenance, this.provenance, 'source/build provenance changed during browser evidence')
    const payload = {
      schema_version: 1,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      source: {
        base_url: this.args.baseUrl,
        api_url: this.args.apiUrl,
        ...this.provenance,
      },
      runtime: {
        playwright: this.playwrightVersion,
        chromium: browserVersion,
        node: process.version,
      },
      fatal,
      totals: {
        required: PHASE26_SCENARIOS.length,
        passed: this.results.filter(({ status }) => status === 'passed').length,
        failed: this.results.filter(({ status }) => status === 'failed').length,
        skipped: 0,
      },
      scenarios: this.results,
    }
    await writeFile(path.join(this.output, ARTIFACT_FILES.results), `${JSON.stringify(payload, null, 2)}\n`)
    await writeJsonLines(path.join(this.output, ARTIFACT_FILES.network), this.network)
    await writeJsonLines(path.join(this.output, ARTIFACT_FILES.console), this.console)
  }

  async prepareDeterministicState() {
    await this.assertProxyProvenance()
    const health = await this.apiRaw('/../health', { expected: 200, absoluteFromApiParent: true })
    const healthBody = JSON.parse(await health.text())
    assert.equal(healthBody.status, 'ok')
    assert.equal(healthBody.app, 'process-condition-manager')
    const projectList = await this.apiJson('/projects?limit=200', { expected: 200 })
    assert.equal(
      projectList.items.length,
      1,
      'browser QA requires a freshly recreated pcm-phase26-qa stack (exactly one seed project)',
    )
    this.seedProject = projectList.items.find(({ process_id }) => process_id === 'PROC_SEED') ?? projectList.items[0]
    const processes = await this.apiJson('/processes?limit=50', { expected: 200 })
    this.fixtureProcesses = processes.items
    assert(this.fixtureProcesses.length >= 2, 'two fixture processes are required')

    let qaSummary = await this.apiJson(`/choice-sets/${QA_SET}`, { expected: 404 })
    assert.equal(qaSummary.__status, 404, 'browser QA fixture was already mutated; recreate the isolated stack')
    qaSummary = await this.apiJson('/choice-sets', {
      expected: 201,
      method: 'POST',
      data: { code: QA_SET, display_name: 'QA browser choices', description: 'Task 15 isolated browser fixture' },
    })
    const qaCsv = [
      'code,label,sort_order,is_active',
      'QA_ALPHA,QA Alpha,10,true',
      'QA_BETA,QA Beta,20,true',
      'QA_GAMMA,QA Gamma,30,true',
      'QA_LEGACY,QA Legacy,40,false',
    ].join('\n')
    await this.apiJson(`/choice-sets/${QA_SET}/import`, {
      expected: 200,
      method: 'POST',
      data: { expected_version: qaSummary.version, csv_text: qaCsv },
    })

    let equipment = await this.apiJson(`/choice-sets/${EQUIPMENT_SET}`, { expected: 200 })
    assert.equal(equipment.option_count, 320, 'equipment fixture must be pristine')
    assert.equal(equipment.active_option_count, 300, 'equipment fixture active count must be pristine')
    const mode002 = await this.apiJson(`/choice-sets/${EQUIPMENT_SET}/options?q=MODE_002&version=${equipment.version}&include_inactive=true`, { expected: 200 })
    assert.equal(mode002.items[0]?.is_active, true, 'MODE_002 must begin active; recreate the isolated stack')
    const rows = ['code,label,sort_order,is_active']
    for (let index = 0; index < 220; index += 1) {
      rows.push(`QA_PAGE_${String(index).padStart(3, '0')},QA page option ${String(index).padStart(3, '0')},${10_000 + index},true`)
    }
    equipment = (
      await this.apiJson(`/choice-sets/${EQUIPMENT_SET}/import`, {
        expected: 200,
        method: 'POST',
        data: { expected_version: equipment.version, csv_text: rows.join('\n') },
      })
    ).choice_set
    assert(equipment.option_count > 500, `equipment set must paginate, got ${equipment.option_count}`)
    return { seedProjectId: this.seedProject.id, equipmentOptions: equipment.option_count }
  }

  async assertProxyProvenance() {
    const response = await this.apiContext.get(`${this.args.baseUrl}/api/projects?limit=1`, {
      headers: { accept: 'application/json' },
    })
    assert.equal(response.status(), 200, `production proxy provenance probe failed: ${response.status()}`)
    assert.equal(
      response.headers()['x-phase26-backend-git-sha'],
      this.buildManifest.source.git_sha,
      'production proxy backend identity header mismatch',
    )
    assert.equal(
      response.headers()['x-phase26-manifest-sha256'],
      this.buildManifest.manifest_sha256,
      'production proxy manifest header mismatch',
    )
    const body = await response.body()
    this.network.push({
      at: new Date().toISOString(),
      scenario: null,
      context: 'provenance-probe',
      source: 'production-proxy',
      phase: 'response',
      method: 'GET',
      url: `${this.args.baseUrl}/api/projects?limit=1`,
      path: '/api/projects',
      query: { limit: '1' },
      status: response.status(),
      body_sha256: createHash('sha256').update(body).digest('hex'),
      response_version: null,
      backend_git_sha: response.headers()['x-phase26-backend-git-sha'],
      manifest_sha256: response.headers()['x-phase26-manifest-sha256'],
    })
  }

  async apiRaw(apiPath, { expected, method = 'GET', data, headers, absoluteFromApiParent = false } = {}) {
    const url = absoluteFromApiParent
      ? new URL(apiPath, `${this.args.apiUrl}/`).href
      : `${this.args.apiUrl}${apiPath}`
    const response = await this.apiContext.fetch(url, {
      method,
      data,
      headers: data === undefined ? headers : { ...JSON_HEADERS, ...headers },
    })
    const parsedUrl = new URL(url)
    const body = await response.body()
    let responseVersion = null
    if (body.length > 0) {
      try { responseVersion = responseVersionFromBody(JSON.parse(body.toString('utf8'))) } catch { responseVersion = null }
    }
    this.network.push({
      at: new Date().toISOString(),
      scenario: this.currentScenario,
      context: 'setup-api',
      source: 'setup-api',
      phase: 'response',
      method,
      url,
      path: parsedUrl.pathname,
      query: Object.fromEntries(parsedUrl.searchParams),
      status: response.status(),
      request_body_sha256: data === undefined ? null : sha256Json(data),
      body_sha256: createHash('sha256').update(body).digest('hex'),
      response_version: responseVersion,
    })
    const allowed = Array.isArray(expected) ? expected : [expected]
    assert(allowed.includes(response.status()), `${method} ${url}: expected ${allowed}, got ${response.status()} ${await response.text()}`)
    return response
  }

  async apiJson(apiPath, options = {}) {
    const response = await this.apiRaw(apiPath, options)
    const status = response.status()
    const text = await response.text()
    if (status === 204) return { __status: status }
    let body
    try {
      body = JSON.parse(text)
    } catch {
      throw new Error(`${options.method ?? 'GET'} ${apiPath} returned non-JSON: ${text}`)
    }
    return status === 404 ? { ...body, __status: status } : body
  }

  async newPage(label, viewport = DEFAULT_VIEWPORT, options = {}) {
    const context = await this.browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
      locale: 'ko-KR',
      colorScheme: 'light',
      reducedMotion: 'reduce',
      permissions: ['clipboard-read', 'clipboard-write'],
      ...options,
    })
    this.openContexts.set(context, this.currentScenario)
    context.on('close', () => this.openContexts.delete(context))
    const page = await context.newPage()
    const pageLabel = `${safeArtifactName(label)}-${++this.pageSequence}`
    this.observePage(page, pageLabel)
    return { context, page, label: pageLabel }
  }

  observePage(page, label) {
    const scenario = this.currentScenario
    const pendingRequests = new Set()
    this.pendingApiRequests.set(page, pendingRequests)
    page.on('request', (request) => {
      const classification = classifySameOriginResponse(request.url(), this.args.baseUrl)
      if (classification !== 'api') return
      pendingRequests.add(request)
      const url = new URL(request.url())
      this.network.push({
        at: new Date().toISOString(), scenario, context: label, source: label, phase: 'request', method: request.method(),
        url: request.url(), path: url.pathname, query: Object.fromEntries(url.searchParams),
      })
    })
    page.on('response', (response) => {
      const url = new URL(response.url())
      const classification = classifySameOriginResponse(response.url(), this.args.baseUrl)
      if (classification === 'external') return
      if (classification === 'static') {
        const headers = response.headers()
        const entry = {
          at: new Date().toISOString(), scenario, context: label, source: label,
          phase: 'resource-response', method: response.request().method(), url: response.url(),
          path: url.pathname, query: Object.fromEntries(url.searchParams), status: response.status(),
          file_path: headers['x-phase26-file-path'] ?? null,
          file_sha256: headers['x-phase26-file-sha256'] ?? null,
          body_sha256: null,
          manifest_sha256: headers['x-phase26-manifest-sha256'] ?? null,
          dist_identity: headers['x-phase26-dist-identity'] ?? null,
          source_git_sha: headers['x-phase26-source-git-sha'] ?? null,
          integrity_error: null,
        }
        this.network.push(entry)
        const task = response.body().then((body) => {
          const verified = verifyStaticResponseEvidence({
            url: response.url(),
            baseUrl: this.args.baseUrl,
            status: response.status(),
            headers,
            body,
            manifest: this.buildManifest,
          })
          entry.body_sha256 = verified.body_sha256
          entry.file_path = verified.file_path
        }).catch((error) => {
          entry.integrity_error = error instanceof Error ? error.message : String(error)
          throw error
        })
        this.networkTasks.push(task)
        return
      }
      const entry = {
        at: new Date().toISOString(), scenario, context: label, source: label, phase: 'response',
        method: response.request().method(), url: response.url(), path: url.pathname,
        query: Object.fromEntries(url.searchParams), status: response.status(),
        body_sha256: null, response_version: null,
      }
      this.network.push(entry)
      const task = response.body().then((body) => {
        entry.body_sha256 = createHash('sha256').update(body).digest('hex')
        try {
          const parsed = JSON.parse(body.toString('utf8'))
          entry.response_version = responseVersionFromBody(parsed)
          const lock = capturedEditLock({
            scenario,
            method: entry.method,
            path: entry.path,
            status: entry.status,
            body: parsed,
          })
          if (lock !== null) this.lockTokens.set(lock.lockToken, lock)
        } catch {
          entry.response_version = null
        }
      }).catch(() => undefined)
      this.networkTasks.push(task)
    })
    page.on('requestfailed', (request) => {
      const url = new URL(request.url())
      const classification = classifySameOriginResponse(request.url(), this.args.baseUrl)
      if (classification === 'external') return
      if (classification === 'api') pendingRequests.delete(request)
      this.network.push({
        at: new Date().toISOString(), scenario, context: label, source: label,
        phase: classification === 'api' ? 'failed' : 'resource-failed', method: request.method(),
        url: request.url(), path: url.pathname, query: Object.fromEntries(url.searchParams),
        error: request.failure()?.errorText ?? 'unknown',
      })
    })
    page.on('requestfinished', (request) => pendingRequests.delete(request))
    page.on('close', () => this.pendingApiRequests.delete(page))
    page.on('console', (message) => {
      if (!['error', 'warning'].includes(message.type())) return
      const text = message.text()
      this.console.push({
        at: new Date().toISOString(), scenario, context: label, source: label,
        type: message.type(), text, expected: isExpectedNetworkConsole(scenario, text),
      })
    })
    page.on('pageerror', (error) => {
      this.console.push({ at: new Date().toISOString(), scenario, context: label, source: label, type: 'pageerror', text: error.message, stack: error.stack, expected: false })
    })
  }

  assertNoUnexpectedBrowserErrors() {
    const unexpected = this.console.filter(
      ({ type, expected }) => type === 'pageerror' || (type === 'error' && expected !== true),
    )
    assert.deepEqual(unexpected, [], `unexpected browser errors: ${JSON.stringify(unexpected)}`)
  }

  async assertNetworkEvidenceComplete() {
    await Promise.all(this.networkTasks)
    const incomplete = this.network.filter(
      (entry) => entry.phase === 'response' && (
        typeof entry.context !== 'string' ||
        typeof entry.path !== 'string' ||
        typeof entry.query !== 'object' ||
        !Number.isInteger(entry.status) ||
        typeof entry.body_sha256 !== 'string' ||
        !/^[0-9a-f]{64}$/.test(entry.body_sha256) ||
        !Object.hasOwn(entry, 'response_version')
      ),
    )
    assert.deepEqual(incomplete, [], `incomplete network evidence: ${JSON.stringify(incomplete)}`)
    const unexpectedResponses = this.network.filter(
      (entry) => entry.phase === 'response' && entry.context !== 'setup-api' &&
        (entry.status < 200 || entry.status >= 300) &&
        !isExpectedBrowserResponse(entry.scenario, entry.method, entry.path, entry.status),
    )
    assert.deepEqual(unexpectedResponses, [], `unexpected non-2xx API responses: ${JSON.stringify(unexpectedResponses)}`)
    const unexpectedFailures = this.network.filter(
      (entry) => entry.phase === 'failed' &&
        !isExpectedFailedRequest(entry.scenario, entry.method, entry.path, entry.error),
    )
    assert.deepEqual(unexpectedFailures, [], `unexpected failed API requests: ${JSON.stringify(unexpectedFailures)}`)
    const unexpectedResourceFailures = this.network.filter((entry) => entry.phase === 'resource-failed')
    assert.deepEqual(
      unexpectedResourceFailures,
      [],
      `unexpected failed same-origin resource requests: ${JSON.stringify(unexpectedResourceFailures)}`,
    )
    const unexpectedResources = this.network.filter(
      (entry) => entry.phase === 'resource-response' && isSameOriginResourceFailure(entry, this.args.baseUrl),
    )
    assert.deepEqual(unexpectedResources, [], `unexpected same-origin resource responses: ${JSON.stringify(unexpectedResources)}`)
    const incompleteResources = this.network.filter(
      (entry) => entry.phase === 'resource-response' && (
        entry.integrity_error !== null ||
        typeof entry.file_path !== 'string' ||
        !/^[0-9a-f]{64}$/.test(entry.file_sha256 ?? '') ||
        !/^[0-9a-f]{64}$/.test(entry.body_sha256 ?? '') ||
        entry.manifest_sha256 !== this.buildManifest.manifest_sha256 ||
        entry.dist_identity !== this.buildManifest.dist.identity_sha256 ||
        entry.source_git_sha !== this.buildManifest.source.git_sha
      ),
    )
    assert.deepEqual(incompleteResources, [], `incomplete static integrity evidence: ${JSON.stringify(incompleteResources)}`)
  }

  async goto(page, route, ready) {
    const response = await page.goto(`${this.args.baseUrl}${route}`, { waitUntil: 'domcontentloaded' })
    assert(response?.ok(), `${route} navigation failed: ${response?.status()}`)
    if (ready) await ready()
    await page.evaluate(() => document.fonts.ready)
  }

  async screenshot(page, name) {
    const filename = `${safeArtifactName(name)}.png`
    await page.screenshot({ path: path.join(this.screenshots, filename), fullPage: false, animations: 'disabled' })
    return `${ARTIFACT_FILES.screenshotDirectory}/${filename}`
  }

  async ariaSnapshot(locator, name) {
    const snapshot = await locator.ariaSnapshot()
    const filename = `${safeArtifactName(name)}.yaml`
    await writeFile(path.join(this.aria, filename), `${snapshot.trim()}\n`)
    return `${ARTIFACT_FILES.ariaDirectory}/${filename}`
  }

  async releaseAllLocksBestEffort() {
    if (!this.apiContext || !this.seedProject) return
    await Promise.all(this.networkTasks)
    await Promise.allSettled([...this.openContexts.keys()].map((context) => this.closeBrowserContext(context)))
    try {
      await Promise.all(this.networkTasks)
      await this.releaseTrackedLocks()
      await this.waitForSheetUnlock(this.seedProject.id)
    } catch {
      // The final SQL assertion is the authoritative lock leak proof. This path only prevents
      // one failed browser scenario from cascading into the following scenarios.
    }
  }

  async cleanupScenarioContexts(scenario) {
    const contexts = [...this.openContexts.entries()]
      .filter(([, owner]) => owner === scenario)
      .map(([context]) => context)
    await Promise.all(this.networkTasks)
    const closed = await Promise.allSettled(contexts.map((context) => this.closeBrowserContext(context)))
    await Promise.all(this.networkTasks)
    const failures = closed.filter(({ status }) => status === 'rejected')
    assert.deepEqual(failures, [], `${scenario} browser context cleanup failed`)
    await Promise.all(this.networkTasks)
    await this.releaseTrackedLocks(scenario)
    if (this.seedProject !== null) await this.waitForSheetUnlock(this.seedProject.id)
  }

  async releaseTrackedLocks(scenario = null) {
    const tracked = [...this.lockTokens.values()]
      .filter((lock) => scenario === null || lock.scenario === scenario)
    for (const lock of tracked) {
      await this.apiRaw(`/projects/${lock.projectId}/lock`, {
        expected: [204, 409],
        method: 'DELETE',
        data: { lock_token: lock.lockToken },
      })
      this.lockTokens.delete(lock.lockToken)
    }
  }

  async releaseScenarioLocksAndWait(projectId) {
    await Promise.all(this.networkTasks)
    await this.releaseTrackedLocks(this.currentScenario)
    await this.waitForSheetUnlock(projectId)
  }

  async closeBrowserContext(context) {
    await this.waitForContextApiQuiescence(context)
    await Promise.all(this.networkTasks)
    await context.close()
    await Promise.all(this.networkTasks)
  }

  async waitForContextApiQuiescence(context, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs
    let stableSince = null
    let stableTaskCount = null
    while (Date.now() < deadline) {
      const pending = context.pages().reduce(
        (count, page) => count + (this.pendingApiRequests.get(page)?.size ?? 0),
        0,
      )
      const taskCount = this.networkTasks.length
      if (pending === 0) {
        if (stableSince === null || stableTaskCount !== taskCount) {
          stableSince = Date.now()
          stableTaskCount = taskCount
        } else if (Date.now() - stableSince >= 250) {
          await Promise.all(this.networkTasks)
          const stillPending = context.pages().reduce(
            (count, page) => count + (this.pendingApiRequests.get(page)?.size ?? 0),
            0,
          )
          if (stillPending === 0 && this.networkTasks.length === taskCount) return
          stableSince = null
          stableTaskCount = null
        }
      } else {
        stableSince = null
        stableTaskCount = null
      }
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    const pending = context.pages().reduce(
      (count, page) => count + (this.pendingApiRequests.get(page)?.size ?? 0),
      0,
    )
    throw new Error(`Timed out waiting for API quiescence before context close (pending=${pending})`)
  }

  async projectWizardScenario() {
    const deviceSummary = await this.apiJson('/choice-sets/device_type', { expected: 200 })
    const beta = this.fixtureProcesses.find(({ process_id }) => process_id === 'PROC_BETA') ?? this.fixtureProcesses[1]
    const alpha = this.fixtureProcesses.find(({ process_id }) => process_id === 'PROC_ALPHA') ?? this.fixtureProcesses[0]
    const betaParam = encodeURIComponent(beta.key)

    const loadingRun = await this.newPage('wizard-required-loading')
    let releaseLoading
    let markLoadingRequest
    const loadingGate = new Promise((resolve) => { releaseLoading = resolve })
    const loadingRequested = new Promise((resolve) => { markLoadingRequest = resolve })
    await loadingRun.page.route('**/api/choice-sets/device_type', async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      markLoadingRequest()
      await loadingGate
      return route.continue()
    })
    await this.goto(loadingRun.page, `/projects/new?step=3&process=${betaParam}`, async () => {
      await loadingRun.page.getByRole('heading', { name: /매칭 확인/ }).waitFor()
    })
    await withTimeout(loadingRequested, 10_000, 'wizard loading request did not start')
    await loadingRun.page.getByText('Device Type 선택지를 불러오는 중입니다.').waitFor()
    const loadingInput = loadingRun.page.locator('#project-device-type')
    await loadingRun.page.waitForFunction(() => {
      const input = document.querySelector('#project-device-type')
      return input instanceof HTMLInputElement && !input.disabled
    }, null, { timeout: 20_000 })
    const loadingInputDisabled = await loadingInput.isDisabled()
    let loadingScreenshot
    try {
      assert.equal(loadingInputDisabled, false)
      await loadingInput.click()
      const loadingListbox = loadingRun.page.locator(`#${await loadingInput.getAttribute('aria-controls')}`)
      await loadingListbox.waitFor()
      assert.equal(await loadingListbox.getAttribute('aria-busy'), 'true')
      assert.equal(await loadingListbox.getAttribute('aria-disabled'), 'true')
      assert.equal(await loadingRun.page.getByRole('button', { name: '프로젝트 생성' }).isDisabled(), true)
      loadingScreenshot = await this.screenshot(loadingRun.page, 'wizard-required-loading-1440x900')
    } finally {
      releaseLoading()
    }
    await loadingRun.page.waitForFunction(() => {
      const input = document.querySelector('#project-device-type')
      const root = input?.closest('[data-searchable-choice]')
      return input instanceof HTMLInputElement && !input.disabled && !root?.textContent?.includes('선택지를 불러오는 중입니다.')
    }, null, { timeout: 20_000 })
    await loadingInput.click()
    await loadingRun.page.waitForFunction(() => {
      const list = document.querySelector('#project-device-type-listbox')
      return list?.getAttribute('aria-busy') !== 'true' && list?.getAttribute('aria-disabled') !== 'true' && list?.querySelector('[role="option"]') !== null
    }, null, { timeout: 20_000 })
    await loadingInput.press('Escape')
    await this.closeBrowserContext(loadingRun.context)

    const retryRun = await this.newPage('wizard-required-retry')
    let failedSummaryRequests = 0
    await retryRun.page.route('**/api/choice-sets/device_type', async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      if (request.method() === 'GET' && url.pathname === '/api/choice-sets/device_type' && failedSummaryRequests < 2) {
        failedSummaryRequests += 1
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'qa_required_set_unavailable', message: 'Task 15 forced required set failure' }),
        })
        return
      }
      await route.continue()
    })
    await this.goto(retryRun.page, `/projects/new?step=3&process=${betaParam}`, async () => {
      await retryRun.page.getByRole('heading', { name: /매칭 확인/ }).waitFor()
    })
    const deviceControl = searchableChoiceRoot(retryRun.page, '#project-device-type')
    await deviceControl.getByRole('alert').waitFor({ timeout: 15_000 })
    assert.match(await deviceControl.getByRole('alert').textContent(), /Task 15 forced required set failure/)
    await deviceControl.getByRole('button', { name: '다시 시도' }).click()
    await deviceControl.getByRole('alert').waitFor({ state: 'detached', timeout: 20_000 })
    const retryInput = retryRun.page.locator('#project-device-type')
    await retryInput.click()
    await retryRun.page.waitForFunction(() => {
      const list = document.querySelector('#project-device-type-listbox')
      return list?.getAttribute('aria-busy') !== 'true' && list?.getAttribute('aria-disabled') !== 'true' && list?.querySelector('[role="option"]') !== null
    }, null, { timeout: 20_000 })
    assert.equal(failedSummaryRequests, 2)
    const retryScreenshot = await this.screenshot(retryRun.page, 'wizard-required-error-retry-1440x900')
    await this.closeBrowserContext(retryRun.context)

    const emptyRun = await this.newPage('wizard-required-empty')
    await emptyRun.page.route('**/api/choice-sets/device_type**', async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      if (request.method() !== 'GET') return route.continue()
      if (url.pathname === '/api/choice-sets/device_type') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...deviceSummary, option_count: 0, active_option_count: 0 }),
        })
      }
      if (url.pathname === '/api/choice-sets/device_type/options') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ set_code: 'device_type', version: deviceSummary.version, items: [], next_cursor: null }),
        })
      }
      return route.continue()
    })
    await this.goto(emptyRun.page, `/projects/new?step=3&process=${betaParam}`, async () => {
      await emptyRun.page.getByText('활성 Device Type 선택지가 없습니다.').waitFor({ timeout: 15_000 })
    })
    const adminLink = emptyRun.page.getByRole('link', { name: '선택지 관리로 이동' }).first()
    assert.equal(await adminLink.getAttribute('href'), '/parameters/choice-sets/device_type')
    const emptyScreenshot = await this.screenshot(emptyRun.page, 'wizard-required-empty-1440x900')
    await this.closeBrowserContext(emptyRun.context)

    const staleRun = await this.newPage('wizard-stale-requests')
    await this.goto(staleRun.page, '/projects/new?step=3&process=L9%3A%3AMISSING', async () => {
      await staleRun.page.getByRole('heading', { name: 'Process 확인' }).waitFor({ timeout: 15_000 })
    })
    assert.match(staleRun.page.url(), /step=1/)
    await this.goto(staleRun.page, `/projects/new?step=3&process=${betaParam}&backbone=999999`, async () => {
      await staleRun.page.getByRole('heading', { name: '백본 선택' }).waitFor({ timeout: 15_000 })
    })
    assert.doesNotMatch(staleRun.page.url(), /backbone=999999/)
    await this.closeBrowserContext(staleRun.context)

    const untouched = await this.createProjectThroughWizard(alpha, {
      partId: 'QA-TASK15-UNTOUCHED',
      name: 'Task 15 untouched comment',
      touchComment: false,
    })
    assert(!Object.hasOwn(untouched.payload, 'comment'), `untouched comment leaked: ${JSON.stringify(untouched.payload)}`)
    const touched = await this.createProjectThroughWizard(beta, {
      partId: 'QA-TASK15-EMPTY',
      name: 'Task 15 explicit empty comment',
      touchComment: true,
    })
    assert.equal(touched.payload.comment, null)
    this.createdProjects.push(untouched.projectId, touched.projectId)

    return {
      required_summary_failures: failedSummaryRequests,
      loading_input_disabled: loadingInputDisabled,
      loading_listbox_observed_when_input_enabled: true,
      loading_recovered_to_committable_options: true,
      no_active_admin_href: '/parameters/choice-sets/device_type',
      stale_process_reconciled: true,
      stale_backbone_reconciled: true,
      submit_latch_requests: [untouched.postCount, touched.postCount],
      untouched_payload_omits_comment: true,
      touched_empty_payload_comment: null,
      created_project_ids: [untouched.projectId, touched.projectId],
      screenshots: [loadingScreenshot, retryScreenshot, emptyScreenshot, untouched.screenshot, touched.screenshot],
    }
  }

  async createProjectThroughWizard(process, { partId, name, touchComment }) {
    const run = await this.newPage(`wizard-create-${process.process_id}`)
    const page = run.page
    let postCount = 0
    let payload = null
    await page.route('**/api/projects', async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      if (request.method() !== 'POST' || url.pathname !== '/api/projects') return route.continue()
      postCount += 1
      payload = request.postDataJSON()
      await new Promise((resolve) => setTimeout(resolve, 250))
      const upstream = await route.fetch()
      await route.fulfill({ response: upstream })
    })
    await this.goto(page, `/projects/new?step=3&process=${encodeURIComponent(process.key)}`, async () => {
      await page.getByRole('heading', { name: /매칭 확인/ }).waitFor({ timeout: 15_000 })
      await page.getByRole('button', { name: '프로젝트 생성' }).waitFor()
    })
    await page.locator('#project-part-id').fill(partId)
    await page.locator('#project-name').fill(name)
    await selectSearchableChoice(page, '#project-device-type', 'LOGIC')
    await selectSearchableChoice(page, '#project-category', 'DEVELOPMENT')
    if (touchComment) {
      await page.locator('#project-comment').fill('will be cleared')
      await page.locator('#project-comment').fill('')
    }
    const button = page.getByRole('button', { name: '프로젝트 생성' })
    await button.waitFor({ state: 'visible' })
    assert.equal(await button.isEnabled(), true)
    const [createResponse] = await Promise.all([
      page.waitForResponse(
        (response) => response.url().endsWith('/api/projects') && response.request().method() === 'POST',
      ),
      button.dblclick(),
    ])
    assert.equal(createResponse.status(), 201)
    await page.getByRole('heading', { name: '프로젝트 기본정보' }).waitFor({ timeout: 20_000 })
    assert.equal(postCount, 1, `submit latch sent ${postCount} requests`)
    const projectId = Number(new URL(page.url()).pathname.split('/').at(-1))
    assert(Number.isInteger(projectId) && projectId > 0)
    const screenshot = await this.screenshot(page, `wizard-created-${process.process_id}`)
    await this.closeBrowserContext(run.context)
    return { projectId, payload, postCount, screenshot }
  }

  async projectListScenario() {
    const seedDetail = await this.apiJson(`/projects/${this.seedProject.id}`, { expected: 200 })
    const projects = Array.from({ length: 60 }, (_, index) => syntheticProjectSummary(seedDetail, 9000 + index, index))
    const run = await this.newPage('project-list-history')
    const page = run.page
    const listRequests = []
    await page.route('**/api/projects**', async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      if (request.method() !== 'GET') return route.continue()
      if (url.pathname === '/api/projects') {
        listRequests.push(Object.fromEntries(url.searchParams))
        const cursor = url.searchParams.get('cursor')
        const first = cursor === null ? projects.slice(0, 50) : projects.slice(50)
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ items: first, next_cursor: cursor === null ? 9049 : null }),
        })
      }
      const match = url.pathname.match(/^\/api\/projects\/(90\d\d)$/)
      if (match) {
        const id = Number(match[1])
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(syntheticProjectDetail(seedDetail, id)),
        })
      }
      return route.continue()
    })
    const listRoute = '/projects?query=QA&status=draft&device_type=MEMORY_LEGACY&project_category=LEGACY_PROJECT'
    const fullFilterState = {
      query: 'QA',
      status: 'draft',
      device_type: 'MEMORY_LEGACY',
      project_category: 'LEGACY_PROJECT',
    }
    const clearedDeviceState = { ...fullFilterState, device_type: null }
    const historyStates = []
    const assertListState = async (expected, transition, cachedRequestCount = null) => {
      if (cachedRequestCount === null) {
        await waitUntil(() => {
          const request = listRequests.at(-1)
          return request !== undefined &&
            (request.query ?? null) === expected.query &&
            (request.status ?? null) === expected.status &&
            (request.device_type_code ?? null) === expected.device_type &&
            (request.project_category_code ?? null) === expected.project_category
        }, 10_000, `${transition} project list API filters`)
      }
      const actualRoute = projectListRouteState(page.url())
      assert.deepEqual(actualRoute, expected, `${transition} route filters`)
      await waitUntil(
        async () => await page.getByPlaceholder('프로젝트명 또는 Part ID').inputValue() === expected.query,
        10_000,
        `${transition} project list query control`,
      )
      if (expected.device_type !== null) {
        await hydrateHistoricalChoice(
          page,
          '#project-list-device-type',
          /MEMORY_LEGACY.*Memory \(legacy\).*사용 중지됨/s,
        )
      } else {
        assert.match(await searchableChoiceRoot(page, '#project-list-device-type').textContent(), /선택 없음/)
      }
      await hydrateHistoricalChoice(
        page,
        '#project-list-category',
        /LEGACY_PROJECT.*Legacy.*사용 중지됨/s,
      )
      if (cachedRequestCount !== null) {
        await page.waitForTimeout(300)
        assert.equal(listRequests.length, cachedRequestCount, `${transition} unexpectedly refetched a fresh cached list`)
        historyStates.push({ transition, route: actualRoute, api: expected, source: 'query-cache' })
      } else {
        const api = projectListApiFilterState(listRequests.at(-1))
        assert.deepEqual(api, expected, `${transition} API filters`)
        historyStates.push({ transition, route: actualRoute, api, source: 'network' })
      }
    }
    await this.goto(page, listRoute, async () => {
      await page.locator('[data-project-id="9000"]').waitFor({ timeout: 15_000 })
    })
    await assertListState(fullFilterState, 'initial')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('[data-project-id="9000"]').waitFor()
    await assertListState(fullFilterState, 'reload')

    const deviceControl = searchableChoiceRoot(page, '#project-list-device-type')
    await deviceControl.getByRole('button', { name: '선택 해제' }).click()
    await page.waitForFunction(() => !new URL(location.href).searchParams.has('device_type'))
    await assertListState(clearedDeviceState, 'clear-device')
    const beforeBackRequestCount = listRequests.length
    await page.goBack()
    await page.waitForFunction(() => new URL(location.href).searchParams.get('device_type') === 'MEMORY_LEGACY')
    await assertListState(fullFilterState, 'back', beforeBackRequestCount)
    const beforeForwardRequestCount = listRequests.length
    await page.goForward()
    await page.waitForFunction(() => !new URL(location.href).searchParams.has('device_type'))
    await assertListState(clearedDeviceState, 'forward', beforeForwardRequestCount)
    await this.goto(page, listRoute, async () => page.locator('[data-project-id="9000"]').waitFor())
    await assertListState(fullFilterState, 'restored')

    await page.getByRole('button', { name: /더 보기/ }).click()
    await page.locator('[data-project-id="9059"]').waitFor()
    const link = page.locator('[data-project-id="9059"]')
    await link.scrollIntoViewIfNeeded()
    await page.evaluate(() => window.scrollBy(0, 120))
    const scrollBefore = await page.evaluate(() => window.scrollY)
    const targetTopBefore = await link.evaluate((node) => node.getBoundingClientRect().top)
    await link.click()
    await page.getByRole('heading', { name: '프로젝트 기본정보' }).waitFor()
    assert.equal(await page.locator('[data-profile-group]').count(), 6)
    assert.equal(await page.locator('[data-profile-group] dt').count(), 31)
    assert.equal(await page.getByText(/Device Ref/i).count(), 0)
    assert.match(await page.locator('[data-profile-group="product"]').textContent(), /MISSING_DEVICE/)
    assert.match(await page.locator('[data-profile-group="product"]').textContent(), /사용 중지됨/)
    await page.goBack()
    await page.locator('[data-project-id="9059"]').waitFor()
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-project-id') === '9059')
    const scrollAfter = await page.evaluate(() => window.scrollY)
    const targetTopAfter = await page.locator('[data-project-id="9059"]').evaluate((node) => node.getBoundingClientRect().top)
    assert(scrollAfter > 0 && scrollBefore > 0)
    assert(Math.abs(scrollAfter - scrollBefore) <= 64, `scroll offset was not restored: ${scrollBefore} -> ${scrollAfter}`)
    assert(Math.abs(targetTopAfter - targetTopBefore) <= 64, `target viewport offset was not restored: ${targetTopBefore} -> ${targetTopAfter}`)

    const visibleColumns = await visibleTableHeaders(page)
    assert.deepEqual(visibleColumns, ['프로젝트명', 'LINE / Process', 'PARTID', 'Device Type', 'Category', '상태', 'Updated'])
    const screenshot = await this.screenshot(page, 'project-list-history-1440x900')
    await this.goto(page, '/projects/9059', async () => {
      await page.getByRole('heading', { name: '프로젝트 기본정보' }).waitFor()
    })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: '프로젝트 기본정보' }).waitFor()
    await this.closeBrowserContext(run.context)
    return {
      url_restored: listRoute,
      loaded_rows: 60,
      native_back_forward: true,
      direct_detail_reload: true,
      return_focus_project_id: 9059,
      scroll_before: scrollBefore,
      scroll_after: scrollAfter,
      target_top_before: targetTopBefore,
      target_top_after: targetTopAfter,
      fixed_detail_values: 31,
      device_ref_count: 0,
      visible_columns_1440: visibleColumns,
      api_filter_query: listRequests[0],
      history_filter_states: historyStates,
      screenshot,
    }
  }

  async profileScenario() {
    const projectId = this.seedProject.id
    const hostile = await this.apiRaw(`/projects/${projectId}/profile`, {
      expected: 409,
      method: 'PATCH',
      data: { comment: 'must not write without a fence' },
    })
    const hostileBody = JSON.parse(await hostile.text())

    const owner = await this.newPage('profile-owner')
    const contender = await this.newPage('profile-contender')
    await this.openProfileEditor(owner.page, projectId)
    await this.goto(contender.page, `/projects/${projectId}`, async () => {
      await contender.page.getByRole('heading', { name: '프로젝트 기본정보' }).waitFor()
    })
    await contender.page.getByRole('button', { name: '기본정보 편집' }).click()
    await contender.page.getByText(/편집 중이라.*잠금을 획득하지 못했습니다/s).waitFor({ timeout: 15_000 })
    assert.equal(await contender.page.locator('#profile-process-name').count(), 0)
    await contender.page.getByRole('button', { name: '다시 시도' }).click()
    await contender.page.getByText(/잠금을 획득하지 못했습니다/).waitFor()

    await owner.page.getByRole('button', { name: '취소', exact: true }).click()
    await owner.page.getByRole('heading', { name: '프로젝트 기본정보 편집' }).waitFor({ state: 'detached' })
    await new Promise((resolve) => setTimeout(resolve, 300))
    await contender.page.getByRole('button', { name: '다시 시도' }).click()
    await contender.page.locator('#profile-process-name:not([disabled])').waitFor({ timeout: 15_000 })

    let patchAttempt = 0
    const patchRequests = []
    await contender.page.route(`**/api/projects/${projectId}/profile`, async (route) => {
      const request = route.request()
      if (request.method() !== 'PATCH') return route.continue()
      patchAttempt += 1
      patchRequests.push({
        attempt: patchAttempt,
        header_present: typeof request.headers()['x-lock-token'] === 'string',
        payload: request.postDataJSON(),
      })
      if (patchAttempt === 1) {
        return route.fulfill({
          status: 422,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'qa_profile_422', message: 'Task 15 forced validation response' }),
        })
      }
      if (patchAttempt === 2) return route.abort('failed')
      return route.continue()
    })

    await contender.page.locator('#profile-pitch-x').fill('001.5000')
    await contender.page.locator('#profile-comment').fill('Task 15 profile recovery')
    const activeDirection = searchableChoiceRoot(contender.page, '#profile-active-direction-code')
    if ((await activeDirection.getByRole('button', { name: '선택 해제' }).count()) > 0) {
      await activeDirection.getByRole('button', { name: '선택 해제' }).click()
    }
    const save = contender.page.getByRole('button', { name: '저장', exact: true })
    await save.click()
    await contender.page.getByText(/Task 15 forced validation response/).waitFor()
    assert.equal(await contender.page.locator('#profile-pitch-x').inputValue(), '001.5000')
    await save.click()
    await contender.page.getByText(/저장하지 못했습니다.*초안은 유지됩니다/s).waitFor()
    assert.equal(await contender.page.locator('#profile-pitch-x').inputValue(), '001.5000')
    await save.click()
    await contender.page.getByRole('heading', { name: '프로젝트 기본정보 편집' }).waitFor({ state: 'detached', timeout: 20_000 })
    await contender.page.getByText('1.5', { exact: true }).waitFor()
    assert.equal(await contender.page.evaluate(() => document.activeElement?.textContent?.trim()), '기본정보 편집')
    assert.equal(patchAttempt, 3)
    assert(patchRequests.every(({ header_present }) => header_present))
    const profile = await this.apiJson(`/projects/${projectId}/profile`, { expected: 200 })
    assert.equal(profile.pitch_x, '1.5')
    assert.equal(profile.active_direction, null)

    await contender.page.getByRole('button', { name: '기본정보 편집' }).click()
    await contender.page.locator('#profile-comment:not([disabled])').waitFor()
    await contender.page.locator('#profile-comment').fill('Task 15 dirty close draft')
    const closeMessage = await answerNativeConfirm(
      contender.page,
      () => contender.page.getByRole('button', { name: '취소', exact: true }).click(),
      false,
    )
    await contender.page.getByText('저장하지 않은 변경이 있습니다.').waitFor()
    assert.match(closeMessage ?? '', /저장하지 않은 프로젝트 기본정보 변경/)
    const navigationMessage = await answerNativeConfirm(
      contender.page,
      () => contender.page.getByRole('link', { name: '프로젝트', exact: true }).evaluate((node) => node.click()),
      false,
    )
    assert.match(navigationMessage ?? '', /저장하지 않은 프로젝트 기본정보 변경/)
    assert.match(contender.page.url(), new RegExp(`/projects/${projectId}$`))
    assert.equal(await contender.page.locator('#profile-comment').inputValue(), 'Task 15 dirty close draft')
    await answerNativeConfirm(
      contender.page,
      () => contender.page.getByRole('button', { name: '취소', exact: true }).click(),
      true,
    )
    await contender.page.getByRole('heading', { name: '프로젝트 기본정보 편집' }).waitFor({ state: 'detached' })
    const recoveryScreenshot = await this.screenshot(contender.page, 'profile-save-recovery-1440x900')
    await this.closeBrowserContext(owner.context)
    await this.closeBrowserContext(contender.context)

    const loss = await this.newPage('profile-lock-loss')
    await loss.page.clock.install({ time: new Date() })
    let heartbeatRejected = false
    let actualLossToken = null
    await loss.page.route(`**/api/projects/${projectId}/lock`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      const response = await route.fetch()
      const body = await response.text()
      actualLossToken = JSON.parse(body).lock_token
      await route.fulfill({ response, body })
    })
    await loss.page.route(`**/api/projects/${projectId}/lock/heartbeat`, async (route) => {
      if (!heartbeatRejected) {
        heartbeatRejected = true
        return route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'lock_conflict', message: 'Task 15 simulated lock loss', details: { locked_by: 'qa.other' } }),
        })
      }
      return route.continue()
    })
    let lossScreenshot
    try {
      await this.openProfileEditor(loss.page, projectId)
      await loss.page.locator('#profile-comment').fill('Task 15 retained read-only recovery draft')
      await loss.page.clock.fastForward(45_100)
      await loss.page.getByText(/편집 잠금을 잃었습니다/).waitFor({ timeout: 10_000 })
      const recoveryCopy = loss.page.locator('#profile-recovery-copy')
      await recoveryCopy.waitFor()
      assert.match(await recoveryCopy.inputValue(), /Task 15 retained read-only recovery draft/)
      assert.equal(await loss.page.locator('#profile-comment').isDisabled(), true)
      lossScreenshot = await this.screenshot(loss.page, 'profile-lock-loss-1440x900')
      const lossCloseMessage = await answerNativeConfirm(
        loss.page,
        () => loss.page.locator('footer').getByRole('button', { name: '닫기', exact: true }).click(),
        true,
      )
      assert.match(lossCloseMessage ?? '', /저장하지 않은 프로젝트 기본정보 변경/)
      await loss.page.getByRole('heading', { name: '프로젝트 기본정보 편집' }).waitFor({ state: 'detached' })
    } finally {
      await this.closeBrowserContext(loss.context)
      if (actualLossToken !== null) {
        await this.apiRaw(`/projects/${projectId}/lock`, {
          expected: [204, 409],
          method: 'DELETE',
          data: { lock_token: actualLossToken },
        })
      }
    }
    await this.releaseScenarioLocksAndWait(projectId)

    return {
      hostile_patch_status: 409,
      hostile_error_code: hostileBody.code ?? hostileBody.detail?.code ?? null,
      holder_conflict_and_retry: true,
      patch_attempts: patchRequests,
      canonical_pitch_x: profile.pitch_x,
      explicit_active_direction_clear: profile.active_direction,
      dirty_close_message: closeMessage,
      dirty_navigation_message: navigationMessage,
      focus_return: '기본정보 편집',
      simulated_lock_loss: heartbeatRejected,
      recovery_copy_retained: true,
      screenshots: [recoveryScreenshot, lossScreenshot],
    }
  }

  async openProfileEditor(page, projectId) {
    await this.goto(page, `/projects/${projectId}`, async () => {
      await page.getByRole('heading', { name: '프로젝트 기본정보' }).waitFor({ timeout: 15_000 })
    })
    await page.getByRole('button', { name: '기본정보 편집' }).click()
    await page.locator('#profile-process-name:not([disabled])').waitFor({ timeout: 15_000 })
  }

  async choiceLifecycleScenario() {
    const run = await this.newPage('choice-lifecycle')
    const page = run.page
    await this.goto(page, `/parameters/choice-sets?q=${QA_SET}&active=all`, async () => {
      await page.getByText(QA_SET, { exact: true }).waitFor({ timeout: 15_000 })
    })
    assert.match(page.url(), /q=qa_browser_choices/)
    assert.equal(await page.getByLabel('상태').inputValue(), 'all')
    await page.getByText(QA_SET, { exact: true }).click()
    await page.getByRole('heading', { name: '선택지 목록' }).waitFor()
    assert.match(page.url(), new RegExp(`/parameters/choice-sets/${QA_SET}`))

    const search = page.getByPlaceholder('code 또는 표시명')
    await search.fill('QA Beta')
    await page.waitForFunction(() => new URL(location.href).searchParams.get('q') === 'QA Beta')
    await page.getByText('QA_BETA', { exact: true }).waitFor()
    assert.equal(await page.getByText('QA_ALPHA', { exact: true }).count(), 0)
    await search.fill('')
    await page.waitForFunction(() => !new URL(location.href).searchParams.has('q'))

    await page.getByRole('button', { name: '선택지 추가' }).click()
    await page.locator('#choice-option-code').fill('qa_alpha')
    await page.locator('#choice-option-label').fill('QA alpha case-sensitive')
    await page.locator('#choice-option-sort-order').fill('50')
    const warning = page.getByText(/대소문자만 다른 코드가 이미 있습니다: QA_ALPHA/)
    await warning.waitFor()
    const createSave = page.getByRole('button', { name: '저장', exact: true })
    assert.equal(await createSave.isEnabled(), true)
    await createSave.click()
    await page.getByRole('heading', { name: '선택지 추가' }).waitFor({ state: 'detached' })
    await page.getByText('qa_alpha', { exact: true }).waitFor()

    await search.fill('QA_BETA')
    await page.waitForFunction(() => new URL(location.href).searchParams.get('q') === 'QA_BETA')
    const betaRow = page.getByRole('row').filter({ hasText: 'QA_BETA' })
    await betaRow.getByRole('button', { name: '수정', exact: true }).click()
    await page.locator('#choice-option-label').fill('QA Beta edited')
    await page.getByRole('button', { name: '저장', exact: true }).click()
    await page.getByRole('heading', { name: '선택지 수정' }).waitFor({ state: 'detached' })
    await search.fill('QA Beta edited')
    await page.waitForFunction(() => new URL(location.href).searchParams.get('q') === 'QA Beta edited')
    await page.getByText('QA_BETA', { exact: true }).waitFor()
    await search.fill('')
    await page.waitForFunction(() => !new URL(location.href).searchParams.has('q'))

    let reorderPayload = null
    await page.route(`**/api/choice-sets/${QA_SET}/option-order`, async (route) => {
      if (route.request().method() === 'PUT') reorderPayload = route.request().postDataJSON()
      const response = await route.fetch()
      await route.fulfill({ response })
    })
    const preReorderSummary = await this.apiJson(`/choice-sets/${QA_SET}`, { expected: 200 })
    const preReorderPage = await this.apiJson(
      `/choice-sets/${QA_SET}/options?version=${preReorderSummary.version}&limit=500&include_inactive=true`,
      { expected: 200 },
    )
    const preReorderCodes = preReorderPage.items.map(({ code }) => code)
    const movedIndex = preReorderCodes.indexOf('QA_ALPHA')
    assert(movedIndex >= 0 && movedIndex < preReorderCodes.length - 1, 'QA_ALPHA has no adjacent option to swap')
    const expectedReorderedCodes = [...preReorderCodes]
    ;[expectedReorderedCodes[movedIndex], expectedReorderedCodes[movedIndex + 1]] =
      [expectedReorderedCodes[movedIndex + 1], expectedReorderedCodes[movedIndex]]
    const down = page.getByRole('button', { name: 'QA_ALPHA 아래로', exact: true })
    await down.focus()
    const [reorderResponse] = await Promise.all([
      page.waitForResponse(
        (response) => response.url().endsWith(`/api/choice-sets/${QA_SET}/option-order`) && response.request().method() === 'PUT',
      ),
      down.press('Enter'),
    ])
    assert.equal(reorderResponse.status(), 200)
    assert(reorderPayload, 'keyboard reorder did not issue a request')
    const postReorder = await this.apiJson(`/choice-sets/${QA_SET}`, { expected: 200 })
    assert.equal(reorderPayload.ordered_codes.length, postReorder.option_count)
    assert.equal(new Set(reorderPayload.ordered_codes).size, postReorder.option_count)
    assert.deepEqual(reorderPayload.ordered_codes, expectedReorderedCodes, 'keyboard reorder was not the exact adjacent swap')
    const postReorderPage = await this.apiJson(
      `/choice-sets/${QA_SET}/options?version=${postReorder.version}&limit=500&include_inactive=true`,
      { expected: 200 },
    )
    assert.deepEqual(postReorderPage.items.map(({ code }) => code), expectedReorderedCodes)
    const renderedCodes = await page.locator('tbody tr').evaluateAll((rows) =>
      rows.map((row) => row.querySelector('td')?.textContent?.replace(/\s+/g, ' ').trim().split(' ')[0] ?? ''),
    )
    assert.equal(renderedCodes.indexOf('QA_ALPHA'), movedIndex + 1)
    assert.equal(renderedCodes[movedIndex], expectedReorderedCodes[movedIndex])

    await page.getByLabel('상태').selectOption('inactive')
    await page.getByText('QA_LEGACY', { exact: true }).waitFor()
    assert.match(page.url(), /active=inactive/)
    await page.getByLabel('상태').selectOption('all')

    await this.goto(page, `/parameters/choice-sets/${EQUIPMENT_SET}?q=MODE_002&active=all`, async () => {
      await page.getByText('MODE_002', { exact: true }).waitFor({ timeout: 20_000 })
    })
    const equipmentRow = page.getByRole('row').filter({ hasText: 'MODE_002' })
    await equipmentRow.getByRole('button', { name: '사용 중지', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '선택지 사용 중지' })
    await dialog.getByText('영향 범위', { exact: true }).waitFor()
    const impactText = await dialog.textContent()
    assert.match(impactText, /파라미터 66곳/)
    assert.match(impactText, /기존 저장값은 계속 읽을 수 있습니다/)
    await dialog.getByLabel('영향 범위를 확인했습니다.').check()
    await dialog.getByRole('button', { name: '사용 중지', exact: true }).click()
    await dialog.waitFor({ state: 'detached' })
    await page.getByText('MODE_002', { exact: true }).waitFor()
    const deactivatedRow = page.getByRole('row').filter({ hasText: 'MODE_002' })
    await waitUntil(
      async () => /사용 중지됨/.test((await deactivatedRow.textContent()) ?? ''),
      10_000,
      'MODE_002 inactive UI refresh',
    )
    assert.match(await deactivatedRow.textContent(), /사용 중지됨/)
    const screenshot = await this.screenshot(page, 'choice-lifecycle-deactivated-1440x900')
    await this.closeBrowserContext(run.context)

    const equipmentSummary = await this.apiJson(`/choice-sets/${EQUIPMENT_SET}`, { expected: 200 })
    const inactive = await this.apiJson(`/choice-sets/${EQUIPMENT_SET}/options?q=MODE_002&version=${equipmentSummary.version}&include_inactive=true`, { expected: 200 })
    assert.equal(inactive.items[0]?.is_active, false)
    return {
      list_url_state: true,
      direct_detail: true,
      code_and_label_search: true,
      case_only_warning_nonblocking: true,
      created_code: 'qa_alpha',
      edited_code: 'QA_BETA',
      reordered_complete_count: reorderPayload.ordered_codes.length,
      adjacent_swap: {
        moved: 'QA_ALPHA',
        displaced: preReorderCodes[movedIndex + 1],
        from_index: movedIndex,
        to_index: movedIndex + 1,
      },
      inactive_filter: 'QA_LEGACY',
      deactivated_used_option: 'MODE_002',
      blast_radius_copy: impactText.replace(/\s+/g, ' ').trim(),
      equipment_version: equipmentSummary.version,
      screenshot,
    }
  }

  async choiceCsvScenario() {
    const run = await this.newPage('choice-csv')
    const page = run.page
    await this.goto(page, `/parameters/choice-sets/${QA_SET}?active=all`, async () => {
      await page.getByRole('button', { name: 'CSV 가져오기' }).waitFor({ timeout: 15_000 })
    })
    const before = await this.apiJson(`/choice-sets/${QA_SET}`, { expected: 200 })
    await page.getByRole('button', { name: 'CSV 가져오기' }).click()
    const csv = page.locator('#choice-import-csv')
    const invalidCsv = [
      'code,label,sort_order,is_active',
      'QA_IMPORT_OK,QA import okay,100,true',
      'INVALID CODE,Invalid identity,110,true',
    ].join('\n')
    await csv.fill(invalidCsv)
    await page.getByRole('button', { name: '미리보기', exact: true }).click()
    await page.getByText(/오류 1/).waitFor()
    const afterPreview = await this.apiJson(`/choice-sets/${QA_SET}`, { expected: 200 })
    assert.equal(afterPreview.version, before.version, 'preview changed the set version')
    assert.equal(await page.getByRole('button', { name: '적용', exact: true }).isDisabled(), true)
    await csv.fill(`${invalidCsv}\nQA_AFTER_EDIT,Preview invalidation,120,true`)
    await page.getByText(/CSV 내용이나 집합 버전이 미리보기 이후 바뀌었습니다/).waitFor()
    assert.equal(await page.getByRole('button', { name: '적용', exact: true }).isDisabled(), true)

    const validCsv = [
      'code,label,sort_order,is_active',
      'QA_ALPHA,QA Alpha imported,10,true',
      'QA_IMPORT_NEW,QA imported new,100,true',
    ].join('\n')
    await csv.fill(validCsv)
    const [validPreviewResponse] = await Promise.all([
      page.waitForResponse(
        (response) => response.url().endsWith(`/api/choice-sets/${QA_SET}/import/preview`) && response.request().method() === 'POST',
      ),
      page.getByRole('button', { name: /미리보기/ }).click(),
    ])
    assert.equal(validPreviewResponse.status(), 200)
    const validPreview = await validPreviewResponse.json()
    assert.equal(validPreview.error_count, 0)
    const applyImport = page.getByRole('button', { name: '적용', exact: true })
    await waitUntil(async () => await applyImport.isEnabled(), 10_000, 'valid CSV preview Apply readiness')

    const conflictCode = `QA_CONFLICT_${before.version}`
    const secondAdmin = await this.newPage('choice-csv-second-admin')
    await this.goto(secondAdmin.page, `/parameters/choice-sets/${QA_SET}`, async () => {
      await secondAdmin.page.getByRole('heading', { name: '선택지 목록' }).waitFor()
    })
    const conflictMutation = await browserApiJson(secondAdmin.page, `/api/choice-sets/${QA_SET}/options`, {
      method: 'POST',
      data: { expected_version: before.version, code: conflictCode, label: 'Concurrent administrator', sort_order: 999, is_active: true },
      expected: 201,
    })
    await page.getByRole('button', { name: '적용', exact: true }).click()
    await page.getByText(/CSV와 미리보기는 그대로 유지됩니다/).waitFor()
    assert.equal(await csv.inputValue(), validCsv)
    assert.match(await page.getByText(/다른 관리자가 버전/).textContent(), new RegExp(`버전 ${conflictMutation.choice_set.version}`))
    const conflictScreenshot = await this.screenshot(page, 'choice-csv-version-conflict-1440x900')
    await this.closeBrowserContext(secondAdmin.context)

    await page.getByRole('button', { name: '최신 버전 불러오기' }).click()
    await page.getByText(/다른 관리자가 버전/).waitFor({ state: 'detached' })
    await page.getByRole('button', { name: /미리보기/ }).click()
    await page.getByText(`미리보기 · 버전 ${conflictMutation.choice_set.version}`).waitFor()
    await page.getByRole('button', { name: '적용', exact: true }).click()
    await page.getByRole('heading', { name: '선택지 CSV 가져오기' }).waitFor({ state: 'detached', timeout: 20_000 })
    const finalSummary = await this.apiJson(`/choice-sets/${QA_SET}`, { expected: 200 })
    const imported = await this.apiJson(`/choice-sets/${QA_SET}/options?q=QA_IMPORT_NEW&version=${finalSummary.version}&include_inactive=true`, { expected: 200 })
    assert.equal(imported.items[0]?.label, 'QA imported new')
    assert.equal(finalSummary.version, conflictMutation.choice_set.version + 1)
    await this.closeBrowserContext(run.context)
    return {
      preview_side_effect_version: [before.version, afterPreview.version],
      invalid_preview_apply_disabled: true,
      csv_edit_invalidated_preview: true,
      concurrent_version: conflictMutation.choice_set.version,
      independent_admin_context: true,
      stale_draft_retained: true,
      explicit_reload_retry: true,
      atomic_apply_version: finalSummary.version,
      imported_code: imported.items[0]?.code,
      screenshot: conflictScreenshot,
    }
  }

  async choicePaginationScenario() {
    const run = await this.newPage('choice-pagination-restart')
    const page = run.page
    const history = []
    let mutation = null
    await page.route(`**/api/choice-sets/${EQUIPMENT_SET}/options**`, async (route) => {
      const request = route.request()
      if (request.method() !== 'GET') return route.continue()
      const url = new URL(request.url())
      const upstream = await route.fetch()
      const text = await upstream.text()
      let body = null
      try { body = JSON.parse(text) } catch { body = null }
      const entry = {
        sequence: history.length + 1,
        status: upstream.status(),
        requested_version: Number(url.searchParams.get('version')),
        cursor: url.searchParams.get('cursor'),
        response_version: body?.version ?? body?.details?.actual_version ?? body?.detail?.details?.actual_version ?? null,
        next_cursor: body?.next_cursor ?? null,
        codes: body?.items?.map(({ code }) => code) ?? [],
      }
      history.push(entry)
      if (upstream.status() === 200 && entry.cursor === null && entry.next_cursor !== null && mutation === null) {
        const raceCode = `QA_PAGE_RACE_V${body.version}`
        mutation = await this.apiJson(`/choice-sets/${EQUIPMENT_SET}/options`, {
          expected: 201,
          method: 'POST',
          data: {
            expected_version: body.version,
            code: raceCode,
            label: `Pagination race version ${body.version}`,
            sort_order: 20_000,
            is_active: true,
          },
        })
      }
      await route.fulfill({ response: upstream, body: text })
    })
    await this.goto(page, `/parameters/choice-sets/${EQUIPMENT_SET}?active=all`, async () => {
      await page.getByRole('heading', { name: '선택지 목록' }).waitFor({ timeout: 20_000 })
      await page.getByText('MODE_000', { exact: true }).waitFor({ timeout: 20_000 })
    })
    await page.waitForFunction(() => !document.body.textContent?.includes('활성·비활성 선택지 전체를 불러오는 중입니다.'))
    assert(mutation, 'between-page mutation was not injected')
    const conflictIndex = history.findIndex(({ status }) => status === 409)
    assert(conflictIndex > 0, `expected a version conflict after page 1: ${JSON.stringify(history)}`)
    const actualVersion = mutation.choice_set.version
    const restartIndex = history.findIndex(
      (entry, index) => index > conflictIndex && entry.status === 200 && entry.cursor === null && entry.requested_version === actualVersion,
    )
    assert(restartIndex > conflictIndex, `new version did not restart at page 1: ${JSON.stringify(history)}`)
    const mixedSuccess = history.some(
      (entry, index) => index >= restartIndex && entry.status === 200 && entry.response_version !== actualVersion,
    )
    assert.equal(mixedSuccess, false, `mixed-version successful pages: ${JSON.stringify(history)}`)
    const finalVersionCodes = history
      .slice(restartIndex)
      .filter(({ status, response_version }) => status === 200 && response_version === actualVersion)
      .flatMap(({ codes }) => codes)
    const finalVersionPages = history
      .slice(restartIndex)
      .filter(({ status, response_version }) => status === 200 && response_version === actualVersion)
    assert(finalVersionPages.length >= 2, 'restarted aggregate did not traverse multiple pages')
    assert.equal(finalVersionPages[0].cursor, null)
    for (let index = 1; index < finalVersionPages.length; index += 1) {
      assert.equal(finalVersionPages[index].cursor, finalVersionPages[index - 1].next_cursor, 'pagination cursor chain broke')
    }
    assert.equal(finalVersionPages.at(-1).next_cursor, null, 'restarted aggregate did not reach its terminal page')
    assert.equal(finalVersionCodes.length, mutation.choice_set.option_count, 'restarted aggregate did not contain the full set')
    assert.equal(new Set(finalVersionCodes).size, finalVersionCodes.length, 'restarted aggregate contained duplicate option codes')
    const raceCode = mutation.option.code
    const search = page.getByPlaceholder('code 또는 표시명')
    await search.fill(raceCode)
    await page.waitForFunction((code) => new URL(location.href).searchParams.get('q') === code, raceCode)
    await page.getByText(raceCode, { exact: true }).waitFor()
    const screenshot = await this.screenshot(page, 'choice-pagination-restart-1440x900')
    await this.closeBrowserContext(run.context)
    return {
      injected_mutation_version: actualVersion,
      request_history: history,
      conflict_index: conflictIndex,
      restart_index: restartIndex,
      restarted_without_cursor: true,
      mixed_version_success_pages: false,
      final_unique_codes: finalVersionCodes.length,
      final_expected_codes: mutation.choice_set.option_count,
      terminal_page_reached: true,
      injected_code_visible: raceCode,
      screenshot,
    }
  }

  async sheetChoiceScenario() {
    const run = await this.newPage('sheet-choice-keyboard')
    const page = run.page
    const choiceOptionRequests = []
    const cellPatches = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (request.method() === 'GET' && url.pathname === `/api/choice-sets/${EQUIPMENT_SET}/options`) {
        choiceOptionRequests.push({ version: url.searchParams.get('version'), cursor: url.searchParams.get('cursor') })
      }
      if (request.method() === 'PATCH' && url.pathname === `/api/projects/${this.seedProject.id}/cells`) {
        cellPatches.push(request.postDataJSON())
      }
    })
    const sheet = await this.openSheet(page, this.seedProject.id)
    assert.equal(sheet.columns.length, 200)
    assert.equal(new Set(sheet.columns.filter(({ value_type }) => value_type === 'choice').map(({ choice_set_code }) => choice_set_code)).size, 1)
    assert.equal(JSON.stringify(sheet).includes('choice_options'), false)
    const aggregateStartsBefore = choiceOptionRequests.filter(({ cursor }) => cursor === null).length
    assert.equal(aggregateStartsBefore, 1, `shared set started ${aggregateStartsBefore} aggregates`)

    await clickGridCell(page, 1, 2)
    await assertCanvasFocus(page, 'choice keyboard-open neighbor')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
    let input = page.locator('#sheet-choice-editor')
    await input.waitFor({ timeout: 15_000 })
    await page.waitForFunction(() => document.activeElement?.id === 'sheet-choice-editor')
    await input.fill('Equipment mode 010')
    await page.getByRole('option', { name: /MODE_010.*Equipment mode 010/ }).waitFor()
    await input.press('Escape')
    await input.waitFor({ state: 'detached' })
    await assertCanvasFocus(page, 'choice keyboard-open Escape')

    await clickGridCell(page, 2, 1)
    input = page.locator('#sheet-choice-editor')
    await input.waitFor({ timeout: 15_000 })
    await page.waitForFunction(() => document.activeElement?.id === 'sheet-choice-editor')
    await page.waitForFunction(() => document.querySelector('#sheet-choice-editor')?.getAttribute('aria-activedescendant'))
    const activeIds = [await input.getAttribute('aria-activedescendant')]
    for (const key of ['ArrowDown', 'ArrowUp', 'End', 'Home', 'ArrowDown']) {
      await input.press(key)
      activeIds.push(await input.getAttribute('aria-activedescendant'))
    }
    assert(new Set(activeIds.filter(Boolean)).size >= 3, `keyboard active descendant did not move: ${activeIds}`)
    await input.fill('MODE_010')
    const option = page.getByRole('option', { name: /MODE_010.*Equipment mode 010/ })
    await option.waitFor()
    assert.equal(await option.getAttribute('aria-disabled'), null)
    await input.press('Enter')
    await input.waitFor({ state: 'detached' })
    await assertCanvasFocus(page, 'choice Enter')
    await page.keyboard.press('ArrowRight')
    await assertCanvasFocus(page, 'choice Enter + grid ArrowRight')
    await page.waitForFunction(() => document.querySelector('[data-sheet-editing-status]')?.textContent?.includes('저장됨'), null, { timeout: 10_000 })
    assert.equal(cellPatches.length, 1)
    assert.equal(cellPatches[0].cells[0].value, 'MODE_010')

    // ArrowRight proves grid keyboard ownership. Return to the committed choice cell before copy.
    // A completed save may move DOM focus from Glide's canvas to its semantic gridcell fallback.
    // Both are inside the same owned grid and retain keyboard selection/navigation.
    await page.keyboard.press('ArrowLeft')
    await assertCanvasFocus(page, 'choice copy target')

    const clipboard = await page.evaluate(async () => {
      await navigator.clipboard.writeText('')
      return null
    })
    void clipboard
    await page.keyboard.press('Control+C')
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    assert.equal(copied.trim(), 'MODE_010')
    const selectedPoint = await gridPoint(page, 2, 1)
    await page.mouse.move(1, 1)
    await page.mouse.move(selectedPoint.x, selectedPoint.y)
    const tooltip = page.locator('[data-testid="header-tooltip"]')
    await waitUntil(
      async () => /MODE_010 · Equipment mode 010/.test((await tooltip.textContent()) ?? ''),
      10_000,
      'saved choice tooltip refresh',
    )
    const tooltipText = await tooltip.textContent()
    assert.match(tooltipText, /MODE_010 · Equipment mode 010/)

    await clickGridCell(page, 2, 1)
    input = page.locator('#sheet-choice-editor')
    await input.waitFor()
    const controls = await input.getAttribute('aria-controls')
    assert(controls)
    const listbox = page.locator(`#${controls}`)
    await listbox.waitFor()
    assert.equal(await listbox.getAttribute('role'), 'listbox')
    const selectedStatus = page.locator('#sheet-choice-editor-selected-status')
    await waitUntil(
      async () => /MODE_010 · Equipment mode 010/.test((await selectedStatus.textContent()) ?? ''),
      10_000,
      'reopened choice selected-value status',
    )
    assert.match(await selectedStatus.textContent(), /MODE_010 · Equipment mode 010/)
    const aria = await this.ariaSnapshot(searchableChoiceRoot(page, '#sheet-choice-editor'), 'sheet-choice-combobox')
    const semanticTables = page.locator('[data-testid="sheet-view-grid"] table[role="grid"]')
    await waitUntil(async () => await semanticTables.count() === 1, 10_000, 'sheet semantic grid table')
    assert.equal(await semanticTables.count(), 1)
    assert.equal(
      await page.locator('[data-testid="sheet-view-grid"] table[role="grid"]').evaluateAll(
        (tables) => tables.filter((table) => table.closest('canvas') === null).length,
      ),
      0,
    )
    const screenshot = await this.screenshot(page, 'sheet-choice-keyboard-1440x900')
    await input.press('Escape')
    await input.waitFor({ state: 'detached' })
    await assertCanvasFocus(page, 'choice Escape')
    await page.keyboard.press('ArrowLeft')
    await assertCanvasFocus(page, 'choice Escape + grid ArrowLeft')

    const aggregateStartsAfter = choiceOptionRequests.filter(({ cursor }) => cursor === null).length
    assert.equal(aggregateStartsAfter, 1, `opening cells refetched immutable aggregate: ${JSON.stringify(choiceOptionRequests)}`)
    await this.closeBrowserContext(run.context)
    await this.releaseScenarioLocksAndWait(this.seedProject.id)
    return {
      columns: sheet.columns.length,
      rows: sheet.rows.length,
      choice_columns: sheet.columns.filter(({ value_type }) => value_type === 'choice').length,
      embedded_options: 0,
      aggregate_page_requests: choiceOptionRequests,
      aggregate_starts: aggregateStartsAfter,
      keyboard_active_descendants: activeIds,
      input_focus: true,
      enter_open: true,
      label_filter: 'Equipment mode 010',
      enter_focus_return: true,
      escape_focus_return: true,
      patch_value: cellPatches[0].cells[0].value,
      copied_value: copied.trim(),
      tooltip: tooltipText,
      canvas_semantic_tables: 1,
      parallel_app_tables: 0,
      aria,
      screenshot,
    }
  }

  async sheetFailClosedScenario() {
    const projectId = this.seedProject.id
    const run = await this.newPage('sheet-fail-closed-cache')
    const { page } = run
    let failSummary = false
    let summaryFailures = 0
    const patches = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (request.method() === 'PATCH' && url.pathname === `/api/projects/${projectId}/cells`) {
        patches.push(request.postDataJSON())
      }
    })
    await page.route(`**/api/choice-sets/${EQUIPMENT_SET}`, async (route) => {
      const url = new URL(route.request().url())
      if (
        failSummary &&
        route.request().method() === 'GET' &&
        url.pathname === `/api/choice-sets/${EQUIPMENT_SET}` &&
        summaryFailures < 2
      ) {
        summaryFailures += 1
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'qa_summary_failure', message: 'Task 15 forced mandatory summary failure' }),
        })
      }
      return route.continue()
    })
    await this.openSheet(page, projectId)
    await clickGridCell(page, 2, 1)
    const warmInput = page.locator('#sheet-choice-editor')
    await warmInput.waitFor()
    await page.waitForFunction(() => document.querySelector('#sheet-choice-editor')?.getAttribute('aria-activedescendant') !== null, null, { timeout: 20_000 })
    await warmInput.press('Escape')
    await warmInput.waitFor({ state: 'detached' })
    failSummary = true
    await clickGridCell(page, 2, 1)
    const input = page.locator('#sheet-choice-editor')
    await input.waitFor()
    const root = searchableChoiceRoot(page, '#sheet-choice-editor')
    const summaryFailureAlert = root.getByRole('alert')
    await summaryFailureAlert.waitFor({ timeout: 15_000 })
    const summaryFailureText = (await summaryFailureAlert.textContent()) ?? ''
    assert.match(summaryFailureText, /503|Service Unavailable|Request failed/i)
    const listbox = page.locator(`#${await input.getAttribute('aria-controls')}`)
    assert.equal(await listbox.getAttribute('aria-disabled'), 'true')
    const disabledOptions = listbox.getByRole('option')
    assert((await disabledOptions.count()) > 0, 'cached display options disappeared on summary failure')
    assert.equal(await disabledOptions.first().getAttribute('aria-disabled'), 'true')
    await disabledOptions.first().click({ force: true })
    await input.press('Enter')
    await page.waitForTimeout(450)
    assert.equal(patches.length, 0, 'fail-closed editor emitted a cell PATCH')
    assert.equal(await input.count(), 1)
    const failedScreenshot = await this.screenshot(page, 'sheet-summary-failure-display-only-1440x900')
    const failedAria = await this.ariaSnapshot(root, 'sheet-summary-failure-display-only')

    failSummary = false
    await root.getByRole('button', { name: '다시 시도' }).click()
    await page.waitForFunction(() => {
      const inputNode = document.querySelector('#sheet-choice-editor')
      if (!(inputNode instanceof HTMLInputElement)) return false
      const list = document.getElementById(inputNode.getAttribute('aria-controls') ?? '')
      return list?.getAttribute('aria-disabled') !== 'true' && inputNode.getAttribute('aria-activedescendant') !== null
    }, null, { timeout: 20_000 })
    assert.equal(summaryFailures, 2)
    await input.press('Escape')
    await input.waitFor({ state: 'detached' })
    await assertCanvasFocus(page, 'summary retry Escape')
    await this.closeBrowserContext(run.context)
    await this.releaseScenarioLocksAndWait(projectId)

    const background = await this.newPage('sheet-background-version-gate')
    const backgroundPatches = []
    let delayedVersion = null
    let releaseAggregate
    let markAggregateStarted
    const aggregateGate = new Promise((resolve) => { releaseAggregate = resolve })
    const aggregateStarted = new Promise((resolve) => { markAggregateStarted = resolve })
    background.page.on('request', (request) => {
      const url = new URL(request.url())
      if (request.method() === 'PATCH' && url.pathname === `/api/projects/${projectId}/cells`) {
        backgroundPatches.push(request.postDataJSON())
      }
    })
    await background.page.route(`**/api/choice-sets/${EQUIPMENT_SET}/options**`, async (route) => {
      const url = new URL(route.request().url())
      if (
        delayedVersion !== null &&
        route.request().method() === 'GET' &&
        Number(url.searchParams.get('version')) === delayedVersion
      ) {
        markAggregateStarted()
        await aggregateGate
      }
      return route.continue()
    })
    await this.openSheet(background.page, projectId)
    await clickGridCell(background.page, 2, 1)
    const backgroundInput = background.page.locator('#sheet-choice-editor')
    await backgroundInput.waitFor()
    await background.page.waitForFunction(() => document.querySelector('#sheet-choice-editor')?.getAttribute('aria-activedescendant'))

    const before = await this.apiJson(`/choice-sets/${EQUIPMENT_SET}`, { expected: 200 })
    const mutationCode = `QA_BG_V${before.version}`
    const mutation = await this.apiJson(`/choice-sets/${EQUIPMENT_SET}/options`, {
      expected: 201,
      method: 'POST',
      data: {
        expected_version: before.version,
        code: mutationCode,
        label: `Background version ${before.version}`,
        sort_order: 30_000 + before.version,
        is_active: true,
      },
    })
    delayedVersion = mutation.choice_set.version
    await simulateVisibilityTransition(background.page)
    await withTimeout(aggregateStarted, 15_000, 'background aggregate did not start')
    await background.page.waitForFunction(() => {
      const inputNode = document.querySelector('#sheet-choice-editor')
      const list = document.getElementById(inputNode?.getAttribute('aria-controls') ?? '')
      return list?.getAttribute('aria-disabled') === 'true'
    })
    await backgroundInput.press('Enter')
    await background.page.waitForTimeout(350)
    assert.equal(backgroundPatches.length, 0, 'stale open editor committed during version transition')
    releaseAggregate()
    await background.page.waitForFunction(() => {
      const inputNode = document.querySelector('#sheet-choice-editor')
      const list = document.getElementById(inputNode?.getAttribute('aria-controls') ?? '')
      return list?.getAttribute('aria-disabled') !== 'true' && inputNode?.getAttribute('aria-activedescendant') !== null
    }, null, { timeout: 20_000 })
    await backgroundInput.fill(mutationCode)
    await background.page.getByRole('option', { name: new RegExp(mutationCode) }).waitFor()
    const recoveredScreenshot = await this.screenshot(background.page, 'sheet-background-version-recovered-1440x900')
    await backgroundInput.press('Escape')
    await this.closeBrowserContext(background.context)
    await this.releaseScenarioLocksAndWait(projectId)

    return {
      cached_summary_failures: summaryFailures,
      cached_display_preserved: true,
      fail_closed_patch_count: patches.length,
      retry_restored_readiness: true,
      summary_failure_copy: summaryFailureText.replace(/\s+/g, ' ').trim(),
      background_version: delayedVersion,
      background_patch_count: backgroundPatches.length,
      exact_version_recovered: true,
      screenshots: [failedScreenshot, recoveredScreenshot],
      aria: failedAria,
    }
  }

  async sheetValueScenario() {
    const projectId = this.seedProject.id
    const inactiveRun = await this.newPage('sheet-inactive-value')
    const inactiveSheet = await this.openSheet(inactiveRun.page, projectId)
    assert.equal(inactiveSheet.rows[0]?.cells.param_002, 'MODE_002')
    const inactivePoint = await gridPoint(inactiveRun.page, 2, 0)
    await inactiveRun.page.mouse.move(inactivePoint.x, inactivePoint.y)
    const inactiveTooltip = inactiveRun.page.locator('[data-testid="header-tooltip"]')
    await inactiveTooltip.waitFor()
    assert.match(await inactiveTooltip.textContent(), /MODE_002 · Equipment mode 002/)
    await clickGridCell(inactiveRun.page, 2, 0)
    const inactiveInput = inactiveRun.page.locator('#sheet-choice-editor')
    await inactiveInput.waitFor()
    const inactiveRoot = searchableChoiceRoot(inactiveRun.page, '#sheet-choice-editor')
    const inactiveStatus = inactiveRun.page.locator('#sheet-choice-editor-selected-status')
    await waitUntil(
      async () => /MODE_002 · Equipment mode 002.*사용 중지됨/s.test((await inactiveStatus.textContent()) ?? ''),
      10_000,
      'inactive stored choice warning',
    )
    assert.match(await inactiveStatus.textContent(), /MODE_002 · Equipment mode 002.*사용 중지됨/s)
    await inactiveInput.fill('MODE_002')
    await inactiveRun.page.waitForTimeout(100)
    assert.equal(await inactiveRun.page.getByRole('option', { name: /MODE_002/ }).count(), 0)
    await inactiveInput.press('Enter')
    assert.equal(await inactiveInput.count(), 1, 'inactive option was committable')
    const inactiveScreenshot = await this.screenshot(inactiveRun.page, 'sheet-inactive-stored-value-1440x900')
    await inactiveInput.press('Escape')
    await this.closeBrowserContext(inactiveRun.context)
    await this.releaseScenarioLocksAndWait(projectId)

    const rawRun = await this.newPage('sheet-raw-decimal-paste')
    const rawPatches = []
    await rawRun.page.route(`**/api/projects/${projectId}/sheet`, async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      const response = await route.fetch()
      const body = await response.json()
      body.rows[1].cells.param_002 = 'MISSING_CODE'
      return route.fulfill({ response, body: JSON.stringify(body), contentType: 'application/json' })
    })
    rawRun.page.on('request', (request) => {
      const url = new URL(request.url())
      if (request.method() === 'PATCH' && url.pathname === `/api/projects/${projectId}/cells`) {
        rawPatches.push(request.postDataJSON())
      }
    })
    const actualSheet = await this.openSheet(rawRun.page, projectId)
    const rawPoint = await gridPoint(rawRun.page, 2, 1)
    await rawRun.page.mouse.move(rawPoint.x, rawPoint.y)
    const rawTooltip = rawRun.page.locator('[data-testid="header-tooltip"]')
    await rawTooltip.waitFor()
    assert.equal((await rawTooltip.textContent())?.trim(), 'MISSING_CODE')
    await clickGridCell(rawRun.page, 2, 1)
    const rawInput = rawRun.page.locator('#sheet-choice-editor')
    await rawInput.waitFor()
    const rawStatus = rawRun.page.locator('#sheet-choice-editor-selected-status')
    await waitUntil(
      async () => /MISSING_CODE/.test((await rawStatus.textContent()) ?? ''),
      10_000,
      'raw choice selected-value diagnostic',
    )
    assert.match(await rawStatus.textContent(), /MISSING_CODE/)
    await rawInput.fill('MISSING_CODE')
    await rawRun.page.waitForTimeout(100)
    assert.equal(await rawRun.page.getByRole('option', { name: /MISSING_CODE/ }).count(), 0)
    await rawInput.press('Enter')
    assert.equal(rawPatches.length, 0)
    await rawInput.press('Escape')
    await rawInput.waitFor({ state: 'detached' })

    await clickGridCell(rawRun.page, 2, 1)
    await rawRun.page.locator('#sheet-choice-editor').waitFor()
    await rawRun.page.locator('#sheet-choice-editor').press('Escape')
    await assertCanvasFocus(rawRun.page, 'raw paste target')
    await rawRun.page.evaluate(() => navigator.clipboard.writeText('MISSING_CODE\nMODE_002'))
    await rawRun.page.keyboard.press('Control+V')
    let panel = rawRun.page.locator('[data-testid="paste-staging-panel"]')
    await panel.waitFor()
    await panel.getByText('불일치 2', { exact: true }).waitFor()
    assert.equal(await panel.getByRole('button', { name: '적용 (0)' }).isDisabled(), true)
    assert.equal(rawPatches.length, 0)
    const rawScreenshot = await this.screenshot(rawRun.page, 'sheet-raw-inactive-paste-rejected-1440x900')
    await panel.getByRole('button', { name: '취소' }).click()
    await panel.waitFor({ state: 'detached' })

    const decimalPoint = await gridPoint(rawRun.page, 0, 0)
    await rawRun.page.mouse.dblclick(decimalPoint.x, decimalPoint.y)
    const decimalInput = rawRun.page.locator('input[inputmode="decimal"]')
    await decimalInput.waitFor()
    const invalidVectors = [
      ['1e3', /지수·쉼표/],
      ['1,5', /지수·쉼표/],
      ['9'.repeat(129), /128자리/],
      ['9'.repeat(257), /256자/],
    ]
    for (const [value, message] of invalidVectors) {
      await decimalInput.fill(value)
      await decimalInput.press('Enter')
      await rawRun.page.getByRole('alert').filter({ hasText: message }).waitFor()
      assert.equal(await decimalInput.count(), 1)
      assert.equal(rawPatches.length, 0)
    }
    const decimalInvalidScreenshot = await this.screenshot(rawRun.page, 'sheet-decimal-invalid-vectors-1440x900')
    await decimalInput.fill('001.5000')
    await decimalInput.press('Enter')
    await decimalInput.waitFor({ state: 'detached' })
    await waitUntil(() => rawPatches.length >= 1, 10_000, 'manual decimal PATCH')
    assert.equal(rawPatches[0].origin, 'manual')
    assert.equal(rawPatches[0].cells[0].value, '1.5')

    await clickGridCell(rawRun.page, 0, 1)
    await rawRun.page.locator('[data-testid="sheet-view-grid"] canvas').first().focus()
    await rawRun.page.evaluate(() => navigator.clipboard.writeText('.5\tTXT\tUNKNOWN\t001.5000'))
    await rawRun.page.keyboard.press('Control+V')
    panel = rawRun.page.locator('[data-testid="paste-staging-panel"]')
    await panel.waitFor()
    await panel.getByText('적용 3', { exact: true }).waitFor()
    await panel.getByText('불일치 1', { exact: true }).waitFor()
    await panel.getByRole('button', { name: '적용 (3)' }).click()
    await panel.waitFor({ state: 'detached', timeout: 10_000 })
    await waitUntil(() => rawPatches.length >= 2, 10_000, 'paste decimal PATCH')
    const pastePatch = rawPatches.at(-1)
    assert.equal(pastePatch.origin, 'paste')
    assert.deepEqual(
      pastePatch.cells.map(({ parameter_code, value }) => [parameter_code, value]),
      [['param_000', '0.5'], ['param_001', 'TXT'], ['param_003', '1.5']],
    )
    await rawRun.page.waitForFunction(() => document.querySelector('[data-sheet-editing-status]')?.textContent?.includes('저장됨'))
    const canonicalScreenshot = await this.screenshot(rawRun.page, 'sheet-decimal-paste-canonical-1440x900')
    await this.closeBrowserContext(rawRun.context)
    await this.releaseScenarioLocksAndWait(projectId)

    const persisted = await this.apiJson(`/projects/${projectId}/sheet`, { expected: 200 })
    assert.equal(persisted.rows.find(({ condition_id }) => condition_id === actualSheet.rows[0].condition_id)?.cells.param_000, '1.5')
    const persistedPasteRow = persisted.rows.find(({ condition_id }) => condition_id === actualSheet.rows[1].condition_id)
    assert.equal(persistedPasteRow?.cells.param_000, '0.5')
    assert.equal(persistedPasteRow?.cells.param_001, 'TXT')
    assert.equal(persistedPasteRow?.cells.param_003, '1.5')

    const failureRun = await this.newPage('sheet-option-request-error')
    let failOptions = true
    let optionFailures = 0
    await failureRun.page.route(`**/api/choice-sets/${EQUIPMENT_SET}/options**`, async (route) => {
      if (failOptions && route.request().method() === 'GET') {
        optionFailures += 1
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'qa_option_failure', message: 'Task 15 forced option request failure' }),
        })
      }
      return route.continue()
    })
    await this.openSheet(failureRun.page, projectId)
    await clickGridCell(failureRun.page, 2, 1)
    const failureInput = failureRun.page.locator('#sheet-choice-editor')
    await failureInput.waitFor()
    const failureRoot = searchableChoiceRoot(failureRun.page, '#sheet-choice-editor')
    const optionFailureAlert = failureRoot.getByRole('alert')
    await optionFailureAlert.waitFor({ timeout: 20_000 })
    const optionFailureText = (await optionFailureAlert.textContent()) ?? ''
    assert.match(optionFailureText, /503|Service Unavailable|Request failed/i)
    assert(optionFailures >= 2)
    const optionFailureScreenshot = await this.screenshot(failureRun.page, 'sheet-option-request-error-1440x900')
    failOptions = false
    await failureRoot.getByRole('button', { name: '다시 시도' }).click()
    await failureRun.page.waitForFunction(() => {
      const inputNode = document.querySelector('#sheet-choice-editor')
      const list = document.getElementById(inputNode?.getAttribute('aria-controls') ?? '')
      return list?.getAttribute('aria-disabled') !== 'true' && list?.querySelector('[role="option"]') !== null
    }, null, { timeout: 20_000 })
    await failureInput.fill('MODE_010')
    await failureRun.page.getByRole('option', { name: /MODE_010/ }).waitFor()
    await failureInput.press('Escape')
    await this.closeBrowserContext(failureRun.context)
    await this.releaseScenarioLocksAndWait(projectId)

    return {
      inactive_stored_code: 'MODE_002',
      inactive_absent_from_new_choices: true,
      raw_code: 'MISSING_CODE',
      raw_and_inactive_paste_mismatches: 2,
      invalid_decimal_vectors: invalidVectors.map(([value]) => value.length > 32 ? `<${value.length} chars>` : value),
      manual_canonical_value: rawPatches[0].cells[0].value,
      paste_canonical_values: pastePatch.cells,
      persisted_cache_values: {
        single: '1.5', paste: ['0.5', 'TXT', '1.5'],
      },
      option_request_failures: optionFailures,
      option_failure_copy: optionFailureText.replace(/\s+/g, ' ').trim(),
      option_retry_recovered: true,
      screenshots: [inactiveScreenshot, rawScreenshot, decimalInvalidScreenshot, canonicalScreenshot, optionFailureScreenshot],
    }
  }

  async sheetLiveDiscoveryScenario() {
    const projectId = this.seedProject.id
    const sheetRun = await this.newPage('sheet-live-discovery')
    await sheetRun.page.clock.install({ time: new Date() })
    const history = []
    await sheetRun.page.route(`**/api/choice-sets/${EQUIPMENT_SET}**`, async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      const url = new URL(route.request().url())
      const response = await route.fetch()
      const bodyText = await response.text()
      let body = null
      try { body = JSON.parse(bodyText) } catch { body = null }
      history.push({
        at: new Date().toISOString(),
        path: url.pathname,
        version: body?.version ?? null,
        requested_version: numberOrNull(url.searchParams.get('version')),
        cursor: url.searchParams.get('cursor'),
        status: response.status(),
      })
      await route.fulfill({ response, body: bodyText })
    })
    const sheet = await this.openSheet(sheetRun.page, projectId)
    assert.equal(sheet.columns.some((column) => Object.hasOwn(column, 'options') || Object.hasOwn(column, 'choice_options')), false)
    const initialSummary = await this.apiJson(`/choice-sets/${EQUIPMENT_SET}`, { expected: 200 })
    await waitUntil(
      () => history.some(({ path: pathname, requested_version, cursor, status }) =>
        pathname.endsWith('/options') && requested_version === initialSummary.version && cursor === null && status === 200),
      20_000,
      `initial version ${initialSummary.version} did not start at page 1`,
    )
    const initialStarts = history.filter(
      ({ path: pathname, requested_version, cursor, status }) =>
        pathname.endsWith('/options') && requested_version === initialSummary.version && cursor === null && status === 200,
    )
    assert.equal(initialStarts.length, 1, `shared columns started duplicate aggregates: ${JSON.stringify(history)}`)

    const adminRun = await this.newPage('sheet-live-second-admin')
    await this.goto(adminRun.page, `/parameters/choice-sets/${EQUIPMENT_SET}`, async () => {
      await adminRun.page.getByRole('heading', { name: '선택지 목록' }).waitFor({ timeout: 20_000 })
    })
    const mutateLabel = async (label) => {
      const summary = await browserApiJson(adminRun.page, `/api/choice-sets/${EQUIPMENT_SET}`, { expected: 200 })
      return browserApiJson(adminRun.page, `/api/choice-sets/${EQUIPMENT_SET}/options/MODE_010`, {
        expected: 200,
        method: 'PATCH',
        data: { expected_version: summary.version, label },
      })
    }
    const assertVersionStartsAtPageOne = async (version, label) => {
      await waitUntil(
        () => history.some(({ path: pathname, requested_version, cursor, status }) =>
          pathname.endsWith('/options') && requested_version === version && cursor === null && status === 200),
        20_000,
        `${label} version ${version} did not start at page 1`,
      )
      const first = history.find(({ path: pathname, requested_version, status }) =>
        pathname.endsWith('/options') && requested_version === version && status === 200)
      assert.equal(first?.cursor, null, `${label} version ${version} did not start without a cursor`)
    }

    const opened = await mutateLabel('Equipment mode 010 · open discovery')
    await clickGridCell(sheetRun.page, 2, 1)
    let input = sheetRun.page.locator('#sheet-choice-editor')
    await input.waitFor()
    await assertVersionStartsAtPageOne(opened.choice_set.version, 'editor-open')
    await input.fill('MODE_010')
    await sheetRun.page.getByRole('option', { name: /MODE_010.*open discovery/ }).waitFor()
    await input.press('Escape')

    const focused = await mutateLabel('Equipment mode 010 · focus discovery')
    const focusVisibilityTransition = await simulateVisibilityTransition(sheetRun.page)
    await assertVersionStartsAtPageOne(focused.choice_set.version, 'window-focus')
    await clickGridCell(sheetRun.page, 2, 1)
    input = sheetRun.page.locator('#sheet-choice-editor')
    await input.waitFor()
    await input.fill('MODE_010')
    await sheetRun.page.getByRole('option', { name: /MODE_010.*focus discovery/ }).waitFor()
    await input.press('Escape')

    const interval = await mutateLabel('Equipment mode 010 · interval discovery')
    await sheetRun.page.clock.fastForward(60_001)
    await assertVersionStartsAtPageOne(interval.choice_set.version, '60-second-interval')
    await clickGridCell(sheetRun.page, 2, 1)
    input = sheetRun.page.locator('#sheet-choice-editor')
    await input.waitFor()
    await input.fill('MODE_010')
    await sheetRun.page.getByRole('option', { name: /MODE_010.*interval discovery/ }).waitFor()
    const screenshot = await this.screenshot(sheetRun.page, 'sheet-live-discovery-1440x900')
    await input.press('Escape')
    await this.closeBrowserContext(adminRun.context)
    await this.closeBrowserContext(sheetRun.context)
    await this.releaseScenarioLocksAndWait(projectId)

    const versions = [initialSummary.version, opened.choice_set.version, focused.choice_set.version, interval.choice_set.version]
    for (const version of versions) {
      assert.equal(
        history.filter(({ path: pathname, requested_version, cursor }) => pathname.endsWith('/options') && requested_version === version && cursor === null).length,
        1,
        `version ${version} aggregate restarted more than once`,
      )
    }
    return {
      shared_choice_columns: sheet.columns.filter(({ value_type }) => value_type === 'choice').length,
      embedded_options: 0,
      discovered_versions: {
        initial: initialSummary.version,
        editor_open: opened.choice_set.version,
        window_focus: focused.choice_set.version,
        interval_60_seconds: interval.choice_set.version,
      },
      first_page_history: history,
      exact_one_start_per_version: true,
      second_admin_context: true,
      focus_visibility_transition: focusVisibilityTransition,
      screenshot,
    }
  }

  async responsiveScenario() {
    const projectId = this.seedProject.id
    const evidence = []
    for (const viewport of VIEWPORTS) {
      const run = await this.newPage(`responsive-${viewport.name}`, viewport)
      const { page } = run
      await this.goto(page, '/projects', async () => {
        await page.getByRole('heading', { name: '프로젝트', exact: true }).waitFor()
      })
      const listMetrics = await responsiveMetrics(page)
      assert.equal(listMetrics.bodyNoOverflow, true)
      assert.equal(listMetrics.documentNoOverflow, true)
      const headers = await visibleTableHeaders(page)
      assert.deepEqual(
        headers,
        EXPECTED_PROJECT_HEADERS[viewport.name],
        `${viewport.name} collapse order: ${headers.join(', ')}`,
      )
      const listScreenshot = await this.screenshot(page, `responsive-project-list-${viewport.name}`)

      await this.goto(page, `/projects/${projectId}`, async () => {
        await page.getByRole('heading', { name: '프로젝트 기본정보' }).waitFor()
      })
      await page.getByRole('button', { name: '기본정보 편집' }).click()
      await page.locator('#profile-process-name:not([disabled])').waitFor({ timeout: 20_000 })
      const dialog = page.getByRole('dialog', { name: '프로젝트 기본정보 편집' })
      const drawerMetrics = await dialog.evaluate((node) => {
        const rect = node.getBoundingClientRect()
        const tabbable = [...node.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
          .filter((item) => item.getClientRects().length > 0)
        return {
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom },
          viewport: { width: innerWidth, height: innerHeight },
          tabbableCount: tabbable.length,
        }
      })
      const expectedDrawerWidth = viewport.width === 1024 ? 409.6 : 480
      assert(Math.abs(drawerMetrics.rect.width - expectedDrawerWidth) < 2, `${viewport.name} drawer width ${drawerMetrics.rect.width}`)
      assert(drawerMetrics.rect.x >= 0 && drawerMetrics.rect.right <= viewport.width + 0.5)
      assert(drawerMetrics.rect.y >= 0 && drawerMetrics.rect.bottom <= viewport.height + 0.5)
      assert(drawerMetrics.tabbableCount > 3)
      await focusDialogEdgeAndWrap(page, dialog, false)
      await focusDialogEdgeAndWrap(page, dialog, true)
      const save = dialog.getByRole('button', { name: '저장', exact: true })
      await save.scrollIntoViewIfNeeded()
      const saveBox = await save.boundingBox()
      assert(saveBox && saveBox.x >= 0 && saveBox.y >= 0 && saveBox.x + saveBox.width <= viewport.width && saveBox.y + saveBox.height <= viewport.height)
      const drawerScreenshot = await this.screenshot(page, `responsive-profile-drawer-${viewport.name}`)
      await dialog.getByRole('button', { name: '취소', exact: true }).click()
      await dialog.waitFor({ state: 'detached' })

      await this.goto(page, `/projects/${projectId}/sheet`, async () => {
        await page.locator('[data-testid="sheet-view-grid"]').waitFor()
        await page.getByText('편집 잠금', { exact: true }).waitFor({ timeout: 20_000 })
      })
      await page.waitForFunction(() => document.querySelector('[data-testid="sheet-view-grid"] canvas'))
      const sheetMetrics = await responsiveMetrics(page)
      assert.equal(sheetMetrics.bodyNoOverflow, true)
      assert.equal(sheetMetrics.documentNoOverflow, true)
      const gridBox = await page.locator('[data-testid="sheet-view-grid"]').boundingBox()
      assert(gridBox && gridBox.x >= 0 && gridBox.y >= 0 && gridBox.x + gridBox.width <= viewport.width && gridBox.y + gridBox.height <= viewport.height)
      await clickGridCell(page, 2, 1)
      const input = page.locator('#sheet-choice-editor')
      await input.waitFor()
      const choiceRoot = searchableChoiceRoot(page, '#sheet-choice-editor')
      let overlayBox = null
      await waitUntil(async () => {
        overlayBox = await choiceRoot.boundingBox()
        return isBoxInsideViewport(overlayBox, viewport)
      }, 10_000, `${viewport.name} choice editor placement`)
      assert(isBoxInsideViewport(overlayBox, viewport), `${viewport.name} choice editor is clipped: ${JSON.stringify(overlayBox)}`)
      const controls = await input.getAttribute('aria-controls')
      assert(controls, `${viewport.name} choice editor does not own a listbox`)
      const listbox = page.locator(`#${controls}`)
      let listboxBox = null
      await waitUntil(async () => {
        listboxBox = await listbox.boundingBox()
        return isBoxInsideViewport(listboxBox, viewport)
      }, 10_000, `${viewport.name} choice listbox placement`)
      assert(isBoxInsideViewport(listboxBox, viewport), `${viewport.name} choice listbox is clipped: ${JSON.stringify(listboxBox)}`)
      const sheetScreenshot = await this.screenshot(page, `responsive-sheet-choice-${viewport.name}`)
      await input.press('Escape')
      await this.closeBrowserContext(run.context)
      await this.releaseScenarioLocksAndWait(projectId)
      evidence.push({
        viewport,
        headers,
        list: listMetrics,
        drawer: drawerMetrics,
        sheet: sheetMetrics,
        choice_listbox: listboxBox,
        screenshots: [listScreenshot, drawerScreenshot, sheetScreenshot],
      })
    }
    return { viewports: evidence, horizontal_overflow: 0, focus_escape: 0 }
  }

  async accessibilityScenario() {
    const projectId = this.seedProject.id
    const run = await this.newPage('accessibility-contract')
    const { page } = run
    await this.goto(page, '/projects', async () => page.getByRole('heading', { name: '프로젝트', exact: true }).waitFor())
    assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute('data-page-title')), true)
    const appSkip = page.getByRole('link', { name: '본문으로 건너뛰기' })
    await page.getByRole('link', { name: 'PCM 프로젝트' }).focus()
    await page.keyboard.press('Shift+Tab')
    assert.equal(await appSkip.evaluate((node) => node === document.activeElement), true)
    await appSkip.press('Enter')
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'main-content')
    assert.equal(await page.getByRole('link', { name: '프로젝트', exact: true }).getAttribute('aria-current'), 'page')
    const projectAria = await this.ariaSnapshot(page.locator('main#main-content'), 'project-list-main')

    await this.goto(page, `/projects/${projectId}/sheet`, async () => {
      await page.locator('[data-testid="sheet-view-grid"]').waitFor()
      await page.getByText('편집 잠금', { exact: true }).waitFor({ timeout: 20_000 })
    })
    await page.waitForFunction(() => document.querySelector('[data-testid="sheet-view-grid"] canvas'))
    assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute('data-page-title')), true)
    const sheetSkip = page.getByRole('link', { name: '조건표로 건너뛰기' })
    await page.locator('main#main-content').focus()
    await page.keyboard.press('Shift+Tab')
    assert.equal(await sheetSkip.evaluate((node) => node === document.activeElement), true)
    await sheetSkip.press('Enter')
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'main-content')

    await clickGridCell(page, 1, 2)
    await assertCanvasFocus(page, 'keyboard pre-choice selection')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
    const input = page.locator('#sheet-choice-editor')
    await input.waitFor()
    await page.waitForFunction(() => document.querySelector('#sheet-choice-editor')?.getAttribute('aria-activedescendant') !== null, null, { timeout: 20_000 })
    assert.equal(await input.getAttribute('role'), 'combobox')
    assert.equal(await input.getAttribute('aria-expanded'), 'true')
    const controls = await input.getAttribute('aria-controls')
    const activeDescendant = await input.getAttribute('aria-activedescendant')
    assert(controls && activeDescendant)
    const listbox = page.locator(`#${controls}`)
    assert.equal(await listbox.getAttribute('role'), 'listbox')
    assert.equal(await page.locator(`#${activeDescendant}`).getAttribute('role'), 'option')
    const selectedStatus = page.locator('#sheet-choice-editor-selected-status')
    const selectedAnnouncement = await selectedStatus.textContent()
    assert.match(selectedAnnouncement, /MODE_004 · Equipment mode 004/)
    const choiceAria = await this.ariaSnapshot(searchableChoiceRoot(page, '#sheet-choice-editor'), 'sheet-choice-expanded')
    const listboxAria = await this.ariaSnapshot(listbox, 'sheet-choice-listbox')
    const gridAria = await this.ariaSnapshot(page.locator('[data-testid="sheet-view-grid"]'), 'sheet-grid-accessibility')
    await waitUntil(
      async () => await page.locator('[data-testid="sheet-view-grid"] table[role="grid"]').count() === 1,
      10_000,
      'accessibility semantic grid table',
    )
    const tableContract = await page.locator('[data-testid="sheet-view-grid"]').evaluate((grid) => {
      const canvas = grid.querySelectorAll('canvas')
      const tables = grid.querySelectorAll('table[role="grid"]')
      return {
        canvases: canvas.length,
        semanticTables: tables.length,
        canvasOwned: [...tables].filter((table) => table.closest('canvas') !== null).length,
        outsideCanvas: [...tables].filter((table) => table.closest('canvas') === null).length,
        outsideGrid: document.querySelectorAll('table[role="grid"]').length - tables.length,
      }
    })
    assert.equal(tableContract.semanticTables, 1)
    assert.equal(tableContract.canvasOwned, 1)
    assert.equal(tableContract.outsideCanvas, 0)
    assert.equal(tableContract.outsideGrid, 0)

    await input.press('ArrowDown')
    await input.press('Enter')
    await input.waitFor({ state: 'detached' })
    await assertCanvasFocus(page, 'keyboard choice Enter')
    await page.waitForFunction(
      () => document.querySelector('[data-sheet-editing-status]')?.textContent?.includes('저장됨'),
      null,
      { timeout: 10_000 },
    )
    await page.keyboard.press('Enter')
    const reopened = page.locator('#sheet-choice-editor')
    await reopened.waitFor()
    await reopened.press('Escape')
    await reopened.waitFor({ state: 'detached' })
    await assertCanvasFocus(page, 'keyboard choice Escape')
    const screenshot = await this.screenshot(page, 'accessibility-sheet-focus-1440x900')
    await this.closeBrowserContext(run.context)
    await this.releaseScenarioLocksAndWait(projectId)
    return {
      app_skip_link: '본문으로 건너뛰기',
      sheet_skip_link: '조건표로 건너뛰기',
      main_focus: true,
      current_navigation: 'project',
      combobox_ownership: { controls, active_descendant: activeDescendant },
      selected_announcement: selectedAnnouncement,
      semantic_table_contract: tableContract,
      enter_focus_return: true,
      escape_focus_return: true,
      aria: [projectAria, choiceAria, listboxAria, gridAria],
      screenshot,
    }
  }

  async openSheet(page, projectId) {
    const sheet = await this.apiJson(`/projects/${projectId}/sheet`, { expected: 200 })
    await this.goto(page, `/projects/${projectId}/sheet`, async () => {
      await page.locator('[data-testid="sheet-view-grid"]').waitFor({ timeout: 20_000 })
      await page.getByText('편집 잠금', { exact: true }).waitFor({ timeout: 20_000 })
    })
    await page.waitForFunction(() => document.querySelector('[data-testid="sheet-view-grid"] canvas'))
    await page.waitForFunction(() => (document.querySelector('[data-testid="sheet-view-grid"]')?.clientHeight ?? 0) > 200)
    await page.waitForTimeout(600)
    return sheet
  }

  async waitForSheetUnlock(projectId) {
    await waitUntil(async () => {
      const sheet = await this.apiJson(`/projects/${projectId}/sheet`, { expected: 200 })
      return sheet.lock.locked_by === null
    }, 10_000, `project ${projectId} lock release`)
  }

  // Scenario implementations are kept below to make the checked-in harness independently runnable.
}

function searchableChoiceRoot(page, selector) {
  return page.locator(selector).locator('xpath=ancestor::div[@data-searchable-choice]')
}

async function hydrateHistoricalChoice(page, selector, expectedStatus) {
  const input = page.locator(selector)
  const root = searchableChoiceRoot(page, selector)
  await input.click()
  const controls = await input.getAttribute('aria-controls')
  assert(controls, `${selector} does not own a listbox`)
  await page.waitForFunction((listboxId) => {
    const listbox = document.getElementById(listboxId)
    return listbox?.getAttribute('aria-busy') !== 'true' &&
      listbox?.getAttribute('aria-disabled') !== 'true' &&
      listbox?.querySelector('[role="option"]') !== null
  }, controls, { timeout: 20_000 })
  await waitUntil(async () => expectedStatus.test((await root.getByRole('status').textContent()) ?? ''), 10_000, `${selector} historical label`)
  assert.match((await root.textContent()) ?? '', expectedStatus)
  if (await input.getAttribute('aria-expanded') === 'true') await input.press('Escape')
}

function projectListRouteState(rawUrl) {
  const params = new URL(rawUrl).searchParams
  return {
    query: params.get('query'),
    status: params.get('status'),
    device_type: params.get('device_type'),
    project_category: params.get('project_category'),
  }
}

function projectListApiFilterState(request = {}) {
  return {
    query: request.query ?? null,
    status: request.status ?? null,
    device_type: request.device_type_code ?? null,
    project_category: request.project_category_code ?? null,
  }
}

async function selectSearchableChoice(page, selector, code) {
  const input = page.locator(selector)
  await input.click()
  await input.fill(code)
  const option = page.getByRole('option', { name: new RegExp(`^${escapeRegExp(code)}(?:\\s|·)`) })
  await option.waitFor({ timeout: 20_000 })
  assert.notEqual(await option.getAttribute('aria-disabled'), 'true', `${code} is not committable`)
  await option.click()
}

function syntheticProjectSummary(seed, id, index) {
  return {
    id,
    line_id: seed.line_id,
    process_id: seed.process_id,
    part_id: `QA-SYNTH-${String(index).padStart(3, '0')}`,
    name: `QA synthetic project ${String(index).padStart(3, '0')}`,
    status: 'draft',
    device_type: { code: 'MEMORY_LEGACY', label: 'Memory (legacy)', is_active: false },
    project_category: { code: 'LEGACY_PROJECT', label: 'Legacy project', is_active: false },
    layer_total: seed.profile.layer_total,
    updated_at: new Date(Date.parse(seed.profile.updated_at) + index * 1000).toISOString(),
    layer_count: seed.layers.length,
    cell_count: seed.layers.reduce((total, layer) => total + layer.cell_count, 0),
  }
}

function syntheticProjectDetail(seed, id) {
  return {
    ...seed,
    id,
    part_id: `QA-SYNTH-${id}`,
    name: `QA synthetic project ${id}`,
    profile: {
      ...seed.profile,
      project_id: id,
      device_type: { code: 'MISSING_DEVICE', label: 'MISSING_DEVICE', is_active: false },
      project_category: { code: 'LEGACY_PROJECT', label: 'Legacy project', is_active: false },
    },
  }
}

async function visibleTableHeaders(page) {
  return page.locator('table thead th').evaluateAll((headers) =>
    headers
      .filter((header) => {
        const style = getComputedStyle(header)
        const rect = header.getBoundingClientRect()
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0
      })
      .map((header) => header.textContent?.replace(/\s+/g, ' ').trim() ?? ''),
  )
}

async function gridPoint(page, parameterIndex, rowIndex = 0) {
  const box = await page.locator('[data-testid="sheet-view-grid"]').boundingBox()
  assert(box, 'grid bounds unavailable')
  return {
    x: box.x + 190 + 84 + 96 + parameterIndex * 150 + 75,
    y: box.y + 34 + rowIndex * 32 + 16,
  }
}

async function clickGridCell(page, parameterIndex, rowIndex = 0) {
  const point = await gridPoint(page, parameterIndex, rowIndex)
  await page.mouse.click(point.x, point.y)
}

async function assertCanvasFocus(page, label) {
  await page.waitForFunction(() => {
    const active = document.activeElement
    const grid = document.querySelector('[data-testid="sheet-view-grid"]')
    return grid?.contains(active) === true && (
      active?.tagName === 'CANVAS' || active?.getAttribute('role') === 'gridcell'
    )
  }, null, { timeout: 5_000 })
  const actual = await page.evaluate(() => ({
    tag: document.activeElement?.tagName ?? null,
    role: document.activeElement?.getAttribute('role') ?? null,
    inGrid: document.querySelector('[data-testid="sheet-view-grid"]')?.contains(document.activeElement) ?? false,
  }))
  assert(isGridFocusTarget(actual), `${label}: grid focus was not restored (${JSON.stringify(actual)})`)
  return actual
}

async function simulateVisibilityTransition(page) {
  const states = await page.evaluate(() => {
    const transition = (visibilityState) => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: visibilityState,
      })
      window.dispatchEvent(new Event('visibilitychange'))
      return document.visibilityState
    }
    return [transition('hidden'), transition('visible')]
  })
  assert.deepEqual(states, ['hidden', 'visible'], 'visibility transition simulation failed')
  return states
}

async function responsiveMetrics(page) {
  return page.evaluate(() => ({
    viewport: { width: innerWidth, height: innerHeight },
    body: { clientWidth: document.body.clientWidth, scrollWidth: document.body.scrollWidth },
    document: { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth },
    bodyNoOverflow: document.body.scrollWidth === document.body.clientWidth,
    documentNoOverflow: document.documentElement.scrollWidth === document.documentElement.clientWidth,
  }))
}

async function focusDialogEdgeAndWrap(page, dialog, backwards) {
  await dialog.evaluate((node, reverse) => {
    const tabbable = [...node.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter((element) => element.getClientRects().length > 0)
    const target = reverse ? tabbable[0] : tabbable.at(-1)
    target?.focus()
  }, backwards)
  await page.keyboard.press(backwards ? 'Shift+Tab' : 'Tab')
  assert.equal(await dialog.evaluate((node) => node.contains(document.activeElement)), true, 'focus escaped modal dialog')
}

async function browserApiJson(page, apiPath, { expected, method = 'GET', data } = {}) {
  return page.evaluate(async ({ apiPath: target, expected: allowedStatus, method: verb, data: payload }) => {
    const response = await fetch(target, {
      method: verb,
      headers: payload === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    })
    const text = await response.text()
    if (!allowedStatus.includes(response.status)) {
      throw new Error(`${verb} ${target}: expected ${allowedStatus}, got ${response.status} ${text}`)
    }
    return text === '' ? { __status: response.status } : JSON.parse(text)
  }, { apiPath, expected: Array.isArray(expected) ? expected : [expected], method, data })
}

async function waitUntil(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`)
}

async function withTimeout(promise, timeoutMs, label) {
  let timeout
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(label)), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timeout)
  }
}

async function answerNativeConfirm(page, action, accept) {
  const message = page.waitForEvent('dialog').then(async (dialog) => {
    const value = dialog.message()
    if (accept) await dialog.accept()
    else await dialog.dismiss()
    return value
  })
  const [, value] = await Promise.all([action(), message])
  return value
}

function assertSafeEvidenceOutput(output) {
  const normalized = path.resolve(output)
  const suffix = path.join('docs', 'superpowers', 'evidence', 'phase-2-6')
  assert(normalized.endsWith(`${path.sep}${suffix}`), `--output must be the Task 15 evidence leaf: ${suffix}`)
  assert.equal(path.basename(normalized), 'phase-2-6')
  assert.notEqual(normalized, path.parse(normalized).root)
}

function evidenceRepoRoot(output) {
  return path.resolve(output, '..', '..', '..', '..')
}

export async function resetEvidenceArtifacts(output, manifestPath) {
  const root = path.resolve(output)
  const configuredManifest = path.resolve(manifestPath)
  assert.equal(path.dirname(configuredManifest), root, 'build manifest must be directly inside the evidence leaf')
  assert.equal(path.basename(configuredManifest), 'build-manifest.json', 'unexpected build manifest filename')
  const resolvedManifest = await realpath(configuredManifest)
  assert.equal(resolvedManifest, configuredManifest, 'build manifest must not be a symlink')
  const before = await readFile(resolvedManifest)
  const entries = await readdir(root)
  for (const entry of entries) {
    if (entry === 'build-manifest.json') continue
    await rm(path.join(root, entry), { recursive: true, force: true })
  }
  const after = await readFile(resolvedManifest)
  assert.deepEqual(after, before, 'evidence cleanup changed the build manifest')
}

async function sourceProvenance(output, manifestInput, backendContainer) {
  const repoRoot = evidenceRepoRoot(output)
  const outputRoot = path.resolve(output)
  const manifestPath = await realpath(manifestInput)
  assert.equal(path.dirname(manifestPath), outputRoot, 'build manifest must be in the Task 15 evidence leaf')
  assert.equal(path.basename(manifestPath), 'build-manifest.json')
  assert.equal(manifestPath, path.resolve(manifestInput), 'build manifest must not be a symlink')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const { manifest_sha256: claimedManifestSha, ...manifestPayload } = manifest
  assert.match(claimedManifestSha ?? '', /^[0-9a-f]{64}$/, 'build manifest digest is missing')
  assert.equal(claimedManifestSha, sha256Json(manifestPayload), 'build manifest digest mismatch')
  assert.equal(manifest.schema_version, 1, 'unsupported build manifest schema')

  const gitSha = gitText(repoRoot, ['rev-parse', 'HEAD']).trim()
  assert.equal(manifest.source.git_sha, gitSha, 'build manifest Git SHA is stale')
  assert.equal(manifest.source.git_tree, gitText(repoRoot, ['rev-parse', 'HEAD^{tree}']).trim(), 'build manifest Git tree is stale')
  assert.equal(
    manifest.source.frontend_tree,
    gitText(repoRoot, ['rev-parse', 'HEAD:frontend']).trim(),
    'build manifest frontend tree is stale',
  )

  await assertBrowserWorktreeClean(repoRoot, outputRoot)
  const expectedScripts = [
    ['build_harness', 'scripts/qa/build_phase26_dist.mjs'],
    ['browser_harness', 'scripts/qa/phase26_browser_qa.mjs'],
    ['dist_server', 'scripts/qa/serve_phase26_dist.mjs'],
  ]
  assert.deepEqual(Object.keys(manifest.scripts), expectedScripts.map(([key]) => key), 'build manifest QA script set is incomplete')
  for (const [key, relative] of expectedScripts) {
    const current = await readFile(path.join(repoRoot, ...relative.split('/')))
    const committed = gitBuffer(repoRoot, ['show', `HEAD:${relative}`])
    assert.deepEqual(current, committed, `${relative} does not match HEAD`)
    assert.deepEqual(manifest.scripts[key], {
      path: relative,
      bytes: current.length,
      sha256: createHash('sha256').update(current).digest('hex'),
      git_blob: gitText(repoRoot, ['rev-parse', `HEAD:${relative}`]).trim(),
    }, `build manifest script provenance is stale: ${relative}`)
  }
  const executedHarness = await readFile(fileURLToPath(import.meta.url))
  const repositoryHarness = await readFile(path.join(repoRoot, 'scripts', 'qa', 'phase26_browser_qa.mjs'))
  const executedHarnessSha256 = createHash('sha256').update(executedHarness).digest('hex')
  const repositoryHarnessSha256 = createHash('sha256').update(repositoryHarness).digest('hex')
  assert.equal(
    executedHarnessSha256,
    repositoryHarnessSha256,
    'executed browser harness does not match the checked-in source',
  )
  assert.deepEqual(
    { bytes: executedHarness.length, sha256: executedHarnessSha256 },
    {
      bytes: manifest.scripts.browser_harness.bytes,
      sha256: manifest.scripts.browser_harness.sha256,
    },
    'executed browser harness does not match the build manifest provenance',
  )
  const packageLock = await readFile(path.join(repoRoot, 'frontend', 'package-lock.json'))
  assert.deepEqual(manifest.source.package_lock, {
    path: 'frontend/package-lock.json',
    bytes: packageLock.length,
    sha256: createHash('sha256').update(packageLock).digest('hex'),
  }, 'build manifest package-lock provenance is stale')
  assertNormalizedBrowserBuildEnvironment(manifest.build_env)
  const buildHelper = await import(pathToFileURL(path.join(repoRoot, 'scripts', 'qa', 'build_phase26_dist.mjs')).href)
  const installedToolchain = await buildHelper.captureInstalledBuildToolchain(
    path.join(repoRoot, 'frontend'),
    packageLock,
    manifest.build_env.variables,
    manifest.toolchain,
  )
  assert.deepEqual(installedToolchain, manifest.toolchain, 'installed production build toolchain differs from the manifest')
  assert.equal(manifest.runtime.node, manifest.toolchain.runtime.node.version, 'manifest Node runtime is inconsistent')
  assert.equal(manifest.runtime.npm, manifest.toolchain.runtime.npm.version, 'manifest npm runtime is inconsistent')
  assert.equal(process.version, manifest.toolchain.runtime.node.version, 'build and browser Node versions differ')
  assert.equal(
    await realpath(process.execPath),
    manifest.toolchain.runtime.node.path,
    'executed browser Node binary differs from the production build runtime',
  )
  assert.deepEqual(manifest.fresh_build, {
    removed_before_build: ['frontend/dist', 'frontend/tsconfig.tsbuildinfo'],
    regenerated_before_build: ['frontend/node_modules'],
    install_command: ['npm', 'ci', '--include=dev', '--no-audit', '--no-fund'],
  }, 'production build did not declare fresh build artifact removal')
  const distSnapshot = await productionBuildManifest(path.join(repoRoot, 'frontend', 'dist'))
  assert.deepEqual(manifest.dist, distSnapshot, 'production dist differs from the build manifest')
  const backend = inspectBackendContainer(backendContainer, gitSha)
  return {
    git_sha: gitSha,
    git_tree: manifest.source.git_tree,
    frontend_tree: manifest.source.frontend_tree,
    worktree_clean_except_evidence: true,
    build_manifest_path: 'docs/superpowers/evidence/phase-2-6/build-manifest.json',
    build_manifest_sha256: claimedManifestSha,
    harness_sha256: executedHarnessSha256,
    backend,
    production_build: manifest,
  }
}

async function productionBuildManifest(distRoot) {
  const root = await realpath(distRoot)
  const files = []
  const visit = async (directory, prefix = '') => {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
    for (const entry of entries) {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(absolute, relative)
      } else {
        assert(entry.isFile(), `production dist contains a non-file entry: ${relative}`)
        const resolved = await realpath(absolute)
        assert(isInsidePath(root, resolved), `production dist entry escapes through a symlink: ${relative}`)
        const body = await readFile(resolved)
        files.push({
          path: relative,
          bytes: body.length,
          sha256: createHash('sha256').update(body).digest('hex'),
        })
      }
    }
  }
  await visit(distRoot)
  assert(files.some(({ path: filename }) => filename === 'index.html'), 'production dist has no index.html')
  assert(files.some(({ path: filename }) => /^assets\/.*\.js$/.test(filename)), 'production dist has no JavaScript asset')
  return {
    root: 'frontend/dist',
    identity_sha256: sha256Json(files),
    files,
  }
}

async function assertBrowserWorktreeClean(repoRoot, evidenceRoot) {
  const evidenceRelative = path.relative(repoRoot, evidenceRoot).split(path.sep).join('/')
  const tracked = splitNullBuffer(gitBuffer(repoRoot, ['diff', '--name-only', '-z', 'HEAD', '--']))
  const untracked = splitNullBuffer(gitBuffer(repoRoot, ['ls-files', '--others', '--exclude-standard', '-z']))
  const ignoredQa = splitNullBuffer(gitBuffer(repoRoot, [
    'ls-files', '--others', '--ignored', '--exclude-standard', '-z', '--', 'scripts/qa',
  ]))
  const frontendEntries = await readdir(path.join(repoRoot, 'frontend'), { withFileTypes: true })
  const environmentFiles = frontendEntries
    .filter((entry) => entry.name === '.env' || entry.name.startsWith('.env.'))
    .map((entry) => `frontend/${entry.name}`)
  const rejected = [...new Set([...tracked, ...untracked, ...ignoredQa, ...environmentFiles])]
    .map((entry) => entry.split(path.sep).join('/'))
    .filter((entry) => entry !== evidenceRelative && !entry.startsWith(`${evidenceRelative}/`))
    .sort()
  assert.deepEqual(rejected, [], `source tree contains changes outside the evidence leaf: ${rejected.join(', ')}`)
}

function inspectBackendContainer(containerName, expectedGitSha) {
  const containers = JSON.parse(execFileSync(
    'docker',
    ['inspect', '--type', 'container', containerName],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  ))
  assert.equal(containers.length, 1, `expected exactly one backend container inspection for ${containerName}`)
  const container = containers[0]
  const images = JSON.parse(execFileSync(
    'docker',
    ['image', 'inspect', container.Image],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  ))
  assert.equal(images.length, 1, `expected exactly one backend image inspection for ${container.Image}`)
  return validateBackendContainerInspection({ container, image: images[0], expectedGitSha })
}

function assertNormalizedBrowserBuildEnvironment(buildEnvironment) {
  assert.deepEqual(buildEnvironment?.vite, {}, 'production VITE environment must be empty')
  const variables = buildEnvironment?.variables
  assert(variables && typeof variables === 'object' && !Array.isArray(variables), 'normalized build variables are missing')
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'NPM_CONFIG_CACHE', 'NPM_CONFIG_USERCONFIG']) {
    assert.equal(typeof variables[key], 'string')
  }
  const fixed = {
    NODE_ENV: 'production',
    CI: '1',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    TZ: 'UTC',
    NPM_CONFIG_GLOBALCONFIG: '/dev/null',
    NPM_CONFIG_UPDATE_NOTIFIER: 'false',
    NPM_CONFIG_FUND: 'false',
    NPM_CONFIG_AUDIT: 'false',
    NO_COLOR: '1',
    FORCE_COLOR: '0',
  }
  for (const [key, value] of Object.entries(fixed)) assert.equal(variables[key], value, `unexpected build env ${key}`)
  assert.deepEqual(
    Object.keys(variables).sort(),
    ['PATH', 'HOME', 'TMPDIR', 'NPM_CONFIG_CACHE', 'NPM_CONFIG_USERCONFIG', ...Object.keys(fixed)].sort(),
    'normalized build environment contains undeclared variables',
  )
}

function gitText(repoRoot, args) {
  return execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
}

function gitBuffer(repoRoot, args) {
  return execFileSync('git', ['-C', repoRoot, ...args], { encoding: null, maxBuffer: 32 * 1024 * 1024 })
}

function splitNullBuffer(value) {
  return value.toString('utf8').split('\0').filter(Boolean)
}

function isInsidePath(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function responseVersionFromBody(body) {
  const candidates = [
    body?.version,
    body?.choice_set?.version,
    body?.actual_version,
    body?.details?.actual_version,
    body?.detail?.details?.actual_version,
  ]
  return candidates.find((value) => Number.isInteger(value)) ?? null
}

function sha256Json(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function isExpectedNetworkConsole(scenario, message) {
  const intentionalHttpFaultScenarios = new Set([
    'project.wizard-required-choice-retry-create',
    'project.profile-lock-fencing-recovery',
    'choice.csv-preview-atomic-conflict',
    'choice.pagination-version-restart',
    'sheet.fail-closed-cache-version-refresh',
    'sheet.inactive-raw-decimal-paste',
    'sheet.shared-resource-live-discovery',
  ])
  if (
    intentionalHttpFaultScenarios.has(scenario) &&
    /^Failed to load resource: the server responded with a status of (?:4|5)\d\d/.test(message)
  ) return true
  return scenario === 'project.profile-lock-fencing-recovery' && /Failed to load resource: net::ERR_FAILED/.test(message)
}

function isExpectedBrowserResponse(scenario, method, apiPath, status) {
  const expected = [
    ['project.wizard-required-choice-retry-create', 'GET', '/api/choice-sets/device_type', 503],
    ['project.wizard-required-choice-retry-create', 'GET', '/api/processes/L9%3A%3AMISSING', 404],
    ['project.wizard-required-choice-retry-create', 'GET', '/api/projects/999999', 404],
    ['project.profile-lock-fencing-recovery', 'POST', /^\/api\/projects\/\d+\/lock$/, 409],
    ['project.profile-lock-fencing-recovery', 'PATCH', /^\/api\/projects\/\d+\/profile$/, 422],
    ['project.profile-lock-fencing-recovery', 'POST', /^\/api\/projects\/\d+\/lock\/heartbeat$/, 409],
    ['choice.csv-preview-atomic-conflict', 'POST', `/api/choice-sets/${QA_SET}/import`, 409],
    ['choice.pagination-version-restart', 'GET', `/api/choice-sets/${EQUIPMENT_SET}/options`, 409],
    ['sheet.fail-closed-cache-version-refresh', 'GET', `/api/choice-sets/${EQUIPMENT_SET}`, 503],
    ['sheet.inactive-raw-decimal-paste', 'GET', `/api/choice-sets/${EQUIPMENT_SET}/options`, 503],
    ['sheet.shared-resource-live-discovery', 'GET', `/api/choice-sets/${EQUIPMENT_SET}/options`, 409],
  ]
  return expected.some(([allowedScenario, allowedMethod, allowedPath, allowedStatus]) =>
    scenario === allowedScenario && method === allowedMethod && status === allowedStatus &&
      (allowedPath instanceof RegExp ? allowedPath.test(apiPath) : apiPath === allowedPath),
  )
}

function isExpectedFailedRequest(scenario, method, apiPath, error) {
  if (
    scenario === 'project.profile-lock-fencing-recovery' &&
    method === 'PATCH' && /^\/api\/projects\/\d+\/profile$/.test(apiPath) &&
    /ERR_FAILED|failed/i.test(error)
  ) return true
  return (
    ['choice.pagination-version-restart', 'sheet.fail-closed-cache-version-refresh', 'sheet.shared-resource-live-discovery'].includes(scenario) &&
    method === 'GET' && apiPath === `/api/choice-sets/${EQUIPMENT_SET}/options` &&
    /ERR_ABORTED|aborted/i.test(error)
  )
}

function numberOrNull(value) {
  if (value === null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function serializeError(error) {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack ?? null }
  return { name: 'NonError', message: String(error), stack: null }
}

async function writeJsonLines(filename, rows) {
  await writeFile(filename, '')
  for (const row of rows) await appendFile(filename, `${JSON.stringify(row)}\n`)
}

const invokedPath = process.argv[1] === undefined ? null : path.resolve(process.argv[1])
if (invokedPath !== null && fileURLToPath(import.meta.url) === invokedPath) {
  const args = parseBrowserQaArgs(process.argv.slice(2))
  if (args.help) {
    process.stdout.write(usage())
  } else {
    const runtimeRequire = createRequire(import.meta.url)
    const playwrightVersion = runtimeRequire('playwright/package.json').version
    assert.equal(playwrightVersion, '1.57.0', `Task 15 requires Playwright 1.57.0, got ${playwrightVersion}`)
    import('playwright')
      .then((playwright) => new BrowserQa(args, playwright, playwrightVersion).run())
      .catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
        process.exitCode = 1
      })
  }
}
