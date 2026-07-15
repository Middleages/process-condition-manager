/**
 * 조건표 그리드 어댑터 계약 (Phase 2 T2에서 확정).
 *
 * 목적: 그리드 라이브러리(Glide Data Grid — D-18 확정, RevoGrid는 대안)를 이 계약 뒤에
 * 두어 라이브러리 선택이 이후 전체를 인질로 잡지 않게 한다(01-architecture P4). Phase 2
 * 편집기는 이 계약만 알고, 구현체는 교체 가능하다. "라이브러리 API가 어댑터 밖으로
 * 새어나가지 않는지"가 리뷰 기준(P4).
 *
 * ── Phase 1 초안 대비 변경 (2026-07-11, T2) ─────────────────────────────────
 * 초안(`ConditionGridAdapter`)은 `render(props): ReactNode` 메서드에 명령형
 * `scrollToCell()`/`getPasteStaging()`가 섞여 React 관용에 맞지 않았다. 다음과 같이
 * 재설계했다. **의미 계약은 100% 유지**하고 형태만 바꿨다.
 *
 * 1. `render()` 메서드 제거 → 구현체는 **그냥 forwardRef React 컴포넌트**
 *    (`ConditionGridComponent`)다. JSX로 `<GlideConditionGrid ... ref={...} />`처럼 쓴다.
 * 2. 명령형 메서드는 `useImperativeHandle`로 노출하는 **ref 핸들**(`ConditionGridHandle`)로
 *    분리 — 네비게이션 명령(`scrollToCell`, `scrollToColumn`)만 남긴다.
 * 3. `getPasteStaging()`(그리드에서 스테이징을 *꺼내는* getter) 제거 → 스테이징은
 *    **props로 내려주는**(`ConditionGridProps.pasteStaging`) 오버레이로 바꿨다. 스테이징
 *    "계산"은 상위(T4)의 몫이고 그리드는 "렌더"만 한다 — 데이터는 아래로, 콜백은 위로.
 *    (셀 상태 `statuses`와 동일한 push 모델로 통일.)
 * 4. `scrollToColumn(parameterCode)` 신설 — 컬럼 검색-점프용(T6).
 *
 * 유지된 의미 계약: 동적 컬럼 / 셀 타입별 에디터 / 카테고리 필터 / 컬럼 고정 /
 * 붙여넣기 스테이징 / 셀 상태 오버레이 / 더티 배치 / 조건 행 그룹핑.
 *
 * 결정 로그: plan/03-grid-evaluation.md §7, plan/README.md D-18, plan/phase-2-tasks.md T2.
 */
import type { ForwardRefExoticComponent, RefAttributes } from 'react'
import type { ChoiceOptionAggregate } from '@/api/types'

export type CellValueType = 'text' | 'number' | 'choice'

export interface SheetChoiceResource {
  setCode: string
  targetVersion: number
  summaryVersion: number | null
  setIsActive: boolean | null
  displayAggregate: ChoiceOptionAggregate | null
  selectableAggregate: ChoiceOptionAggregate | null
  selectionReady: boolean
  isStale: boolean
  loading: boolean
  error: string | null
  prepareToOpen: () => Promise<void>
  retry: () => Promise<void>
}

export type CellValidationErrorCode =
  | 'invalid_decimal'
  | 'choice_resource_unavailable'
  | 'choice_set_inactive'
  | 'choice_option_inactive'
  | 'choice_unknown'

/** 레지스트리 파라미터 1개 = 그리드 컬럼 1개 (동적 구성). */
export interface ConditionGridColumn {
  key: string // parameter_code
  headerName: string // display_name
  valueType: CellValueType
  categoryCode: string | null // 카테고리 탭/필터의 근거
  unit?: string | null
  description?: string | null // 헤더 툴팁(축약 컬럼명 전체 의미)
  choiceSetCode: string | null
  choiceSetVersion: number | null
  pinned?: boolean // 좌측 고정(식별 컬럼)
}

/**
 * 시트의 행 = layer 안의 조건 행(layer_condition).
 *
 * 행 그룹핑(D-16): 같은 `layerKey`의 **연속된** 행은 하나의 그룹으로 묶여 시각적으로
 * 표시된다. Glide Data Grid는 row span(셀 병합)이 없으므로, 구현체는 그룹의 **첫 행에만
 * layer 라벨**(`layerLabel`)을 렌더링하고 이후 행은 공백 처리하며, 그룹 경계를 배경색
 * 구분/경계선 등으로 드러낸다. rows는 이미 layer→조건 순서로 정렬되어 전달된다고 본다.
 */
export interface ConditionGridRow {
  id: string // condition_id
  layerKey: string
  layerLabel: string // "layer_id (step_seq)"
  conditionLabel: string
  isPor: boolean // POR 라디오 컬럼(layer당 1개)
  values: Record<string, string | null> // parameter_code -> value_text
}

