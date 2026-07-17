import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  LockOut,
  ProjectProfileOut,
} from '@/api/types'

import { hydrateProfileForm } from './profileForm'
import {
  createProjectProfileLockController,
  createProjectProfileUnloadEventHandlers,
  createUnloadReleaseOnce,
  type ProjectProfileLockDependencies,
} from './profileLockState'
import useProjectProfileLockSource from './useProjectProfileLock.ts?raw'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

const profile: ProjectProfileOut = {
  project_id: 42,
  process_name: 'Server profile',
  device_type: { code: 'FOUNDRY', label: 'Foundry', is_active: true },
  project_category: { code: 'LOGIC', label: 'Logic', is_active: true },
  comment: 'server',
  active_direction: null,
  gate_direction: null,
  gross_die: null,
  pitch_x: null,
  pitch_y: null,
  shot_x: null,
  shot_y: null,
  slit_occupancy: null,
  lens_occupancy: null,
  map_offset_x: null,
  map_offset_y: null,
  scribe_lane_x: null,
  scribe_lane_y: null,
  shot_count: null,
  full_shot: null,
  layer_total: null,
  euv: null,
  imm: null,
  arf: null,
  krf: null,
  iline: null,
  soh: null,
  pspi: null,
  metal_layer_count: null,
  created_at: '2026-07-14T00:00:00Z',
  updated_at: '2026-07-14T00:00:00Z',
}

function serverProfile(overrides: Partial<ProjectProfileOut> = {}): ProjectProfileOut {
  return { ...profile, ...overrides }
}

function lock(token: string): LockOut {
  return {
    locked_by: 'dev-admin',
    lock_token: token,
    locked_at: '2026-07-14T00:00:00Z',
    expires_at: '2026-07-14T00:05:00Z',
  }
}

function lockConflict(holder = 'other-admin') {
  return Object.assign(new Error('locked'), {
    isAxiosError: true,
    response: {
      status: 409,
      data: { code: 'lock_conflict', message: 'locked', details: { locked_by: holder } },
    },
  })
}

function dependencies(
  overrides: Partial<ProjectProfileLockDependencies> = {},
): ProjectProfileLockDependencies {
  return {
    acquire: vi.fn().mockResolvedValue(lock('token-1')),
    heartbeat: vi.fn().mockResolvedValue(lock('token-1')),
    getProfile: vi.fn().mockResolvedValue(profile),
    patchProfile: vi.fn().mockResolvedValue(profile),
    invalidate: vi.fn().mockResolvedValue(undefined),
    release: vi.fn().mockResolvedValue(undefined),
    heartbeatMs: 1_000,
    ...overrides,
  }
}

