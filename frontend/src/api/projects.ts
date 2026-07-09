import { apiClient } from './client'
import type { ProjectCreate, ProjectOut } from './types'

export async function listProjects(): Promise<ProjectOut[]> {
  const response = await apiClient.get<ProjectOut[]>('/projects')
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
