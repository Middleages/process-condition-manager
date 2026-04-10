import { describe, expect, it } from 'vitest'
import {
  getStateAfterLineChange,
  getStateAfterProcessChange,
  isCreateSubmitDisabled,
  type CreateModalSelectionState,
} from '../ProjectCreateModalV2'

function buildState(overrides?: Partial<CreateModalSelectionState>): CreateModalSelectionState {
  return {
    selectedLineId: 1,
    selectedProcessId: 'PROC-A',
    selectedPartId: 'PART-01',
    deviceType: 'full',
    selectedLayerIds: [],
    backboneConditionId: '',
    ...overrides,
  }
}

describe('ProjectCreateModalV2 cascading selection logic', () => {
  it('resets process/part/device/layer/backbone when line changes', () => {
    const prev = buildState({
      selectedLineId: 1,
      selectedProcessId: 'PROC-A',
      selectedPartId: 'PART-01',
      deviceType: 'short',
      selectedLayerIds: ['L1', 'L2'],
      backboneConditionId: '100',
    })

    const next = getStateAfterLineChange('2', prev)

    expect(next.selectedLineId).toBe(2)
    expect(next.selectedProcessId).toBe('')
    expect(next.selectedPartId).toBe('')
    expect(next.deviceType).toBe('full')
    expect(next.selectedLayerIds).toEqual([])
    expect(next.backboneConditionId).toBe('')
  })

  it('resets part when process changes', () => {
    const prev = buildState({
      selectedProcessId: 'PROC-A',
      selectedPartId: 'PART-01',
    })

    const next = getStateAfterProcessChange('PROC-B', prev)

    expect(next.selectedProcessId).toBe('PROC-B')
    expect(next.selectedPartId).toBe('')
  })
})

describe('ProjectCreateModalV2 submit guard', () => {
  it('requires part selection (part dropdown forced)', () => {
    const disabled = isCreateSubmitDisabled({
      state: buildState({ selectedPartId: '' }),
      selectableLayerRefCount: 3,
      hasDuplicate: false,
      isCheckingDuplicate: false,
      isCreating: false,
    })

    expect(disabled).toBe(true)
  })

  it('disables submit in short mode when no layer is selected', () => {
    const disabled = isCreateSubmitDisabled({
      state: buildState({ deviceType: 'short', selectedLayerIds: [] }),
      selectableLayerRefCount: 3,
      hasDuplicate: false,
      isCheckingDuplicate: false,
      isCreating: false,
    })

    expect(disabled).toBe(true)
  })

  it('enables submit when line/process/part are selected and constraints are satisfied', () => {
    const disabled = isCreateSubmitDisabled({
      state: buildState(),
      selectableLayerRefCount: 3,
      hasDuplicate: false,
      isCheckingDuplicate: false,
      isCreating: false,
    })

    expect(disabled).toBe(false)
  })
})

