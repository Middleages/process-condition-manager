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
