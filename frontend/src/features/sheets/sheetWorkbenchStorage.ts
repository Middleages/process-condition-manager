export const SHEET_INSPECTOR_WIDTH_STORAGE_KEY = 'pcm:sheet-inspector-width'
export const SHEET_INSPECTOR_DEFAULT_WIDTH = 380
export const SHEET_INSPECTOR_MIN_WIDTH = 320
export const SHEET_INSPECTOR_MAX_WIDTH = 520

export function clampSheetInspectorWidth(width: number): number {
  return Math.min(SHEET_INSPECTOR_MAX_WIDTH, Math.max(SHEET_INSPECTOR_MIN_WIDTH, Math.round(width)))
}

export function readPersistedSheetInspectorWidth(defaultWidth = SHEET_INSPECTOR_DEFAULT_WIDTH): number {
  const fallback = clampSheetInspectorWidth(defaultWidth)
  try {
    if (typeof window === 'undefined') return fallback
    const raw = window.localStorage.getItem(SHEET_INSPECTOR_WIDTH_STORAGE_KEY)
    const parsed = raw === null ? Number.NaN : Number(raw)
    return Number.isFinite(parsed) ? clampSheetInspectorWidth(parsed) : fallback
  } catch {
    return fallback
  }
}

export function writePersistedSheetInspectorWidth(width: number): void {
  try {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(SHEET_INSPECTOR_WIDTH_STORAGE_KEY, String(clampSheetInspectorWidth(width)))
  } catch {
    // Storage is an enhancement; retain in-memory state when unavailable.
  }
}
