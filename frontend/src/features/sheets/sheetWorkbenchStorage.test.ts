import { afterEach, describe, expect, it } from 'vitest'

import {
  SHEET_WORKBENCH_HEIGHT_STORAGE_KEY,
  readPersistedSheetWorkbenchHeight,
  writePersistedSheetWorkbenchHeight,
} from './sheetWorkbenchStorage'
import {
  VALIDATION_WORKBENCH_DEFAULT_HEIGHT,
  VALIDATION_WORKBENCH_MAX_HEIGHT,
  VALIDATION_WORKBENCH_MIN_HEIGHT,
} from './validationWorkbenchState'

describe('sheet workbench storage', () => {
  afterEach(() => {
    cleanupWindow()
  })

  it('falls back to the clamped default height when storage is unavailable or invalid', () => {
    expect(readPersistedSheetWorkbenchHeight(VALIDATION_WORKBENCH_DEFAULT_HEIGHT)).toBe(
      VALIDATION_WORKBENCH_DEFAULT_HEIGHT,
    )

    installWindow({
      getItem: () => 'not-a-number',
      setItem: () => undefined,
      removeItem: () => undefined,
    })

    expect(readPersistedSheetWorkbenchHeight(VALIDATION_WORKBENCH_DEFAULT_HEIGHT)).toBe(
      VALIDATION_WORKBENCH_DEFAULT_HEIGHT,
    )
  })

  it('clamps persisted values on read and write', () => {
    const store = new Map<string, string>([[SHEET_WORKBENCH_HEIGHT_STORAGE_KEY, '9999']])
    installWindow(storageFromMap(store))

    expect(readPersistedSheetWorkbenchHeight(VALIDATION_WORKBENCH_DEFAULT_HEIGHT)).toBe(
      VALIDATION_WORKBENCH_MAX_HEIGHT,
    )

    writePersistedSheetWorkbenchHeight(VALIDATION_WORKBENCH_MIN_HEIGHT - 10)
    expect(store.get(SHEET_WORKBENCH_HEIGHT_STORAGE_KEY)).toBe(
      String(VALIDATION_WORKBENCH_MIN_HEIGHT),
    )
  })

  it('ignores storage write failures without crashing the host state', () => {
    installWindow({
      getItem: () => null,
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => undefined,
    })

    expect(() => writePersistedSheetWorkbenchHeight(VALIDATION_WORKBENCH_DEFAULT_HEIGHT)).not.toThrow()
  })
})

function storageFromMap(store: Map<string, string>) {
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
  }
}

function installWindow(localStorage: {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage },
    writable: true,
  })
}

function cleanupWindow() {
  Reflect.deleteProperty(globalThis, 'window')
}
