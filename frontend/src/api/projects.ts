import { apiClient } from './client'
import type { ProjectCreate, ProjectListOut, ProjectOut } from './types'

export interface ListProjectsParams {
  query?: string
  status?: string
  cursor?: number
  limit?: number
}

export async function listProjects(params: ListProjectsParams = {}): Promise<ProjectListOut> {
  const response = await apiClient.get<ProjectListOut>('/projects', { params })
  return response.data
}

export async function getProject(projectId: number): Promise<ProjectOut> {
  const response = await apiClient.get<ProjectOut>(`/projects/${projectId}`)
  return response.data
}

export async function createProject(payload: ProjectCreate): Promise<ProjectOut> {
  const response = await apiClient.post<ProjectOut>('/projects', payload)
  return response.data
}
