import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// We need to mock localStorage before importing the store, because the store
// calls loadUserId() at module-evaluation time.
// ---------------------------------------------------------------------------

// Create a simple in-memory localStorage mock
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key]
    }),
    clear: vi.fn(() => {
      store = {}
    }),
    get length() {
      return Object.keys(store).length
    },
    key: vi.fn((_index: number) => null),
    _store: store,
    _reset: () => {
      store = {}
      localStorageMock.getItem.mockClear()
      localStorageMock.setItem.mockClear()
      localStorageMock.removeItem.mockClear()
    },
  }
})()

// Install the mock globally
Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
})

// ===========================================================================
// Tests
// ===========================================================================
describe('useUserStore', () => {
  beforeEach(async () => {
    localStorageMock._reset()
    // We need to reset the module registry so the store re-evaluates loadUserId()
    vi.resetModules()
  })

  it('initializes with null when localStorage is empty', async () => {
    const { useUserStore } = await import('@/stores/useUserStore')
    expect(useUserStore.getState().currentUserId).toBeNull()
  })

  it('initializes from localStorage when a valid user id is stored', async () => {
    localStorageMock.setItem('pcm-current-user-id', '42')
    const { useUserStore } = await import('@/stores/useUserStore')
    expect(useUserStore.getState().currentUserId).toBe(42)
  })

  it('initializes with null when localStorage contains non-numeric value', async () => {
    localStorageMock.setItem('pcm-current-user-id', 'not-a-number')
    const { useUserStore } = await import('@/stores/useUserStore')
    expect(useUserStore.getState().currentUserId).toBeNull()
  })

  it('setCurrentUserId saves to state and localStorage', async () => {
    const { useUserStore } = await import('@/stores/useUserStore')

    useUserStore.getState().setCurrentUserId(7)

    expect(useUserStore.getState().currentUserId).toBe(7)
    expect(localStorageMock.setItem).toHaveBeenCalledWith('pcm-current-user-id', '7')
  })

  it('setCurrentUserId with null removes from localStorage', async () => {
    localStorageMock.setItem('pcm-current-user-id', '42')
    const { useUserStore } = await import('@/stores/useUserStore')

    useUserStore.getState().setCurrentUserId(null)

    expect(useUserStore.getState().currentUserId).toBeNull()
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('pcm-current-user-id')
  })

  it('setCurrentUserId overwrites previous value', async () => {
    const { useUserStore } = await import('@/stores/useUserStore')

    useUserStore.getState().setCurrentUserId(1)
    expect(useUserStore.getState().currentUserId).toBe(1)

    useUserStore.getState().setCurrentUserId(2)
    expect(useUserStore.getState().currentUserId).toBe(2)
    expect(localStorageMock.setItem).toHaveBeenLastCalledWith('pcm-current-user-id', '2')
  })
})
