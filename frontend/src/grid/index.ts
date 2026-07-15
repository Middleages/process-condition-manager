/**
 * 조건표 그리드 어댑터의 공개 표면.
 *
 * 상위 코드는 여기(또는 `./types`)에서만 import 한다. 구현체(Glide)는 `GlideConditionGrid`
 * 하나로 노출하고, 라이브러리 타입은 새어나가지 않는다. 라이브러리를 교체하면 이 배럴이
 * 가리키는 구현만 바꾼다(계약·상위 코드 불변).
 */
export { GlideConditionGrid } from './GlideConditionGrid'
export type {
  CellStatus,
  CellValueType,
  ConditionGridCallbacks,
  ConditionGridColumn,
  ConditionGridComponent,
  ConditionGridData,
  ConditionGridHandle,
  ConditionGridProps,
  ConditionGridRow,
  ConditionGridViewState,
  DirtyCell,
  PasteStagingCell,
  SheetChoiceResource,
} from './types'
