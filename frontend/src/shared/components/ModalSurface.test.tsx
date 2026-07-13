import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { Dialog, Drawer } from './ModalSurface'

describe('ModalSurface', () => {
  it('labels the modal drawer', () => {
    const html = renderToStaticMarkup(
      <Drawer open title="파라미터 수정" onRequestClose={vi.fn()}>
        <button type="button">저장</button>
      </Drawer>,
    )

    expect(html).toContain('<dialog')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('aria-labelledby=')
    expect(html).toContain('파라미터 수정')
  })

  it('renders dialog content and footer inside the labelled surface', () => {
    const html = renderToStaticMarkup(
      <Dialog
        open
        title="레이어 백본 교체"
        onRequestClose={vi.fn()}
        footer={<button type="button">교체 적용</button>}
      >
        <p>교체할 소스를 선택한다.</p>
      </Dialog>,
    )

    expect(html).toContain('레이어 백본 교체')
    expect(html).toContain('교체할 소스를 선택한다.')
    expect(html).toContain('교체 적용')
    expect(html).toContain('aria-label="닫기"')
  })
})
