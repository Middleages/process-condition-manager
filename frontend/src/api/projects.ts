import client from './client'
import type {
  Project,
  ProjectDetail,
  ProjectCreateRequestV2,
  BulkSaveRequest,
  BulkSaveResponse,
  ValidationResponse,
  ProjectStatus,
  ChangeLogListResponse,
  BackboneReplaceRequest,
  BackboneReplaceResponse,
  LayerAddRequest,
  LayerAddResponse,
  RecipeUploadResponse,
  RecipeApplyRequest,
  RecipeApplyResponse,
  ReviseProjectRequest,
  RevisionListResponse,
  StatusTransitionRequest,
  StatusTransitionResponse,
  ChangeSummaryResponse,
  StatusHistoryResponse,
  TimelineParams,
  TimelineResponse,
  CellHistoryResponse,
  VersionHistoryResponse,
  VersionDiffResponse,
} from '@/types'

export async function fetchProjects(params?: {
  status?: ProjectStatus
  product_id?: number
  line_id?: number
  is_latest?: boolean
}): Promise<Project[]> {
  const { data } = await client.get<Project[]>('/process-conditions', { params })
  return data
}

export async function fetchProjectDetail(projectId: number): Promise<ProjectDetail> {
  const { data } = await client.get<ProjectDetail>(`/process-conditions/${projectId}`)
  return data
}

export interface BackboneConditionOption {
  id: number
  line_id: number
  process_id: string
  part_id: string
  revision: number
  approved_at: string | null
}

export interface BackboneConditionLayerOption {
  id: number
  project_id: number
  layer_id: string
  layer_name: string
  step_seq: string
  conditions: Record<string, unknown>
  backbone_conditions: Record<string, unknown>
  sort_order: number
}

export async function fetchBackboneConditions(lineId?: number): Promise<BackboneConditionOption[]> {
  const params = lineId ? { line_id: lineId } : undefined
  const { data } = await client.get<BackboneConditionOption[]>('/process-conditions/backbones', { params })
  return data
}

export async function fetchBackboneConditionLayers(
  conditionId: number
): Promise<BackboneConditionLayerOption[]> {
  const { data } = await client.get<BackboneConditionLayerOption[]>(
    `/process-conditions/backbones/${conditionId}/layers`
  )
  return data
}

export async function createProjectV2(req: ProjectCreateRequestV2): Promise<ProjectDetail> {
  const { data } = await client.post<ProjectDetail>('/process-conditions/v2', req)
  return data
}

export async function bulkSaveConditions(
  projectId: number,
  req: BulkSaveRequest
): Promise<BulkSaveResponse> {
  const { data } = await client.put<BulkSaveResponse>(
    `/process-conditions/${projectId}/conditions`,
    req
  )
  return data
}

export async function validateProject(projectId: number): Promise<ValidationResponse> {
  const { data } = await client.post<ValidationResponse>(
    `/process-conditions/${projectId}/validate`
  )
  return data
}

export async function fetchChangeLogs(
  projectId: number,
  params?: {
    layer_id?: string
    column_name?: string
    limit?: number
    offset?: number
  }
): Promise<ChangeLogListResponse> {
  const { data } = await client.get<ChangeLogListResponse>(
    `/process-conditions/${projectId}/change-logs`,
    { params }
  )
  return data
}


// --- Backbone replacement ---

export async function replaceLayerBackbone(
  projectId: number,
  projectLayerId: number,
  req: BackboneReplaceRequest
): Promise<BackboneReplaceResponse> {
  const { data } = await client.put<BackboneReplaceResponse>(
    `/process-conditions/${projectId}/layers/${projectLayerId}/backbone`,
    req
  )
  return data
}


// --- Layer add/delete ---

export async function addProjectLayer(
  projectId: number,
  req: LayerAddRequest
): Promise<LayerAddResponse> {
  const { data } = await client.post<LayerAddResponse>(
    `/process-conditions/${projectId}/layers`,
    req
  )
  return data
}

export async function deleteProjectLayer(
  projectId: number,
  projectLayerId: number
): Promise<void> {
  await client.delete(`/process-conditions/${projectId}/layers/${projectLayerId}`)
}


// --- Recipe XML ---

export async function uploadRecipeXml(
  projectId: number,
  files: File[],
  projectLayerId?: number
): Promise<RecipeUploadResponse> {
  const formData = new FormData()
  for (const file of files) {
    formData.append('files', file)
  }
  if (projectLayerId != null) {
    formData.append('project_layer_id', String(projectLayerId))
  }
  const { data } = await client.post<RecipeUploadResponse>(
    `/process-conditions/${projectId}/recipe/upload`,
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } }
  )
  return data
}

export async function applyRecipeChanges(
  projectId: number,
  req: RecipeApplyRequest
): Promise<RecipeApplyResponse> {
  const { data } = await client.post<RecipeApplyResponse>(
    `/process-conditions/${projectId}/recipe/apply`,
    req
  )
  return data
}


// --- Revision ---

export async function reviseProject(
  projectId: number,
  request?: ReviseProjectRequest
): Promise<ProjectDetail> {
  const { data } = await client.post<ProjectDetail>(
    `/process-conditions/${projectId}/revise`,
    request ?? {}
  )
  return data
}

export async function getNaturalKeyRevisions(params: {
  line_id: number
  process: string
  part_id: string
}): Promise<RevisionListResponse> {
  const { data } = await client.get<RevisionListResponse>(
    `/process-conditions/by-key/revisions`,
    { params }
  )
  return data
}


// --- Status Transition ---

export async function updateProjectStatus(
  projectId: number,
  req: StatusTransitionRequest
): Promise<StatusTransitionResponse> {
  const { data } = await client.patch<StatusTransitionResponse>(
    `/process-conditions/${projectId}/status`,
    req
  )
  return data
}

export async function fetchChangeSummary(
  projectId: number
): Promise<ChangeSummaryResponse> {
  const { data } = await client.get<ChangeSummaryResponse>(
    `/process-conditions/${projectId}/change-summary`
  )
  return data
}

export async function fetchStatusHistory(
  projectId: number
): Promise<StatusHistoryResponse> {
  const { data } = await client.get<StatusHistoryResponse>(
    `/process-conditions/${projectId}/status-history`
  )
  return data
}


// --- SPEC-004: Timeline & Cell History ---

export async function fetchTimeline(
  projectId: number,
  params: TimelineParams = {}
): Promise<TimelineResponse> {
  const { data } = await client.get<TimelineResponse>(
    `/process-conditions/${projectId}/changelog/timeline`,
    { params }
  )
  return data
}

export async function fetchCellHistory(
  projectId: number,
  projectLayerId: number,
  columnName: string
): Promise<CellHistoryResponse> {
  const { data } = await client.get<CellHistoryResponse>(
    `/process-conditions/${projectId}/changelog/cell`,
    { params: { project_layer_id: projectLayerId, column_name: columnName } }
  )
  return data
}

export async function fetchVersionHistory(
  projectId: number
): Promise<VersionHistoryResponse> {
  const { data } = await client.get<VersionHistoryResponse>(
    `/process-conditions/${projectId}/versions`
  )
  return data
}

// --- SPEC-006 M3: Version Diff ---

export const getVersionDiff = async (
  projectId: number,
  compareProjectId: number
): Promise<VersionDiffResponse> => {
  const { data } = await client.get<VersionDiffResponse>(
    `/process-conditions/${projectId}/versions/${compareProjectId}/diff`
  )
  return data
}
