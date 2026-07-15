import type { ReactNode } from 'react'

export interface SheetFocusFrameProps {
  header: ReactNode
  controls: ReactNode
  children: ReactNode
  workbench?: ReactNode
}

/**
 * Viewport geometry for the Focus Shell.
 *
 * The future workbench is content-gated: an absent value emits no host element and
 * therefore reserves no height. The grid row is the only flexible row.
 */
export function SheetFocusFrame({
  header,
  controls,
  children,
  workbench,
}: SheetFocusFrameProps) {
  return (
    <div
      className="grid h-full min-h-0 min-w-0 grid-rows-[40px_auto_minmax(0,1fr)_auto] overflow-hidden"
      data-sheet-focus-frame
    >
      {header}
      <div className="min-w-0" data-sheet-controls>
        {controls}
      </div>
      <div
        className="min-h-0 min-w-0 overflow-hidden"
        data-sheet-grid-host
      >
        {children}
      </div>
      {workbench != null ? (
        <div className="min-h-0 min-w-0 overflow-hidden" data-sheet-workbench>
          {workbench}
        </div>
      ) : null}
    </div>
  )
}
