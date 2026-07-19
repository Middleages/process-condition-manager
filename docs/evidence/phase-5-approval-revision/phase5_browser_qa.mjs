#!/usr/bin/env node

import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require('/home/appuser/.npm/_npx/fd3bca3c548369c0/node_modules/playwright')

const BASE_URL = process.env.PHASE5_QA_BASE_URL ?? 'http://127.0.0.1:4175'
const OUTPUT = path.resolve(
  process.env.PHASE5_QA_OUTPUT ?? 'docs/evidence/phase-5-approval-revision',
)
const CHROMIUM =
  process.env.PHASE5_QA_CHROMIUM ??
  '/home/appuser/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome'
const VIEWPORTS = [
  { name: '1024x768', width: 1024, height: 768 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1920x1080', width: 1920, height: 1080 },
]

const now = '2026-07-20T00:00:00Z'
const profile = (projectId, label = 'Frozen Foundry') => ({
  project_id: projectId,
  process_name: 'Phase 5 Process',
  device_type: { code: 'FOUNDRY', label, is_active: true },
  project_category: { code: 'LOGIC', label: 'Frozen Logic', is_active: true },
  comment: 'Browser QA fixture',
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
  layer_total: '1',
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
})

const layer = {
  id: 701,
  layer_key: 'L1::PHASE5::010::ETCH',
  step_seq: '010',
  layer_id: 'ETCH',
  eqp_type: 'ETCHER',
  eqp_type_desc: 'Etcher',
  area_name: 'FAB-A',
  sort_order: 1,
  condition_count: 1,
  cell_count: 2,
  source_project_id: null,
  source_layer_key: null,
}

const sheet = {
  columns: [
    {
      parameter_code: 'equipment_mode',
      display_name: 'Frozen Equipment Mode',
      value_type: 'choice',
      category_code: 'process',
      unit: null,
      min_value: null,
      max_value: null,
      required: true,
      pattern: null,
      pattern_hint: null,
      description: 'Frozen snapshot column',
      choice_set_code: 'equipment_mode',
      choice_set_version: 7,
      sort_order: 1,
    },
    {
      parameter_code: 'pressure',
      display_name: 'Frozen Pressure',
      value_type: 'number',
      category_code: 'process',
      unit: 'mTorr',
      min_value: '0',
      max_value: '100',
      required: false,
      pattern: null,
      pattern_hint: null,
      description: 'Frozen numeric column',
      choice_set_code: null,
      choice_set_version: null,
      sort_order: 2,
    },
  ],
  rows: [
    {
      condition_id: 711,
      layer_key: layer.layer_key,
      layer_label: 'ETCH (010)',
      condition_label: 'POR',
      is_por: true,
      layer_sort_order: 1,
      condition_index: 0,
      cells: { equipment_mode: 'AUTO', pressure: '42' },
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
  frozen_choice_sets: [
    {
      set_code: 'equipment_mode',
      version: 7,
      is_active: true,
      items: [
        { code: 'AUTO', label: 'Frozen Automatic', sort_order: 1, is_active: true },
      ],
    },
  ],
}

function projectFor(state, id = 7) {
  if (id === 8) {
    return {
      id: 8,
      line_id: 'L1',
      process_id: 'PHASE5',
      part_id: 'PART-QA',
      name: 'Phase 5 Revision Draft',
      status: 'draft',
      version: 2,
      revision_root_id: 7,
      predecessor_project_id: 7,
      successor_project_id: null,
      allowed_actions: ['request_review'],
      profile: profile(8, 'Live Foundry v2'),
      layers: [{ ...layer, id: 801 }],
    }
  }
  const actions = {
    draft: ['request_review'],
    review: ['approve', 'reject'],
    approved: ['create_revision'],
    rejected: ['return_to_draft'],
    archived: [],
  }[state.status]
  return {
    id: 7,
    line_id: 'L1',
    process_id: 'PHASE5',
    part_id: 'PART-QA',
    name: 'Phase 5 Approval Fixture',
    status: state.status,
    version: 1,
    revision_root_id: 7,
    predecessor_project_id: null,
    successor_project_id: state.status === 'archived' ? 8 : null,
    allowed_actions: actions,
    profile: profile(7),
    layers: [layer],
  }
}

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' }
const json = (route, body, status = 200) =>
  route.fulfill({ status, headers: jsonHeaders, body: JSON.stringify(body) })

async function installApiMock(page, state, evidence) {
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const method = request.method()
    const pathname = url.pathname.replace(/^\/api/, '')
    evidence.network.push({ method, pathname, search: url.search })

    if (method === 'GET' && pathname === '/auth/me') {
      return json(route, {
        id: 'oidc:browser-qa-reviewer',
        display_name: 'Phase 5 Reviewer',
        email: 'reviewer@example.test',
        roles: ['admin', 'reviewer', 'editor'],
        permissions: [
          'business.read',
          'registry.manage',
          'project.edit',
          'project.review.request',
          'project.review.decide',
          'project.revision.create',
          'project.comment',
        ],
      })
    }
    if (method === 'GET' && /^\/projects\/(7|8)$/.test(pathname)) {
      return json(route, projectFor(state, Number(pathname.split('/').at(-1))))
    }
    if (method === 'GET' && pathname === '/projects/7/sheet') return json(route, sheet)
    if (method === 'GET' && pathname === '/projects/8/sheet') return json(route, sheet)

    if (method === 'GET' && pathname === '/projects/7/comments') {
      const target = url.searchParams.get('target')
      const items = target === 'cell' ? state.cellComments : state.projectComments
      return json(route, { items, next_cursor: null })
    }
    if (method === 'GET' && pathname === '/projects/8/comments') {
      return json(route, { items: [], next_cursor: null })
    }
    if (method === 'POST' && pathname === '/projects/7/comments') {
      const input = request.postDataJSON()
      const isCell = Number.isInteger(input.condition_id)
      const comment = {
        id: state.nextCommentId++,
        project_id: 7,
        layer_key: input.layer_key ?? null,
        condition_id: input.condition_id ?? null,
        parameter_code: input.parameter_code ?? null,
        body: input.body,
        author: 'oidc:browser-qa-reviewer',
        resolved: false,
        deleted: false,
        created_at: now,
        updated_at: now,
        resolved_at: null,
        deleted_at: null,
      }
      ;(isCell ? state.cellComments : state.projectComments).unshift(comment)
      return json(route, comment, 201)
    }
    if (method === 'PATCH' && /^\/projects\/7\/comments\/\d+$/.test(pathname)) {
      const id = Number(pathname.split('/').at(-1))
      const comment = [...state.projectComments, ...state.cellComments].find((item) => item.id === id)
      assert(comment, `unknown comment ${id}`)
      comment.resolved = Boolean(request.postDataJSON().resolved)
      comment.updated_at = now
      comment.resolved_at = comment.resolved ? now : null
      return json(route, comment)
    }
    if (method === 'DELETE' && /^\/projects\/7\/comments\/\d+$/.test(pathname)) {
      const id = Number(pathname.split('/').at(-1))
      const comment = [...state.projectComments, ...state.cellComments].find((item) => item.id === id)
      assert(comment, `unknown comment ${id}`)
      comment.deleted = true
      comment.body = null
      comment.deleted_at = now
      return route.fulfill({ status: 204, body: '' })
    }

    if (method === 'POST' && pathname === '/projects/7/transitions') {
      const input = request.postDataJSON()
      if (input.action === 'request_review' && state.reviewAttempts++ === 0) {
        return json(
          route,
          {
            code: 'review_gate_failed',
            message: 'Review 게이트 검증에 실패했습니다',
            details: {
              validation: {
                summary: { error_count: 1, warning_count: 0 },
                issues: [],
                evaluated_at: now,
                basis_hash: `sha256:${'b'.repeat(64)}`,
                rule_versions: {},
                truncated: false,
              },
              missing_por_layers: [{ layer_key: layer.layer_key, layer_label: 'ETCH' }],
              total_missing_por_count: 1,
            },
          },
          409,
        )
      }
      if (input.action === 'request_review') state.status = 'review'
      if (input.action === 'approve') state.status = 'approved'
      if (input.action === 'reject') state.status = 'rejected'
      if (input.action === 'return_to_draft') state.status = 'draft'
      return json(route, {
        project_id: 7,
        status: state.status,
        allowed_actions: projectFor(state).allowed_actions,
        basis_hash: state.status === 'draft' ? null : `sha256:${'a'.repeat(64)}`,
        rule_versions: state.status === 'draft' ? null : {},
        revalidated: false,
        operation_id: `00000000-0000-4000-8000-${String(state.reviewAttempts).padStart(12, '0')}`,
      })
    }
    if (method === 'POST' && pathname === '/projects/7/revisions') {
      state.status = 'archived'
      return json(route, {
        operation_id: '00000000-0000-4000-8000-000000000099',
        source: { id: 7, status: 'archived', version: 1 },
        revision: projectFor(state, 8),
      })
    }

    evidence.unexpected_requests.push({ method, pathname, search: url.search })
    return json(route, { code: 'qa_unmocked', message: `${method} ${pathname}` }, 500)
  })
}

async function check(evidence, name, operation) {
  const started = Date.now()
  try {
    const details = await operation()
    evidence.checks.push({ name, status: 'pass', duration_ms: Date.now() - started, details })
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

async function main() {
  await mkdir(path.join(OUTPUT, 'screenshots'), { recursive: true })
  const state = {
    status: 'draft',
    reviewAttempts: 0,
    nextCommentId: 100,
    projectComments: [],
    cellComments: [],
  }
  const evidence = {
    schema_version: 1,
    started_at: new Date().toISOString(),
    completed_at: null,
    base_url: BASE_URL,
    chromium: CHROMIUM,
    mock_boundary: 'Browser/UI behavior only; API responses are deterministic Playwright route mocks.',
    checks: [],
    network: [],
    unexpected_requests: [],
    console_errors: [],
    expected_console_errors: [],
    status: 'running',
  }
  const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true })
  const context = await browser.newContext({ viewport: VIEWPORTS[1] })
  const page = await context.newPage()
  page.on('console', (message) => {
    if (message.type() === 'error') evidence.console_errors.push(message.text())
  })
  page.on('pageerror', (error) => evidence.console_errors.push(error.message))
  page.on('dialog', (dialog) => dialog.accept())
  await installApiMock(page, state, evidence)

  try {
    await check(evidence, 'auth-and-draft-detail', async () => {
      await page.goto(`${BASE_URL}/projects/7`, { waitUntil: 'networkidle' })
      await page.getByRole('heading', { name: 'Phase 5 Approval Fixture' }).waitFor()
      await page.getByText('초안', { exact: true }).first().waitFor()
      await page.getByRole('button', { name: '검토요청' }).waitFor()
      return { status: state.status }
    })

    await check(evidence, 'review-gate-error-no-state-change', async () => {
      await page.getByRole('button', { name: '검토요청' }).click()
      await page.getByText('Review 게이트를 통과하지 못했습니다.').waitFor()
      await page.getByText(/오류 1개.*POR 누락 1개/).waitFor()
      assert.equal(state.status, 'draft')
      return { status: state.status, review_attempts: state.reviewAttempts }
    })

    await check(evidence, 'review-success-and-project-comment', async () => {
      await page.getByRole('button', { name: '검토요청' }).click()
      await page.getByText('검토중', { exact: true }).first().waitFor()
      await page.getByLabel('댓글 입력').fill('Review project comment')
      await page.getByRole('button', { name: '댓글 등록' }).click()
      await page.getByText('Review project comment').waitFor()
      return { status: state.status, project_comment_count: state.projectComments.length }
    })

    await check(evidence, 'approval-to-read-only-frozen-sheet', async () => {
      await page.getByRole('button', { name: '승인', exact: true }).click()
      await page.getByText('승인', { exact: true }).first().waitFor()
      assert.equal(state.status, 'approved')
      await page.getByRole('link', { name: /조건표 열기/ }).click()
      await page.getByText('읽기 전용 모드입니다. 초안 상태에서만 편집이 가능합니다.').waitFor()
      const frozenHeader = page.locator('th[role="columnheader"]', {
        hasText: 'Frozen Equipment Mode',
      })
      await frozenHeader.waitFor({ state: 'attached' })
      assert.equal(await frozenHeader.count(), 1)
      const mutationTraffic = evidence.network.filter(
        (entry) => entry.pathname.includes('/lock') || entry.pathname.includes('/choice-sets'),
      )
      assert.deepEqual(mutationTraffic, [])
      return { status: state.status, forbidden_network_count: mutationTraffic.length }
    })

    await check(evidence, 'keyboard-column-navigation-and-cell-comment', async () => {
      const search = page.getByTestId('sheet-column-search')
      await search.focus()
      await search.fill('pressure')
      await search.press('Enter')
      await page.getByText('Frozen Pressure 컬럼으로 이동했습니다.').waitFor()

      const gridCells = page.getByRole('gridcell', { includeHidden: true })
      const count = await gridCells.count()
      assert(count >= 5, `expected accessible grid cells, got ${count}`)
      const canvases = page.locator('canvas')
      let largestCanvas = null
      for (let index = 0; index < (await canvases.count()); index += 1) {
        const candidate = await canvases.nth(index).boundingBox()
        if (
          candidate !== null &&
          (largestCanvas === null || candidate.width * candidate.height > largestCanvas.width * largestCanvas.height)
        ) {
          largestCanvas = candidate
        }
      }
      assert(largestCanvas !== null, 'Glide canvas bounding box is unavailable')
      // Identity columns are 190+84+96px; activate the first parameter cell in row 1.
      await page.mouse.click(largestCanvas.x + 445, largestCanvas.y + 55)
      await page.getByTestId('cell-comments-panel').locator('summary').click()
      await page.getByLabel('선택 셀 댓글').waitFor()
      await page.getByLabel('선택 셀 댓글').fill('Selected cell comment')
      await page.getByLabel('선택 셀 댓글').press('Enter')
      await page.getByText('Selected cell comment').waitFor()
      return {
        accessible_grid_cells: count,
        cell_comment_count: state.cellComments.length,
        canvas: largestCanvas,
      }
    })

    await check(evidence, 'responsive-read-only-sheet', async () => {
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport)
        await page.screenshot({
          path: path.join(OUTPUT, 'screenshots', `approved-sheet-${viewport.name}.png`),
          fullPage: true,
        })
        assert.equal(await page.getByText('읽기 전용 모드입니다. 초안 상태에서만 편집이 가능합니다.').isVisible(), true)
      }
      return { viewports: VIEWPORTS.map((viewport) => viewport.name) }
    })

    await check(evidence, 'revision-source-and-live-draft-lineage', async () => {
      await page.goto(`${BASE_URL}/projects/7`, { waitUntil: 'networkidle' })
      await page.getByRole('button', { name: '리비전 생성' }).click()
      await page.getByText('보존', { exact: true }).first().waitFor()
      assert.equal(state.status, 'archived')
      await page.goto(`${BASE_URL}/projects/8`, { waitUntil: 'networkidle' })
      await page.getByRole('heading', { name: 'Phase 5 Revision Draft' }).waitFor()
      await page.getByText(/Live Foundry v2/).waitFor()
      await page.getByText(/v2 \/ root 7 \/ pred 7/).waitFor()
      return { source_status: state.status, target_status: 'draft', target_version: 2 }
    })

    await check(evidence, 'responsive-revision-detail', async () => {
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport)
        await page.screenshot({
          path: path.join(OUTPUT, 'screenshots', `revision-detail-${viewport.name}.png`),
          fullPage: true,
        })
        assert.equal(await page.getByRole('heading', { name: 'Phase 5 Revision Draft' }).isVisible(), true)
      }
      return { viewports: VIEWPORTS.map((viewport) => viewport.name) }
    })

    assert.deepEqual(evidence.unexpected_requests, [])
    evidence.expected_console_errors = evidence.console_errors.filter((message) =>
      message.includes('status of 409'),
    )
    evidence.console_errors = evidence.console_errors.filter(
      (message) => !message.includes('status of 409'),
    )
    assert.deepEqual(evidence.console_errors, [])
    evidence.status = 'pass'
  } catch (error) {
    evidence.status = 'fail'
    evidence.failure = error instanceof Error ? error.stack ?? error.message : String(error)
    throw error
  } finally {
    evidence.completed_at = new Date().toISOString()
    await writeFile(path.join(OUTPUT, 'results.json'), `${JSON.stringify(evidence, null, 2)}\n`)
    await browser.close()
  }
}

await main()
