import { apiClient } from './client'
import type {
  BackboneCandidateOut,
  BackboneReplaceIn,
  ManualOverrideIn,
  MatchPreviewOut,
  ProjectCreate,
  ProjectListOut,
  ProjectOut,
} from './types'

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

export async function getBackboneCandidates(
  lineId: string,
  processId: string,
): Promise<BackboneCandidateOut[]> {
  const response = await apiClient.get<BackboneCandidateOut[]>('/projects/backbone-candidates', {
    params: { line_id: lineId, process_id: processId },
  })
  return response.data
}

export interface PreviewBackbonePayload {
  line_id: string
  process_id: string
  backbone_project_id?: number | null
  manual_overrides?: ManualOverrideIn[]
}

export async function previewBackbone(payload: PreviewBackbonePayload): Promise<MatchPreviewOut> {
  const response = await apiClient.post<MatchPreviewOut>('/projects/backbone-preview', payload)
  return response.data
}

export async function replaceLayerBackbone(
  projectId: number,
  layerKey: string,
  payload: BackboneReplaceIn,
  lockToken: string,
): Promise<ProjectOut> {
  const response = await apiClient.post<ProjectOut>(
    `/projects/${projectId}/layers/${encodeURIComponent(layerKey)}/backbone-replace`,
    payload,
    { headers: { 'X-Lock-Token': lockToken } },
  )
  return response.data
}
