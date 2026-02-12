import type { ProjectLayerData } from '@/types'

export interface LayerDiffSummary {
  layerId: number
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
