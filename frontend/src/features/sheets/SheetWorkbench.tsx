import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { Button } from '@/shared/components/Button'
import { InlineAlert } from '@/shared/components/InlineAlert'

import {
  SHEET_INSPECTOR_MAX_WIDTH,
  SHEET_INSPECTOR_MIN_WIDTH,
  clampSheetInspectorWidth,
  readPersistedSheetInspectorWidth,
  writePersistedSheetInspectorWidth,
} from './sheetWorkbenchStorage'
import { SheetWorkbenchNavigation } from './SheetWorkbenchNavigation'

export type SheetWorkbenchMode = 'validation' | 'history' | 'backbone-diff' | null

export function useSheetWorkbenchState() {
  const [mode, setMode] = useState<SheetWorkbenchMode>(null)
  const [inspectorWidth, setInspectorWidthState] = useState(readPersistedSheetInspectorWidth)
  const lastModeRef = useRef<Exclude<SheetWorkbenchMode, null>>('validation')

  useEffect(() => {
    writePersistedSheetInspectorWidth(inspectorWidth)
  }, [inspectorWidth])

  const open = useCallback(() => setMode(lastModeRef.current), [])
  const close = useCallback(() => setMode(null), [])
  const toggle = useCallback(
    () =>
      setMode((current) => {
        if (current === null) return lastModeRef.current
        lastModeRef.current = current
        return null
      }),
    [],
  )
  const selectMode = useCallback((next: Exclude<SheetWorkbenchMode, null>) => {
    lastModeRef.current = next
    setMode(next)
  }, [])
  const resizeBy = useCallback((delta: -1 | 1) => {
    setInspectorWidthState((width) => clampSheetInspectorWidth(width + delta * 16))
  }, [])
  const setInspectorWidth = useCallback((width: number) => {
    setInspectorWidthState(clampSheetInspectorWidth(width))
  }, [])

  return {
    mode,
    open,
    close,
    toggle,
    selectMode,
    resizeBy,
    setInspectorWidth,
    inspectorWidth,
  }
}

export function SheetWorkbenchToggle({
  expanded,
  onToggle,
  disabled = false,
}: {
  expanded: boolean
  onToggle: () => void
  disabled?: boolean
}) {
  return (
    <Button
      aria-expanded={expanded}
      className="shrink-0"
      data-testid="sheet-workbench-toggle"
      disabled={disabled}
      onClick={onToggle}
      size="compact"
      type="button"
      variant={expanded ? 'primary' : 'secondary'}
    >
      워크벤치
    </Button>
  )
}

export function SheetWorkbenchPanel({
  mode,
  inspectorWidth,
  onModeChange,
  onResizeBy,
  onSetWidth,
  validationIssueCount = 0,
  validationContent,
  historyContent,
  backboneDiffContent,
}: {
  mode: Exclude<SheetWorkbenchMode, null>
  inspectorWidth: number
  onModeChange: (mode: Exclude<SheetWorkbenchMode, null>) => void
  onResizeBy: (delta: -1 | 1) => void
  onSetWidth: (width: number) => void
  validationIssueCount?: number
  validationContent: ReactNode
  historyContent?: ReactNode
  backboneDiffContent?: ReactNode
}) {
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startWidth: number
  } | null>(null)

  function beginResize(event: React.PointerEvent<HTMLDivElement>): void {
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: inspectorWidth,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function continueResize(event: React.PointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    onSetWidth(drag.startWidth + drag.startX - event.clientX)
  }

  function finishResize(event: React.PointerEvent<HTMLDivElement>): void {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  function resizeWithKeyboard(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    onResizeBy(event.key === 'ArrowLeft' ? 1 : -1)
  }

  return (
    <section
      aria-label="증거 패널"
      className="relative flex h-full min-h-0 flex-col overflow-hidden border-l border-border-subtle bg-surface"
      data-sheet-evidence-panel
      style={{ width: inspectorWidth }}
    >
      <div
        aria-label="증거 패널 너비 조절"
        aria-orientation="vertical"
        aria-valuemax={SHEET_INSPECTOR_MAX_WIDTH}
        aria-valuemin={SHEET_INSPECTOR_MIN_WIDTH}
        aria-valuenow={inspectorWidth}
        className="absolute inset-y-0 left-0 z-10 w-1 cursor-col-resize bg-transparent hover:bg-brand-500 focus-visible:bg-brand-500"
        onKeyDown={resizeWithKeyboard}
        onPointerCancel={finishResize}
        onPointerDown={beginResize}
        onPointerMove={continueResize}
        onPointerUp={finishResize}
        role="separator"
        tabIndex={0}
      />

      <div className="border-b border-border-subtle bg-canvas px-2 py-2">
        <SheetWorkbenchNavigation
          mode={mode}
          onModeChange={onModeChange}
          validationIssueCount={validationIssueCount}
        />
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-hidden bg-canvas p-2">
        <WorkbenchTabPanel
          active={mode === 'validation'}
          id="sheet-workbench-panel-validation"
          labelledBy="sheet-workbench-tab-validation"
        >
          {validationContent}
        </WorkbenchTabPanel>
        <WorkbenchTabPanel
          active={mode === 'history'}
          id="sheet-workbench-panel-history"
          labelledBy="sheet-workbench-tab-history"
        >
          {historyContent ?? <WorkbenchPlaceholder title="이력 워크벤치" />}
        </WorkbenchTabPanel>
        <WorkbenchTabPanel
          active={mode === 'backbone-diff'}
          id="sheet-workbench-panel-backbone-diff"
          labelledBy="sheet-workbench-tab-backbone-diff"
        >
          {backboneDiffContent ?? <WorkbenchPlaceholder title="백본 비교 워크벤치" />}
        </WorkbenchTabPanel>
      </div>
    </section>
  )
}

function WorkbenchTabPanel({
  active,
  id,
  labelledBy,
  children,
}: {
  active: boolean
  id: string
  labelledBy: string
  children: ReactNode
}) {
  return (
    <section
      aria-labelledby={labelledBy}
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-border-subtle bg-surface"
      hidden={!active}
      id={id}
      role="tabpanel"
      aria-hidden={!active}
    >
      {active ? (
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-2">
          {children}
        </div>
      ) : null}
    </section>
  )
}

function WorkbenchPlaceholder({ title }: { title: string }) {
  return (
    <InlineAlert tone="info">
      <div className="flex flex-wrap items-center gap-2">
        <strong>{title}</strong>
        <span>준비 중입니다.</span>
      </div>
    </InlineAlert>
  )
}
