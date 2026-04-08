import client from './client'
import type {
  DeviceMaster,
  DeviceMasterListResponse,
  DeviceSyncResult,
  EnrichmentResult,
  EnrichmentSummary,
  SyncSourceConfig,
  SyncSourceConfigCreate,
  SyncSourceConfigUpdate,
  DeviceMetaSource,
  DeviceMetaSourceCreate,
  DeviceMetaSourceUpdate,
  DiscoveredColumnInfo,
  DeviceSearchResult,
  DeviceLayerItem,
  DuplicateCheckResponse,
  StepCurrentLayersResponse,
  StepCurrentProcessOptionsResponse,
} from '@/types/deviceMaster'

// ========== Public API ==========

export async function fetchDeviceMasters(params: {
  page?: number
  size?: number
  line_id?: number
  product_name?: string
  process?: string
}): Promise<DeviceMasterListResponse> {
  const { data } = await client.get<DeviceMasterListResponse>('/device-masters', { params })
  return data
}

export async function fetchDeviceMaster(id: number): Promise<DeviceMaster> {
  const { data } = await client.get<DeviceMaster>(`/device-masters/${id}`)
  return data
}

export async function fetchDeviceLayers(deviceId: number): Promise<DeviceLayerItem[]> {
  const { data } = await client.get<DeviceLayerItem[]>(`/device-masters/${deviceId}/layers`)
  return data
}

export async function fetchStepCurrentProcessOptions(
  lineId: number
): Promise<StepCurrentProcessOptionsResponse> {
  const { data } = await client.get<StepCurrentProcessOptionsResponse>(
    '/device-masters/step-current/processes',
    { params: { line_id: lineId } }
  )
  return data
}

export async function fetchStepCurrentLayers(params: {
  line_id: number
  process_id: string
}): Promise<StepCurrentLayersResponse> {
  const { data } = await client.get<StepCurrentLayersResponse>('/device-masters/step-current/layers', {
    params,
  })
  return data
}


export async function searchDevices(params: {
  q: string
  line_id?: number
}): Promise<DeviceSearchResult[]> {
  const { data } = await client.get<DeviceSearchResult[]>('/device-masters/search', { params })
  return data
}

export async function checkDuplicate(params: {
  line_id: number
  process: string
  part_id: string
}): Promise<DuplicateCheckResponse> {
  const { data } = await client.post<DuplicateCheckResponse>('/device-masters/check-duplicate', params)
  return data
}

// ========== Admin - Sync ==========

export async function syncDeviceMasters(autoEnrich = true): Promise<DeviceSyncResult> {
  const { data } = await client.post<DeviceSyncResult>('/admin/device-masters/sync', null, {
    params: { auto_enrich: autoEnrich },
  })
  return data
}

export async function syncLayerMasters(): Promise<DeviceSyncResult> {
  const { data } = await client.post<DeviceSyncResult>('/admin/layer-masters/sync')
  return data
}

// ========== Admin - Enrichment ==========

export async function enrichDevice(deviceId: number): Promise<EnrichmentResult> {
  const { data } = await client.post<EnrichmentResult>(
    `/admin/device-masters/${deviceId}/enrich`
  )
  return data
}

export async function enrichAllDevices(): Promise<EnrichmentSummary> {
  const { data } = await client.post<EnrichmentSummary>('/admin/device-masters/enrich-all')
  return data
}

// ========== Admin - Sync Source Config CRUD ==========

export async function fetchSyncSourceConfigs(): Promise<SyncSourceConfig[]> {
  const { data } = await client.get<SyncSourceConfig[]>('/admin/sync-source-configs')
  return data
}

export async function createSyncSourceConfig(
  payload: SyncSourceConfigCreate
): Promise<SyncSourceConfig> {
  const { data } = await client.post<SyncSourceConfig>('/admin/sync-source-configs', payload)
  return data
}

export async function updateSyncSourceConfig(
  id: number,
  payload: SyncSourceConfigUpdate
): Promise<SyncSourceConfig> {
  const { data } = await client.put<SyncSourceConfig>(
    `/admin/sync-source-configs/${id}`,
    payload
  )
  return data
}

export async function deleteSyncSourceConfig(id: number): Promise<void> {
  await client.delete(`/admin/sync-source-configs/${id}`)
}

// ========== Admin - Device Meta Source CRUD ==========

export async function fetchDeviceMetaSources(): Promise<DeviceMetaSource[]> {
  const { data } = await client.get<DeviceMetaSource[]>('/admin/device-meta-sources')
  return data
}

export async function createDeviceMetaSource(
  payload: DeviceMetaSourceCreate
): Promise<DeviceMetaSource> {
  const { data } = await client.post<DeviceMetaSource>('/admin/device-meta-sources', payload)
  return data
}

export async function updateDeviceMetaSource(
  id: number,
  payload: DeviceMetaSourceUpdate
): Promise<DeviceMetaSource> {
  const { data } = await client.put<DeviceMetaSource>(
    `/admin/device-meta-sources/${id}`,
    payload
  )
  return data
}

export async function deleteDeviceMetaSource(id: number): Promise<void> {
  await client.delete(`/admin/device-meta-sources/${id}`)
}

// ========== Admin - Column Discovery ==========

export async function discoverColumns(
  tableName: string,
  schemaName = 'public'
): Promise<DiscoveredColumnInfo[]> {
  const { data } = await client.get<DiscoveredColumnInfo[]>(
    '/admin/device-meta-sources/discover-columns',
    { params: { table_name: tableName, schema_name: schemaName } }
  )
  return data
}
