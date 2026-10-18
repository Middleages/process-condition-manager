// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getProcess, searchProcesses } from '@/api/processes'
import { createProject, getBackboneCandidates, previewBackbone } from '@/api/projects'
import type { ProcessDetailOut } from '@/api/types'

import { ProjectCreatePage } from './ProjectCreatePage'

vi.mock('@/api/processes', () => ({ getProcess: vi.fn(), searchProcesses: vi.fn() }))
vi.mock('@/api/projects', () => ({
  createProject: vi.fn(), getBackboneCandidates: vi.fn(), getProject: vi.fn(), previewBackbone: vi.fn(),
}))
// Keep the actual managed-choice controls; replace only their remote resource boundary.
vi.mock('@/features/choiceSets/useChoiceSetOptions', () => ({
  useChoiceSetOptions: (setCode: string) => {
    const code = setCode === 'device_type' ? 'FOUNDRY' : 'LOGIC'
    const options = [{ code, label: code, is_active: true, sort_order: 0 }]
    return {
      setCode, version: 1, setIsActive: true, displayOptions: options, selectableOptions: options,
      selectionReady: true, loading: false, refreshing: false, error: null,
      prepareToOpen: async () => {}, refetchSummary: async () => {}, retryOptions: async () => {},
    }
  },
}))

const process: ProcessDetailOut = {
  key: 'LINE A::COAT', line_id: 'LINE A', process_id: 'COAT', display_name: 'LINE A / COAT',
  step_count: 1, area_names: ['COAT'], has_project: true, project_count: 2,
}
let root: Root | undefined
let client: QueryClient
let container: HTMLDivElement

async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
}
async function click(button: HTMLElement) {
  await act(async () => button.click())
  await settle()
}
function button(text: string) {
  const found = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes(text))
  expect(found, `button ${text}`).toBeDefined()
  return found!
}
async function input(id: string, value: string) {
  const field = container.querySelector<HTMLInputElement>(`#${id}`)!
  expect(field).not.toBeNull()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function selectChoice(id: string) {
  const field = container.querySelector<HTMLInputElement>(`#${id}`)!
  await act(async () => field.focus())
  await settle()
  await click(container.querySelector<HTMLElement>('[role="option"]')!)
}
async function mount(location = '/projects/new') {
  const router = createMemoryRouter([
    { path: '/projects/new', element: <ProjectCreatePage /> },
    { path: '/projects/:id/sheet', element: <p>등록된 조건표</p> },
    { path: '/projects', element: <p>제품 목록</p> },
  ], { initialEntries: [location] })
  await act(async () => {
    root = createRoot(container)
    root.render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
  })
  await settle()
  return router
}
async function completeInformation(partId: string) {
  expect(container.querySelector('#project-name')).toBeNull()
  expect(container.textContent).not.toContain('프로젝트명')
  await input('project-part-id', partId)
  await selectChoice('project-device-type')
  await selectChoice('project-category')
  expect(button('공정조건 등록').disabled).toBe(false)
}
async function submit() {
  await act(async () => {
    container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  await settle()
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  HTMLElement.prototype.scrollIntoView = vi.fn()
  vi.mocked(searchProcesses).mockResolvedValue({ items: [{ ...process, sort_order: 1 }], next_cursor: null })
  vi.mocked(getProcess).mockResolvedValue(process)
  vi.mocked(getBackboneCandidates).mockResolvedValue([])
  vi.mocked(previewBackbone).mockResolvedValue({
    match_rate: 0, matched_count: 0, unmatched_count: 1, copy_condition_count: 0, copy_cell_count: 0,
    matches: [{ target_layer_key: '1::COAT', source_layer_key: null, match_type: 'unmatched' }],
  })
  vi.mocked(createProject).mockResolvedValue({ id: 42 } as Awaited<ReturnType<typeof createProject>>)
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } })
  container = document.createElement('div')
  document.body.append(container)
})
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  client.clear()
  container.remove()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('Part ID registration through the actual wizard', () => {
  it('registers another Part ID under an existing Process through all steps and enters its sheet', async () => {
    const router = await mount()
    await click(button('LINE A / COAT'))
    expect(container.textContent).toContain('다른 Part ID로 추가 등록할 수 있습니다.')
    expect(button('백본 선택으로').disabled).toBe(false)
    await click(button('백본 선택으로'))
    expect(router.state.location.search).toContain('step=2')
    await click(button('매칭 확인으로'))
    expect(router.state.location.search).toContain('step=3')
    await completeInformation('  NEW-PART  ')
    expect(container.textContent).toContain('NEW-PART')
    await input('project-part-id', '   ')
    expect(button('공정조건 등록').disabled).toBe(true)
    expect(container.textContent).toContain('Part ID를 입력해 주세요.')
    await input('project-part-id', '  NEW-PART  ')
    await submit()
    expect(createProject).toHaveBeenCalledTimes(1)
    expect(createProject).toHaveBeenCalledWith({
      line_id: 'LINE A', process_id: 'COAT', part_id: 'NEW-PART', name: 'NEW-PART',
      device_type_code: 'FOUNDRY', project_category_code: 'LOGIC', backbone_project_id: null, manual_overrides: [],
    })
    expect(router.state.location.pathname).toBe('/projects/42/sheet')
    expect(container.textContent).toBe('등록된 조건표')
  })

  it.each([true, false])('restores step three and recovers from 409 (existing ID: %s) by changing Part ID', async (hasExistingId) => {
    vi.mocked(createProject).mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 409, data: { code: 'conflict', message: '이미 등록된 조합입니다.',
        details: hasExistingId ? { existing_project_id: 17, existing_status: 'draft' } : null } },
    })
    const router = await mount(`/projects/new?${new URLSearchParams({ step: '3', process: process.key })}`)
    expect(router.state.location.search).toContain('step=3')
    await completeInformation('OLD-PART')
    await submit()
    expect(container.textContent).toContain('이미 등록된 조합입니다.')
    expect(container.textContent).toContain('LINE·Process·Part ID 조합을 확인해 주세요.')
    const recovery = Array.from(container.querySelectorAll('a')).find(a => a.textContent?.includes(hasExistingId ? '기존 조건표 열기' : '기존 제품 목록에서 선택'))
    expect(recovery?.getAttribute('href')).toBe(hasExistingId ? '/projects/17' : '/projects?line=LINE+A&query=COAT')
    expect(router.state.location.pathname).toBe('/projects/new')
    await input('project-part-id', 'OTHER-PART')
    expect(container.textContent).not.toContain('이미 등록된 조합입니다.')
    expect(button('공정조건 등록').disabled).toBe(false)
    await submit()
    expect(createProject).toHaveBeenCalledTimes(2)
    expect(vi.mocked(createProject).mock.calls[1][0]).toMatchObject({ part_id: 'OTHER-PART', name: 'OTHER-PART' })
    expect(router.state.location.pathname).toBe('/projects/42/sheet')
  })
})
