/**
 * 조건표 그리드 어댑터 인터페이스 초안 (Phase 1 T7 / EC3).
 *
 * 목적: 그리드 라이브러리(Glide Data Grid / RevoGrid 등)를 이 인터페이스 뒤에 두어
 * PoC 결정이 이후 전체를 인질로 잡지 않게 한다(01-architecture P4 그리드 어댑터).
 * Phase 2 편집기는 이 계약만 알고, 구현체는 교체 가능하다.
 *
 * 결정 로그: plan/03-grid-evaluation.md §7, plan/README.md D-18.
 */
import type { ReactNode } from 'react'

export type CellValueType = 'text' | 'number' | 'choice' | 'date' | 'boolean'

/** 레지스트리 파라미터 1개 = 그리드 컬럼 1개 (동적 구성). */
export interface ConditionGridColumn {
  key: string // parameter_code
  headerName: string // display_name
  valueType: CellValueType
  categoryCode: string | null // 카테고리 탭/필터의 근거
  unit?: string | null
  description?: string | null // 헤더 툴팁(축약 컬럼명 전체 의미)
  choiceOptions?: readonly string[] // choice 에디터
  pinned?: boolean // 좌측 고정(식별 컬럼)
}

/** 시트의 행 = layer 안의 조건 행(layer_condition). 같은 layer는 그룹으로 묶인다. */
export interface ConditionGridRow {
  id: string // condition_id
  layerKey: string
  layerLabel: string // "layer_id (step_seq)"
  conditionLabel: string
  isPor: boolean // POR 라디오 컬럼(layer당 1개)
  values: Record<string, string | null> // parameter_code -> value_text
}

/** 편집으로 생긴 더티 셀 (저장 시 배치 UPSERT 대상). */
export interface DirtyCell {
  conditionId: string
  parameterCode: string
  value: string | null
}

/** 붙여넣기 스테이징: 적용 전 타입 검사 결과를 표시한다. */
export interface PasteStagingCell {
  conditionId: string
  parameterCode: string
  value: string | null
  valid: boolean
  message?: string
}

/** 셀 상태 오버레이(검증 오류/더티/코멘트 하이라이트). */
export interface CellStatus {
  conditionId: string
  parameterCode: string
  state: 'error' | 'dirty' | 'comment'
  message?: string
}

export interface ConditionGridData {
  columns: readonly ConditionGridColumn[]
  rows: readonly ConditionGridRow[]
  statuses?: readonly CellStatus[]
}

export interface ConditionGridCallbacks {
  onCellEdit?(cell: DirtyCell): void
  onPaste?(target: { conditionId: string; parameterCode: string }, tsv: string): void
  onPorChange?(layerKey: string, conditionId: string): void
}

export interface ConditionGridViewState {
  activeCategory?: string | null // 카테고리 탭(컬럼 부분집합)
  columnSearch?: string // 컬럼 검색-점프
  readOnly?: boolean // 비보유 잠금/승인본 렌더링
}

/**
 * 구현체가 만족해야 하는 어댑터 계약.
 * Phase 2에서 확정 라이브러리로 구현한다 (PoC 코드는 폐기 가능).
 */
export interface ConditionGridAdapter {
  render(props: {
    data: ConditionGridData
    view?: ConditionGridViewState
    callbacks?: ConditionGridCallbacks
  }): ReactNode
  /** 특정 셀로 스크롤 점프(검증 오류 목록 → 셀 이동). */
  scrollToCell(conditionId: string, parameterCode: string): void
  /** 스테이징된 붙여넣기 셀 목록을 반환(적용 전 미리보기). */
  getPasteStaging(): readonly PasteStagingCell[]
}
