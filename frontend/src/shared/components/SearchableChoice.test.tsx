import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import {
  canCommitChoice,
  getChoiceRetryAction,
  SearchableChoice,
  settleChoiceRetry,
  type SearchableChoiceItem,
} from './SearchableChoice'

const options: SearchableChoiceItem[] = [
  { code: 'FOUNDRY', label: 'Foundry', is_active: true },
  { code: 'SPECIAL', label: 'Special customer', is_active: true },
  { code: 'OLD', label: 'Legacy', is_active: false },
]

function renderChoice(
  overrides: Partial<React.ComponentProps<typeof SearchableChoice>> = {},
): string {
  return renderToStaticMarkup(
    <SearchableChoice
      id="equipment-mode"
      label="Equipment mode"
      value="FOUNDRY"
      options={options}
      onChange={vi.fn()}
      {...overrides}
    />,
  )
}

describe('SearchableChoice SSR contract', () => {
  it('renders the complete combobox, listbox, option, and selected-value semantics', () => {
    const html = renderChoice({ openOnMount: true })

    expect(html).toContain('role="combobox"')
    expect(html).toContain('aria-autocomplete="list"')
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('aria-controls="equipment-mode-listbox"')
    expect(html).toContain('role="listbox"')
    expect(html).toContain('id="equipment-mode-listbox"')
    expect(html).toContain('id="equipment-mode-option-0"')
    expect(html).toContain('role="option"')
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('aria-posinset="1"')
    expect(html).toContain('aria-setsize="2"')
    expect(html).toContain('FOUNDRY · Foundry')
  })

  it('shows an inactive current value but excludes it from new default selections', () => {
    const html = renderChoice({ value: 'OLD', openOnMount: true })

    expect(html).toContain('OLD · Legacy')
    expect(html).toContain('사용 중지됨')
    expect(html).not.toContain('id="equipment-mode-option-2"')
  })

  it('preserves an unknown raw code and exposes error retry without blanking it', () => {
    const html = renderChoice({
      value: 'MISSING',
      error: '선택지를 불러오지 못했습니다.',
      onRetry: vi.fn(),
    })

    expect(html).toContain('MISSING')
    expect(html).toContain('선택지를 불러오지 못했습니다.')
    expect(html).toContain('다시 시도')
    expect(html).toContain('role="alert"')
    expect(html).not.toContain('사용 중지됨')
  })

  it('renders a labelled disabled empty state', () => {
    const html = renderChoice({ value: null, options: [], disabled: true, openOnMount: true })

    expect(html).toContain('<label')
    expect(html).toContain('disabled=""')
    expect(html).toContain('aria-disabled="true"')
    expect(html).toContain('선택 가능한 항목이 없습니다.')
    expect(html).not.toContain('검색 중')
    expect(html).not.toContain('열림')
  })

  it('uses open and refresh indicators only for their accurate states', () => {
    expect(renderChoice({ openOnMount: true })).toContain('열림')
    expect(renderChoice({ openOnMount: true })).not.toContain('검색 중')
    expect(renderChoice({ openOnMount: true, loading: true })).toContain('새로 고침 중')
  })

  it('aligns listbox disabled state with generation and inactive-selection policy', () => {
    expect(renderChoice({ openOnMount: true, loading: true })).toContain(
      'role="listbox" aria-busy="true" aria-disabled="true"',
    )
    expect(
      renderChoice({
        openOnMount: true,
        sourceActive: false,
        selectionReady: true,
        allowInactiveSelection: true,
      }),
    ).toContain('role="listbox" aria-label=')
  })

  it('maps unknown or inactive resources to display-only rows and fail-closed commits', () => {
    const item = options[0]!
    expect(
      canCommitChoice(item, {
        sourceActive: false,
        selectionReady: false,
        generationReady: true,
      }),
    ).toBe(false)
    expect(
      canCommitChoice(item, {
        sourceActive: true,
        selectionReady: true,
        generationReady: true,
      }),
    ).toBe(true)
    expect(
      canCommitChoice(options[2]!, {
        sourceActive: true,
        selectionReady: true,
        generationReady: true,
      }),
    ).toBe(false)
  })

  it('chooses one retry path so resource retry and mandatory open refresh cannot run twice', () => {
    expect(getChoiceRetryAction('summary unavailable', true, true)).toBe('prepare')
    expect(getChoiceRetryAction(null, true, true)).toBe('prepare')
    expect(getChoiceRetryAction(null, true, false)).toBe('prepare')
    expect(getChoiceRetryAction(null, false, false)).toBe('none')
  })

  it('consumes a rejected async retry callback instead of leaking an unhandled rejection', async () => {
    const retry = vi.fn(async () => {
      throw new Error('retry failed')
    })

    await expect(settleChoiceRetry(retry)).resolves.toBeUndefined()
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it.each([0, 250, 499])(
    'renders at most 60 rows while mounting active result %i',
    (selectedIndex) => {
      const many = Array.from({ length: 500 }, (_, index) => ({
        code: `CODE_${index}`,
        label: `Option ${index}`,
        is_active: true,
      }))
      const html = renderChoice({
        value: many[selectedIndex]!.code,
        options: many,
        openOnMount: true,
      })

      expect((html.match(/role="option"/g) ?? []).length).toBeLessThanOrEqual(60)
      expect(html).toContain(`id="equipment-mode-option-${selectedIndex}"`)
      expect(html).toContain(`aria-activedescendant="equipment-mode-option-${selectedIndex}"`)
    },
  )
})
