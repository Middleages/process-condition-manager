import { useCallback, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import type { RecipeDiffItem } from '@/types'
import { Check, Minus } from 'lucide-react'

interface Props {
  items: RecipeDiffItem[]
  selectedColumns: Set<string>
  onSelectionChange: (columns: Set<string>) => void
}

export function RecipeDiffTable({ items, selectedColumns, onSelectionChange }: Props) {
  const diffItems = useMemo(() => items.filter((i) => i.is_different), [items])
  const sameItems = useMemo(() => items.filter((i) => !i.is_different), [items])
  const [showSame, setShowSame] = useState(false)

  const allDiffSelected = diffItems.length > 0 && diffItems.every((i) => selectedColumns.has(i.column_name))
  const someDiffSelected = diffItems.some((i) => selectedColumns.has(i.column_name))

  const toggleAll = useCallback(() => {
    if (allDiffSelected) {
      onSelectionChange(new Set())
    } else {
      onSelectionChange(new Set(diffItems.map((i) => i.column_name)))
    }
  }, [allDiffSelected, diffItems, onSelectionChange])

  const toggleItem = useCallback(
    (columnName: string) => {
      const next = new Set(selectedColumns)
      if (next.has(columnName)) {
        next.delete(columnName)
      } else {
        next.add(columnName)
      }
      onSelectionChange(next)
    },
    [selectedColumns, onSelectionChange]
  )

  // Group diff items by category
  const groupedDiff = useMemo(() => {
    const map = new Map<string, RecipeDiffItem[]>()
    for (const item of diffItems) {
      const cat = item.category_code ?? 'ETC'
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat)!.push(item)
    }
    return map
  }, [diffItems])

  if (items.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-8 text-sm">
        매핑된 항목이 없습니다.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Summary */}
      <div className="flex items-center justify-between text-sm">
        <span>
          전체 {items.length}항목 중{' '}
          <span className="font-semibold text-orange-600">{diffItems.length}건 차이</span>
        </span>
        <span className="text-muted-foreground">
          선택: {selectedColumns.size}건
        </span>
      </div>

      {/* Diff table */}
      {diffItems.length > 0 && (
        <div className="border rounded-md overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b">
                <th className="w-10 px-3 py-2">
                  <button
                    onClick={toggleAll}
                    className={cn(
                      'w-4 h-4 rounded border flex items-center justify-center transition-colors',
                      allDiffSelected
                        ? 'bg-primary border-primary text-primary-foreground'
                        : someDiffSelected
                          ? 'bg-primary/30 border-primary'
                          : 'border-muted-foreground/30'
                    )}
                  >
                    {allDiffSelected && <Check className="h-3 w-3" />}
                    {someDiffSelected && !allDiffSelected && <Minus className="h-3 w-3" />}
                  </button>
                </th>
                <th className="text-left px-3 py-2 font-medium">항목</th>
                <th className="text-left px-3 py-2 font-medium">현재 값</th>
                <th className="text-left px-3 py-2 font-medium">Recipe 값</th>
                <th className="text-left px-3 py-2 font-medium w-16">카테고리</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(groupedDiff.entries()).map(([cat, catItems]) => (
                catItems.map((item, idx) => (
                  <tr
                    key={item.column_name}
                    className={cn(
                      'border-b last:border-b-0 hover:bg-muted/30 transition-colors',
                      selectedColumns.has(item.column_name) && 'bg-green-50'
                    )}
                  >
                    <td className="px-3 py-1.5">
                      <button
                        onClick={() => toggleItem(item.column_name)}
                        className={cn(
                          'w-4 h-4 rounded border flex items-center justify-center transition-colors',
                          selectedColumns.has(item.column_name)
                            ? 'bg-primary border-primary text-primary-foreground'
                            : 'border-muted-foreground/30'
                        )}
                      >
                        {selectedColumns.has(item.column_name) && <Check className="h-3 w-3" />}
                      </button>
                    </td>
                    <td className="px-3 py-1.5 font-medium">{item.display_name}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {item.current_value != null ? String(item.current_value) : <span className="italic">(없음)</span>}
                    </td>
                    <td className="px-3 py-1.5 font-semibold text-green-700">
                      {String(item.recipe_value)}
                    </td>
                    <td className="px-3 py-1.5">
                      {idx === 0 && (
                        <span className="text-xs text-muted-foreground">{cat}</span>
                      )}
                    </td>
                  </tr>
                ))
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Same items (collapsible) */}
      {sameItems.length > 0 && (
        <div>
          <button
            onClick={() => setShowSame(!showSame)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showSame ? '▾' : '▸'} 동일 항목 ({sameItems.length}건)
          </button>
          {showSame && (
            <div className="mt-1 border rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <tbody>
                  {sameItems.map((item) => (
                    <tr key={item.column_name} className="border-b last:border-b-0">
                      <td className="px-3 py-1 text-muted-foreground">{item.display_name}</td>
                      <td className="px-3 py-1 text-muted-foreground">
                        {item.current_value != null ? String(item.current_value) : '-'}
                      </td>
                      <td className="px-3 py-1 text-muted-foreground text-xs">{item.category_code}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
