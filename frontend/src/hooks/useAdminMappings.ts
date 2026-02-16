import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchAdminMappings,
  createMapping,
  updateMapping,
  deleteMapping,
} from '@/api/admin'
import type { XmlMappingCreateRequest, XmlMappingUpdateRequest } from '@/types'
import { useToastStore } from '@/stores/useToastStore'

export const adminMappingKeys = {
  all: ['admin', 'mappings'] as const,
  list: (filters?: { search?: string; isActive?: boolean }) =>
    [...adminMappingKeys.all, 'list', filters] as const,
}

export function useAdminMappings(search?: string, isActive?: boolean) {
  return useQuery({
    queryKey: adminMappingKeys.list({ search, isActive }),
    queryFn: () => fetchAdminMappings({ search, is_active: isActive }),
    staleTime: 5 * 60 * 1000,
  })
}

export function useCreateMapping() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: (request: XmlMappingCreateRequest) => createMapping(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminMappingKeys.all })
      addToast('XML 매핑이 생성되었습니다.', 'success')
    },
    onError: () => {
      addToast('XML 매핑 생성에 실패했습니다.', 'error')
    },
  })
}

export function useUpdateMapping() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: ({ id, request }: { id: number; request: XmlMappingUpdateRequest }) =>
      updateMapping(id, request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminMappingKeys.all })
      addToast('XML 매핑이 수정되었습니다.', 'success')
    },
    onError: () => {
      addToast('XML 매핑 수정에 실패했습니다.', 'error')
    },
  })
}

export function useDeleteMapping() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: (id: number) => deleteMapping(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminMappingKeys.all })
      addToast('XML 매핑이 삭제되었습니다.', 'success')
    },
    onError: () => {
      addToast('XML 매핑 삭제에 실패했습니다.', 'error')
    },
  })
}
