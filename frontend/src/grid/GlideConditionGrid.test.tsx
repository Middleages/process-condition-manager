import { describe, expect, it } from 'vitest'

import {
  cellStatusMarkerFacts,
  cellStatusTooltip,
  cellStatusVisualPriority,
  currentGridSelectionForLayout,
  gridLayoutAuthority,
} from './GlideConditionGrid'
import source from './GlideConditionGrid.tsx?raw'

describe('composite cell status rendering priority', () => {
  it('renders validation error above warning, dirty, and comment without requiring exclusive state', () => {
    expect(
      cellStatusVisualPriority({
        conditionId: '1',
        parameterCode: 'amount',
        validation: { severity: 'error', count: 2, message: 'invalid' },
        dirty: true,
        commentCount: 3,
      }),
    ).toBe('error')
    expect(
      cellStatusVisualPriority({
        conditionId: '1',
        parameterCode: 'amount',
        validation: { severity: 'warning', count: 1, message: 'review' },
        dirty: true,
        commentCount: 3,
      }),
    ).toBe('warning')
  })

  it('renders dirty above comment and preserves comment-only fallback', () => {
    expect(
      cellStatusVisualPriority({
        conditionId: '1',
        parameterCode: 'amount',
        dirty: true,
        commentCount: 1,
      }),
    ).toBe('dirty')
    expect(
      cellStatusVisualPriority({
        conditionId: '1',
        parameterCode: 'amount',
        dirty: false,
        commentCount: 1,
      }),
    ).toBe('comment')
  })

  it('keeps dirty and comment markers independently perceivable under validation', () => {
    const status = {
      conditionId: '1',
      parameterCode: 'amount',
      validation: { severity: 'error' as const, count: 2, message: '입력 값을 확인해 주세요.' },
      dirty: true,
      commentCount: 3,
    }

    expect(cellStatusMarkerFacts(status)).toEqual({ dirty: true, comment: true })
    expect(cellStatusTooltip(status)).toBe(
      '오류 2건 · 입력 값을 확인해 주세요. · 저장되지 않은 변경 · 댓글 3개',
    )
  })

  it('makes scrollToCell scroll, select, and focus through Glide only inside the adapter', () => {
    const command = source.match(
      /scrollToCell\(conditionId, parameterCode\)[\s\S]*?(?=\n      scrollToColumn)/,
    )?.[0]
    expect(command).toMatch(/scrollTo\([\s\S]*?setSelectionState\(/)
    expect(command).not.toContain('gridRef.current?.focus()')
    expect(source).toMatch(
      /requestedFocusRef\.current = null\s+gridRef\.current\?\.focus\(\)/,
    )
    expect(source).toContain('gridSelection={effectiveGridSelection}')
    expect(source).toContain('onGridSelectionChange={handleGridSelectionChange}')
  })

  it('invalidates controlled selection when visible keys or row identity/order changes', () => {
    const columns = [{ key: 'amount' }, { key: 'equipment' }]
    const rows = [{ id: '11' }, { id: '12' }]
    const original = gridLayoutAuthority(columns, rows)

    expect(gridLayoutAuthority(columns, [{ id: '11' }, { id: '12' }])).toBe(original)
    expect(gridLayoutAuthority([{ key: 'equipment' }], rows)).not.toBe(original)
    expect(gridLayoutAuthority(columns, [...rows].reverse())).not.toBe(original)
    expect(
      currentGridSelectionForLayout(
        { layoutAuthority: original, selection: 'stale coordinate' },
        gridLayoutAuthority([{ key: 'equipment' }], rows),
        'empty selection',
      ),
    ).toBe('empty selection')
  })

  it('preserves selection across value-only row changes with stable row ids and visible keys', () => {
    const columns = [{ key: 'amount' }]
    const before = [{ id: '11', values: { amount: '7' } }]
    const dirty = [{ id: '11', values: { amount: '8' } }]
    const authority = gridLayoutAuthority(columns, before)

    expect(gridLayoutAuthority(columns, dirty)).toBe(authority)
    expect(
      currentGridSelectionForLayout(
        { layoutAuthority: authority, selection: 'selected cell' },
        authority,
        'empty selection',
      ),
    ).toBe('selected cell')
  })

  it('publishes navigation selection against the current layout authority after a category commit', () => {
    expect(source).toContain('layoutAuthority, selection: selectionForCell(target.col, target.row)')
    expect(source).toMatch(
      /selectionState\.layoutAuthority !== layoutAuthority[\s\S]*?setSelectionState\(\{[\s\S]*?layoutAuthority,[\s\S]*?selection: EMPTY_GRID_SELECTION/,
    )
  })
})
