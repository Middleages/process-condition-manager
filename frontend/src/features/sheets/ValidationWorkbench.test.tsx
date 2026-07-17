import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import {
  VALIDATION_DEFINITIONS_FAILURE,
  VALIDATION_PERSISTENCE_GUIDANCE,
  VALIDATION_SERVER_FAILURE,
} from './validationState'
import { ValidationWorkbench } from './ValidationWorkbench'
import type { ValidationWorkbenchIssue } from './validationWorkbenchState'
import source from './ValidationWorkbench.tsx?raw'

describe('ValidationWorkbench', () => {
  it('renders a 30px collapsed strip with explicit severity text, authority, and visible focus', () => {
    const html = render({ issues: [workbenchIssue('error'), workbenchIssue('warning')] })

    expect(html).toContain('h-[30px]')
    expect(html).toContain('오류 1')
    expect(html).toContain('경고 1')
    expect(html).toContain('서버 확인됨')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('focus-visible:outline-2')
  })

  it('exposes full tile descriptions, non-color severity, keyboard semantics, and 3/4/5 columns', () => {
    const html = render({ issues: [workbenchIssue('error')] })

    expect(html).toContain('aria-label="오류. ETCH (10) POR. 노광량. 현재 값 7. 노광량 값을 입력해 주세요."')
    expect(html).toContain('>오류<')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('h-[50px]')
    expect(html).toContain('min-[640px]:grid-cols-2')
    expect(html).not.toContain('sm:grid-cols-2')
    expect(html).toContain('min-[1024px]:grid-cols-3')
    expect(html).toContain('min-[1440px]:grid-cols-4')
    expect(html).toContain('min-[1920px]:grid-cols-5')
    expect(source).toContain('onKeyDown={activateWithKeyboard}')
    expect(source).toContain('handleValidationTileActivationKey(')
    expect(source).toContain("selected ? 'h-auto' : 'h-[50px]'")
  })

  it('renders only validation content and no longer owns the host resize affordances', () => {
    const html = render({ issues: [workbenchIssue('error')] })

    expect(html).not.toContain('role="separator"')
    expect(html).not.toContain('aria-orientation="horizontal"')
    expect(html).not.toContain('aria-valuenow="300"')
    expect(source).not.toContain('onPointerMove={continueResize}')
  })

  it('keeps the latest issues visible on failure and exposes the exact retry affordance', () => {
    const onRetry = vi.fn()
    const html = render(
      {
        issues: [workbenchIssue('error')],
        serverConfirmation: 'failed',
        serverFailure: VALIDATION_SERVER_FAILURE,
        onRetry,
      },
    )

    expect(html).toContain('최신 상태 확인 실패 · 다시 시도')
    expect(html).toContain('>다시 시도<')
    expect(html).toContain('노광량')
  })

  it('renders unavailable configuration as an error and never a green success strip', () => {
    const html = render({
      issues: [],
      summary: null,
      issueAuthority: 'unavailable',
      serverConfirmation: 'failed',
      serverFailure: VALIDATION_DEFINITIONS_FAILURE,
    })

    expect(html).toContain(VALIDATION_DEFINITIONS_FAILURE)
    expect(html).toContain('bg-error-surface')
    expect(html).not.toContain('bg-success-surface')
    expect(html).not.toContain('검증 완료 · 문제 없음')
  })

  it('renders an error-free definition transition neutrally even when the prior controller is unavailable', () => {
    const html = render({
      definitionsPending: true,
      issues: [],
      summary: null,
      issueAuthority: 'unavailable',
      serverConfirmation: 'failed',
      serverFailure: VALIDATION_DEFINITIONS_FAILURE,
    })

    expect(html).toContain('검증 규칙을 불러오는 중')
    expect(html).toContain('bg-canvas')
    expect(html).not.toContain('bg-success-surface')
    expect(html).not.toContain(VALIDATION_DEFINITIONS_FAILURE)
  })

  it('shows persistence guidance without presenting a network retry as successful recovery', () => {
    const html = render({
      issues: [workbenchIssue('error')],
      serverConfirmation: 'failed',
      serverFailure: VALIDATION_PERSISTENCE_GUIDANCE,
    })

    expect(html).toContain('저장 후 검증해 주세요.')
    expect(html).not.toContain('>다시 시도<')
    expect(html).not.toContain('bg-success-surface')
  })

  it('renders a truthful success strip for a confirmed zero-issue explicit result', () => {
    const html = render({ issues: [], summary: { error_count: 0, warning_count: 0 } })

    expect(html).toContain('검증 완료 · 문제 없음')
    expect(html).toContain('bg-success-surface')
  })
})

function render(
  overrides: Partial<Parameters<typeof ValidationWorkbench>[0]> = {},
): string {
  return renderToStaticMarkup(
    <ValidationWorkbench
      issues={[]}
      summary={{ error_count: 1, warning_count: 1 }}
      issueAuthority="authoritative"
      serverConfirmation="confirmed"
      serverFailure={null}
      onIssueActivate={vi.fn()}
      onRetry={vi.fn()}
      {...overrides}
    />,
  )
}

function workbenchIssue(severity: 'error' | 'warning'): ValidationWorkbenchIssue {
  return {
    key: `11:amount:${severity}`,
    severity,
    severityLabel: severity === 'error' ? '오류' : '경고',
    conditionId: '11',
    parameterCode: 'amount',
    categoryCode: 'process',
    layerLabel: 'ETCH (10)',
    conditionLabel: 'POR',
    parameterName: '노광량',
    currentValue: '7',
    guidance: '노광량 값을 입력해 주세요.',
    accessibleDescription: '오류. ETCH (10) POR. 노광량. 현재 값 7. 노광량 값을 입력해 주세요.',
  }
}
