import type { ConditionGridRow } from '../../grid/types'

export function rowsForLayerViewport(
  rows: readonly ConditionGridRow[],
  activeLayerKey: string,
  currentOnly: boolean,
): readonly ConditionGridRow[] {
  return currentOnly ? rows.filter((row) => row.layerKey === activeLayerKey) : rows
}

export function firstConditionIdForLayer(
  rows: readonly ConditionGridRow[],
  layerKey: string,
): string | null {
  return rows.find((row) => row.layerKey === layerKey)?.id ?? null
}

export function recoverLayerSelection(
  rows: readonly ConditionGridRow[],
  orderedLayerKeys: readonly string[],
  previousLayerKey: string,
): { layerKey: string; conditionId: string } | null {
  const previousIndex = orderedLayerKeys.indexOf(previousLayerKey)
  if (previousIndex === -1) return null

  const candidateLayerKeys = [
    ...orderedLayerKeys.slice(previousIndex + 1),
    ...orderedLayerKeys.slice(0, previousIndex).reverse(),
  ]

  for (const layerKey of candidateLayerKeys) {
    const conditionId = firstConditionIdForLayer(rows, layerKey)
    if (conditionId !== null) return { layerKey, conditionId }
  }

  return null
}
