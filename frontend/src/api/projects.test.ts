import type { AxiosResponse } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
}))

import { apiClient } from './client'
import {
  createProject,
  getProject,
  getProjectProfile,
  listProjects,
  patchProjectProfile,
} from './projects'
import {
  PROJECT_PROFILE_PATCH_FIELDS,
  type ProjectCreate,
  type ProjectListOut,
  type ProjectOut,
  type ProjectProfileOut,
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
  profile,
  layers: [],
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
