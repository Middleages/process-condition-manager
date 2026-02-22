import { useEffect, useRef, useCallback, useState } from 'react'
import { useEditorStore } from '@/stores/useEditorStore'
import { useToastStore } from '@/stores/useToastStore'

const AUTO_SAVE_INTERVAL = 30_000 // 30 seconds

interface UseAutoSaveOptions {
  /** Function to execute the save */
  onSave: () => Promise<void>
  /** Whether auto-save is enabled */
  enabled: boolean
}

export function useAutoSave({ onSave, enabled }: UseAutoSaveOptions) {
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isSavingRef = useRef(false)

  const doAutoSave = useCallback(async () => {
    const { dirtyCells, isSaving } = useEditorStore.getState()

    // Skip if no dirty cells, or manual save is in progress
    if (dirtyCells.size === 0 || isSaving || isSavingRef.current) return

    isSavingRef.current = true
    try {
      await onSave()
      const now = new Date()
      setLastSavedAt(
        now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      )
    } catch {
      useToastStore.getState().addToast('자동 저장에 실패했습니다. 수동으로 저장해주세요.', 'error')
    } finally {
      isSavingRef.current = false
    }
  }, [onSave])

  useEffect(() => {
    if (!enabled) {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      return
    }

    timerRef.current = setInterval(doAutoSave, AUTO_SAVE_INTERVAL)

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [enabled, doAutoSave])

  return { lastSavedAt }
}
