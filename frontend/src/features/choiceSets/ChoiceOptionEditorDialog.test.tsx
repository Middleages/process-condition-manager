import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { ChoiceOptionOut, ChoiceSetSummaryOut } from '@/api/types'

import {
  buildChoiceOptionSubmission,
  choiceOptionEditorReducer,
  ChoiceOptionEditorDialogView,
  startChoiceOptionEditorSession,
  submitChoiceOptionEditorSession,
} from './ChoiceOptionEditorDialog'

const option: ChoiceOptionOut = {
  code: 'FOO',
  label: '기존 표시명',
  sort_order: 10,
  is_active: true,
}
const summary = makeSummary(4)
const latest = makeSummary(5)
const snapshot = {
  summary,
  aggregate: { set_code: summary.code, version: summary.version, items: [option] },
}

describe('ChoiceOptionEditorDialog', () => {
  it('captures and submits the exact base version for an option edit', () => {
    let session = startChoiceOptionEditorSession({ kind: 'edit', option }, summary)
    session = choiceOptionEditorReducer(session, {
      type: 'change-field',
      field: 'label',
      value: '내 표시명',
    })

    expect(buildChoiceOptionSubmission('equipment_mode', session, snapshot)).toEqual({
      kind: 'patch',
      setCode: 'equipment_mode',
      optionCode: 'FOO',
      payload: {
        expected_version: 4,
        label: '내 표시명',
        sort_order: 10,
        is_active: true,
      },
    })
  })

  it('preserves every typed field, open state, and validation on 409 until reload', () => {
    let session = startChoiceOptionEditorSession({ kind: 'edit', option }, summary)
    session = choiceOptionEditorReducer(session, {
      type: 'change-field',
      field: 'label',
      value: '충돌 뒤에도 남을 이름',
    })
    session = choiceOptionEditorReducer(session, {
      type: 'validation',
      message: '표시명을 확인해 주세요.',
    })
    session = choiceOptionEditorReducer(session, { type: 'conflict', latest })

    expect(session).toMatchObject({
      open: true,
      baseVersion: 4,
      draft: {
        code: 'FOO',
        label: '충돌 뒤에도 남을 이름',
        sortOrder: '10',
        isActive: true,
      },
      validationMessage: '표시명을 확인해 주세요.',
      conflict: latest,
    })

    session = choiceOptionEditorReducer(session, {
      type: 'reload-latest',
      latestSummary: latest,
      latestOption: { ...option, label: '다른 관리자의 표시명' },
    })
    const mutate = vi.fn()
    expect(session.baseVersion).toBe(5)
    expect(session.draft.label).toBe('다른 관리자의 표시명')
    expect(session.touched.size).toBe(0)
    const latestSnapshot = {
      summary: latest,
      aggregate: {
        set_code: latest.code,
        version: latest.version,
        items: [{ ...option, label: '다른 관리자의 표시명' }],
      },
    }
    expect(
      submitChoiceOptionEditorSession('equipment_mode', session, latestSnapshot, mutate),
    ).toBe(true)
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ expected_version: 5 }) }),
    )
  })

  it.each(['A/B', 'A%2FB', 'A B', '선택', '.', '..'])(
    'blocks invalid option code %s before the mutation seam',
    (code) => {
      let session = startChoiceOptionEditorSession({ kind: 'create' }, summary)
      session = choiceOptionEditorReducer(session, {
        type: 'change-field',
        field: 'code',
        value: code,
      })
      session = choiceOptionEditorReducer(session, {
        type: 'change-field',
        field: 'label',
        value: '표시명',
      })
      const mutate = vi.fn()

      expect(buildChoiceOptionSubmission('equipment_mode', session, snapshot)).toBeNull()
      expect(
        submitChoiceOptionEditorSession('equipment_mode', session, snapshot, mutate),
      ).toBe(false)
      expect(mutate).not.toHaveBeenCalled()
    },
  )

  it('enforces the option-code transport maximum before mutation', () => {
    let session = startChoiceOptionEditorSession({ kind: 'create' }, summary)
    session = choiceOptionEditorReducer(session, {
      type: 'change-field',
      field: 'code',
      value: 'A'.repeat(129),
    })
    session = choiceOptionEditorReducer(session, {
      type: 'change-field',
      field: 'label',
      value: '표시명',
    })
    const mutate = vi.fn()

    expect(
      submitChoiceOptionEditorSession('equipment_mode', session, snapshot, mutate),
    ).toBe(false)
    expect(mutate).not.toHaveBeenCalled()
  })

  it('never mutates from a summary/aggregate version mismatch', () => {
    let session = startChoiceOptionEditorSession({ kind: 'edit', option }, summary)
    session = choiceOptionEditorReducer(session, {
      type: 'change-field',
      field: 'label',
      value: '새 이름',
    })
    const mutate = vi.fn()
    const mismatched = {
      summary,
      aggregate: { set_code: summary.code, version: 8, items: [option] },
    }

    expect(buildChoiceOptionSubmission('equipment_mode', session, mismatched)).toBeNull()
    expect(
      submitChoiceOptionEditorSession('equipment_mode', session, mismatched, mutate),
    ).toBe(false)
    expect(mutate).not.toHaveBeenCalled()
  })

  it('shows case-only warning without disabling a valid create save', () => {
    let session = startChoiceOptionEditorSession({ kind: 'create' }, summary)
    session = choiceOptionEditorReducer(session, {
      type: 'change-field',
      field: 'code',
      value: 'foo',
    })
    session = choiceOptionEditorReducer(session, {
      type: 'change-field',
      field: 'label',
      value: '새 표시명',
    })
    const html = renderDialog(session, false, [option])

    expect(html).toContain('대소문자만 다른 코드가 이미 있습니다: FOO')
    expect(html).toContain('코드는 대소문자를 정확히 구분합니다')
    const saveButton = html.match(/<button[^>]*form="choice-option-editor-form"[^>]*>/)?.[0]
    expect(saveButton).toBeDefined()
    expect(saveButton).not.toContain(' disabled=""')
  })

  it('renders immutable code, pending controls, conflict summary, reload and retry', () => {
    let session = startChoiceOptionEditorSession({ kind: 'edit', option }, summary)
    session = choiceOptionEditorReducer(session, { type: 'conflict', latest })
    const html = renderDialog(session, true, [option])

    expect(html).toMatch(/<input[^>]*(readonly|disabled)[^>]*value="FOO"/)
    expect(html).toContain('다른 관리자가 버전 5로 변경했습니다')
    expect(html).toContain('초안은 그대로 유지됩니다')
    expect(html).toContain('최신 버전 불러오기')
    expect(html).toContain('다시 저장')
    expect((html.match(/disabled=""/g) ?? []).length).toBeGreaterThan(1)
  })

  it('requires blast-radius acknowledgement before deactivation', () => {
    const session = startChoiceOptionEditorSession(
      { kind: 'deactivate', option },
      summary,
    )
    const html = renderDialog(session, false, [option])

    expect(html).toContain('파라미터 4곳')
    expect(html).toContain('고정 Profile 필드')
    expect(html).toContain('device_type_code')
    expect(html).toContain('영향 범위를 확인했습니다')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*(?:<span[^>]*>)?사용 중지/)
  })

  it('returns focus to the captured opener and keeps the heading as fallback', () => {
    const fallbackFocusRef = { current: null }
    const element = ChoiceOptionEditorDialogView({
      aggregate: snapshot.aggregate,
      fallbackFocusRef,
      pending: false,
      session: startChoiceOptionEditorSession({ kind: 'edit', option }, summary),
      summary,
      onAcknowledge: vi.fn(),
      onChange: vi.fn(),
      onClose: vi.fn(),
      onReload: vi.fn(),
      onSubmit: vi.fn(),
    })

    expect(element.props.fallbackFocusRef).toBe(fallbackFocusRef)
    expect(element.props).not.toHaveProperty('returnFocusRef')
  })
})

function renderDialog(
  session: ReturnType<typeof startChoiceOptionEditorSession>,
  pending: boolean,
  options: ChoiceOptionOut[],
) {
  return renderToStaticMarkup(
    <ChoiceOptionEditorDialogView
      aggregate={{ set_code: summary.code, version: summary.version, items: options }}
      fallbackFocusRef={{ current: null }}
      pending={pending}
      session={session}
      summary={summary}
      onAcknowledge={vi.fn()}
      onChange={vi.fn()}
      onClose={vi.fn()}
      onReload={vi.fn()}
      onSubmit={vi.fn()}
    />,
  )
}

function makeSummary(version: number): ChoiceSetSummaryOut {
  return {
    code: 'equipment_mode',
    display_name: '설비 모드',
    description: null,
    is_active: true,
    version,
    option_count: 1,
    active_option_count: 1,
    parameter_usage_count: 4,
    profile_usage_fields: ['device_type_code', 'active_direction_code'],
    created_at: '2026-07-14T00:00:00Z',
    updated_at: '2026-07-14T00:00:00Z',
  }
}
