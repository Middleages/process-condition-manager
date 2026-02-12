import { useQuery } from '@tanstack/react-query'
import { fetchColumns } from '@/api/columns'
import type { ColumnCategory, ColumnDefinition } from '@/types'
import { useMemo } from 'react'

export const columnKeys = {
  all: ['columns'] as const,
  list: () => [...columnKeys.all, 'list'] as const,
}

export function useColumns() {
  return useQuery({
    queryKey: columnKeys.list(),
    queryFn: () => fetchColumns(),
    staleTime: 10 * 60 * 1000, // Column metadata rarely changes
  })
}

/** Flat map: column_name → ColumnDefinition (with validations) */
export function useColumnMap() {
  const { data: categories } = useColumns()

  return useMemo(() => {
    const map = new Map<string, ColumnDefinition>()
    if (!categories) return map
    for (const cat of categories) {
      for (const col of cat.columns) {
        map.set(col.column_name, col)
      }
    }
    return map
  }, [categories])
}

/** Get columns for a specific category */
export function useColumnsForCategory(categoryCode: string) {
  const { data: categories } = useColumns()

  return useMemo(() => {
    if (!categories) return []
    const cat = categories.find((c: ColumnCategory) => c.category_code === categoryCode)
    return cat?.columns ?? []
  }, [categories, categoryCode])
}
