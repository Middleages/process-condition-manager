import { useState, type KeyboardEvent } from 'react'
import { GridCellKind, drawTextCell } from '@glideapps/glide-data-grid'
import type {
  CustomCell,
  CustomRenderer,
  ProvideEditorComponent,
  Theme,
} from '@glideapps/glide-data-grid'

import { normalizeDecimalInput } from '@/shared/domain/decimal'

import { formatNumberDisplay } from './model'

export interface DecimalCellData {
  readonly kind: 'decimal-cell'
  readonly value: string | null
  readonly unit: string | null
}

export type DecimalCell = CustomCell<DecimalCellData>

export function isDecimalCell(cell: CustomCell): cell is DecimalCell {
  return (cell.data as Partial<DecimalCellData>).kind === 'decimal-cell'
}

export function makeDecimalCell(
  value: string | null,
  unit: string | null,
  readOnly: boolean,
  themeOverride?: Partial<Theme>,
): DecimalCell {
  return {
    kind: GridCellKind.Custom,
    allowOverlay: !readOnly,
    readonly: readOnly,
    copyData: value ?? '',
    contentAlign: 'right',
    themeOverride,
    data: { kind: 'decimal-cell', value, unit },
  }
}

export type DecimalDraftResult =
  | { ok: true; value: string | null }
  | { ok: false; code: 'invalid_decimal'; message: string }

export function validateDecimalDraft(raw: string): DecimalDraftResult {
  const result = normalizeDecimalInput(raw)
  if (result.kind === 'empty') return { ok: true, value: null }
  if (result.kind === 'valid') return { ok: true, value: result.value }
  return {
    ok: false,
    code: 'invalid_decimal',
    message:
      result.reason === 'too_long'
        ? '소수 입력은 256자 이하여야 합니다.'
        : result.reason === 'too_many_digits'
          ? '소수 입력은 숫자 128자리 이하여야 합니다.'
          : '지수·쉼표 없이 소수 형식으로 입력해 주세요.',
  }
}

export function commitDecimalDraft(
  raw: string,
  commit: (value: string | null) => void,
): DecimalDraftResult {
  const result = validateDecimalDraft(raw)
  if (result.ok) commit(result.value)
  return result
}

export const DecimalEditor: ProvideEditorComponent<DecimalCell> = ({
  value: cell,
  initialValue,
  onFinishedEditing,
}) => {
  const [draft, setDraft] = useState(initialValue ?? cell.data.value ?? '')
  const [error, setError] = useState<string | null>(null)

  const finish = (): void => {
    const result = commitDecimalDraft(draft, (value) => {
      setError(null)
      onFinishedEditing({
        ...cell,
        copyData: value ?? '',
        data: { ...cell.data, value },
      })
    })
    if (!result.ok) setError(result.message)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      finish()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onFinishedEditing(undefined)
    }
  }

  return (
    <div className="grid min-w-0 gap-1 bg-surface p-2">
      <input
        autoFocus
        aria-invalid={error === null ? undefined : true}
        className="input w-full font-mono"
        inputMode="decimal"
        value={draft}
        onChange={(event) => {
          const next = event.currentTarget.value
          setDraft(next)
          if (error !== null && validateDecimalDraft(next).ok) setError(null)
        }}
        onKeyDown={onKeyDown}
      />
      {error !== null ? (
        <p className="text-xs text-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export const decimalCellRenderer: CustomRenderer<DecimalCell> = {
  kind: GridCellKind.Custom,
  isMatch: isDecimalCell,
  draw: (args, cell) => {
    drawTextCell(args, formatNumberDisplay(cell.data.value, cell.data.unit), 'right')
  },
  provideEditor: () => ({ editor: DecimalEditor, disablePadding: true }),
  onPaste: (raw, data) => {
    const result = validateDecimalDraft(raw)
    return result.ok ? { ...data, value: result.value } : data
  },
}
