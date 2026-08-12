import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { SheetFocusFrame } from './SheetFocusFrame'

describe('SheetFocusFrame', () => {
  it('emits no inspector DOM or reserved content when inspector is absent', () => {
    const html = renderToStaticMarkup(
      <SheetFocusFrame header={<div>header</div>} controls={<div>controls</div>}>
        <div>grid</div>
      </SheetFocusFrame>,
    )

    expect(html).not.toContain('data-sheet-evidence-inspector')
    expect(html).not.toContain('validation')
    expect(html).toContain('grid')
  })

  it('owns a horizontal navigator, grid, and inspector work row without a bottom rail', () => {
    const html = renderToStaticMarkup(
      <SheetFocusFrame
        header={<div>header</div>}
        controls={<div>controls</div>}
        navigator={<div>layer navigator</div>}
        inspector={<div>evidence inspector</div>}
      >
        <div>grid</div>
      </SheetFocusFrame>,
    )

    expect(html).toContain('h-full min-h-0 min-w-0')
    expect(html).toContain('grid-rows-[40px_auto_minmax(0,1fr)]')
    expect(html).toContain('data-sheet-work-row="true"')
    expect(html).toContain('data-sheet-layer-navigator="true"')
    expect(html).toContain('data-sheet-grid-host="true"')
    expect(html).toContain('min-h-0 min-w-0 overflow-hidden')
    expect(html).toContain('data-sheet-evidence-inspector="true"')
    expect(html).not.toContain('data-sheet-workbench')
    expect(html).toContain('layer navigator')
    expect(html).toContain('evidence inspector')
  })
})
