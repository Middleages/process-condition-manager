import { apiClient } from './client'
import type { MatchPreviewOut, ManualOverrideIn, ProjectCreate, ProjectOut } from './types'

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


export async function previewBackbone(params: {
  line_id: string
  process_id: string
  backbone_project_id?: number | null
  manual_overrides?: ManualOverrideIn[]
}): Promise<MatchPreviewOut> {
  const response = await apiClient.post<MatchPreviewOut>('/projects/backbone-preview', {
    ...params,
    manual_overrides: params.manual_overrides ?? [],
  })
  return response.data
}
