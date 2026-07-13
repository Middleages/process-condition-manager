export interface SheetInteractionInput {
  readOnly: boolean
  writeBusy: boolean
  hasPaste: boolean
}

export interface SheetInteractionPolicy {
  mode: 'editable' | 'read-only' | 'write-busy' | 'paste-review'
  canEditCells: boolean
  canStagePaste: boolean
  canSwitchCategory: boolean
  canManageConditions: boolean
  canTransferPor: boolean
  canApplyPaste: boolean
  canCancelPaste: boolean
}

const DISCOVERY_ONLY = {
  canEditCells: false,
  canStagePaste: false,
  canSwitchCategory: true,
  canManageConditions: false,
  canTransferPor: false,
  canApplyPaste: false,
  canCancelPaste: false,
} as const

/**
 * 시트의 모든 상호작용 허용 여부를 한 번에 결정한다.
 *
 * 붙여넣기 검토는 다른 상태보다 우선한다. 잠금을 잃거나 쓰기 큐가 바빠져도 검토 결과는
 * 유지되고 취소는 가능하지만, 적용을 포함한 모든 데이터 변경은 중단된다. 읽기 전용/쓰기 중에도
 * 카테고리와 검색은 데이터 변경이 아닌 발견 동작이므로 계속 사용할 수 있다.
 */
export function resolveSheetInteraction({
  readOnly,
  writeBusy,
  hasPaste,
}: SheetInteractionInput): SheetInteractionPolicy {
  if (hasPaste) {
    return {
      mode: 'paste-review',
      canEditCells: false,
      canStagePaste: false,
      canSwitchCategory: false,
      canManageConditions: false,
      canTransferPor: false,
      canApplyPaste: !readOnly && !writeBusy,
      canCancelPaste: true,
    }
  }

  if (readOnly) return { mode: 'read-only', ...DISCOVERY_ONLY }
  if (writeBusy) return { mode: 'write-busy', ...DISCOVERY_ONLY }

  return {
    mode: 'editable',
    canEditCells: true,
    canStagePaste: true,
    canSwitchCategory: true,
    canManageConditions: true,
    canTransferPor: true,
    canApplyPaste: false,
    canCancelPaste: false,
  }
}
