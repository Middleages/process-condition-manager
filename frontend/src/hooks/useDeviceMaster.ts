import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchDeviceMasters,
  fetchDeviceLayers,
  checkDuplicate,
  syncDeviceMasters,
  syncLayerMasters,
  enrichDevice,
  enrichAllDevices,
  fetchSyncSourceConfigs,
  createSyncSourceConfig,
  updateSyncSourceConfig,
  deleteSyncSourceConfig,
  fetchDeviceMetaSources,
  createDeviceMetaSource,
  updateDeviceMetaSource,
  deleteDeviceMetaSource,
  discoverColumns,
} from '@/api/deviceMaster'
import type {
  SyncSourceConfigCreate,
  SyncSourceConfigUpdate,
  DeviceMetaSourceCreate,
  DeviceMetaSourceUpdate,
} from '@/types/deviceMaster'

// ========== Query Keys ==========

export const deviceMasterKeys = {
  all: ['device-masters'] as const,
  list: (params: {
    page?: number
    size?: number
    line_id?: number
    product_name?: string
    process?: string
  }) => [...deviceMasterKeys.all, 'list', params] as const,
  layers: (deviceId: number) => [...deviceMasterKeys.all, deviceId, 'layers'] as const,
}

export const syncConfigKeys = {
  all: ['sync-source-configs'] as const,
  list: () => [...syncConfigKeys.all] as const,
}

export const metaSourceKeys = {
  all: ['device-meta-sources'] as const,
  list: () => [...metaSourceKeys.all] as const,
  columns: (tableName: string, schemaName: string) =>
    [...metaSourceKeys.all, 'columns', tableName, schemaName] as const,
}

// ========== Device Master Queries ==========

export function useDeviceMasters(params: {
  page?: number
  size?: number
  line_id?: number
  product_name?: string
  process?: string
}) {
  return useQuery({
    queryKey: deviceMasterKeys.list(params),
    queryFn: () => fetchDeviceMasters(params),
  })
}

export function useDeviceLayers(deviceId: number | null) {
  return useQuery({
    queryKey: deviceMasterKeys.layers(deviceId ?? 0),
    queryFn: () => fetchDeviceLayers(deviceId!),
    enabled: deviceId !== null && deviceId > 0,
  })
}

export function useCheckDuplicate() {
  return useMutation({
    mutationFn: (params: {
      line_id: number
      product_name: string
      process: string
      part_id: string
    }) => checkDuplicate(params),
  })
}

// ========== Sync Mutations ==========

export function useSyncDeviceMasters() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (autoEnrich?: boolean) => syncDeviceMasters(autoEnrich),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: deviceMasterKeys.all })
    },
  })
}

export function useSyncLayerMasters() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => syncLayerMasters(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: deviceMasterKeys.all })
    },
  })
}

// ========== Enrichment Mutations ==========

export function useEnrichDevice() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (deviceId: number) => enrichDevice(deviceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: deviceMasterKeys.all })
    },
  })
}

export function useEnrichAllDevices() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => enrichAllDevices(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: deviceMasterKeys.all })
    },
  })
}

// ========== Sync Source Config Hooks ==========

export function useSyncSourceConfigs() {
  return useQuery({
    queryKey: syncConfigKeys.list(),
    queryFn: fetchSyncSourceConfigs,
  })
}

export function useCreateSyncSourceConfig() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: SyncSourceConfigCreate) => createSyncSourceConfig(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: syncConfigKeys.list() })
    },
  })
}

export function useUpdateSyncSourceConfig() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: SyncSourceConfigUpdate }) =>
      updateSyncSourceConfig(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: syncConfigKeys.list() })
    },
  })
}

export function useDeleteSyncSourceConfig() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: number) => deleteSyncSourceConfig(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: syncConfigKeys.list() })
    },
  })
}

// ========== Device Meta Source Hooks ==========

export function useDeviceMetaSources() {
  return useQuery({
    queryKey: metaSourceKeys.list(),
    queryFn: fetchDeviceMetaSources,
  })
}

export function useCreateDeviceMetaSource() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: DeviceMetaSourceCreate) => createDeviceMetaSource(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: metaSourceKeys.list() })
    },
  })
}

export function useUpdateDeviceMetaSource() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: DeviceMetaSourceUpdate }) =>
      updateDeviceMetaSource(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: metaSourceKeys.list() })
    },
  })
}

export function useDeleteDeviceMetaSource() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: number) => deleteDeviceMetaSource(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: metaSourceKeys.list() })
    },
  })
}

export function useDiscoverColumns(tableName: string | null, schemaName = 'public') {
  return useQuery({
    queryKey: metaSourceKeys.columns(tableName ?? '', schemaName),
    queryFn: () => discoverColumns(tableName!, schemaName),
    enabled: tableName !== null && tableName.trim().length > 0,
  })
}
