import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { Route, Routes, StaticRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { AuthProvider } from '@/app/AuthContext'
import { defaultAuthState, type AuthPermissions } from '@/api/auth'
import type { ProjectOut } from '@/api/types'

import { ProjectDetailPage } from './ProjectDetailPage'
import source from './ProjectDetailPage.tsx?raw'

const maximumLayerId = 'L'.repeat(64)
const maximumStepSequence = 'S'.repeat(64)
const maximumAreaName = 'A'.repeat(128)
const maximumSourceKey = 'K'.repeat(256)

const project: ProjectOut = {
  id: 42,
  line_id: 'L1',
  process_id: 'coat',
  part_id: 'P-42',
  name: 'Coat baseline',
  status: 'draft',
  version: 1,
  revision_root_id: null,
  predecessor_project_id: null,
  successor_project_id: null,
  allowed_actions: ['request_review', 'approve'],
  profile: {
    project_id: 42,
    process_name: 'Coat',
    device_type: { code: 'FOUNDRY', label: 'Foundry', is_active: true },
    project_category: { code: 'LOGIC', label: 'Logic', is_active: true },
    comment: null,
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
    created_at: '2026-07-14T00:00:00Z',
    updated_at: '2026-07-14T00:00:00Z',
  },
  layers: [
    {
      id: 7,
      layer_key: 'X'.repeat(256),
      step_seq: maximumStepSequence,
      layer_id: maximumLayerId,
      eqp_type: null,
      eqp_type_desc: null,
      area_name: maximumAreaName,
      sort_order: 0,
      condition_count: 2,
      cell_count: 24,
      source_project_id: 41,
      source_layer_key: maximumSourceKey,
    },
  ],
}

const allPermissions: AuthPermissions = {
  ...defaultAuthState.permissions,
  canApprove: true,
  canComment: true,
  canCreateRevision: true,
  canEditDraft: true,
  canReject: true,
  canRequestReview: true,
  canReturnToDraft: true,
}

function renderDetail(
  projectData: ProjectOut = project,
  permissions: AuthPermissions = allPermissions,
): string {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY } },
  })
  queryClient.setQueryData(['project', projectData.id], projectData)

  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AuthProvider
        initialState={{
          ready: true,
          permissions,
          user: {
            id: 'user-1',
            display_name: null,
            email: null,
            roles: [],
            permissions: [],
          },
          error: null,
        }}
      >
        <StaticRouter location={`/projects/${projectData.id}`}>
          <Routes>
            <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
          </Routes>
        </StaticRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
}

