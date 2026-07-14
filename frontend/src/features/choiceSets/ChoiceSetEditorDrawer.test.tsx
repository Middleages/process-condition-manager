import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { ChoiceSetSummaryOut } from '@/api/types'

import {
  buildChoiceSetEditorSubmission,
  choiceSetEditorReducer,
  ChoiceSetEditorDrawerView,
  startChoiceSetEditorSession,
  submitChoiceSetEditorSession,
} from './ChoiceSetEditorDrawer'

const summary = makeSummary(7)
const latest = makeSummary(8, '다른 관리자의 이름')

describe('ChoiceSetEditorDrawer', () => {
  it('captures the base version and serializes that exact expected_version', () => {
    let session = startChoiceSetEditorSession({ kind: 'edit', summary })
    session = choiceSetEditorReducer(session, {
      type: 'change-field',
      field: 'displayName',
      value: '내 초안 이름',
    })

    expect(buildChoiceSetEditorSubmission(session)).toEqual({
      kind: 'patch',
      setCode: 'equipment_mode',
      payload: {
        expected_version: 7,
        display_name: '내 초안 이름',
        description: '설명',
        is_active: true,
      },
    })
  })

  it('preserves every field, validation message, open state, and base on 409', () => {
    let session = startChoiceSetEditorSession({ kind: 'edit', summary })
    session = choiceSetEditorReducer(session, {
      type: 'change-field',
      field: 'displayName',
      value: '내 초안 이름',
    })
    session = choiceSetEditorReducer(session, {
      type: 'validation',
      message: '표시명을 확인해 주세요.',
    })
    session = choiceSetEditorReducer(session, { type: 'conflict', latest })

    expect(session).toMatchObject({
      open: true,
      baseVersion: 7,
      draft: {
        code: 'equipment_mode',
        displayName: '내 초안 이름',
        description: '설명',
        isActive: true,
      },
      validationMessage: '표시명을 확인해 주세요.',
      conflict: latest,
    })
  })

  it('only hydrates after explicit reload and retries once with the new version', () => {
    let session = startChoiceSetEditorSession({ kind: 'edit', summary })
    session = choiceSetEditorReducer(session, {
      type: 'change-field',
      field: 'displayName',
      value: '보존할 초안',
    })
    session = choiceSetEditorReducer(session, { type: 'conflict', latest })
    session = choiceSetEditorReducer(session, { type: 'reload-latest' })
    const mutate = vi.fn()

    expect(session.baseVersion).toBe(8)
    expect(session.draft.displayName).toBe('다른 관리자의 이름')
    expect(session.touched.size).toBe(0)
    expect(submitChoiceSetEditorSession(session, mutate)).toBe(true)
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ expected_version: 8 }),
      }),
    )
  })

  it.each(['A/B', 'A%2FB', 'A B', '선택', '.', '..']) (
    'rejects invalid create code %s before invoking a mutation',
    (code) => {
      let session = startChoiceSetEditorSession({ kind: 'create' })
      session = choiceSetEditorReducer(session, {
        type: 'change-field',
        field: 'code',
        value: code,
      })
      session = choiceSetEditorReducer(session, {
        type: 'change-field',
        field: 'displayName',
        value: '표시명',
      })
      const mutate = vi.fn()

      expect(buildChoiceSetEditorSubmission(session)).toBeNull()
      expect(submitChoiceSetEditorSession(session, mutate)).toBe(false)
      expect(mutate).not.toHaveBeenCalled()
    },
  )

  it('enforces the set-code transport maximum before mutation', () => {
    let session = startChoiceSetEditorSession({ kind: 'create' })
    session = choiceSetEditorReducer(session, {
      type: 'change-field',
      field: 'code',
      value: 'A'.repeat(65),
    })
    session = choiceSetEditorReducer(session, {
      type: 'change-field',
      field: 'displayName',
      value: '표시명',
    })
    const mutate = vi.fn()

    expect(submitChoiceSetEditorSession(session, mutate)).toBe(false)
    expect(mutate).not.toHaveBeenCalled()
  })

  it('renders immutable code, pending controls, and explicit conflict recovery', () => {
    let session = startChoiceSetEditorSession({ kind: 'edit', summary })
    session = choiceSetEditorReducer(session, { type: 'conflict', latest })
    const html = renderToStaticMarkup(
      <ChoiceSetEditorDrawerView
        session={session}
        pending
        fallbackFocusRef={{ current: null }}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onReload={vi.fn()}
        onSubmit={vi.fn()}
      />,
    )

    expect(html).toContain('<dialog')
    expect(html).toContain('value="equipment_mode"')
    expect(html).toMatch(/<input[^>]*(readonly|disabled)[^>]*value="equipment_mode"/)
    expect(html).toContain('다른 관리자가 버전 8로 변경했습니다')
    expect(html).toContain('초안은 그대로 유지됩니다')
    expect(html).toContain('최신 버전 불러오기')
    expect(html).toContain('다시 저장')
    expect((html.match(/disabled=""/g) ?? []).length).toBeGreaterThan(1)
  })

  it('shows the shared inline URL-safe explanation for an invalid create draft', () => {
    let session = startChoiceSetEditorSession({ kind: 'create' })
    session = choiceSetEditorReducer(session, {
      type: 'change-field',
      field: 'code',
      value: 'A/B',
    })
    const html = renderToStaticMarkup(
      <ChoiceSetEditorDrawerView
        session={session}
        pending={false}
        fallbackFocusRef={{ current: null }}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onReload={vi.fn()}
        onSubmit={vi.fn()}
      />,
    )

    expect(html).toContain('URL-safe')
    expect(html).toContain('aria-invalid="true"')
  })

  it('returns focus to the captured opener and uses the heading only as fallback', () => {
    const fallbackFocusRef = { current: null }
    const element = ChoiceSetEditorDrawerView({
      session: startChoiceSetEditorSession({ kind: 'edit', summary }),
      pending: false,
      fallbackFocusRef,
      onChange: vi.fn(),
      onClose: vi.fn(),
      onReload: vi.fn(),
      onSubmit: vi.fn(),
    })

    expect(element.props.fallbackFocusRef).toBe(fallbackFocusRef)
    expect(element.props).not.toHaveProperty('returnFocusRef')
  })
})

function makeSummary(version: number, displayName = '설비 모드'): ChoiceSetSummaryOut {
  return {
    code: 'equipment_mode',
    display_name: displayName,
    description: '설명',
    is_active: true,
    version,
    option_count: 3,
    active_option_count: 2,
    parameter_usage_count: 4,
    profile_usage_fields: ['device_type_code'],
    created_at: '2026-07-14T00:00:00Z',
    updated_at: '2026-07-14T00:00:00Z',
  }
}
