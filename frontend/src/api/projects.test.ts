import type { AxiosResponse } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

import { apiClient } from './client'
import {
  createProject,
  createProjectComment,
  deleteProjectComment,
  getProject,
  getProjectProfile,
  listProjectComments,
  patchProjectComment,
  transitionProject,
  listProjects,
  patchProjectProfile,
  createRevision,
} from './projects'
import {
  PROJECT_PROFILE_PATCH_FIELDS,
  type ProjectCreate,
  type ProjectCommentCreateIn,
  type ProjectCommentListOut,
  type ProjectCommentOut,
  type ProjectCommentPatchIn,
  type ProjectListOut,
  type ProjectRevisionOut,
  type ProjectOut,
  type ProjectProfileOut,
  type ProjectTransitionIn,
  type ProjectTransitionOut,
} from './types'

function response<T>(data: T): AxiosResponse<T> {
  return { data } as AxiosResponse<T>
}

const profile: ProjectProfileOut = {
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
}

const project: ProjectOut = {
  id: 42,
  line_id: 'L1',
  process_id: 'coat',
  part_id: 'P-42',
  name: 'Coat baseline',
  status: 'draft',
  version: 1,
  revision_root_id: 42,
  predecessor_project_id: null,
  successor_project_id: null,
  allowed_actions: ['request_review', 'approve'],
  profile,
  layers: [],
}

const transitionOut: ProjectTransitionOut = {
  project_id: 42,
  status: 'review',
  allowed_actions: ['approve', 'reject'],
  basis_hash: 'sha256:0c1f2e3d4f56789abcdeffedcba1234567890abcdef0123456789abcdef01234567',
  rule_versions: { R1: 1 },
  revalidated: false,
  operation_id: 'op-transition',
}

const revision: ProjectRevisionOut = {
  operation_id: 'op-revision',
  source: {
    id: 42,
    status: 'approved',
    version: 2,
  },
  revision: {
    ...project,
    status: 'draft',
  },
}

const comments: ProjectCommentListOut = {
  items: [
    {
      id: 99,
      project_id: 42,
      layer_key: null,
      condition_id: 11,
      parameter_code: null,
      body: 'review needed',
      author: 'dev-admin',
      resolved: false,
      deleted: false,
      created_at: '2026-07-14T00:00:00Z',
      updated_at: '2026-07-14T00:00:00Z',
      resolved_at: null,
      deleted_at: null,
    },
  ],
  next_cursor: null,
}

const commentPayload: ProjectCommentCreateIn = {
  body: 'review needed',
}

const projects: ProjectListOut = {
  items: [],
  next_cursor: null,
}

const get = vi.mocked(apiClient.get)
const post = vi.mocked(apiClient.post)
const patch = vi.mocked(apiClient.patch)

