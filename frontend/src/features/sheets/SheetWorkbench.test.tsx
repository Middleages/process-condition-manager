import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import {
  SheetWorkbenchNavigation,
  SHEET_WORKBENCH_MODES,
} from './SheetWorkbenchNavigation'
import {
  SheetWorkbenchPanel,
  SheetWorkbenchToggle,
} from './SheetWorkbench'
import { resolveWorkbenchRovingIndex } from './sheetWorkbenchNavigation'

describe('sheet workbench host and navigation', () => {
  it('moves roving focus across the compact mode tabs with wraparound home/end support', () => {
    expect(resolveWorkbenchRovingIndex('ArrowRight', 0, SHEET_WORKBENCH_MODES.length)).toBe(1)
    expect(resolveWorkbenchRovingIndex('ArrowLeft', 0, SHEET_WORKBENCH_MODES.length)).toBe(2)
    expect(resolveWorkbenchRovingIndex('Home', 2, SHEET_WORKBENCH_MODES.length)).toBe(0)
    expect(resolveWorkbenchRovingIndex('End', 0, SHEET_WORKBENCH_MODES.length)).toBe(2)
    expect(resolveWorkbenchRovingIndex('Escape', 1, SHEET_WORKBENCH_MODES.length)).toBeNull()
  })

  it('renders a three-tab mode list with unique tabpanel wiring', () => {
    const html = renderToStaticMarkup(
      <SheetWorkbenchNavigation mode="history" onModeChange={() => undefined} />,
    )

    expect(html).toContain('role="tablist"')
    expect(html).toContain('aria-label="증거 패널 모드"')
    expect(html).toContain('id="sheet-workbench-tab-validation"')
    expect(html).toContain('aria-controls="sheet-workbench-panel-validation"')
    expect(html).toContain('id="sheet-workbench-tab-history"')
    expect(html).toContain('aria-controls="sheet-workbench-panel-history"')
    expect(html).toContain('id="sheet-workbench-tab-backbone-diff"')
    expect(html).toContain('aria-controls="sheet-workbench-panel-backbone-diff"')
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('tabindex="-1"')
  })

  it('shows a passive validation issue badge without changing the active history mode', () => {
    const onModeChange = vi.fn()
    const html = renderToStaticMarkup(
      <SheetWorkbenchNavigation
        mode="history"
        onModeChange={onModeChange}
        validationIssueCount={3}
      />,
    )

    expect(html).toContain('data-testid="sheet-workbench-validation-count"')
    expect(html).toContain('aria-label="검증 이슈 3건"')
    expect(html).toContain('>3</span>')
    expect(html.match(/<button[^>]*id="sheet-workbench-tab-validation"[^>]*>/)?.[0]).toContain(
      'aria-selected="false"',
    )
    expect(html.match(/<button[^>]*id="sheet-workbench-tab-history"[^>]*>/)?.[0]).toContain(
      'aria-selected="true"',
    )
    expect(onModeChange).not.toHaveBeenCalled()
  })

  it('renders the compact 워크벤치 toggle with a truthful expanded state', () => {
    const collapsed = renderToStaticMarkup(
      <SheetWorkbenchToggle expanded={false} onToggle={() => undefined} />,
    )
    const expanded = renderToStaticMarkup(
      <SheetWorkbenchToggle expanded={true} onToggle={() => undefined} />,
    )

    expect(collapsed).toContain('data-testid="sheet-workbench-toggle"')
    expect(collapsed).toContain('aria-expanded="false"')
    expect(collapsed).toContain('bg-surface')
    expect(collapsed).toContain('워크벤치')
    expect(expanded).toContain('aria-expanded="true"')
    expect(expanded).toContain('bg-brand-700')
  })

  it('keeps inspector width and tabpanel ownership outside validation content', () => {
    const html = renderToStaticMarkup(
      <SheetWorkbenchPanel
        mode="history"
        inspectorWidth={380}
        onModeChange={() => undefined}
        onResizeBy={() => undefined}
        onSetWidth={() => undefined}
        validationContent={<div>validation content</div>}
        historyContent={<div>history content</div>}
        backboneDiffContent={<div>backbone diff content</div>}
      />,
    )

    expect(html).toContain('data-sheet-evidence-panel')
    expect(html).toContain('aria-label="증거 패널"')
    expect(html).toContain('role="separator"')
    expect(html).toContain('aria-orientation="vertical"')
    expect(html).toContain('aria-valuemin="320"')
    expect(html).toContain('aria-valuemax="520"')
    expect(html).toContain('aria-valuenow="380"')
    expect(html).toContain('id="sheet-workbench-panel-validation"')
    expect(html).toContain('id="sheet-workbench-panel-history"')
    expect(html).toContain('history content')
    expect(html).toContain('id="sheet-workbench-panel-backbone-diff"')
    expect(html).toContain('hidden=""')
    expect(html).not.toContain('validation content')
    expect(html).not.toContain('backbone diff content')
  })
})
