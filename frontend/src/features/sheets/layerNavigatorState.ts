import type { ProjectLayerOut } from '../../api/types'

export interface LayerNavigatorItem {
  key: string
  number: string
  label: string
  searchText: string
  sortOrder: number
  errorCount: number
  dirty: boolean
}

export function buildLayerNavigatorItems(
  layers: readonly ProjectLayerOut[],
  issueCounts: ReadonlyMap<string, number>,
  dirtyLayerKeys: ReadonlySet<string>,
): readonly LayerNavigatorItem[] {
  const sorted = [...layers].sort(
    (left, right) => left.sort_order - right.sort_order || left.id - right.id,
  )
  return sorted.map((layer, index) => {
    const description = layer.eqp_type_desc?.trim() || layer.eqp_type?.trim() || '설명 없음'
    const label = `${layer.layer_id} · ${layer.step_seq} · ${description}`
    return {
      key: layer.layer_key,
      number: String(index + 1).padStart(2, '0'),
      label,
      searchText: `${layer.layer_key} ${layer.layer_id} ${layer.step_seq} ${layer.eqp_type ?? ''} ${description} ${layer.area_name ?? ''}`.toLocaleLowerCase('ko-KR'),
      sortOrder: layer.sort_order,
      errorCount: issueCounts.get(layer.layer_key) ?? 0,
      dirty: dirtyLayerKeys.has(layer.layer_key),
    }
  })
}

export function filterLayerNavigatorItems(
  items: readonly LayerNavigatorItem[],
  query: string,
): readonly LayerNavigatorItem[] {
  const normalized = query.trim().toLocaleLowerCase('ko-KR')
  return normalized === '' ? items : items.filter((item) => item.searchText.includes(normalized))
}

export function updateRecentLayerKeys(
  current: readonly string[],
  activatedKey: string,
  limit = 3,
): readonly string[] {
  return [activatedKey, ...current.filter((key) => key !== activatedKey)].slice(0, Math.max(0, limit))
}

export function resolveLayerNavigatorIndex(
  key: string,
  currentIndex: number,
  itemCount: number,
): number | null {
  if (itemCount <= 0) return null
  if (key === 'ArrowUp') return Math.max(0, currentIndex - 1)
  if (key === 'ArrowDown') return Math.min(itemCount - 1, currentIndex + 1)
  if (key === 'Home') return 0
  if (key === 'End') return itemCount - 1
  return null
}
