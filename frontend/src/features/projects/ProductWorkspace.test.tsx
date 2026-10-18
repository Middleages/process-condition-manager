import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProductWorkspace, LegacyProjectRedirect, useProductWorkspace } from './ProductWorkspace'
import type { SheetEditing } from '@/features/sheets/useSheetEditing'

vi.mock('@/api/projects', () => ({ getProject: vi.fn(async () => ({ id: 7, status: 'draft' })) }))
let cleanup: () => void
let workspace: NonNullable<ReturnType<typeof useProductWorkspace>>
function deferred() { let resolve!: () => void; const promise = new Promise<void>((yes) => { resolve = yes }); return { promise, resolve } }
function setup({ unsavedCount = 0, hasPaste = false, persistenceIdle = true, suspend = vi.fn(async (): Promise<void> => undefined) } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://pcm.test' })
  const previous = { window: globalThis.window, document: globalThis.document }
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  client.setQueryData(['project', 7], { id: 7, status: 'draft' })
  const resume = vi.fn()
  const editing = { unsavedCount, persistenceIdle, suspend, resume } as unknown as SheetEditing
  function Probe() {
    workspace = useProductWorkspace()!
    useLayoutEffect(() => { workspace.session.current = { editing, hasPaste } })
    return <div>workspace</div>
  }
  const root = createRoot(dom.window.document.getElementById('root')!)
  const router = createMemoryRouter([
    { path: '/projects/:projectId', element: <LegacyProjectRedirect /> },
    { path: '/projects/:projectId/sheet', element: <ProductWorkspace projectId={7}><Probe /></ProductWorkspace> },
  ], { initialEntries: [{ pathname: '/projects/7', state: { from: '/projects?line_id=L1&query=ETCH&cursor=25' } }] })
  act(() => root.render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>))
  cleanup = () => { act(() => root.unmount()); client.clear(); Object.assign(globalThis, previous); dom.window.close() }
  return { client, router, suspend, resume }
}
afterEach(() => cleanup?.())
describe('product workspace mutation boundary', () => {
  it('preserves old bookmarks and list return context while replacing the legacy route', () => {
    const { router } = setup()
    expect(router.state.location.pathname).toBe('/projects/7/sheet')
    expect(router.state.location.state.from).toBe('/projects?line_id=L1&query=ETCH&cursor=25')
    expect(router.state.historyAction).toBe('REPLACE')
  })
  it.each([{ unsavedCount: 1 }, { hasPaste: true }, { persistenceIdle: false }])('blocks mutation until sheet input is resolved: %j', async (state) => {
    const { suspend } = setup(state)
    await act(async () => { expect(await workspace.beginMutation('profile')).toBe(false) })
    expect(suspend).not.toHaveBeenCalled()
    expect(workspace.error).toContain('저장하고')
    expect(workspace.mutation).toBe('none')
  })
  it('freezes immediately and waits for release before exposing the profile, then refresh before resuming', async () => {
    const release = deferred()
    const { resume, client } = setup({ suspend: vi.fn(() => release.promise) })
    let begin!: Promise<boolean>
    await act(async () => { begin = workspace.beginMutation('profile'); await Promise.resolve() })
    expect(workspace.mutation).toBe('handoff')
    await act(async () => { expect(await workspace.beginMutation('layer')).toBe(false) })
    await act(async () => { release.resolve(); expect(await begin).toBe(true) })
    expect(workspace.mutation).toBe('profile')
    const refresh = deferred()
    vi.spyOn(client, 'invalidateQueries').mockReturnValue(refresh.promise)
    let end!: Promise<void>
    await act(async () => { end = workspace.endMutation(); await Promise.resolve() })
    expect(workspace.mutation).toBe('refresh')
    expect(resume).not.toHaveBeenCalled()
    await act(async () => { refresh.resolve(); await end })
    expect(resume).toHaveBeenCalledOnce()
    expect(workspace.mutation).toBe('none')
  })
  it('offers explicit release recovery without acquiring before release succeeds', async () => {
    const suspend = vi.fn(async (): Promise<void> => undefined).mockRejectedValueOnce(new Error('offline'))
    const { resume } = setup({ suspend })
    await act(async () => { expect(await workspace.beginMutation('profile')).toBe(false) })
    expect(workspace.releaseFailed).toBe(true)
    expect(resume).not.toHaveBeenCalled()
    await act(async () => { await workspace.recoverEditing() })
    expect(suspend).toHaveBeenCalledTimes(2)
    expect(resume).toHaveBeenCalledOnce()
    expect(workspace.releaseFailed).toBe(false)
  })
  it('keeps refresh failures frozen and offers a truthful retry', async () => {
    const { resume, client } = setup()
    await act(async () => { await workspace.beginMutation('transition') })
    const invalidate = vi.spyOn(client, 'invalidateQueries').mockRejectedValue(new Error('offline'))
    await act(async () => { await workspace.endMutation() })
    expect(workspace.mutation).toBe('refresh')
    expect(resume).not.toHaveBeenCalled()
    expect(workspace.error).toContain('편집을 중지')
    invalidate.mockResolvedValue(undefined)
    await act(async () => { await workspace.endMutation() })
    expect(workspace.mutation).toBe('none')
    expect(resume).toHaveBeenCalledOnce()
  })
})