/** 편집으로 생긴 더티 셀 (저장 시 배치 UPSERT 대상 — T3). */
export interface DirtyCell {
  conditionId: string
  parameterCode: string
  value: string | null
}

/**
 * 붙여넣기 스테이징 셀: 적용 전 타입 검사 결과.
 *
 * 계산은 상위(T4)가 하고, 그리드는 `ConditionGridProps.pasteStaging`로 받아 오버레이만
 * 그린다(적용될 셀/불일치 셀 하이라이트).
 */
export interface PasteStagingCell {
  conditionId: string
  parameterCode: string
  value: string | null
  valid: boolean
  message?: string
  errorCode?: CellValidationErrorCode
}

/** 셀 상태 오버레이. 독립 사실을 합성해 검증 표시가 dirty/comment 정보를 지우지 않는다. */
export interface CellStatus {
  conditionId: string
  parameterCode: string
  validation?: {
    severity: 'error' | 'warning'
    count: number
    message: string
  }
  dirty: boolean
  commentCount?: number
}

export interface ConditionGridData {
  columns: readonly ConditionGridColumn[]
  rows: readonly ConditionGridRow[]
  statuses?: readonly CellStatus[]
  /** set code별 공유 resource. 셀/column별 option 복제를 만들지 않는다. */
  choiceResources?: ReadonlyMap<string, SheetChoiceResource>
}

export interface ConditionGridCallbacks {
  /** 셀 편집 확정 → 더티 버퍼 진입(T3). */
  onCellEdit?(cell: DirtyCell): void
  /**
   * 범위 붙여넣기 가로채기. 그리드는 기본 붙여넣기를 막고, 붙여넣기 대상 좌상단 셀과
   * 원본 TSV 텍스트를 넘긴다. 스테이징 파이프라인 구현은 T4의 몫.
   */
  onPaste?(target: { conditionId: string; parameterCode: string }, tsv: string): void
  /** POR 이양(T7) — layer당 1개 강제는 서버가 담당. */
  onPorChange?(layerKey: string, conditionId: string): void
  /**
   * 조건 행 관리(추가/복제/삭제) 대상 활성화(T7). 좌측 식별 컬럼(Layer/조건) 클릭 시 그 행을
   * 관리 대상으로 올린다. 실제 추가/복제/삭제 UI와 API 호출은 상위(SheetEditor)의 몫 —
   * 그리드는 어떤 행이 선택됐는지 도메인 좌표(conditionId, layerKey)로만 보고한다(픽셀 좌표
   * 같은 라이브러리/표현 세부는 경계 밖으로 내보내지 않는다, P4).
   */
  onConditionActivate?(payload: { conditionId: string; layerKey: string }): void
}

export interface ConditionGridViewState {
  activeCategory?: string | null // 카테고리 탭(컬럼 부분집합). null/undefined = 전체
  columnSearch?: string // 컬럼 검색-점프(T6) — 실제 점프는 scrollToColumn 핸들 사용
  readOnly?: boolean // 비보유 잠금/승인본 렌더링
}

/**
 * 명령형 핸들: React 데이터 흐름(props)으로 표현하기 어려운 "특정 위치로 스크롤" 같은
 * 일회성 명령만 노출한다. 구현체는 `useImperativeHandle`로 이 형태를 만족시킨다.
 */
export interface ConditionGridHandle {
  /** 특정 셀로 스크롤 점프(검증 오류 목록 → 셀 이동, Phase 3). */
  scrollToCell(conditionId: string, parameterCode: string): void
  /** 특정 파라미터 컬럼으로 스크롤 점프(컬럼 검색-점프, T6). */
  scrollToColumn(parameterCode: string): void
}

/** 그리드 컴포넌트 props. 데이터는 아래로(props), 이벤트는 위로(callbacks). */
export interface ConditionGridProps {
  data: ConditionGridData
  view?: ConditionGridViewState
  callbacks?: ConditionGridCallbacks
  /**
   * 붙여넣기 스테이징 오버레이(적용 전 미리보기). 계산은 상위(T4), 렌더는 그리드.
   * `statuses`와 같은 push 오버레이.
   */
  pasteStaging?: readonly PasteStagingCell[]
}

/**
 * 구현체가 만족해야 하는 어댑터 계약.
 *
 * = props로 데이터를 받고 ref로 명령형 핸들을 노출하는 forwardRef React 컴포넌트.
 * Glide/RevoGrid 어느 구현이든 이 타입을 만족해야 하며, 라이브러리 타입은 이 경계
 * 바깥으로 새어나가지 않는다.
 */
export type ConditionGridComponent = ForwardRefExoticComponent<
  ConditionGridProps & RefAttributes<ConditionGridHandle>
>
