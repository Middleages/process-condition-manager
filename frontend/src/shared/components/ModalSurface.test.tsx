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

  it('restores focus only once after a completed open cycle', async () => {
    type Effect = () => void | (() => void)

    class FakeElement {
      isConnected = true
      focus = vi.fn()
    }

    class FakeDialog extends FakeElement {
      open = false
      showModal = vi.fn(() => {
        this.open = true
      })
      close = vi.fn(() => {
        this.open = false
      })
    }

    const effects: Effect[] = []
    const dialog = new FakeDialog()
    const title = new FakeElement()
    const trigger = new FakeElement()
    const fallback = new FakeElement()
    const refs: Array<{ current: unknown }> = Array.from({ length: 4 }, () => ({ current: undefined }))
    let refIndex = 0

    vi.resetModules()
    vi.stubGlobal('HTMLElement', FakeElement)
    vi.stubGlobal('document', { activeElement: trigger, body: new FakeElement() })
    vi.doMock('react', async (importOriginal) => ({
      ...(await importOriginal<typeof import('react')>()),
      useEffect: (effect: Effect) => effects.push(effect),
      useId: () => 'modal-title',
      useRef: (initialValue: unknown) => {
        const index = refIndex++ % refs.length
        const ref = refs[index]
        if (refIndex <= refs.length && ref) ref.current = initialValue
        return ref
      },
    }))

    try {
      const { ModalSurface } = await import('./ModalSurface')
      const props = {
        title: '수명주기 검증',
        variant: 'dialog' as const,
        onRequestClose: vi.fn(),
        fallbackFocusRef: { current: fallback as unknown as HTMLElement },
        children: null,
      }

      ModalSurface({ ...props, open: false })
      if (refs[0]) refs[0].current = dialog
      if (refs[1]) refs[1].current = title
      const unmount = effects[1]?.()
      effects[0]?.()
      expect(fallback.focus).not.toHaveBeenCalled()

      ModalSurface({ ...props, open: true })
      effects[2]?.()
      expect(dialog.showModal).toHaveBeenCalledOnce()

      ModalSurface({ ...props, open: false })
      effects[4]?.()
      expect(trigger.focus).toHaveBeenCalledOnce()

      if (typeof unmount === 'function') unmount()
      expect(trigger.focus).toHaveBeenCalledOnce()
    } finally {
      vi.doUnmock('react')
      vi.unstubAllGlobals()
      vi.resetModules()
    }
  })
})
