import type { ProjectLayerData } from '@/types'

export interface LayerDiffSummary {
  layerId: string
  layerName: string
  changedCount: number
  changedColumns: string[]
}

export interface ProjectDiffSummary {
  totalChangedCells: number
  totalChangedLayers: number
  layers: LayerDiffSummary[]
}

/**
 * Compare conditions vs backbone_conditions for a single layer.
 * Returns the list of column names that differ.
 */
export function diffLayerConditions(
  conditions: Record<string, unknown>,
  backboneConditions: Record<string, unknown>
): string[] {
  const changed: string[] = []
  const allKeys = new Set([
    ...Object.keys(conditions),
    ...Object.keys(backboneConditions),
  ])

  for (const key of allKeys) {
    const cur = conditions[key]
    const bb = backboneConditions[key]
    if (!valuesEqual(cur, bb)) {
      changed.push(key)
    }
  }

  return changed
}

/**
 * Compare values, treating null/undefined/"" equivalently for empty.
 */
function valuesEqual(a: unknown, b: unknown): boolean {
  const na = normalize(a)
  const nb = normalize(b)
  return na === nb
}

function normalize(v: unknown): string {
  if (v === null || v === undefined || v === '') return ''
  return String(v)
}

/**
 * Compute diff summary for an entire project.
 */
export function computeProjectDiff(layers: ProjectLayerData[]): ProjectDiffSummary {
  const layerDiffs: LayerDiffSummary[] = []
  let totalChangedCells = 0

  for (const layer of layers) {
    const changedColumns = diffLayerConditions(
      layer.conditions,
      layer.backbone_conditions
    )
    if (changedColumns.length > 0) {
      layerDiffs.push({
        layerId: layer.layer_id,
        layerName: layer.layer_name,
        changedCount: changedColumns.length,
        changedColumns,
      })
      totalChangedCells += changedColumns.length
    }
  }

  return {
    totalChangedCells,
    totalChangedLayers: layerDiffs.length,
    layers: layerDiffs,
  }
}

/**
 * Get the count of backbone-differing cells for a specific layer.
 */
export function getLayerChangeCount(layer: ProjectLayerData): number {
  return diffLayerConditions(layer.conditions, layer.backbone_conditions).length
}

// ========== Detailed Comparison (with values) ==========

export interface CellChange {
  columnName: string
  backboneValue: string | null
  currentValue: string | null
}

export interface LayerComparisonDetail {
  layerId: string
  layerName: string
  stepSeq: string
  backboneProductName: string | null
  changes: CellChange[]
}

export interface ProjectComparisonDetail {
  totalChangedCells: number
  totalChangedLayers: number
  totalLayers: number
  layers: LayerComparisonDetail[]
}

/**
 * Get detailed backbone comparison for a single layer, including old/new values.
 */
export function getLayerComparisonDetail(layer: ProjectLayerData): LayerComparisonDetail {
  const changes: CellChange[] = []
  const allKeys = new Set([
    ...Object.keys(layer.conditions),
    ...Object.keys(layer.backbone_conditions),
  ])

  for (const key of allKeys) {
    const cur = layer.conditions[key]
    const bb = layer.backbone_conditions[key]
    if (!valuesEqual(cur, bb)) {
      changes.push({
        columnName: key,
        backboneValue: bb === null || bb === undefined || bb === '' ? null : String(bb),
        currentValue: cur === null || cur === undefined || cur === '' ? null : String(cur),
      })
    }
  }

  return {
    layerId: layer.layer_id,
    layerName: layer.layer_name,
    stepSeq: layer.step_seq,
    backboneProductName: layer.backbone_product_name,
    changes,
  }
}

/**
 * Compute detailed backbone comparison for all layers in a project.
 */
export function computeProjectComparisonDetail(layers: ProjectLayerData[]): ProjectComparisonDetail {
  const layerDetails: LayerComparisonDetail[] = []
  let totalChangedCells = 0

  for (const layer of layers) {
    const detail = getLayerComparisonDetail(layer)
    if (detail.changes.length > 0) {
      layerDetails.push(detail)
      totalChangedCells += detail.changes.length
    }
  }

  return {
    totalChangedCells,
    totalChangedLayers: layerDetails.length,
    totalLayers: layers.length,
    layers: layerDetails,
  }
}
