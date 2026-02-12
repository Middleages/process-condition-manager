import client from './client'
import type {
  Project,
  ProjectDetail,
  ProjectCreateRequest,
  BulkSaveRequest,
  BulkSaveResponse,
  ValidationResponse,
  ProjectStatus,
} from '@/types'

export async function fetchProjects(params?: {
  status?: ProjectStatus
  product_id?: number
}): Promise<Project[]> {
  const { data } = await client.get<Project[]>('/projects', { params })
  return data
}

export async function fetchProjectDetail(projectId: number): Promise<ProjectDetail> {
  const { data } = await client.get<ProjectDetail>(`/projects/${projectId}`)
  return data
}

export async function createProject(req: ProjectCreateRequest): Promise<ProjectDetail> {
  const { data } = await client.post<ProjectDetail>('/projects', req)
  return data
}

export async function bulkSaveConditions(
  projectId: number,
  req: BulkSaveRequest
): Promise<BulkSaveResponse> {
  const { data } = await client.put<BulkSaveResponse>(
    `/projects/${projectId}/conditions`,
    req
  )
  return data
}

export async function validateProject(projectId: number): Promise<ValidationResponse> {
  const { data } = await client.post<ValidationResponse>(
    `/projects/${projectId}/validate`
  )
  return data
}
