import type { AxiosResponse } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./client', () => ({
  apiClient: {
    get: vi.fn(),
  },
}))

import { apiClient } from './client'
import { getProject, listProjects } from './projects'
import type { ProjectListOut, ProjectOut } from './types'

function response<T>(data: T): AxiosResponse<T> {
  return { data } as AxiosResponse<T>
}

const project: ProjectOut = {
  id: 42,
  line_id: 'L1',
  process_id: 'coat',
  part_id: 'P-42',
  name: 'Coat baseline',
  description: null,
  status: 'draft',
  layers: [],
}

const projects: ProjectListOut = {
  items: [],
  next_cursor: null,
}

const get = vi.mocked(apiClient.get)

describe('projects api client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes project list filters and pagination through to the API', async () => {
    get.mockResolvedValue(response(projects))

    const result = await listProjects({ query: 'coat', status: 'draft', cursor: 50, limit: 25 })

    expect(get).toHaveBeenCalledWith('/projects', {
      params: { query: 'coat', status: 'draft', cursor: 50, limit: 25 },
    })
    expect(result).toEqual(projects)
  })

  it('fetches a project by id', async () => {
    get.mockResolvedValue(response(project))

    const result = await getProject(42)

    expect(get).toHaveBeenCalledWith('/projects/42')
    expect(result).toEqual(project)
  })
})
