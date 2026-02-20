import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchAdminExportSystems,
  createExportSystem,
  updateExportSystem,
  deleteExportSystem,
  fetchExportMappings,
  createExportMapping,
  updateExportMapping,
  deleteExportMapping,
  reorderExportMappings,
} from '@/api/exportAdmin'
import type { ExportSystemCreate, ExportMappingCreate } from '@/types/export'

// ========== Query Keys ==========

export const exportAdminKeys = {
  all: ['adminExportSystems'] as const,
  systems: () => [...exportAdminKeys.all] as const,
  mappings: (systemId: number) => ['exportMappings', systemId] as const,
}

// ========== Queries ==========

export function useAdminExportSystems() {
  return useQuery({
    queryKey: exportAdminKeys.systems(),
    queryFn: fetchAdminExportSystems,
  })
}

export function useExportMappings(systemId: number) {
  return useQuery({
    queryKey: exportAdminKeys.mappings(systemId),
    queryFn: () => fetchExportMappings(systemId),
    enabled: !!systemId,
  })
}

// ========== ExportSystem Mutations ==========

export function useCreateExportSystem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: ExportSystemCreate) => createExportSystem(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: exportAdminKeys.systems() })
    },
  })
}

export function useUpdateExportSystem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<ExportSystemCreate> }) =>
      updateExportSystem(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: exportAdminKeys.systems() })
    },
  })
}

export function useDeleteExportSystem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: number) => deleteExportSystem(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: exportAdminKeys.systems() })
    },
  })
}

// ========== ExportMapping Mutations ==========

export function useCreateExportMapping(systemId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: ExportMappingCreate) => createExportMapping(systemId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: exportAdminKeys.mappings(systemId) })
    },
  })
}

export function useUpdateExportMapping(systemId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      mappingId,
      payload,
    }: {
      mappingId: number
      payload: Partial<ExportMappingCreate>
    }) => updateExportMapping(systemId, mappingId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: exportAdminKeys.mappings(systemId) })
    },
  })
}

export function useDeleteExportMapping(systemId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (mappingId: number) => deleteExportMapping(systemId, mappingId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: exportAdminKeys.mappings(systemId) })
    },
  })
}

export function useReorderExportMappings(systemId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (orderedIds: number[]) => reorderExportMappings(systemId, orderedIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: exportAdminKeys.mappings(systemId) })
    },
  })
}
