import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { ChoiceImportPreviewOut, ChoiceSetSummaryOut } from '@/api/types'

import {
  buildChoiceImportApplyPayload,
  beginChoiceImportPreview,
  choiceImportReducer,
  ChoiceImportDialogView,
  startChoiceImportSession,
  settleChoiceImportPreview,
} from './ChoiceImportDialog'

const validPreview: ChoiceImportPreviewOut = {
  set_code: 'equipment_mode',
  base_version: 3,
  created_count: 1,
  updated_count: 1,
  error_count: 0,
  rows: [
    { line: 2, code: 'AUTO', action: 'create', message: null },
    { line: 3, code: 'MANUAL', action: 'update', message: null },
  ],
}

describe('ChoiceImportDialog', () => {
  it('fingerprints preview by exact raw CSV and base version for atomic apply', () => {
    let session = startChoiceImportSession()
    session = choiceImportReducer(session, {
      type: 'change-csv',
      csvText: 'AUTO,자동,10,true',
    })
    session = choiceImportReducer(session, {
      type: 'preview-success',
      baseVersion: 3,
      response: validPreview,
    })

    expect(buildChoiceImportApplyPayload(session, 3)).toEqual({
      expected_version: 3,
      csv_text: 'AUTO,자동,10,true',
    })
    expect(buildChoiceImportApplyPayload(session, 4)).toBeNull()

    session = choiceImportReducer(session, {
      type: 'change-csv',
      csvText: 'MANUAL,수동,20,true',
    })
    expect(buildChoiceImportApplyPayload(session, 3)).toBeNull()
  })

  it('keeps raw CSV and preview rows visible after a version conflict', () => {
    let session = startChoiceImportSession()
    session = choiceImportReducer(session, {
      type: 'change-csv',
      csvText: 'AUTO,자동,10,true',
    })
    session = choiceImportReducer(session, {
      type: 'preview-success',
      baseVersion: 3,
      response: validPreview,
    })
    session = choiceImportReducer(session, {
      type: 'conflict',
      latest: makeSummary(4),
    })

    expect(session.csvText).toBe('AUTO,자동,10,true')
    expect(session.preview?.response.rows).toEqual(validPreview.rows)
    expect(session.conflict?.version).toBe(4)
    expect(buildChoiceImportApplyPayload(session, 4)).toBeNull()
  })

  it('ignores a late preview after a newer CSV generation has settled', () => {
    let session = choiceImportReducer(startChoiceImportSession(), {
      type: 'change-csv',
      csvText: 'OLD,이전,10,true',
    })
    const first = beginChoiceImportPreview(session, 3)
    session = choiceImportReducer(session, {
      type: 'preview-start',
      request: first,
    })
    session = choiceImportReducer(session, {
      type: 'change-csv',
      csvText: 'NEW,최신,10,true',
    })
    const second = beginChoiceImportPreview(session, 3)
    session = choiceImportReducer(session, {
      type: 'preview-start',
      request: second,
    })
    session = settleChoiceImportPreview(session, second, {
      ...validPreview,
      rows: [{ line: 2, code: 'NEW', action: 'create', message: null }],
    })
    session = settleChoiceImportPreview(session, first, {
      ...validPreview,
      rows: [{ line: 2, code: 'OLD', action: 'create', message: null }],
    })

    expect(session.preview?.csvText).toBe('NEW,최신,10,true')
    expect(session.preview?.response.rows[0]?.code).toBe('NEW')
  })

  it('disables apply when preview reports any error row', () => {
    let session = startChoiceImportSession()
    session = choiceImportReducer(session, {
      type: 'change-csv',
      csvText: 'BAD,잘못됨,ten,true',
    })
    session = choiceImportReducer(session, {
      type: 'preview-success',
      baseVersion: 3,
      response: {
        ...validPreview,
        error_count: 1,
        rows: [
          {
            line: 2,
            code: 'BAD',
            action: 'error',
            message: 'sort_order가 올바르지 않습니다.',
          },
        ],
      },
    })
    const html = renderDialog(session, 3)

    expect(html).toContain('sort_order가 올바르지 않습니다')
    expect(html).toContain('오류 1')
    expect(html).toContain('오류 행을 수정한 뒤 다시 미리보세요')
    expect(html).not.toContain('CSV 내용이나 집합 버전이 미리보기 이후 바뀌었습니다')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*(?:<span[^>]*>)?적용/)
  })

  it('shows stale-preview guidance and explicit reload without discarding evidence', () => {
    let session = startChoiceImportSession()
    session = choiceImportReducer(session, {
      type: 'change-csv',
      csvText: 'AUTO,자동,10,true',
    })
    session = choiceImportReducer(session, {
      type: 'preview-success',
      baseVersion: 3,
      response: validPreview,
    })
    session = choiceImportReducer(session, {
      type: 'conflict',
      latest: makeSummary(4),
    })
    const html = renderDialog(session, 3)

    expect(html).toContain('AUTO,자동,10,true')
    expect(html).toContain('AUTO')
    expect(html).toContain('다른 관리자가 버전 4로 변경했습니다')
    expect(html).toContain('CSV와 미리보기는 그대로 유지됩니다')
    expect(html).toContain('최신 버전 불러오기')
    expect(html).toContain('다시 미리보기')
  })

  it('locks preview and apply synchronously when the observed owner version advances', () => {
    let session = choiceImportReducer(startChoiceImportSession(), {
      type: 'change-csv',
      csvText: 'AUTO,자동,10,true',
    })
    session = choiceImportReducer(session, {
      type: 'preview-success',
      baseVersion: 3,
      response: validPreview,
    })
    const html = renderDialog(session, 3, false)

    expect(html).toContain('최신 버전을 확인할 때까지 미리보기와 적용을 사용할 수 없습니다')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*(?:<span[^>]*>)?다시 미리보기/)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*(?:<span[^>]*>)?적용/)
    expect(buildChoiceImportApplyPayload(session, 3, false)).toBeNull()
  })

  it('returns focus to the captured opener and keeps the heading as fallback', () => {
    const fallbackFocusRef = { current: null }
    const element = ChoiceImportDialogView({
      currentVersion: 3,
      fallbackFocusRef,
      pendingAction: null,
      session: startChoiceImportSession(),
      onApply: vi.fn(),
      onChangeCsv: vi.fn(),
      onClose: vi.fn(),
      onPreview: vi.fn(),
      onReload: vi.fn(),
    })

    expect(element.props.fallbackFocusRef).toBe(fallbackFocusRef)
    expect(element.props).not.toHaveProperty('returnFocusRef')
  })
})

function renderDialog(
  session: ReturnType<typeof startChoiceImportSession>,
  currentVersion: number,
  writeAuthorized = true,
) {
  return renderToStaticMarkup(
    <ChoiceImportDialogView
      currentVersion={currentVersion}
      fallbackFocusRef={{ current: null }}
      pendingAction={null}
      writeAuthorized={writeAuthorized}
      session={session}
      onApply={vi.fn()}
      onChangeCsv={vi.fn()}
      onClose={vi.fn()}
      onPreview={vi.fn()}
      onReload={vi.fn()}
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
    option_count: 2,
    active_option_count: 2,
    parameter_usage_count: 0,
    profile_usage_fields: [],
    created_at: '2026-07-14T00:00:00Z',
    updated_at: '2026-07-14T00:00:00Z',
  }
}