describe('ProjectDetailPage', () => {
  it('uses compact layer rows with an exact 36px replace target', () => {
    const html = renderDetail()

    expect(html).toContain('<tr class="h-9">')
    expect(html).toContain(
      'class="h-9 shadow-[inset_0_1px_0_var(--color-border-subtle)]',
    )
    expect(html).toMatch(/<button[^>]*class="[^"]*h-9[^"]*"[^>]*>/)
  })

  it('does not announce the entire resolved detail table as a live region', () => {
    expect(renderDetail()).not.toContain('aria-live="polite"')
  })

  it('contains maximum-length Layer fields without losing their accessible text', () => {
    const html = renderDetail()
    const layerLabel = `${maximumLayerId} (${maximumStepSequence})`
    const sourceLabel = `#41 · ${maximumSourceKey}`

    expect(html).toContain('table-fixed')
    expect(html).toContain(`title="${layerLabel}"`)
    expect(html).toContain(`>${layerLabel}</span>`)
    expect(html).toContain(`title="${maximumAreaName}"`)
    expect(html).toContain(`>${maximumAreaName}</span>`)
    expect(html).toContain(`title="${sourceLabel}"`)
    expect(html).toContain(`>${sourceLabel}</span>`)
    expect(html).toContain('min-w-0 overflow-hidden')
    expect(html).toContain('truncate whitespace-nowrap')
  })

  it('renders all fixed Profile values across core and advanced groups before the Layer table', () => {
    const html = renderDetail()
    const profileIndex = html.indexOf('id="project-profile-title"')
    const layersIndex = html.indexOf('id="project-layers-title"')

    expect(profileIndex).toBeGreaterThan(-1)
    expect(layersIndex).toBeGreaterThan(profileIndex)
    expect(html).toContain('data-profile-group="identity"')
    expect(html).toContain('data-profile-group="product"')
    expect(html).toContain('data-profile-group="direction"')
    expect(html).toContain('data-profile-group="die-shot"')
    expect(html).toContain('data-profile-group="wafer-position"')
    expect(html).toContain('data-profile-group="layer-summary"')

    for (const label of [
      'LINE',
      'Process ID',
      'PARTID',
      'Process Name',
      'Device Type',
      'Category',
      'Comment',
      'Active Direction',
      'Gate Direction',
      'Gross Die',
      'Pitch X',
      'Pitch Y',
      'Shot X',
      'Shot Y',
      'Slit Occupancy',
      'Lens Occupancy',
      'Shot Count',
      'Full Shot',
      'Map Offset X',
      'Map Offset Y',
      'Scribe Lane X',
      'Scribe Lane Y',
      'Layer Total',
      'EUV',
      'IMM',
      'ARF',
      'KRF',
      'I-line',
      'SOH',
      'PSPI',
      'Metal Layer Count',
    ]) {
      expect(html, label).toContain(`>${label}<`)
    }
  })

  it('keeps identity read-only and exposes the fenced Profile edit trigger', () => {
    const html = renderDetail()
    const identity = html.match(
      /<section[^>]*data-profile-group="identity"[\s\S]*?<\/section>/,
    )?.[0]

    expect(identity).toBeDefined()
    expect(identity).toContain('>L1<')
    expect(identity).toContain('>coat<')
    expect(identity).toContain('>P-42<')
    expect(identity).not.toContain('<input')
    expect(identity).not.toContain('<textarea')
    expect(html).toContain('기본정보 편집')
    expect(html).toContain('FOUNDRY · Foundry')
    expect(html).not.toContain('Device Ref')
  })

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

  it('renders workflow lineage, status badge and allowed actions for project transitions', () => {
    const html = renderDetail({
      ...project,
      status: 'review',
      version: 7,
      revision_root_id: 100,
      predecessor_project_id: 90,
      successor_project_id: null,
      allowed_actions: ['request_review', 'approve', 'reject', 'return_to_draft'],
    })

    expect(html).toContain('id="project-workflow-title"')
    expect(html).toContain('워크플로우')
    expect(html).toContain('v7 / root 100 / pred 90 / succ - / actions 4')
    expect(html).toContain('허용 액션')
    expect(html).toContain('검토요청')
    expect(html).toContain('승인')
    expect(html).toContain('반려')
    expect(html).toContain('초안복귀')
  })

  it('renders comment composer and list container for discussion', () => {
    const html = renderDetail()

    expect(html).toContain('id="project-comments-title"')
    expect(html).toContain('댓글')
    expect(html).toContain('aria-label="댓글 입력"')
    expect(html).toContain('댓글 등록')
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

  it('hides draft-only mutation controls when user lacks draft/write permissions', () => {
    const html = renderDetail(project, defaultAuthState.permissions)

    expect(html).not.toContain('기본정보 편집')
    expect(html).not.toContain('aria-label="댓글 입력"')
    expect(html).not.toContain('댓글 등록')
    expect(html).not.toContain('>교체</button>')
  })

  it('hides draft edits but keeps audit comments on non-Draft projects', () => {
    const html = renderDetail(
      {
        ...project,
        status: 'approved',
        allowed_actions: ['request_review', 'approve', 'create_revision', 'reject', 'return_to_draft'],
      },
      allPermissions,
    )

    expect(html).not.toContain('기본정보 편집')
    expect(html).toContain('aria-label="댓글 입력"')
    expect(html).toContain('댓글 등록')
    expect(html).not.toContain('>교체</button>')
    expect(html).toContain('승인')
    expect(html).toContain('반려')
  })

  it('filters transition action buttons through effective permissions', () => {
    const noApprove = renderDetail(
      {
        ...project,
        status: 'review',
        allowed_actions: ['request_review', 'approve', 'reject', 'return_to_draft'],
      },
      {
        ...allPermissions,
        canApprove: false,
        canReject: false,
      },
    )

    expect(noApprove).toContain('검토요청')
    expect(noApprove).toContain('초안복귀')
    expect(noApprove).not.toContain('승인')
    expect(noApprove).not.toContain('반려')
  })

  it('contains transition confirmations and inline error/error-invalidation branches', () => {
    expect(source).toContain('if (action === \'approve\' || action === \'create_revision\')')
    expect(source).toContain('window.confirm(`${actionLabel(action)}를 진행하시겠습니까?`)')
    expect(source).toContain('executeTransitionMutation.isError')
    expect(source).toContain('<ReviewGateError projectId={project.id} error={executeTransitionMutation.error} />')
    expect(source).toContain("getApiErrorDetails(error, 'review_gate_failed')")
    expect(source).toContain('queryClient.invalidateQueries({ queryKey: [\'sheet\', project.id] })')
    expect(source).toContain('invalidateProjectHistoryAfterMutation(queryClient, project.id)')
    expect(source).toContain('invalidateProjectBackboneDiffAfterMutation(queryClient, project.id)')
    expect(source).toContain('createCommentMutation.isError')
    expect(source).toContain('patchCommentMutation.isError')
    expect(source).toContain('deleteCommentMutation.isError')
  })
})