describe('projects api client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps exact project Profile filters to backend query names', async () => {
    get.mockResolvedValue(response(projects))

    const result = await listProjects({
      query: 'foundry',
      status: 'draft',
      deviceTypeCode: 'FOUNDRY',
      projectCategoryCode: 'LOGIC',
    })

    expect(get).toHaveBeenCalledWith('/projects', {
      params: {
        query: 'foundry',
        status: 'draft',
        device_type_code: 'FOUNDRY',
        project_category_code: 'LOGIC',
      },
    })
    expect(result).toEqual(projects)
  })

  it('passes project list pagination through without undefined filters', async () => {
    get.mockResolvedValue(response(projects))

    await listProjects({ cursor: 50, limit: 25 })

    expect(get).toHaveBeenCalledWith('/projects', {
      params: { cursor: 50, limit: 25 },
    })
  })

  it('calls transition endpoint with exact expected_status payload and returns contract out', async () => {
    const transitionIn: ProjectTransitionIn = {
      action: 'request_review',
      expected_status: 'draft',
    }
    post.mockResolvedValue(response(transitionOut))

    const result = await transitionProject(42, transitionIn)

    expect(post).toHaveBeenCalledWith('/projects/42/transitions', transitionIn)
    expect(result).toEqual(transitionOut)
    expect(result).toEqual({
      project_id: 42,
      status: 'review',
      allowed_actions: ['approve', 'reject'],
      basis_hash: expect.any(String),
      rule_versions: { R1: 1 },
      revalidated: false,
      operation_id: 'op-transition',
    })
  })

  it('calls revision endpoint and reads explicit source/revision shape', async () => {
    post.mockResolvedValue(response(revision))

    const result = await createRevision(42)

    expect(post).toHaveBeenCalledWith('/projects/42/revisions')
    expect(result).toEqual(revision)
    expect(result.source).toEqual({
      id: 42,
      status: 'approved',
      version: 2,
    })
    expect(result.revision).toHaveProperty('allowed_actions')
    expect(result.revision).toHaveProperty('revision_root_id')
  })

  it('maps comment list query params to exact cursor/filter keys', async () => {
    get.mockResolvedValue(response(comments))

    await listProjectComments(42, {
      beforeId: 200,
      limit: 77,
      resolved: 'true',
      target: 'cell',
      layerKey: 'L1::10::ETCH',
      conditionId: 11,
      parameterCode: 'ETCH_P001',
    })

    expect(get).toHaveBeenCalledWith('/projects/42/comments', {
      params: {
        before_id: 200,
        limit: 77,
        resolved: 'true',
        target: 'cell',
        layer_key: 'L1::10::ETCH',
        condition_id: 11,
        parameter_code: 'ETCH_P001',
      },
    })
  })

  it('creates a project comment using condition_id-capable payload contract', async () => {
    const payload: ProjectCommentCreateIn = {
      ...commentPayload,
      layer_key: 'L1::10::ETCH',
      condition_id: 11,
      parameter_code: 'ETCH_P001',
    }
    const responseComment: ProjectCommentOut = comments.items[0]!
    post.mockResolvedValue(response(responseComment))

    const result = await createProjectComment(42, payload)

    expect(post).toHaveBeenCalledWith('/projects/42/comments', payload)
    expect(result).toEqual(responseComment)
    expect(result).toHaveProperty('condition_id', 11)
    expect(result).toHaveProperty('deleted', false)
  })

  it('patches resolved state and deletes through their exact endpoints', async () => {
    const payload: ProjectCommentPatchIn = {
      resolved: true,
    }
    const responseComment: ProjectCommentOut = {
      ...comments.items[0]!,
      resolved: true,
      deleted: true,
    }
    patch.mockResolvedValue(response(responseComment))

    const result = await patchProjectComment(42, 99, payload)

    expect(patch).toHaveBeenCalledWith('/projects/42/comments/99', payload)
    expect(result.resolved).toBe(true)
    expect(result.deleted).toBe(true)

    vi.mocked(apiClient.delete).mockResolvedValue(response(undefined))
    await deleteProjectComment(42, 99)
    expect(apiClient.delete).toHaveBeenCalledWith('/projects/42/comments/99')
  })

  it('sends required Profile codes without obsolete or server-owned fields', async () => {
    post.mockResolvedValue(response(project))
    const payload: ProjectCreate = {
      line_id: 'L1',
      process_id: 'coat',
      part_id: 'P-42',
      name: 'Coat baseline',
      device_type_code: 'FOUNDRY',
      project_category_code: 'LOGIC',
      backbone_project_id: 7,
      manual_overrides: [
        { target_layer_key: 'TARGET::1', source_layer_key: 'SOURCE::1' },
      ],
    }

    await createProject(payload)

    expect(post).toHaveBeenCalledWith('/projects', payload)
    expect(post.mock.calls[0]?.[1]).not.toHaveProperty('comment')
    expect(post.mock.calls[0]?.[1]).not.toHaveProperty('description')
    expect(post.mock.calls[0]?.[1]).not.toHaveProperty('process_name')
  })

  it('preserves an explicit null Comment', async () => {
    post.mockResolvedValue(response(project))
    const payload: ProjectCreate = {
      line_id: 'L1',
      process_id: 'coat',
      part_id: 'P-42',
      name: 'Coat baseline',
      device_type_code: 'FOUNDRY',
      project_category_code: 'LOGIC',
      comment: null,
    }

    await createProject(payload)

    expect(post).toHaveBeenCalledWith('/projects', expect.objectContaining({ comment: null }))
  })

  it('fetches a project by id', async () => {
    get.mockResolvedValue(response(project))

    const result = await getProject(42)

    expect(get).toHaveBeenCalledWith('/projects/42')
    expect(result).toEqual(project)
  })

  it('fetches the authoritative project Profile by id', async () => {
    get.mockResolvedValue(response(profile))

    const result = await getProjectProfile(42)

    expect(get).toHaveBeenCalledWith('/projects/42/profile')
    expect(result).toEqual(profile)
  })

  it('patches only explicit Profile changes under the exact lock header', async () => {
    patch.mockResolvedValue(response(profile))

    const result = await patchProjectProfile(
      42,
      { comment: null, pitch_x: '1.5' },
      'lock-abc',
    )

    expect(patch).toHaveBeenCalledWith(
      '/projects/42/profile',
      { comment: null, pitch_x: '1.5' },
      { headers: { 'X-Lock-Token': 'lock-abc' } },
    )
    expect(result).toEqual(profile)
  })

  it('freezes the Profile patch boundary to the approved 28 snake-case keys', () => {
    expect(PROJECT_PROFILE_PATCH_FIELDS).toEqual([
      'process_name',
      'device_type_code',
      'project_category_code',
      'comment',
      'active_direction_code',
      'gate_direction_code',
      'gross_die',
      'pitch_x',
      'pitch_y',
      'shot_x',
      'shot_y',
      'slit_occupancy',
      'lens_occupancy',
      'map_offset_x',
      'map_offset_y',
      'scribe_lane_x',
      'scribe_lane_y',
      'shot_count',
      'full_shot',
      'layer_total',
      'euv',
      'imm',
      'arf',
      'krf',
      'iline',
      'soh',
      'pspi',
      'metal_layer_count',
    ])
    expect(PROJECT_PROFILE_PATCH_FIELDS).not.toContain('project_id')
    expect(PROJECT_PROFILE_PATCH_FIELDS).not.toContain('line_id')
    expect(PROJECT_PROFILE_PATCH_FIELDS).not.toContain('process_id')
    expect(PROJECT_PROFILE_PATCH_FIELDS).not.toContain('part_id')
    expect(PROJECT_PROFILE_PATCH_FIELDS).not.toContain('device_ref')
    expect(PROJECT_PROFILE_PATCH_FIELDS).not.toContain('device_type')
    expect(PROJECT_PROFILE_PATCH_FIELDS).not.toContain('project_category')
    expect(PROJECT_PROFILE_PATCH_FIELDS).not.toContain('created_at')
    expect(PROJECT_PROFILE_PATCH_FIELDS).not.toContain('updated_at')
  })
})
