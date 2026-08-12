import { afterEach, describe, expect, it } from 'vitest'
import {
  SHEET_INSPECTOR_DEFAULT_WIDTH,
  SHEET_INSPECTOR_MAX_WIDTH,
  SHEET_INSPECTOR_MIN_WIDTH,
  SHEET_INSPECTOR_WIDTH_STORAGE_KEY,
  readPersistedSheetInspectorWidth,
  writePersistedSheetInspectorWidth,
} from './sheetWorkbenchStorage'

describe('sheet evidence inspector storage', () => {
  afterEach(() => Reflect.deleteProperty(globalThis, 'window'))

  it('falls back and clamps inspector widths', () => {
    expect(readPersistedSheetInspectorWidth()).toBe(SHEET_INSPECTOR_DEFAULT_WIDTH)
    const store = new Map([[SHEET_INSPECTOR_WIDTH_STORAGE_KEY, '9999']])
    installWindow(store)
    expect(readPersistedSheetInspectorWidth()).toBe(SHEET_INSPECTOR_MAX_WIDTH)
    writePersistedSheetInspectorWidth(1)
    expect(store.get(SHEET_INSPECTOR_WIDTH_STORAGE_KEY)).toBe(String(SHEET_INSPECTOR_MIN_WIDTH))
  })

  it('ignores unavailable storage', () => {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } } } })
    expect(readPersistedSheetInspectorWidth()).toBe(SHEET_INSPECTOR_DEFAULT_WIDTH)
    expect(() => writePersistedSheetInspectorWidth(380)).not.toThrow()
  })
})

function installWindow(store: Map<string, string>) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) } },
  })
}
