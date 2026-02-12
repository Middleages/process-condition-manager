import { cn } from '@/lib/utils'
import { useEditorStore } from '@/stores/useEditorStore'
import type { ColumnCategory } from '@/types'

interface Props {
  categories: ColumnCategory[]
}

export function CategoryTabs({ categories }: Props) {
  const activeCategory = useEditorStore((s) => s.activeCategory)
  const setActiveCategory = useEditorStore((s) => s.setActiveCategory)

  return (
    <div className="flex border-b bg-muted/30">
      {categories.map((cat) => (
        <button
          key={cat.category_code}
          className={cn(
            'px-4 py-2 text-sm font-medium transition-colors relative',
            activeCategory === cat.category_code
              ? 'text-primary border-b-2 border-primary bg-background'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
          )}
          onClick={() => setActiveCategory(cat.category_code)}
        >
          {cat.category_name}
          <span className="ml-1.5 text-xs text-muted-foreground">
            ({cat.columns.length})
          </span>
        </button>
      ))}
    </div>
  )
}
