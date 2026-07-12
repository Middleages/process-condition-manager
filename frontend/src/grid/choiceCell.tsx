/**
 * choice(선택지) 파라미터용 Glide 커스텀 셀.
 *
 * Glide 코어에는 드롭다운 셀이 없다. 공식 애드온(@glideapps/glide-data-grid-cells)의
 * DropdownCell은 react-select와 @toast-ui/editor(마크다운 WYSIWYG)까지 끌고 와서 폐쇄망
 * 배포(D-12)에 과하다. 그래서 코어만으로 자체 구현한다 — 값 + ▾를 캔버스에 그리고, 편집
 * 오버레이로 네이티브 <select>를 띄운다. 이 커스텀 셀 타입은 어댑터(grid/) 안에만 존재하며
 * 라이브러리 경계 바깥으로 새어나가지 않는다(P4).
 */
import { GridCellKind, drawTextCell } from '@glideapps/glide-data-grid'
import type {
  CustomCell,
  CustomRenderer,
  ProvideEditorComponent,
  Theme,
} from '@glideapps/glide-data-grid'

export interface ChoiceCellData {
  readonly kind: 'choice-cell'
  readonly value: string
  readonly options: readonly string[]
}

export type ChoiceCell = CustomCell<ChoiceCellData>

export function isChoiceCell(cell: CustomCell): cell is ChoiceCell {
  return (cell.data as Partial<ChoiceCellData>).kind === 'choice-cell'
}

/** choice 셀 팩토리. themeOverride로 그룹 배경/상태 오버레이를 전달받는다. */
export function makeChoiceCell(
  value: string,
  options: readonly string[],
  readOnly: boolean,
  themeOverride?: Partial<Theme>,
): ChoiceCell {
  return {
    kind: GridCellKind.Custom,
    allowOverlay: !readOnly,
    readonly: readOnly,
    copyData: value,
    themeOverride,
    data: { kind: 'choice-cell', value, options },
  }
}

const ChoiceEditor: ProvideEditorComponent<ChoiceCell> = (props) => {
  const { value: cell, onFinishedEditing } = props
  const { value, options } = cell.data
  return (
    <select
      autoFocus
      defaultValue={value}
      style={{
        width: '100%',
        height: '100%',
        border: 'none',
        outline: 'none',
        padding: '0 8px',
        background: 'transparent',
        font: 'inherit',
      }}
      onChange={(event) => {
        const next = event.target.value
        onFinishedEditing({ ...cell, copyData: next, data: { ...cell.data, value: next } })
      }}
    >
      <option value="">(비움)</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  )
}

export const choiceCellRenderer: CustomRenderer<ChoiceCell> = {
  kind: GridCellKind.Custom,
  isMatch: isChoiceCell,
  draw: (args, cell) => {
    // 값은 좌측, 드롭다운 표식(▾)은 우측에 옅게.
    drawTextCell(args, cell.data.value, cell.contentAlign)
    drawTextCell(args, '▾', 'right')
  },
  provideEditor: () => ({
    editor: ChoiceEditor,
    disablePadding: true,
  }),
  onPaste: (val, data) => ({ ...data, value: val }),
}
