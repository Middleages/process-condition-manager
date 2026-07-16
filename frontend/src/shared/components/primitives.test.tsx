import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Badge } from './Badge'
import { Button } from './Button'
import { Field } from './Field'
import { InlineAlert } from './InlineAlert'
import { PageHeader } from './PageHeader'
import { ErrorMessage, LoadingMessage } from './StatusMessage'

describe('shared primitives', () => {
  it('announces blocking errors', () => {
    const html = renderToStaticMarkup(<InlineAlert tone="error">저장 실패</InlineAlert>)
    expect(html).toContain('role="alert"')
    expect(html).toContain('저장 실패')
  })

  it('announces non-blocking status politely', () => {
    const html = renderToStaticMarkup(<InlineAlert tone="success">저장됨</InlineAlert>)
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-live="polite"')
  })

  it('preserves status-message wrappers with live-region semantics', () => {
    const loadingHtml = renderToStaticMarkup(<LoadingMessage />)
    const errorHtml = renderToStaticMarkup(<ErrorMessage message="조회 실패" />)

    expect(loadingHtml).toContain('role="status"')
    expect(loadingHtml).toContain('불러오는 중...')
    expect(errorHtml).toContain('role="alert"')
    expect(errorHtml).toContain('조회 실패')
  })

  it('allows a live-region politeness override', () => {
    const html = renderToStaticMarkup(
      <InlineAlert tone="warning" live="assertive">
        잠금 만료 임박
      </InlineAlert>,
    )
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-live="assertive"')
  })

  it('exposes pending button state', () => {
    const html = renderToStaticMarkup(<Button loading>저장</Button>)
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('disabled=""')
  })

  it('reserves the label width while showing an absolute loading indicator', () => {
    const idleHtml = renderToStaticMarkup(<Button>긴 저장 작업</Button>)
    const loadingHtml = renderToStaticMarkup(<Button loading>긴 저장 작업</Button>)

    expect(idleHtml).toContain('class="inline-flex min-w-0 items-center gap-2"')
    expect(loadingHtml).toContain('class="inline-flex min-w-0 items-center gap-2 opacity-0"')
    expect(loadingHtml).toContain('aria-hidden="true" class="pointer-events-none absolute inset-0')
    expect(loadingHtml).toContain('긴 저장 작업')
  })

  it('uses the approved exact shared-button heights', () => {
    const compactHtml = renderToStaticMarkup(<Button size="compact">수정</Button>)
    const defaultHtml = renderToStaticMarkup(<Button>저장</Button>)

    expect(compactHtml).toContain(' h-[34px] ')
    expect(defaultHtml).toContain(' h-9 ')
    expect(compactHtml).not.toContain('min-h-')
    expect(defaultHtml).not.toContain('min-h-')
  })

  it('retains native button props and caller classes', () => {
    const html = renderToStaticMarkup(
      <Button className="justify-start" name="action" type="submit" value="save">
        저장
      </Button>,
    )
    expect(html).toContain('class="')
    expect(html).toContain('justify-start')
    expect(html).toContain('name="action"')
    expect(html).toContain('type="submit"')
    expect(html).toContain('value="save"')
  })

  it('links field labels, help, and errors to the control', () => {
    const html = renderToStaticMarkup(
      <Field inputId="project-name" label="프로젝트 이름" help="현장에서 쓰는 이름" error="이름을 입력하세요">
        <input aria-describedby="existing-description" />
      </Field>,
    )
    expect(html).toContain('for="project-name"')
    expect(html).toContain('id="project-name"')
    expect(html).toContain('aria-describedby="existing-description project-name-help project-name-error"')
    expect(html).toContain('aria-invalid="true"')
  })

  it('keeps route focus on the h1 instead of the entire PageHeader surface', () => {
    const html = renderToStaticMarkup(
      <PageHeader
        eyebrow={<Badge tone="draft">초안</Badge>}
        title="프로젝트"
        description="조건표 작업을 선택하세요."
        actions={<Button>프로젝트 생성</Button>}
      />,
    )
    const headerTag = html.match(/<header[^>]*>/)?.[0]
    const headingTag = html.match(/<h1[^>]*>/)?.[0]

    expect(headerTag).toBeDefined()
    expect(headerTag).toContain('gap-3')
    expect(headerTag).toContain('pb-4')
    expect(headerTag).not.toContain('data-page-title')
    expect(headerTag).not.toContain('tabindex')
    expect(headerTag).not.toContain('focus:outline')
    expect(headerTag).not.toContain('rounded-sm')

    expect(headingTag).toBeDefined()
    expect(headingTag).toContain('data-page-title="true"')
    expect(headingTag).toContain('tabindex="-1"')
    expect(headingTag).toContain('rounded-sm')
    expect(headingTag).toContain('focus:outline-2')
    expect(headingTag).toContain('focus:outline-offset-2')
    expect(headingTag).toContain('focus:outline-brand-700')

    expect(html).toContain('초안')
    expect(html).toContain('프로젝트')
    expect(html).toContain('조건표 작업을 선택하세요.')
    expect(html).toContain('프로젝트 생성')
  })
})
