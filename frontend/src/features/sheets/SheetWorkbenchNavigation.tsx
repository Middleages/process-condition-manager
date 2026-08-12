import { useRef } from 'react'

import { Badge } from '@/shared/components/Badge'
import { cn } from '@/shared/lib/cn'

import type { SheetWorkbenchMode } from './SheetWorkbench'
import { resolveWorkbenchRovingIndex } from './sheetWorkbenchNavigation'

export const SHEET_WORKBENCH_MODES: readonly Exclude<SheetWorkbenchMode, null>[] = [
  'validation',
  'history',
  'backbone-diff',
] as const

const SHEET_WORKBENCH_MODE_LABELS: Record<Exclude<SheetWorkbenchMode, null>, string> = {
  validation: '검증',
  history: '이력',
  'backbone-diff': '백본 비교',
}

export function SheetWorkbenchNavigation({
  mode,
  onModeChange,
  validationIssueCount = 0,
  disabled = false,
}: {
  mode: Exclude<SheetWorkbenchMode, null>
  onModeChange: (mode: Exclude<SheetWorkbenchMode, null>) => void
  validationIssueCount?: number
  disabled?: boolean
}) {
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([])
  const activeIndex = SHEET_WORKBENCH_MODES.findIndex((candidate) => candidate === mode)

  function selectMode(index: number): void {
    const nextMode = SHEET_WORKBENCH_MODES[index]
    if (nextMode === undefined) return
    onModeChange(nextMode)
    buttonsRef.current[index]?.focus()
  }

  return (
    <div
      aria-label="증거 패널 모드"
      className="grid min-w-0 grid-cols-3 items-center border border-border-control"
      data-testid="sheet-workbench-tabs"
      role="tablist"
    >
      {SHEET_WORKBENCH_MODES.map((candidate, index) => {
        const isActive = index === activeIndex
        const tabId = `sheet-workbench-tab-${candidate}`
        const panelId = `sheet-workbench-panel-${candidate}`
        return (
          <button
            aria-controls={panelId}
            aria-selected={isActive}
            className={cn(
              'inline-flex min-w-0 items-center justify-center border-r border-border-control px-2 font-semibold transition-colors duration-150 last:border-r-0 disabled:cursor-not-allowed disabled:opacity-60',
              'h-[32px] text-[11px]',
              isActive
                ? 'bg-brand-700 text-white hover:bg-ink-950'
                : 'bg-surface text-ink-950 hover:bg-brand-100',
            )}
            disabled={disabled}
            id={tabId}
            key={candidate}
            onClick={() => selectMode(index)}
            onKeyDown={(event) => {
              const nextIndex = resolveWorkbenchRovingIndex(
                event.key,
                index,
                SHEET_WORKBENCH_MODES.length,
              )
              if (nextIndex === null) return
              event.preventDefault()
              selectMode(nextIndex)
            }}
            ref={(button) => {
              buttonsRef.current[index] = button
            }}
            role="tab"
            tabIndex={isActive ? 0 : -1}
            type="button"
          >
            {SHEET_WORKBENCH_MODE_LABELS[candidate]}
            {candidate === 'validation' && validationIssueCount > 0 ? (
              <Badge
                aria-label={`검증 이슈 ${validationIssueCount}건`}
                className="ml-1.5 min-w-5 justify-center px-1.5 py-0 text-[10px] leading-4"
                data-testid="sheet-workbench-validation-count"
                tone="neutral"
              >
                {validationIssueCount}
              </Badge>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