describe('project Profile lock controller lifecycle', () => {
  it('invalidates the saved project history prefix with the existing profile caches', () => {
    const invalidateBody = useProjectProfileLockSource.match(
      /invalidate: async \(id, profile\) => \{[\s\S]*?await Promise\.all\(\[[\s\S]*?\]\)/,
    )?.[0]

    expect(invalidateBody).toContain(
      'invalidateProjectHistoryAfterMutation(queryClient, id)',
    )
  })

  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('moves closed -> acquiring -> loading-profile -> editable and heartbeats during GET', async () => {
    const acquired = deferred<LockOut>()
    const loaded = deferred<ProjectProfileOut>()
    const deps = dependencies({
      acquire: vi.fn(() => acquired.promise),
      getProfile: vi.fn(() => loaded.promise),
    })
    const controller = createProjectProfileLockController(42, deps)

    const opening = controller.open()
    expect(controller.getState().phase).toBe('acquiring')

    acquired.resolve(lock('token-a'))
    await flushPromises()
    expect(controller.getState().phase).toBe('loading-profile')
    expect(deps.getProfile).toHaveBeenCalledWith(42)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(deps.heartbeat).toHaveBeenCalledWith(42, 'token-a')

    loaded.resolve(profile)
    await opening
    expect(controller.getState()).toMatchObject({
      phase: 'editable',
      token: 'token-a',
      profile,
      draft: hydrateProfileForm(profile),
    })
  })

  it('keeps a failed Profile GET retryable while retaining and heartbeating the token', async () => {
    const deps = dependencies({
      getProfile: vi.fn()
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValueOnce(profile),
    })
    const controller = createProjectProfileLockController(42, deps)

    await controller.open()
    expect(controller.getState()).toMatchObject({ phase: 'load-error', token: 'token-1' })

    await vi.advanceTimersByTimeAsync(1_000)
    expect(deps.heartbeat).toHaveBeenCalledWith(42, 'token-1')

    await controller.retryLoad()
    expect(deps.acquire).toHaveBeenCalledTimes(1)
    expect(deps.getProfile).toHaveBeenCalledTimes(2)
    expect(controller.getState().phase).toBe('editable')
  })

  it('shows the conflict holder without creating an editable draft', async () => {
    const deps = dependencies({ acquire: vi.fn().mockRejectedValue(lockConflict('park')) })
    const controller = createProjectProfileLockController(42, deps)

    await controller.open()

    expect(controller.getState()).toMatchObject({
      phase: 'conflict',
      holder: 'park',
      token: null,
      draft: null,
    })
    expect(deps.getProfile).not.toHaveBeenCalled()
  })

  it('makes double-open idempotent and releases one late acquired token after close', async () => {
    const acquired = deferred<LockOut>()
    const deps = dependencies({ acquire: vi.fn(() => acquired.promise) })
    const controller = createProjectProfileLockController(42, deps)

    const first = controller.open()
    const second = controller.open()
    expect(deps.acquire).toHaveBeenCalledTimes(1)

    await controller.close()
    expect(controller.getState().phase).toBe('closed')

    acquired.resolve(lock('late-token'))
    await Promise.all([first, second])
    expect(deps.getProfile).not.toHaveBeenCalled()
    expect(deps.release).toHaveBeenCalledTimes(1)
    expect(deps.release).toHaveBeenCalledWith(42, 'late-token')
    expect(controller.getState().phase).toBe('closed')
  })

  it('allows close during a slow GET, releases once, and ignores the late Profile', async () => {
    const loaded = deferred<ProjectProfileOut>()
    const released = deferred<void>()
    const deps = dependencies({
      getProfile: vi.fn(() => loaded.promise),
      release: vi.fn(() => released.promise),
    })
    const controller = createProjectProfileLockController(42, deps)

    const opening = controller.open()
    await flushPromises()
    expect(controller.getState().phase).toBe('loading-profile')

    const closing = controller.close()
    expect(controller.getState().phase).toBe('releasing')
    await controller.close()
    expect(deps.release).toHaveBeenCalledTimes(1)

    released.resolve()
    await closing
    expect(controller.getState().phase).toBe('closed')

    loaded.resolve(serverProfile({ process_name: 'late' }))
    await opening
    expect(controller.getState()).toMatchObject({ phase: 'closed', draft: null })
  })

  it('waits for PATCH and invalidation before stopping/releasing/closing', async () => {
    const patched = deferred<ProjectProfileOut>()
    const invalidated = deferred<void>()
    const released = deferred<void>()
    const deps = dependencies({
      patchProfile: vi.fn(() => patched.promise),
      invalidate: vi.fn(() => invalidated.promise),
      release: vi.fn(() => released.promise),
    })
    const controller = createProjectProfileLockController(42, deps)
    const transitions: string[] = []
    controller.subscribe(() => transitions.push(controller.getState().phase))
    await controller.open()
    controller.updateDraft({ ...hydrateProfileForm(profile), comment: 'changed' })

    const saving = controller.save({ comment: 'changed' })
    expect(controller.getState().phase).toBe('saving')
    expect(deps.release).not.toHaveBeenCalled()
    await controller.close()
    expect(controller.getState().phase).toBe('saving')

    const saved = serverProfile({ comment: 'changed', updated_at: 'later' })
    patched.resolve(saved)
    await flushPromises()
    expect(deps.invalidate).toHaveBeenCalledWith(42, saved)
    expect(deps.release).not.toHaveBeenCalled()

    invalidated.resolve()
    await flushPromises()
    expect(controller.getState().phase).toBe('releasing')
    expect(deps.release).toHaveBeenCalledWith(42, 'token-1')

    released.resolve()
    await saving
    expect(controller.getState()).toMatchObject({
      phase: 'closed',
      token: null,
      profile: saved,
      draft: hydrateProfileForm(saved),
    })
    expect(transitions).toEqual(expect.arrayContaining(['saving', 'releasing', 'closed']))
  })

  it('ignores a late heartbeat conflict after save has entered intentional release', async () => {
    const heartbeat = deferred<LockOut>()
    const released = deferred<void>()
    const saved = serverProfile({ comment: 'saved', updated_at: 'later' })
    const deps = dependencies({
      heartbeat: vi.fn(() => heartbeat.promise),
      patchProfile: vi.fn().mockResolvedValue(saved),
      release: vi.fn(() => released.promise),
    })
    const controller = createProjectProfileLockController(42, deps)
    await controller.open()
    controller.updateDraft({ ...hydrateProfileForm(profile), comment: 'saved' })

    await vi.advanceTimersByTimeAsync(1_000)
    expect(deps.heartbeat).toHaveBeenCalledWith(42, 'token-1')

    const saving = controller.save({ comment: 'saved' })
    await flushPromises()
    expect(controller.getState().phase).toBe('releasing')

    heartbeat.reject(lockConflict('new-owner'))
    await flushPromises()
    expect(controller.getState().phase).toBe('releasing')

    released.resolve()
    await saving
    expect(controller.getState()).toMatchObject({
      phase: 'closed',
      token: null,
      profile: saved,
      draft: hydrateProfileForm(saved),
    })
  })

  it('returns an ordinary failed PATCH to editable with the same token and draft', async () => {
    const deps = dependencies({ patchProfile: vi.fn().mockRejectedValue(new Error('offline')) })
    const controller = createProjectProfileLockController(42, deps)
    await controller.open()
    const draft = { ...hydrateProfileForm(profile), comment: 'unsaved' }
    controller.updateDraft(draft)

    await controller.save({ comment: 'unsaved' })

    expect(controller.getState()).toMatchObject({
      phase: 'editable',
      token: 'token-1',
      draft,
    })
    expect(controller.getState().error).toContain('offline')
    expect(deps.release).not.toHaveBeenCalled()
  })

  it.each(['resolve', 'reject'] as const)(
    'keeps lock-lost authoritative when a stale PATCH later %s',
    async (settlement) => {
      const patched = deferred<ProjectProfileOut>()
      const deps = dependencies({
        heartbeat: vi.fn().mockRejectedValue(lockConflict('new-owner')),
        patchProfile: vi.fn(() => patched.promise),
      })
      const controller = createProjectProfileLockController(42, deps)
      await controller.open()
      const draft = { ...hydrateProfileForm(profile), comment: 'recovery text' }
      controller.updateDraft(draft)

      const saving = controller.save({ comment: 'recovery text' })
      await vi.advanceTimersByTimeAsync(1_000)
      expect(controller.getState()).toMatchObject({
        phase: 'lock-lost',
        holder: 'new-owner',
        draft,
        recoveryDraft: draft,
      })

      if (settlement === 'resolve') {
        patched.resolve(serverProfile({ comment: 'stale success' }))
      } else {
        patched.reject(new Error('stale failure'))
      }
      await saving

      expect(controller.getState()).toMatchObject({
        phase: 'lock-lost',
        draft,
        recoveryDraft: draft,
      })
      expect(deps.invalidate).not.toHaveBeenCalled()
      expect(deps.release).not.toHaveBeenCalled()
      await controller.save({ comment: 'blocked' })
      expect(deps.patchProfile).toHaveBeenCalledTimes(1)
    },
  )

  it('invalidates a slow GET on heartbeat loss and never hydrates its late result', async () => {
    const loaded = deferred<ProjectProfileOut>()
    const deps = dependencies({
      getProfile: vi.fn(() => loaded.promise),
      heartbeat: vi.fn().mockRejectedValue(lockConflict()),
    })
    const controller = createProjectProfileLockController(42, deps)

    const opening = controller.open()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(controller.getState()).toMatchObject({ phase: 'lock-lost', draft: null })

    loaded.resolve(serverProfile({ process_name: 'late GET' }))
    await opening
    expect(controller.getState()).toMatchObject({ phase: 'lock-lost', draft: null })
  })

  it('releases the lost token once, reacquires a fresh draft, and isolates a late old PATCH', async () => {
    const oldPatch = deferred<ProjectProfileOut>()
    const freshGet = deferred<ProjectProfileOut>()
    const acquire = vi.fn()
      .mockResolvedValueOnce(lock('old-token'))
      .mockResolvedValueOnce(lock('new-token'))
    const getProfile = vi.fn()
      .mockResolvedValueOnce(profile)
      .mockImplementationOnce(() => freshGet.promise)
    const deps = dependencies({
      acquire,
      getProfile,
      heartbeat: vi.fn().mockRejectedValueOnce(lockConflict()).mockResolvedValue(lock('new-token')),
      patchProfile: vi.fn(() => oldPatch.promise),
    })
    const controller = createProjectProfileLockController(42, deps)
    await controller.open()
    const recoveryDraft = { ...hydrateProfileForm(profile), comment: 'copy me' }
    controller.updateDraft(recoveryDraft)
    const staleSave = controller.save({ comment: 'copy me' })
    await vi.advanceTimersByTimeAsync(1_000)

    const reacquiring = controller.reacquire()
    await flushPromises()
    expect(deps.release).toHaveBeenCalledTimes(1)
    expect(deps.release).toHaveBeenCalledWith(42, 'old-token')
    expect(acquire).toHaveBeenCalledTimes(2)
    expect(controller.getState().phase).toBe('loading-profile')

    const fresh = serverProfile({ process_name: 'Fresh server', comment: 'authoritative' })
    freshGet.resolve(fresh)
    await reacquiring
    expect(controller.getState()).toMatchObject({
      phase: 'editable',
      token: 'new-token',
      draft: hydrateProfileForm(fresh),
      recoveryDraft,
    })

    oldPatch.resolve(serverProfile({ comment: 'late old success' }))
    await staleSave
    expect(controller.getState()).toMatchObject({
      phase: 'editable',
      token: 'new-token',
      draft: hydrateProfileForm(fresh),
      recoveryDraft,
    })
    expect(deps.invalidate).not.toHaveBeenCalled()
    expect(deps.release).toHaveBeenCalledTimes(1)
  })

  it('starts a new reacquire after the reacquired token is lost during a slow GET', async () => {
    const staleGet = deferred<ProjectProfileOut>()
    const fresh = serverProfile({ process_name: 'Third session', comment: 'authoritative' })
    const acquire = vi.fn()
      .mockResolvedValueOnce(lock('token-1'))
      .mockResolvedValueOnce(lock('token-2'))
      .mockResolvedValueOnce(lock('token-3'))
    const deps = dependencies({
      acquire,
      getProfile: vi.fn()
        .mockResolvedValueOnce(profile)
        .mockImplementationOnce(() => staleGet.promise)
        .mockResolvedValueOnce(fresh),
      heartbeat: vi.fn()
        .mockRejectedValueOnce(lockConflict('owner-2'))
        .mockRejectedValueOnce(lockConflict('owner-3'))
        .mockResolvedValue(lock('token-3')),
    })
    const controller = createProjectProfileLockController(42, deps)
    await controller.open()

    await vi.advanceTimersByTimeAsync(1_000)
    expect(controller.getState()).toMatchObject({ phase: 'lock-lost', token: 'token-1' })

    const staleReacquire = controller.reacquire()
    await flushPromises()
    expect(controller.getState()).toMatchObject({
      phase: 'loading-profile',
      token: 'token-2',
    })

    await vi.advanceTimersByTimeAsync(1_000)
    expect(controller.getState()).toMatchObject({ phase: 'lock-lost', token: 'token-2' })

    const currentReacquire = controller.reacquire()
    await flushPromises()
    expect(acquire).toHaveBeenCalledTimes(3)
    await currentReacquire
    expect(controller.getState()).toMatchObject({
      phase: 'editable',
      token: 'token-3',
      draft: hydrateProfileForm(fresh),
    })
    expect(deps.release).toHaveBeenCalledTimes(2)
    expect(deps.release).toHaveBeenNthCalledWith(1, 42, 'token-1')
    expect(deps.release).toHaveBeenNthCalledWith(2, 42, 'token-2')

    staleGet.resolve(serverProfile({ process_name: 'Late second session' }))
    await staleReacquire
    expect(controller.getState()).toMatchObject({
      phase: 'editable',
      token: 'token-3',
      draft: hydrateProfileForm(fresh),
    })
    expect(deps.release).toHaveBeenCalledTimes(2)
  })

  it('allows the reacquired token to save while the lost session PATCH is still pending', async () => {
    const oldPatch = deferred<ProjectProfileOut>()
    const newPatch = deferred<ProjectProfileOut>()
    const fresh = serverProfile({ process_name: 'Fresh server', comment: 'fresh baseline' })
    const saved = serverProfile({ process_name: 'Fresh server', comment: 'new session save' })
    const deps = dependencies({
      acquire: vi.fn()
        .mockResolvedValueOnce(lock('old-token'))
        .mockResolvedValueOnce(lock('new-token')),
      getProfile: vi.fn()
        .mockResolvedValueOnce(profile)
        .mockResolvedValueOnce(fresh),
      heartbeat: vi.fn()
        .mockRejectedValueOnce(lockConflict())
        .mockResolvedValue(lock('new-token')),
      patchProfile: vi.fn()
        .mockImplementationOnce(() => oldPatch.promise)
        .mockImplementationOnce(() => newPatch.promise),
    })
    const controller = createProjectProfileLockController(42, deps)
    await controller.open()
    controller.updateDraft({ ...hydrateProfileForm(profile), comment: 'lost edit' })
    const staleSave = controller.save({ comment: 'lost edit' })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(controller.getState().phase).toBe('lock-lost')

    await controller.reacquire()
    expect(controller.getState()).toMatchObject({
      phase: 'editable',
      token: 'new-token',
      draft: hydrateProfileForm(fresh),
    })
    controller.updateDraft({ ...hydrateProfileForm(fresh), comment: 'new session save' })

    const currentSave = controller.save({ comment: 'new session save' })
    expect(deps.patchProfile).toHaveBeenCalledTimes(2)
    expect(deps.patchProfile).toHaveBeenLastCalledWith(
      42,
      { comment: 'new session save' },
      'new-token',
    )
    expect(controller.getState().phase).toBe('saving')

    oldPatch.resolve(serverProfile({ comment: 'late old success' }))
    await staleSave
    expect(controller.getState()).toMatchObject({ phase: 'saving', token: 'new-token' })
    expect(deps.invalidate).not.toHaveBeenCalled()
    expect(deps.release).toHaveBeenCalledTimes(1)

    newPatch.resolve(saved)
    await currentSave
    expect(controller.getState()).toMatchObject({
      phase: 'closed',
      token: null,
      profile: saved,
      draft: hydrateProfileForm(saved),
    })
    expect(deps.invalidate).toHaveBeenCalledTimes(1)
    expect(deps.invalidate).toHaveBeenCalledWith(42, saved)
    expect(deps.release).toHaveBeenCalledTimes(2)
    expect(deps.release).toHaveBeenLastCalledWith(42, 'new-token')
  })

  it('disposes a reacquired token promptly without waiting for the old PATCH', async () => {
    const oldPatch = deferred<ProjectProfileOut>()
    const fresh = serverProfile({ process_name: 'Fresh server' })
    const deps = dependencies({
      acquire: vi.fn()
        .mockResolvedValueOnce(lock('old-token'))
        .mockResolvedValueOnce(lock('new-token')),
      getProfile: vi.fn()
        .mockResolvedValueOnce(profile)
        .mockResolvedValueOnce(fresh),
      heartbeat: vi.fn()
        .mockRejectedValueOnce(lockConflict())
        .mockResolvedValue(lock('new-token')),
      patchProfile: vi.fn(() => oldPatch.promise),
    })
    const controller = createProjectProfileLockController(42, deps)
    await controller.open()
    controller.updateDraft({ ...hydrateProfileForm(profile), comment: 'lost edit' })
    const staleSave = controller.save({ comment: 'lost edit' })
    await vi.advanceTimersByTimeAsync(1_000)
    await controller.reacquire()
    expect(deps.release).toHaveBeenCalledTimes(1)
    expect(deps.release).toHaveBeenCalledWith(42, 'old-token')

    controller.dispose()
    await flushPromises()
    expect(deps.release).toHaveBeenCalledTimes(2)
    expect(deps.release).toHaveBeenLastCalledWith(42, 'new-token')

    oldPatch.resolve(serverProfile({ comment: 'late old success' }))
    await staleSave
    await flushPromises()
    expect(deps.release).toHaveBeenCalledTimes(2)
    expect(controller.getState()).toMatchObject({ phase: 'closed', token: null })
  })
})

describe('unload release fence', () => {
  it('handles pagehide plus beforeunload exactly once for a held session and rearms for a new one', () => {
    const release = vi.fn()
    const releaseOnce = createUnloadReleaseOnce(release)

    releaseOnce(7, 'token-a')
    releaseOnce(7, 'token-a')
    expect(release).toHaveBeenCalledTimes(1)
    expect(release).toHaveBeenCalledWith('token-a')

    releaseOnce(8, 'token-b')
    expect(release).toHaveBeenCalledTimes(2)
    expect(release).toHaveBeenLastCalledWith('token-b')
  })

  it('keeps the editable session when a later dirty handler cancels beforeunload', async () => {
    const beacon = vi.fn()
    const releaseOnce = createUnloadReleaseOnce(beacon)
    const controller = createProjectProfileLockController(
      42,
      dependencies(),
      releaseOnce,
    )
    await controller.open()
    const queued: Array<() => void> = []
    const handlers = createProjectProfileUnloadEventHandlers(
      () => controller.releaseOnUnload(),
      (callback) => queued.push(callback),
    )
    const event = { defaultPrevented: false }

    handlers.beforeunload(event)
    event.defaultPrevented = true
    queued.shift()?.()

    expect(beacon).not.toHaveBeenCalled()
    expect(controller.getState()).toMatchObject({
      phase: 'editable',
      token: 'token-1',
    })

    handlers.pagehide()
    handlers.pagehide()
    expect(beacon).toHaveBeenCalledTimes(1)
    expect(beacon).toHaveBeenCalledWith('token-1')
    controller.dispose()
  })

  it('releases an uncancelled beforeunload exactly once when pagehide follows', async () => {
    const beacon = vi.fn()
    const releaseOnce = createUnloadReleaseOnce(beacon)
    const controller = createProjectProfileLockController(
      42,
      dependencies(),
      releaseOnce,
    )
    await controller.open()
    const queued: Array<() => void> = []
    const handlers = createProjectProfileUnloadEventHandlers(
      () => controller.releaseOnUnload(),
      (callback) => queued.push(callback),
    )
    const event = { defaultPrevented: false }

    handlers.beforeunload(event)
    queued.shift()?.()
    handlers.pagehide()

    expect(beacon).toHaveBeenCalledTimes(1)
    expect(beacon).toHaveBeenCalledWith('token-1')
    controller.dispose()
  })
})
