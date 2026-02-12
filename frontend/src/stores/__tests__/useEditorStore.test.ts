import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from '@/stores/useEditorStore'

// Reset the store before each test to ensure isolation
beforeEach(() => {
  useEditorStore.getState().reset()
})

// ===========================================================================
// setCellValue
// ===========================================================================
describe('setCellValue', () => {
  it('adds a dirty cell when value differs from original', () => {
    const { setCellValue } = useEditorStore.getState()

    setCellValue(10, 'col_a', 'new_value', 'old_value')

    const { dirtyCells } = useEditorStore.getState()
    expect(dirtyCells.size).toBe(1)

    const cell = dirtyCells.get('10:col_a')
    expect(cell).toBeDefined()
    expect(cell!.projectLayerId).toBe(10)
    expect(cell!.columnName).toBe('col_a')
    expect(cell!.value).toBe('new_value')
    expect(cell!.originalValue).toBe('old_value')
  })

  it('removes dirty cell when value matches original', () => {
    const { setCellValue } = useEditorStore.getState()

    // First, create a dirty cell
    setCellValue(10, 'col_a', 'changed', 'original')
    expect(useEditorStore.getState().dirtyCells.size).toBe(1)

    // Then set it back to original
    setCellValue(10, 'col_a', 'original', 'original')
    expect(useEditorStore.getState().dirtyCells.size).toBe(0)
  })

  it('overwrites existing dirty cell with new value', () => {
    const { setCellValue } = useEditorStore.getState()

    setCellValue(10, 'col_a', 'first_edit', 'original')
    setCellValue(10, 'col_a', 'second_edit', 'original')

    const { dirtyCells } = useEditorStore.getState()
    expect(dirtyCells.size).toBe(1)
    expect(dirtyCells.get('10:col_a')!.value).toBe('second_edit')
  })

  it('handles multiple different cells independently', () => {
    const { setCellValue } = useEditorStore.getState()

    setCellValue(10, 'col_a', 'v1', 'o1')
    setCellValue(10, 'col_b', 'v2', 'o2')
    setCellValue(20, 'col_a', 'v3', 'o3')

    const { dirtyCells } = useEditorStore.getState()
    expect(dirtyCells.size).toBe(3)
    expect(dirtyCells.has('10:col_a')).toBe(true)
    expect(dirtyCells.has('10:col_b')).toBe(true)
    expect(dirtyCells.has('20:col_a')).toBe(true)
  })
})

// ===========================================================================
// clearAllDirty
// ===========================================================================
describe('clearAllDirty', () => {
  it('clears all dirty cells', () => {
    const store = useEditorStore.getState()
    store.setCellValue(1, 'a', 'x', 'y')
    store.setCellValue(2, 'b', 'x', 'y')

    expect(useEditorStore.getState().dirtyCells.size).toBe(2)

    useEditorStore.getState().clearAllDirty()

    expect(useEditorStore.getState().dirtyCells.size).toBe(0)
  })

  it('is safe to call when already empty', () => {
    useEditorStore.getState().clearAllDirty()
    expect(useEditorStore.getState().dirtyCells.size).toBe(0)
  })
})

// ===========================================================================
// getDirtyCellsForLayer
// ===========================================================================
describe('getDirtyCellsForLayer', () => {
  it('returns only cells for the specified projectLayerId', () => {
    const store = useEditorStore.getState()
    store.setCellValue(10, 'col_a', 'v1', 'o1')
    store.setCellValue(10, 'col_b', 'v2', 'o2')
    store.setCellValue(20, 'col_a', 'v3', 'o3')

    const layer10Cells = useEditorStore.getState().getDirtyCellsForLayer(10)
    expect(layer10Cells).toHaveLength(2)
    expect(layer10Cells.every((c) => c.projectLayerId === 10)).toBe(true)

    const layer20Cells = useEditorStore.getState().getDirtyCellsForLayer(20)
    expect(layer20Cells).toHaveLength(1)
    expect(layer20Cells[0].projectLayerId).toBe(20)
  })

  it('returns empty array for a layer with no dirty cells', () => {
    const store = useEditorStore.getState()
    store.setCellValue(10, 'col_a', 'v1', 'o1')

    const cells = useEditorStore.getState().getDirtyCellsForLayer(99)
    expect(cells).toHaveLength(0)
  })

  it('returns empty array when no dirty cells exist', () => {
    const cells = useEditorStore.getState().getDirtyCellsForLayer(10)
    expect(cells).toHaveLength(0)
  })
})

// ===========================================================================
// hasDirtyCells
// ===========================================================================
describe('hasDirtyCells', () => {
  it('returns false when no dirty cells exist', () => {
    expect(useEditorStore.getState().hasDirtyCells()).toBe(false)
  })

  it('returns true when dirty cells exist', () => {
    useEditorStore.getState().setCellValue(1, 'a', 'new', 'old')
    expect(useEditorStore.getState().hasDirtyCells()).toBe(true)
  })
})

// ===========================================================================
// reset
// ===========================================================================
describe('reset', () => {
  it('resets all state to initial values', () => {
    const store = useEditorStore.getState()

    // Mutate various pieces of state
    store.setActiveCategory('OVL')
    store.setActiveLayerId(42)
    store.setCellValue(1, 'x', 'new', 'old')
    store.setValidationErrors([
      {
        layer_id: 1,
        layer_name: 'AA',
        column_name: 'x',
        display_name: 'X',
        rule_type: 'required',
        message: 'Required',
      },
    ])
    store.setIsSaving(true)

    // Reset
    store.reset()

    const state = useEditorStore.getState()
    expect(state.activeCategory).toBe('SP')
    expect(state.activeLayerId).toBeNull()
    expect(state.dirtyCells.size).toBe(0)
    expect(state.validationErrors).toEqual([])
    expect(state.isSaving).toBe(false)
  })
})

// ===========================================================================
// setActiveCategory / setActiveLayerId
// ===========================================================================
describe('setActiveCategory', () => {
  it('updates active category', () => {
    useEditorStore.getState().setActiveCategory('DEV')
    expect(useEditorStore.getState().activeCategory).toBe('DEV')
  })
})

describe('setActiveLayerId', () => {
  it('sets active layer id', () => {
    useEditorStore.getState().setActiveLayerId(5)
    expect(useEditorStore.getState().activeLayerId).toBe(5)
  })

  it('sets active layer id to null', () => {
    useEditorStore.getState().setActiveLayerId(5)
    useEditorStore.getState().setActiveLayerId(null)
    expect(useEditorStore.getState().activeLayerId).toBeNull()
  })
})

// ===========================================================================
// setValidationErrors / setIsSaving
// ===========================================================================
describe('setValidationErrors', () => {
  it('sets validation errors', () => {
    const errors = [
      {
        layer_id: 1,
        layer_name: 'AA',
        column_name: 'x',
        display_name: 'X',
        rule_type: 'required',
        message: 'Required',
      },
    ]
    useEditorStore.getState().setValidationErrors(errors)
    expect(useEditorStore.getState().validationErrors).toEqual(errors)
  })
})

describe('setIsSaving', () => {
  it('sets saving state', () => {
    useEditorStore.getState().setIsSaving(true)
    expect(useEditorStore.getState().isSaving).toBe(true)
    useEditorStore.getState().setIsSaving(false)
    expect(useEditorStore.getState().isSaving).toBe(false)
  })
})
