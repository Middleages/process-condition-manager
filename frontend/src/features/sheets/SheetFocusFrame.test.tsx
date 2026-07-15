import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { SheetFocusFrame } from './SheetFocusFrame'

describe('SheetFocusFrame', () => {
  it('emits no workbench DOM or reserved content when workbench is absent', () => {
    const html = renderToStaticMarkup(
      <SheetFocusFrame header={<div>header</div>} controls={<div>controls</div>}>
        <div>grid</div>
      </SheetFocusFrame>,
    )

    expect(html).not.toContain('data-sheet-workbench')
    expect(html).not.toContain('validation')
    expect(html).toContain('grid')
  })

  it('owns the full-height minmax geometry without allowing the grid host to overflow', () => {
    const html = renderToStaticMarkup(
      <SheetFocusFrame
        header={<div>header</div>}
        controls={<div>controls</div>}
        workbench={<div>future workbench</div>}
      >
        <div>grid</div>
      </SheetFocusFrame>,
    )

    expect(html).toContain('h-full min-h-0 min-w-0')
    expect(html).toContain('grid-rows-[40px_auto_minmax(0,1fr)_auto]')
    expect(html).toContain('data-sheet-grid-host="true"')
    expect(html).toContain('min-h-0 min-w-0 overflow-hidden')
    expect(html).toContain('data-sheet-workbench="true"')
    expect(html).toContain('future workbench')
  })
})
