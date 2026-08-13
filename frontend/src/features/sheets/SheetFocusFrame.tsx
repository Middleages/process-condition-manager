import type { ReactNode } from 'react'

export interface SheetFocusFrameProps {
  header: ReactNode
  controls: ReactNode
  children: ReactNode
  navigator?: ReactNode
  inspector?: ReactNode
  /** @deprecated Pass the content as `inspector` instead. */
  workbench?: ReactNode
}

/**
 * Viewport geometry for the Focus Shell.
 *
 * The Drafting Table keeps navigation, grid, and evidence in one horizontal work
 * row. Optional side regions emit no host element and therefore reserve no width.
 */
export function SheetFocusFrame({
  header,
  controls,
  children,
  navigator,
  inspector,
  workbench,
}: SheetFocusFrameProps) {
  const evidence = inspector ?? workbench

  return (
    <div
      className="grid h-full min-h-0 min-w-0 grid-rows-[40px_auto_minmax(0,1fr)] overflow-hidden"
      data-sheet-focus-frame
    >
      {header}
      <div className="min-w-0" data-sheet-controls>
        {controls}
      </div>
      <div className="flex min-h-0 min-w-0 overflow-hidden" data-sheet-work-row>
        {navigator != null ? (
          <aside className="min-h-0 shrink-0 overflow-hidden" data-sheet-layer-navigator>
            {navigator}
          </aside>
        ) : null}
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden" data-sheet-grid-host>
          {children}
        </div>
        {evidence != null ? (
          <aside className="min-h-0 shrink-0 overflow-hidden" data-sheet-evidence-inspector>
            {evidence}
          </aside>
        ) : null}
      </div>
    </div>
  )
}
