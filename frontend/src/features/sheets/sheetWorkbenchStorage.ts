import { clampValidationWorkbenchHeight } from './validationWorkbenchState'

export const SHEET_WORKBENCH_HEIGHT_STORAGE_KEY = 'pcm:sheet-workbench-height'

export function readPersistedSheetWorkbenchHeight(defaultHeight: number): number {
  const fallback = clampValidationWorkbenchHeight(defaultHeight)

  try {
    if (typeof window === 'undefined') return fallback
    const raw = window.localStorage.getItem(SHEET_WORKBENCH_HEIGHT_STORAGE_KEY)
    if (raw === null) return fallback

    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return fallback
    return clampValidationWorkbenchHeight(parsed)
  } catch {
    return fallback
  }
}

export function writePersistedSheetWorkbenchHeight(height: number): void {
  try {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(
      SHEET_WORKBENCH_HEIGHT_STORAGE_KEY,
      String(clampValidationWorkbenchHeight(height)),
    )
  } catch {
    // localStorage may be unavailable or blocked; keep the in-memory height only.
  }
}
