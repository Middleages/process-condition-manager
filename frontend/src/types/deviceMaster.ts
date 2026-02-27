// Device Master & Layer Master types for SPEC-DEVICE-001

// ========== Device Master ==========

export interface DeviceMaster {
  id: number
  line_id: number
  line_name: string
  product_name: string
  process: string
  part_id: string | null
  is_active: boolean
  enrichment: Record<string, Record<string, unknown>>
  synced_at: string | null
  created_at: string
  updated_at: string
}

export interface DeviceMasterListResponse {
  items: DeviceMaster[]
  total: number
  page: number
  size: number
}

export interface DeviceSyncResult {
  total_processed: number
  inserted: number
  updated: number
  unchanged: number
  errors: string[]
  enrichment_summary: EnrichmentSummary | null
}

// ========== Layer Master ==========

export interface LayerMaster {
  id: number
  device_master_id: number
  layer_id: string
  step_seq: string | null
  descript: string | null
  synced_at: string | null
  created_at: string
}

// ========== Sync Source Config ==========

export interface ColumnMapping {
  source_column: string
  target_field: string
}

export interface SyncSourceConfig {
  id: number
  source_type: 'device' | 'layer'
  source_name: string
  table_name: string
  schema_name: string
  column_mappings: ColumnMapping[]
  description: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface SyncSourceConfigCreate {
  source_type: 'device' | 'layer'
  source_name: string
  table_name: string
  schema_name?: string
  column_mappings: ColumnMapping[]
  description?: string
  is_active?: boolean
}

export interface SyncSourceConfigUpdate {
  source_name?: string
  table_name?: string
  schema_name?: string
  column_mappings?: ColumnMapping[]
  description?: string
  is_active?: boolean
}

// ========== Device Meta Source ==========

export interface JoinKey {
  device_field: string
  source_column: string
}

export interface MetaColumnMapping {
  source_column: string
  target_field: string
}

export interface DeviceMetaSource {
  id: number
  source_name: string
  table_name: string
  schema_name: string
  join_keys: JoinKey[]
  column_mappings: MetaColumnMapping[]
  description: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface DeviceMetaSourceCreate {
  source_name: string
  table_name: string
  schema_name?: string
  join_keys: JoinKey[]
  column_mappings: MetaColumnMapping[]
  description?: string
  is_active?: boolean
}

export interface DeviceMetaSourceUpdate {
  source_name?: string
  table_name?: string
  schema_name?: string
  join_keys?: JoinKey[]
  column_mappings?: MetaColumnMapping[]
  description?: string
  is_active?: boolean
}

// ========== Enrichment ==========

export interface EnrichmentResult {
  device_id: number
  product_name: string
  sources_processed: number
  fields_enriched: string[]
  errors: string[]
}

export interface EnrichmentSummary {
  devices_enriched: number
  total_errors: number
  details: EnrichmentResult[]
}

// ========== Column Discovery ==========

export interface DiscoveredColumnInfo {
  column_name: string
  data_type: string
}

// ========== Project Creation (SPEC-PROJECT-002) ==========

export interface DeviceSearchResult {
  id: number
  line_id: number
  product_name: string
  process: string
  part_id: string | null
  is_active: boolean
  enrichment: Record<string, Record<string, unknown>>
}

export interface DeviceLayerItem {
  id: number
  layer_id: string
  step_seq: string | null
  descript: string | null
}

export interface DuplicateCheckResponse {
  exists: boolean
  existing_project_id?: number | null
  existing_project_status?: string | null
  existing_project_revision?: number | null
}
