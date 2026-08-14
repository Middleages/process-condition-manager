import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import type { Theme } from '@glideapps/glide-data-grid'

import {
  commitDecimalDraft,
  type DecimalCell,
  DecimalEditor,
  makeDecimalCell,
  validateDecimalDraft,
} from './decimalCell'
import decimalCellSource from './decimalCell.tsx?raw'
import glideSource from './GlideConditionGrid.tsx?raw'

describe('decimalCell', () => {
  it('keeps cell data and copyData as canonical strings', () => {
    const cell = makeDecimalCell('12345678901234567890.0001', 'nm', false)
    expect(cell.data.value).toBe('12345678901234567890.0001')
    expect(cell.copyData).toBe('12345678901234567890.0001')
    expect(typeof cell.data.value).toBe('string')
  })

  it.each([
    ['.5', '0.5'],
    ['001.5000', '1.5'],
    ['', null],
  ])('commits %s as the canonical string %s', (draft, expected) => {
    const commit = vi.fn()
    expect(commitDecimalDraft(draft, commit)).toEqual({ ok: true, value: expected })
    expect(commit).toHaveBeenCalledWith(expected)
  })

  it.each(['1e3', '1,000', '9'.repeat(129)])(
    'keeps invalid draft %s in validation state without committing',
    (draft) => {
      const commit = vi.fn()
      expect(commitDecimalDraft(draft, commit)).toEqual(
        expect.objectContaining({ ok: false, code: 'invalid_decimal' }),
      )
      expect(validateDecimalDraft(draft)).toEqual(
        expect.objectContaining({ ok: false, message: expect.any(String) }),
      )
      expect(commit).not.toHaveBeenCalled()
    },
  )

  it('is the only numeric Glide path and delegates commit validation to the shared validator', () => {
    expect(glideSource).toContain('makeDecimalCell')
    expect(glideSource).toContain('validateSingleCellEdit')
    expect(glideSource).toContain('shouldPersistCellChange(oldValue, validation.value)')
    expect(decimalCellSource).toContain('event.stopPropagation()')
    expect(glideSource).not.toContain('GridCellKind.Number')
    expect(glideSource).not.toMatch(/Number\(trimmed\)/)
  })

  it('sends a rejected raw Enter candidate to the Grid boundary while Escape cancels', () => {
    const enterFinished = vi.fn()
    const enterEditor = renderDecimalEditor('abc', enterFinished)
    try {
      const input = enterEditor.container.querySelector('input')
      expect(input).not.toBeNull()
      act(() => {
        input?.dispatchEvent(new enterEditor.window.KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
        }))
      })

      expect(enterFinished).toHaveBeenCalledTimes(1)
      expect(enterFinished.mock.calls[0]?.[0]).toMatchObject({
        copyData: 'abc',
        data: { kind: 'decimal-cell', value: 'abc' },
      })
    } finally {
      enterEditor.cleanup()
    }

    const escapeFinished = vi.fn()
    const escapeEditor = renderDecimalEditor('abc', escapeFinished)
    try {
      const input = escapeEditor.container.querySelector('input')
      act(() => {
        input?.dispatchEvent(new escapeEditor.window.KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
        }))
      })
      expect(escapeFinished).toHaveBeenCalledWith(undefined)
    } finally {
      escapeEditor.cleanup()
    }
  })

  it('sends an exact parseable raw candidate to the authoritative Grid validator', () => {
    const finished = vi.fn()
    const editor = renderDecimalEditor('00501.0', finished)
    try {
      const input = editor.container.querySelector('input')
      act(() => {
        input?.dispatchEvent(new editor.window.KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
        }))
      })

      expect(finished).toHaveBeenCalledWith(expect.objectContaining({
        copyData: '00501.0',
        data: expect.objectContaining({ kind: 'decimal-cell', value: '00501.0' }),
      }))
    } finally {
      editor.cleanup()
    }
  })
})

function renderDecimalEditor(
  initialValue: string,
  onFinishedEditing: (
    newValue?: DecimalCell,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
  ) => void,
) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const container = dom.window.document.querySelector<HTMLDivElement>('#root')
  if (container === null) throw new Error('Decimal editor root is unavailable.')
  const globals = globalThis as unknown as {
    document?: Document
    HTMLElement?: typeof HTMLElement
    Node?: typeof Node
    window?: Window
    IS_REACT_ACT_ENVIRONMENT?: boolean
  }
  const previous = {
    document: globals.document,
    HTMLElement: globals.HTMLElement,
    Node: globals.Node,
    window: globals.window,
    IS_REACT_ACT_ENVIRONMENT: globals.IS_REACT_ACT_ENVIRONMENT,
  }
  let root: Root | null = null
  globals.window = dom.window as unknown as Window
  globals.document = dom.window.document
  globals.HTMLElement = dom.window.HTMLElement as unknown as typeof HTMLElement
  globals.Node = dom.window.Node as unknown as typeof Node
  globals.IS_REACT_ACT_ENVIRONMENT = true
  Object.defineProperties(dom.window.HTMLElement.prototype, {
    attachEvent: { configurable: true, value: vi.fn() },
    detachEvent: { configurable: true, value: vi.fn() },
  })
  act(() => {
    root = createRoot(container)
    root.render(
      <DecimalEditor
        forceEditMode
        isHighlighted={false}
        onChange={vi.fn()}
        onFinishedEditing={onFinishedEditing}
        target={{ x: 0, y: 0, width: 120, height: 32 }}
        theme={{} as Theme}
        value={makeDecimalCell(null, 'kPa', false)}
        initialValue={initialValue}
      />,
    )
  })

  return {
    container,
    window: dom.window,
    cleanup: () => {
      act(() => root?.unmount())
      globals.window = previous.window
      globals.document = previous.document
      globals.HTMLElement = previous.HTMLElement
      globals.Node = previous.Node
      globals.IS_REACT_ACT_ENVIRONMENT = previous.IS_REACT_ACT_ENVIRONMENT
      dom.window.close()
    },
  }
}
