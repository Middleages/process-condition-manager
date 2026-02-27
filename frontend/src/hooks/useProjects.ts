import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchProjects,
  fetchProjectDetail,
  createProjectV2,
  bulkSaveConditions,
  validateProject,
  fetchChangeLogs,
  replaceLayerBackbone,
  addProjectLayer,
  deleteProjectLayer,
  uploadRecipeXml,
  applyRecipeChanges,
  reviseProject,
  getProductRevisions,
  fetchTimeline,
  fetchCellHistory,
  fetchVersionHistory,
  getVersionDiff,
} from '@/api/projects'
import type {
  ProjectStatus,
  ProjectCreateRequestV2,
  BulkSaveRequest,
  BackboneReplaceRequest,
  LayerAddRequest,
  RecipeApplyRequest,
  ReviseProjectRequest,
  TimelineParams,
} from '@/types'

export const projectKeys = {
  all: ['projects'] as const,
  lists: () => [...projectKeys.all, 'list'] as const,
  list: (filters: { status?: ProjectStatus; line_id?: number }) =>
    [...projectKeys.lists(), filters] as const,
  details: () => [...projectKeys.all, 'detail'] as const,
  detail: (id: number) => [...projectKeys.details(), id] as const,
  validation: (id: number) => [...projectKeys.all, 'validation', id] as const,
  changeLogs: (id: number, filters?: Record<string, unknown>) =>
    [...projectKeys.all, 'change-logs', id, filters] as const,
  timeline: (projectId: number, params: TimelineParams) =>
    [...projectKeys.detail(projectId), 'timeline', params] as const,
  cellHistory: (projectId: number, projectLayerId: number, columnName: string) =>
    [...projectKeys.detail(projectId), 'cellHistory', projectLayerId, columnName] as const,
  versionHistory: (projectId: number) =>
    [...projectKeys.detail(projectId), 'versionHistory'] as const,
  productRevisions: (productId: number) => ['projects', 'productRevisions', productId] as const,
  versionDiff: (projectId: number, compareProjectId: number) =>
    ['projects', 'versionDiff', projectId, compareProjectId] as const,
}

export function useProjects(status?: ProjectStatus, lineId?: number) {
  return useQuery({
    queryKey: projectKeys.list({ status, line_id: lineId }),
    queryFn: () => {
      const params: { status?: ProjectStatus; line_id?: number } = {}
      if (status) params.status = status
      if (lineId) params.line_id = lineId
      return fetchProjects(Object.keys(params).length > 0 ? params : undefined)
    },
  })
}

export function useProjectDetail(projectId: number) {
  return useQuery({
    queryKey: projectKeys.detail(projectId),
    queryFn: () => fetchProjectDetail(projectId),
    enabled: projectId > 0,
  })
}

export function useCreateProjectV2() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (req: ProjectCreateRequestV2) => createProjectV2(req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() })
    },
  })
}

export function useBulkSave(projectId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (req: BulkSaveRequest) => bulkSaveConditions(projectId, req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) })
      queryClient.invalidateQueries({ queryKey: projectKeys.changeLogs(projectId) })
    },
  })
}

export function useValidateProjectMutation() {
  return useMutation({
    mutationFn: (projectId: number) => validateProject(projectId),
  })
}

export function useChangeLogs(
  projectId: number,
  params?: { layer_id?: string; column_name?: string; limit?: number }
) {
  return useQuery({
    queryKey: projectKeys.changeLogs(projectId, params),
    queryFn: () => fetchChangeLogs(projectId, params),
    enabled: projectId > 0,
  })
}

export function useReplaceBackbone(projectId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      projectLayerId,
      req,
    }: {
      projectLayerId: number
      req: BackboneReplaceRequest
    }) => replaceLayerBackbone(projectId, projectLayerId, req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) })
      queryClient.invalidateQueries({ queryKey: projectKeys.changeLogs(projectId) })
    },
  })
}

export function useAddLayer(projectId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (req: LayerAddRequest) => addProjectLayer(projectId, req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) })
    },
  })
}

export function useDeleteLayer(projectId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (projectLayerId: number) => deleteProjectLayer(projectId, projectLayerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) })
    },
  })
}

export function useUploadRecipe(projectId: number) {
  return useMutation({
    mutationFn: ({ files, projectLayerId }: { files: File[]; projectLayerId?: number }) =>
      uploadRecipeXml(projectId, files, projectLayerId),
  })
}

export function useApplyRecipe(projectId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (req: RecipeApplyRequest) => applyRecipeChanges(projectId, req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) })
      queryClient.invalidateQueries({ queryKey: projectKeys.changeLogs(projectId) })
    },
  })
}

export function useReviseProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ projectId, request }: { projectId: number; request?: ReviseProjectRequest }) =>
      reviseProject(projectId, request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() })
    },
  })
}

export function useProductRevisions(productId: number | null) {
  return useQuery({
    queryKey: projectKeys.productRevisions(productId!),
    queryFn: () => getProductRevisions(productId!),
    enabled: !!productId,
  })
}

export function useTimeline(projectId: number, params: TimelineParams = {}) {
  return useQuery({
    queryKey: projectKeys.timeline(projectId, params),
    queryFn: () => fetchTimeline(projectId, params),
    enabled: !!projectId,
  })
}

export function useCellHistory(
  projectId: number,
  projectLayerId: number | null,
  columnName: string | null
) {
  return useQuery({
    queryKey: projectKeys.cellHistory(projectId, projectLayerId!, columnName!),
    queryFn: () => fetchCellHistory(projectId, projectLayerId!, columnName!),
    enabled: !!projectId && !!projectLayerId && !!columnName,
  })
}

export function useVersionHistory(projectId: number) {
  return useQuery({
    queryKey: projectKeys.versionHistory(projectId),
    queryFn: () => fetchVersionHistory(projectId),
    enabled: !!projectId,
  })
}

export function useVersionDiff(
  projectId: number,
  compareProjectId: number,
  enabled: boolean = false
) {
  return useQuery({
    queryKey: projectKeys.versionDiff(projectId, compareProjectId),
    queryFn: () => getVersionDiff(projectId, compareProjectId),
    enabled: enabled && !!projectId && !!compareProjectId,
  })
}
