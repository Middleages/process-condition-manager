import { useMemo, useRef } from 'react'

import { Button } from '@/shared/components/Button'

import { resolveWorkbenchRovingIndex } from './sheetWorkbenchNavigation'

export function SheetWorkbenchCategoryTabs({
  categories,
  activeCategory,
  disabled = false,
  onSelectCategory,
}: {
  categories: readonly string[]
  activeCategory: string | null
  disabled?: boolean
  onSelectCategory: (category: string | null) => void
}) {
  const tabs = useMemo(() => [null, ...categories], [categories])
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([])
  const activeIndex = Math.max(
    0,
    tabs.findIndex((category) => category === activeCategory),
  )

  function selectTab(index: number): void {
    const nextCategory = tabs[index] ?? null
    onSelectCategory(nextCategory)
    buttonsRef.current[index]?.focus()
  }

  return (
    <div
      aria-label="카테고리 탭"
      className="flex min-w-0 flex-wrap items-center gap-2"
      data-testid="sheet-category-tabs"
      role="tablist"
    >
      {tabs.map((category, index) => {
        const isActive = index === activeIndex
        return (
          <Button
            aria-selected={isActive}
            className="shrink-0"
            disabled={disabled}
            key={category ?? 'all'}
            onClick={() => selectTab(index)}
            onKeyDown={(event) => {
              const nextIndex = resolveWorkbenchRovingIndex(event.key, index, tabs.length)
              if (nextIndex === null) return
              event.preventDefault()
              selectTab(nextIndex)
            }}
            ref={(button) => {
              buttonsRef.current[index] = button
            }}
            role="tab"
            size="compact"
            tabIndex={isActive ? 0 : -1}
            type="button"
            variant={isActive ? 'primary' : 'secondary'}
          >
            {category ?? '전체'}
          </Button>
        )
      })}
    </div>
  )
}
