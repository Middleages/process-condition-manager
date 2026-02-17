import client from './client'
import type {
  Project,
  ProjectDetail,
  ProjectCreateRequest,
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
} from '@/types'

export async function fetchProjects(params?: {
  status?: ProjectStatus
  product_id?: number
  is_latest?: boolean
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

export async function fetchChangeLogs(
  projectId: number,
  params?: {
    layer_id?: number
    column_name?: string
    limit?: number
    offset?: number
  }
): Promise<ChangeLogListResponse> {
  const { data } = await client.get<ChangeLogListResponse>(
    `/projects/${projectId}/change-logs`,
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
    `/projects/${projectId}/layers/${projectLayerId}/backbone`,
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
    `/projects/${projectId}/layers`,
    req
  )
  return data
}

export async function deleteProjectLayer(
  projectId: number,
  projectLayerId: number
): Promise<void> {
  await client.delete(`/projects/${projectId}/layers/${projectLayerId}`)
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
    `/projects/${projectId}/recipe/upload`,
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
    `/projects/${projectId}/recipe/apply`,
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
    `/projects/${projectId}/revise`,
    request ?? {}
  )
  return data
}

export async function getProductRevisions(productId: number): Promise<RevisionListResponse> {
  const { data } = await client.get<RevisionListResponse>(
    `/projects/by-product/${productId}/revisions`
  )
  return data
}


// --- Status Transition ---

export async function updateProjectStatus(
  projectId: number,
  req: StatusTransitionRequest
): Promise<StatusTransitionResponse> {
  const { data } = await client.patch<StatusTransitionResponse>(
    `/projects/${projectId}/status`,
    req
  )
  return data
}

export async function fetchChangeSummary(
  projectId: number
): Promise<ChangeSummaryResponse> {
  const { data } = await client.get<ChangeSummaryResponse>(
    `/projects/${projectId}/change-summary`
  )
  return data
}

export async function fetchStatusHistory(
  projectId: number
): Promise<StatusHistoryResponse> {
  const { data } = await client.get<StatusHistoryResponse>(
    `/projects/${projectId}/status-history`
  )
  return data
}
