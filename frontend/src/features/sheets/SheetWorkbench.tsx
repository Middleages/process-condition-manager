import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/shared/components/Button'

export type SheetWorkbenchMode = 'validation' | null

export function shouldAutoOpenSheetWorkbench({
  visible,
  wasVisible,
  mode,
}: {
  visible: boolean
  wasVisible: boolean
  mode: SheetWorkbenchMode
}): boolean {
  return visible && !wasVisible && mode === null
}

export function useSheetWorkbenchMode(visible: boolean) {
  const [mode, setMode] = useState<SheetWorkbenchMode>(null)
  const wasVisibleRef = useRef(false)

  useEffect(() => {
    if (shouldAutoOpenSheetWorkbench({ visible, wasVisible: wasVisibleRef.current, mode })) {
      setMode('validation')
    }
    wasVisibleRef.current = visible
  }, [mode, visible])

  const open = useCallback(() => setMode('validation'), [])
  const close = useCallback(() => setMode(null), [])
  const toggle = useCallback(
    () => setMode((current) => (current === null ? 'validation' : null)),
    [],
  )

  return {
    mode,
    open,
    close,
    toggle,
    visible: mode === 'validation' && visible,
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
      {expanded ? '워크벤치 닫기' : '워크벤치 열기'}
    </Button>
  )
}
