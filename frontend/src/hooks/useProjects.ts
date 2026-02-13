import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchProjects,
  fetchProjectDetail,
  createProject,
  bulkSaveConditions,
  validateProject,
  fetchChangeLogs,
  replaceLayerBackbone,
  addProjectLayer,
  deleteProjectLayer,
} from '@/api/projects'
import type {
  ProjectStatus,
  ProjectCreateRequest,
  BulkSaveRequest,
  BackboneReplaceRequest,
  LayerAddRequest,
} from '@/types'

export const projectKeys = {
  all: ['projects'] as const,
  lists: () => [...projectKeys.all, 'list'] as const,
  list: (filters: { status?: ProjectStatus }) =>
    [...projectKeys.lists(), filters] as const,
  details: () => [...projectKeys.all, 'detail'] as const,
  detail: (id: number) => [...projectKeys.details(), id] as const,
  validation: (id: number) => [...projectKeys.all, 'validation', id] as const,
  changeLogs: (id: number, filters?: Record<string, unknown>) =>
    [...projectKeys.all, 'change-logs', id, filters] as const,
}

export function useProjects(status?: ProjectStatus) {
  return useQuery({
    queryKey: projectKeys.list({ status }),
    queryFn: () => fetchProjects(status ? { status } : undefined),
  })
}

export function useProjectDetail(projectId: number) {
  return useQuery({
    queryKey: projectKeys.detail(projectId),
    queryFn: () => fetchProjectDetail(projectId),
    enabled: projectId > 0,
  })
}

export function useCreateProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (req: ProjectCreateRequest) => createProject(req),
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
  params?: { layer_id?: number; column_name?: string; limit?: number }
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
