import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchDataSources,
  createDataSource,
  updateDataSource,
  deleteDataSource,
  fetchDataSourceColumns,
} from '@/api/exportDataSource'
import type { ExportDataSourceCreate, ExportDataSourceUpdate } from '@/types/export'

// ========== Query Keys ==========

export const dataSourceKeys = {
  all: ['exportDataSources'] as const,
  list: () => [...dataSourceKeys.all] as const,
  columns: (sourceId: number) => ['exportDataSourceColumns', sourceId] as const,
}

// ========== Queries ==========

export function useExportDataSources() {
  return useQuery({
    queryKey: dataSourceKeys.list(),
    queryFn: fetchDataSources,
  })
}

export function useDataSourceColumns(sourceId: number | null) {
  return useQuery({
    queryKey: dataSourceKeys.columns(sourceId ?? 0),
    queryFn: () => fetchDataSourceColumns(sourceId!),
    enabled: sourceId !== null && sourceId > 0,
  })
}

// ========== Mutations ==========

export function useCreateDataSource() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: ExportDataSourceCreate) => createDataSource(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dataSourceKeys.list() })
    },
  })
}

export function useUpdateDataSource() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: ExportDataSourceUpdate }) =>
      updateDataSource(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dataSourceKeys.list() })
    },
  })
}

export function useDeleteDataSource() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: number) => deleteDataSource(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dataSourceKeys.list() })
    },
  })
}
