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
  VALIDATION_WORKBENCH_DEFAULT_HEIGHT,
  VALIDATION_WORKBENCH_MAX_HEIGHT,
  VALIDATION_WORKBENCH_MIN_HEIGHT,
  VALIDATION_WORKBENCH_RESIZE_STEP,
  clampValidationWorkbenchHeight,
} from './validationWorkbenchState'
import { SheetWorkbenchNavigation } from './SheetWorkbenchNavigation'

export type SheetWorkbenchMode = 'validation' | 'history' | 'backbone-diff' | null

export function useSheetWorkbenchState(visible: boolean) {
  const [mode, setMode] = useState<SheetWorkbenchMode>(null)
  const [panelHeight, setPanelHeight] = useState(() =>
    clampValidationWorkbenchHeight(VALIDATION_WORKBENCH_DEFAULT_HEIGHT),
  )
  const wasVisibleRef = useRef(false)
  const lastModeRef = useRef<Exclude<SheetWorkbenchMode, null>>('validation')

  useEffect(() => {
    if (visible && !wasVisibleRef.current && mode === null) {
      setMode('validation')
      lastModeRef.current = 'validation'
    }
    wasVisibleRef.current = visible
  }, [mode, visible])

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
    setPanelHeight((height) =>
      clampValidationWorkbenchHeight(height + delta * VALIDATION_WORKBENCH_RESIZE_STEP),
    )
  }, [])
  const setHeight = useCallback((height: number) => {
    setPanelHeight(clampValidationWorkbenchHeight(height))
  }, [])

  return {
    mode,
    open,
    close,
    toggle,
    selectMode,
    resizeBy,
    setHeight,
    panelHeight,
    visible: visible && mode !== null,
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
  panelHeight,
  onModeChange,
  onResizeBy,
  onSetHeight,
  validationContent,
  historyContent,
  backboneDiffContent,
}: {
  mode: Exclude<SheetWorkbenchMode, null>
  panelHeight: number
  onModeChange: (mode: Exclude<SheetWorkbenchMode, null>) => void
  onResizeBy: (delta: -1 | 1) => void
  onSetHeight: (height: number) => void
  validationContent: ReactNode
  historyContent?: ReactNode
  backboneDiffContent?: ReactNode
}) {
  const dragRef = useRef<{
    pointerId: number
    startY: number
    startHeight: number
  } | null>(null)

  function beginResize(event: React.PointerEvent<HTMLDivElement>): void {
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: panelHeight,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function continueResize(event: React.PointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    onSetHeight(drag.startHeight + drag.startY - event.clientY)
  }

  function finishResize(event: React.PointerEvent<HTMLDivElement>): void {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  function resizeWithKeyboard(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    onResizeBy(event.key === 'ArrowUp' ? 1 : -1)
  }

  return (
    <section
      aria-label="워크벤치"
      className="flex min-h-0 min-w-0 flex-col overflow-hidden border-t border-border-subtle bg-surface"
      data-sheet-workbench
      style={{ height: panelHeight }}
    >
      <div
        aria-label="워크벤치 높이 조절"
        aria-orientation="horizontal"
        aria-valuemax={VALIDATION_WORKBENCH_MAX_HEIGHT}
        aria-valuemin={VALIDATION_WORKBENCH_MIN_HEIGHT}
        aria-valuenow={panelHeight}
        className="h-2 shrink-0 cursor-row-resize bg-border-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-700"
        onKeyDown={resizeWithKeyboard}
        onPointerCancel={finishResize}
        onPointerDown={beginResize}
        onPointerMove={continueResize}
        onPointerUp={finishResize}
        role="separator"
        tabIndex={0}
      />

      <div className="border-b border-border-subtle bg-canvas px-3 py-2">
        <SheetWorkbenchNavigation mode={mode} onModeChange={onModeChange} />
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
