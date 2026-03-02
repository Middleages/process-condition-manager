import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchConfigChanges,
  fetchConfigChangeDetail,
  createConfigChange,
  voteConfigChange,
  startConfigChange,
  completeConfigChange,
  cancelConfigChange,
} from '@/api/configChanges'
import type { ConfigChangeCreateRequest, ConfigChangeVoteRequest } from '@/types'

export const configChangeKeys = {
  all: ['configChanges'] as const,
  list: (status?: string | null, offset?: number, limit?: number) =>
    [...configChangeKeys.all, 'list', status, offset, limit] as const,
  detail: (id: number) => [...configChangeKeys.all, 'detail', id] as const,
}

export function useConfigChanges(status?: string | null, offset = 0, limit = 20) {
  return useQuery({
    queryKey: configChangeKeys.list(status, offset, limit),
    queryFn: () => fetchConfigChanges(status, offset, limit),
  })
}

export function useConfigChangeDetail(id: number) {
  return useQuery({
    queryKey: configChangeKeys.detail(id),
    queryFn: () => fetchConfigChangeDetail(id),
    enabled: id > 0,
  })
}

export function useCreateConfigChange() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: ConfigChangeCreateRequest) => createConfigChange(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: configChangeKeys.all })
    },
  })
}

export function useVoteConfigChange() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: ConfigChangeVoteRequest }) =>
      voteConfigChange(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: configChangeKeys.all })
    },
  })
}

export function useStartConfigChange() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => startConfigChange(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: configChangeKeys.all })
    },
  })
}

export function useCompleteConfigChange() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => completeConfigChange(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: configChangeKeys.all })
    },
  })
}

export function useCancelConfigChange() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => cancelConfigChange(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: configChangeKeys.all })
    },
  })
}
