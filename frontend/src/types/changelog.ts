// ========== Change Log ==========
export interface ChangeLogItem {
  id: number
  project_layer_id: number
  layer_name: string
  column_name: string
  old_value: string | null
  new_value: string | null
  change_type: 'manual' | 'backbone' | 'recipe'
  changed_by: number
  changed_by_name: string
  changed_at: string
}

export interface ChangeLogListResponse {
  total: number
  items: ChangeLogItem[]
}

// === SPEC-004: Timeline Types ===
export interface TimelineEntryDetails {
  // For cell_change
  layer_name?: string
  column_name?: string | null
  old_value?: string | null
  new_value?: string | null
  change_type?: string  // manual, backbone, recipe
  backbone_info?: string
  // For status_change
  from_status?: string
  to_status?: string
  comment?: string | null
}

export interface TimelineEntry {
  id: string  // "change-500" or "status-5"
  entry_type: 'cell_change' | 'status_change'
  timestamp: string
  user_id: number
  user_name: string
  details: TimelineEntryDetails
}

export interface TimelineGroup {
  date: string  // "YYYY-MM-DD"
  entries: TimelineEntry[]
}

export interface TimelineResponse {
  total: number
  page: number
  limit: number
  groups: TimelineGroup[]
}

export interface TimelineParams {
  page?: number
  limit?: number
  layer_id?: string
  change_type?: string
  changed_by?: number
}

// === SPEC-004: Cell History Types ===
export interface CellHistoryItem {
  id: number
  old_value: string | null
  new_value: string | null
  change_type: string
  changed_by: number
  changed_by_name: string
  changed_at: string
}

export interface CellHistoryResponse {
  project_layer_id: number
  layer_name: string
  column_name: string
  total: number
  items: CellHistoryItem[]
}

// === SPEC-004: Version History Types ===
export interface VersionItem {
  project_id: number
  revision: number
  status: string
  is_latest: boolean
  is_current: boolean
  created_by_userid: string | null
  created_at: string
  revision_reason?: string | null
}

export interface VersionHistoryResponse {
  product_id: number
  product_name: string
  current_project_id: number
  versions: VersionItem[]
}

// === SPEC-006 M3: Version Diff Types ===
export interface CellDiff {
  column_name: string
  old_value: string | null
  new_value: string | null
}

export interface LayerDiff {
  layer_id: string
  layer_name: string
  change_type: 'modified' | 'added' | 'removed'
  changes: CellDiff[]
}

export interface DiffSummary {
  total_layers_changed: number
  total_cells_changed: number
}

export interface VersionDiffResponse {
  base_project_id: number
  compare_project_id: number
  base_revision: number
  compare_revision: number
  summary: DiffSummary
  layers: LayerDiff[]
}
