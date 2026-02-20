import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchEquipment,
  createEquipment,
  updateEquipment,
  deleteEquipment,
  reorderEquipment,
} from '@/api/equipment'
import type { EquipmentCreate } from '@/types/export'

// ========== Query Keys ==========

export const equipmentKeys = {
  all: ['equipment'] as const,
  list: (projectId: number, layerId: number) =>
    [...equipmentKeys.all, projectId, layerId] as const,
}

// ========== Query ==========

export function useEquipment(projectId: number, layerId: number) {
  return useQuery({
    queryKey: equipmentKeys.list(projectId, layerId),
    queryFn: () => fetchEquipment(projectId, layerId),
    enabled: !!projectId && !!layerId,
  })
}

// ========== Mutations ==========

export function useCreateEquipment(projectId: number, layerId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: EquipmentCreate) =>
      createEquipment(projectId, layerId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: equipmentKeys.list(projectId, layerId),
      })
    },
  })
}

export function useUpdateEquipment(projectId: number, layerId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      eqId,
      payload,
    }: {
      eqId: number
      payload: Partial<EquipmentCreate>
    }) => updateEquipment(projectId, layerId, eqId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: equipmentKeys.list(projectId, layerId),
      })
    },
  })
}

export function useDeleteEquipment(projectId: number, layerId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (eqId: number) => deleteEquipment(projectId, layerId, eqId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: equipmentKeys.list(projectId, layerId),
      })
    },
  })
}

export function useReorderEquipment(projectId: number, layerId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (orderedIds: number[]) =>
      reorderEquipment(projectId, layerId, orderedIds),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: equipmentKeys.list(projectId, layerId),
      })
    },
  })
}
