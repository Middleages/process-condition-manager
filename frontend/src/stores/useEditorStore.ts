import { create } from 'zustand'
import type { DirtyCell, ValidationError } from '@/types'

function cellKey(projectLayerId: number, columnName: string) {
  return `${projectLayerId}:${columnName}`
}

interface EditorState {
  // Active selections
  activeCategory: string // "SP" | "SC" | "OVL" | "DEV"
  activeLayerId: number | null

  // Dirty cells (unsaved edits)
  dirtyCells: Map<string, DirtyCell>

  // Recipe-applied cells (green highlight) — key: `${projectLayerId}:${columnName}`
  recipeCells: Set<string>

  // Client-side validation errors
  validationErrors: ValidationError[]

  // Saving state
  isSaving: boolean

  // History panel state
  isHistoryPanelOpen: boolean
  cellHistoryTarget: { projectLayerId: number; columnName: string; layerName: string } | null

  // Actions
  setActiveCategory: (code: string) => void
  setActiveLayerId: (layerId: number | null) => void
  setCellValue: (projectLayerId: number, columnName: string, value: unknown, originalValue: unknown) => void
  removeDirtyCell: (projectLayerId: number, columnName: string) => void
  clearAllDirty: () => void
  getDirtyCellsForLayer: (projectLayerId: number) => DirtyCell[]
  hasDirtyCells: () => boolean
  setValidationErrors: (errors: ValidationError[]) => void
  setIsSaving: (saving: boolean) => void
  addRecipeCells: (keys: string[]) => void
  clearRecipeCells: () => void
  reset: () => void
  toggleHistoryPanel: () => void
  openCellHistory: (projectLayerId: number, columnName: string, layerName: string) => void
  closeCellHistory: () => void
}

export const useEditorStore = create<EditorState>((set, get) => ({
  activeCategory: 'SP',
  activeLayerId: null,
  dirtyCells: new Map(),
  recipeCells: new Set(),
  validationErrors: [],
  isSaving: false,
  isHistoryPanelOpen: false,
  cellHistoryTarget: null,

  setActiveCategory: (code) => set({ activeCategory: code }),

  setActiveLayerId: (layerId) => set({ activeLayerId: layerId }),

  setCellValue: (projectLayerId, columnName, value, originalValue) => {
    set((state) => {
      const newMap = new Map(state.dirtyCells)
      const key = cellKey(projectLayerId, columnName)

      // If value matches original, remove from dirty
      if (value === originalValue) {
        newMap.delete(key)
      } else {
        newMap.set(key, { projectLayerId, columnName, value, originalValue })
      }

      return { dirtyCells: newMap }
    })
  },

  removeDirtyCell: (projectLayerId, columnName) => {
    set((state) => {
      const newMap = new Map(state.dirtyCells)
      newMap.delete(cellKey(projectLayerId, columnName))
      return { dirtyCells: newMap }
    })
  },

  clearAllDirty: () => set({ dirtyCells: new Map() }),

  getDirtyCellsForLayer: (projectLayerId) => {
    const { dirtyCells } = get()
    const result: DirtyCell[] = []
    for (const cell of dirtyCells.values()) {
      if (cell.projectLayerId === projectLayerId) {
        result.push(cell)
      }
    }
    return result
  },

  hasDirtyCells: () => get().dirtyCells.size > 0,

  setValidationErrors: (errors) => set({ validationErrors: errors }),

  setIsSaving: (saving) => set({ isSaving: saving }),

  addRecipeCells: (keys) => {
    set((state) => {
      const newSet = new Set(state.recipeCells)
      for (const k of keys) newSet.add(k)
      return { recipeCells: newSet }
    })
  },

  clearRecipeCells: () => set({ recipeCells: new Set() }),

  reset: () =>
    set({
      activeCategory: 'SP',
      activeLayerId: null,
      dirtyCells: new Map(),
      recipeCells: new Set(),
      validationErrors: [],
      isSaving: false,
      isHistoryPanelOpen: false,
      cellHistoryTarget: null,
    }),

  toggleHistoryPanel: () => set((state) => ({ isHistoryPanelOpen: !state.isHistoryPanelOpen })),

  openCellHistory: (projectLayerId, columnName, layerName) =>
    set({ cellHistoryTarget: { projectLayerId, columnName, layerName } }),

  closeCellHistory: () => set({ cellHistoryTarget: null }),
}))
