import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { acquireLock, releaseLock, heartbeatLock } from '@/api/locks'
import { useSheetEditing, type SheetEditing } from './useSheetEditing'
import { useEditStore } from './editStore'

vi.mock('@/api/locks', () => ({ acquireLock: vi.fn(), releaseLock: vi.fn(), heartbeatLock: vi.fn(), releaseLockOnUnload: vi.fn() }))
const lock = { lock_token: 'sheet-token', locked_by: 'editor', locked_at: '', expires_at: '' }
function deferred() { let resolve!: () => void; let reject!: (reason: unknown) => void; const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
let editing: SheetEditing
let cleanup: () => void
async function mount(initiallySuspended = false) {
  const dom = new JSDOM('<div id="root"></div>')
  const previous = { window: globalThis.window, document: globalThis.document }
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })
  function Probe() { editing = useSheetEditing(7, { heartbeatMs: 20, initiallySuspended }); return null }
  const root = createRoot(dom.window.document.getElementById('root')!)
  await act(async () => { root.render(<Probe />); await Promise.resolve() })
  cleanup = () => { act(() => root.unmount()); Object.assign(globalThis, previous); dom.window.close() }
}
beforeEach(() => { vi.mocked(acquireLock).mockReset().mockResolvedValue(lock); vi.mocked(releaseLock).mockReset().mockResolvedValue(undefined); vi.mocked(heartbeatLock).mockReset().mockResolvedValue(lock) })
afterEach(() => cleanup?.())
describe('workspace sheet lock handoff', () => {
  it('does not acquire when a draft editor mounts during a workspace mutation', async () => {
    await mount(true)
    await act(async () => { await new Promise((r) => setTimeout(r, 40)) })
    expect(acquireLock).not.toHaveBeenCalled()
    await act(async () => { editing.resume(); await Promise.resolve() })
    expect(acquireLock).toHaveBeenCalledOnce()
    expect(editing.lockStatus).toBe('held')
  })
  it('awaits release and suppresses automatic and manual reacquisition until resumed', async () => {
    await mount()
    const release = deferred()
    vi.mocked(releaseLock).mockReturnValueOnce(release.promise)
    let done = false
    let pending!: Promise<void>
    await act(async () => { pending = editing.suspend().then(() => { done = true }); await Promise.resolve() })
    expect(done).toBe(false)
    expect(editing.readOnly).toBe(true)
    await act(async () => { editing.reacquire(); await new Promise((r) => setTimeout(r, 60)) })
    expect(acquireLock).toHaveBeenCalledTimes(1)
    expect(heartbeatLock).not.toHaveBeenCalled()
    await act(async () => { release.resolve(); await pending })
    expect(done).toBe(true)
    await act(async () => { editing.resume(); await Promise.resolve() })
    expect(acquireLock).toHaveBeenCalledTimes(2)
    expect(editing.lockStatus).toBe('held')
  })
  it('retains failed release for an explicit retry and never treats failure as handoff success', async () => {
    await mount()
    vi.mocked(releaseLock).mockRejectedValueOnce(new Error('offline'))
    await act(async () => { await expect(editing.suspend()).rejects.toThrow('offline') })
    expect(editing.readOnly).toBe(true)
    await act(async () => { editing.reacquire(); await new Promise((r) => setTimeout(r, 40)) })
    expect(acquireLock).toHaveBeenCalledTimes(1)
    await act(async () => { await editing.suspend() })
    expect(releaseLock).toHaveBeenCalledTimes(2)
    expect(releaseLock).toHaveBeenLastCalledWith(7, 'sheet-token')
  })
  it('waits for a late acquisition and releases its token before completing suspension', async () => {
    const acquired = deferred()
    vi.mocked(acquireLock).mockImplementationOnce(async () => { await acquired.promise; return lock })
    await mount()
    let done = false
    let pending!: Promise<void>
    await act(async () => { pending = editing.suspend().then(() => { done = true }); await Promise.resolve() })
    expect(done).toBe(false)
    await act(async () => { acquired.resolve(); await pending })
    expect(releaseLock).toHaveBeenCalledWith(7, 'sheet-token')
    expect(editing.readOnly).toBe(true)
  })
  it('rejects dirty handoff without clearing the actual edited value', async () => {
    await mount()
    act(() => editing.setCell('11', 'ETCH_P001', '42'))
    await act(async () => { await expect(editing.suspend()).rejects.toThrow('먼저 저장') })
    expect([...useEditStore.getState().dirtyCells.values()][0].value).toBe('42')
    expect(releaseLock).not.toHaveBeenCalled()
  })
})
