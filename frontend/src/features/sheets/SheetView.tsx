import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'

import { getApiErrorMessage } from '@/api/client'
import { addCondition, deleteCondition, setConditionPor } from '@/api/conditions'
import { getSheet } from '@/api/sheets'
import type { SheetOut } from '@/api/types'
import { GlideConditionGrid } from '@/grid'
import type {
  ConditionGridCallbacks,
  ConditionGridColumn,
  ConditionGridHandle,
  ConditionGridRow,
} from '@/grid'
import { distinctCategories, layersMissingPor, visibleParameterColumns } from '@/grid/model'
import { ErrorMessage, LoadingMessage } from '@/shared/components/StatusMessage'

import {
  applyDirtyToRows,
  selectDirtyCells,
  toCellStatuses,
  useEditStore,
  type DirtyCell,
} from './editStore'
import { buildPasteStaging, parseTsv, type PasteStagingResult } from './pasteStaging'
import {
  applySavedToSheet,
  toConditionGridData,
  toLockView,
  type SheetLockView,
} from './sheetAdapter'
import { useSheetEditing, type SheetEditing } from './useSheetEditing'

/**
 * 시트 조회 → 편집 가능한 그리드 렌더링 (T3 범위).
 *
 * 조회/빈-상태는 여기서 처리하고, 실제 편집(잠금·자동저장·더티 오버레이)은 시트가 준비된 뒤
 * 마운트되는 `SheetEditor`가 맡는다. `key={projectId}`로 프로젝트 전환 시 편집 세션이 자연히
 * 재시작(잠금 재획득·더티 리셋)되도록 한다.
 */
export function SheetView({ projectId }: { projectId: number }) {
  const sheetQuery = useQuery({
    queryKey: ['sheet', projectId],
    queryFn: () => getSheet(projectId),
  })

  if (sheetQuery.isLoading) return <LoadingMessage>시트를 불러오는 중...</LoadingMessage>
  if (sheetQuery.isError) return <ErrorMessage message={getApiErrorMessage(sheetQuery.error)} />
  if (!sheetQuery.data) return null

  const sheet = sheetQuery.data

  if (sheet.columns.length === 0 || sheet.rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
        표시할 컬럼 또는 조건 행이 없다 (레지스트리 파라미터 또는 layer/조건 행 확인).
      </p>
    )
  }

  return <SheetEditor key={projectId} projectId={projectId} sheet={sheet} />
}

/** 편집 세션. 시트가 준비된 뒤에만 마운트된다(잠금/자동저장 훅 규칙 준수). */
function SheetEditor({ projectId, sheet }: { projectId: number; sheet: SheetOut }) {
  const queryClient = useQueryClient()

  const data = useMemo(() => toConditionGridData(sheet), [sheet])
  const lock = useMemo(() => toLockView(sheet.lock), [sheet.lock])
  const dirtyCells = useEditStore(selectDirtyCells)

  // 저장 성공분을 서버 스냅샷(캐시)에 확정 반영 → 더티 제거 후에도 저장값 유지.
  const commitSaved = useCallback(
    (cells: DirtyCell[]) => {
      queryClient.setQueryData<SheetOut>(['sheet', projectId], (prev) =>
        prev ? applySavedToSheet(prev, cells) : prev,
      )
    },
    [queryClient, projectId],
  )

  const editing = useSheetEditing(projectId, { onPersisted: commitSaved })

  // 컬럼 가독성(T6): 카테고리 탭으로 파라미터 컬럼 부분집합을 고르고, 컬럼 검색-점프로 특정
  // 컬럼으로 스크롤한다. 좌측 식별 컬럼 고정·헤더 hover 툴팁은 어댑터가 내부에서 처리한다.
  const gridRef = useRef<ConditionGridHandle>(null)
  const categories = useMemo(() => distinctCategories(data.columns), [data.columns])
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [columnQuery, setColumnQuery] = useState('')

  // 서버 행 위에 더티 값을 얹어 표시(편집값 즉시 반영) + 더티 셀 상태 오버레이.
  const displayRows = useMemo(() => applyDirtyToRows(data.rows, dirtyCells), [data.rows, dirtyCells])
  const statuses = useMemo(() => toCellStatuses(dirtyCells), [dirtyCells])
  const gridData = useMemo(
    () => ({ ...data, rows: displayRows, statuses }),
    [data, displayRows, statuses],
  )

  // 붙여넣기 대상 매핑 기준 컬럼 순서 — 그리드가 view.activeCategory로 거르는 것과 동일한
  // 부분집합이어야 대상 셀 해석이 어긋나지 않는다(같은 activeCategory·같은 함수).
  const visibleColumns = useMemo(
    () => visibleParameterColumns(data.columns, activeCategory),
    [data.columns, activeCategory],
  )

  // 붙여넣기 스테이징(적용 전 미리보기). null = 대기 중인 붙여넣기 없음.
  const [paste, setPaste] = useState<PasteStagingResult | null>(null)
  const [pasteError, setPasteError] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)

  const { readOnly, setCell, applyPaste, runStructuralChange } = editing

  // 조건 행 관리(T7): 추가/복제/삭제 대상은 좌측 식별 컬럼 클릭으로 활성화한 행 하나다.
  // POR 이양은 활성 행과 무관하게 POR 컬럼 클릭으로 바로 실행한다. 구조 변경은 더티 셀 버퍼와
  // 분리된 즉시 API 호출(runStructuralChange)이고, 성공하면 시트 쿼리를 무효화해 다시 조회한다
  // (행 수/POR 지정이 바뀌는 구조적 변화라 부분 캐시 반영보다 재조회가 안전·단순).
  const [activeRow, setActiveRow] = useState<{ conditionId: string; layerKey: string } | null>(null)
  const [structError, setStructError] = useState<string | null>(null)
  const [structBusy, setStructBusy] = useState(false)
  const structInFlightRef = useRef(false) // 구조 변경 중복 실행(빠른 연타) 방지 — 동기 가드.

  const porGaps = useMemo(() => layersMissingPor(data.rows), [data.rows])
  const activeRowLabel = useMemo(() => {
    if (activeRow === null) return null
    const row = data.rows.find((candidate) => candidate.id === activeRow.conditionId)
    return row === undefined ? null : `${row.layerLabel} · ${row.conditionLabel}`
  }, [activeRow, data.rows])

  // 활성 행이 (삭제·외부 변경으로) 시트에서 사라지면 선택을 정리한다 — 없는 행에 대한 조작 방지.
  useEffect(() => {
    if (activeRow !== null && !data.rows.some((row) => row.id === activeRow.conditionId)) {
      setActiveRow(null)
    }
  }, [activeRow, data.rows])

  const refreshSheet = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['sheet', projectId] })
  }, [queryClient, projectId])

  // 구조 변경 공용 실행: 잠금 검사·더티 flush·잠금 상실 처리(runStructuralChange)를 감싸
  // UI 상태(진행 중/에러)와 재조회를 얹는다. 성공하면 true, 실패하면 에러를 표시하고 false.
  const performStructural = useCallback(
    async (fn: (token: string) => Promise<unknown>): Promise<boolean> => {
      if (structInFlightRef.current) return false
      structInFlightRef.current = true
      setStructBusy(true)
      setStructError(null)
      try {
        await runStructuralChange(fn)
        refreshSheet()
        return true
      } catch (error) {
        setStructError(getApiErrorMessage(error))
        return false
      } finally {
        structInFlightRef.current = false
        setStructBusy(false)
      }
    },
    [runStructuralChange, refreshSheet],
  )

  const handleAddEmpty = useCallback(() => {
    if (activeRow === null) return
    const layerKey = activeRow.layerKey
    void performStructural((token) => addCondition(projectId, layerKey, null, token))
  }, [activeRow, performStructural, projectId])

  const handleDuplicate = useCallback(() => {
    if (activeRow === null) return
    const { layerKey } = activeRow
    const sourceId = Number(activeRow.conditionId)
    void performStructural((token) => addCondition(projectId, layerKey, sourceId, token))
  }, [activeRow, performStructural, projectId])

  const handleDelete = useCallback(async () => {
    if (activeRow === null) return
    // 하드 삭제(셀 값까지 캐스케이드)라 되돌릴 수 없다 — 실행 전 한 번 확인한다.
    if (!window.confirm('이 조건 행을 삭제한다. 되돌릴 수 없다. 계속할까?')) return
    const conditionId = Number(activeRow.conditionId)
    const ok = await performStructural((token) => deleteCondition(projectId, conditionId, token))
    if (ok) setActiveRow(null)
  }, [activeRow, performStructural, projectId])

  const clearActive = useCallback(() => {
    setActiveRow(null)
    setStructError(null)
  }, [])

  const gridCallbacks = useMemo<ConditionGridCallbacks>(
    () => ({
      onCellEdit: (cell) => setCell(cell.conditionId, cell.parameterCode, cell.value),
      onPaste: (target, tsv) => {
        // 편집 불가(읽기 전용) 상태에서는 붙여넣기를 스테이징하지 않는다(그리드가 기본 동작은 이미 막는다).
        if (readOnly) return
        const result = buildPasteStaging(target, parseTsv(tsv), visibleColumns, data.rows)
        // 매핑되는 셀도 없고 잘린 것도 없으면(대상 밖 등) 무시.
        if (result.staging.length === 0 && result.truncatedRows === 0 && result.truncatedCols === 0) {
          return
        }
        setPasteError(null)
        setPaste(result)
      },
      // POR 이양: 클릭된 행을 POR로. 성공 시 두 행(기존/신규)의 is_por가 바뀌므로 재조회한다.
      onPorChange: (_layerKey, conditionId) => {
        void performStructural((token) => setConditionPor(projectId, Number(conditionId), token))
      },
      // 좌측 식별 컬럼 클릭 → 그 행을 추가/복제/삭제 대상으로 활성화(하단 액션 바에 노출).
      onConditionActivate: (payload) => {
        setStructError(null)
        setActiveRow(payload)
      },
    }),
    [setCell, readOnly, visibleColumns, data.rows, performStructural, projectId],
  )

  const cancelPaste = useCallback(() => {
    setPaste(null)
    setPasteError(null)
  }, [])

  const commitPaste = useCallback(async () => {
    if (paste === null) return
    // 유효한 셀만 적용 대상 — 불일치 셀은 제외하고 개수로만 안내한다.
    const validCells: DirtyCell[] = paste.staging
      .filter((cell) => cell.valid)
      .map((cell) => ({
        conditionId: cell.conditionId,
        parameterCode: cell.parameterCode,
        value: cell.value,
      }))
    if (validCells.length === 0) {
      cancelPaste() // 적용할 유효 셀이 없으면 스테이징만 폐기
      return
    }
    setApplying(true)
    setPasteError(null)
    try {
      await applyPaste(validCells)
      setPaste(null) // 성공 → 스테이징 종료(서버 스냅샷에 반영됨)
    } catch (error) {
      // 실패(네트워크/409 등): 스테이징 유지 + 에러 표시 → 사용자가 다시 "적용" 가능.
      setPasteError(getApiErrorMessage(error))
    } finally {
      setApplying(false)
    }
  }, [paste, applyPaste, cancelPaste])

  const jumpToColumn = useCallback(() => {
    const query = columnQuery.trim().toLowerCase()
    if (query === '') return
    // headerName 또는 key(parameter_code) 부분 일치(대소문자 무시)로 첫 컬럼을 찾아 점프한다.
    // 활성 카테고리에서 걸러진 컬럼이면 scrollToColumn이 조용히 무시한다(보이는 컬럼만 대상).
    const match = data.columns.find(
      (column) =>
        column.key.toLowerCase().includes(query) || column.headerName.toLowerCase().includes(query),
    )
    if (match !== undefined) gridRef.current?.scrollToColumn(match.key)
  }, [columnQuery, data.columns])

  return (
    <div className="space-y-3">
      <StatusBar
        editing={editing}
        lock={lock}
        rowCount={data.rows.length}
        colCount={data.columns.length}
      />
      {porGaps.length > 0 ? (
        <div
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
          data-testid="por-warning"
        >
          POR 미지정 layer <strong>{porGaps.length}</strong>개 — {porGaps.map((group) => group.layerLabel).join(', ')}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2" data-testid="sheet-category-tabs">
        {categories.length > 0 ? (
          <>
            <CategoryTab active={activeCategory === null} onClick={() => setActiveCategory(null)}>
              전체
            </CategoryTab>
            {categories.map((category) => (
              <CategoryTab
                key={category}
                active={activeCategory === category}
                onClick={() => setActiveCategory(category)}
              >
                {category}
              </CategoryTab>
            ))}
          </>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <input
            className="input w-56"
            placeholder="컬럼 검색 (예: ETCH_P012)"
            value={columnQuery}
            data-testid="sheet-column-search"
            onChange={(event) => setColumnQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') jumpToColumn()
            }}
          />
          <button
            type="button"
            className="btn-secondary"
            data-testid="sheet-column-jump"
            onClick={jumpToColumn}
          >
            컬럼 점프
          </button>
        </div>
      </div>
      <div
        className="h-[70vh] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
        data-testid="sheet-view-grid"
      >
        <GlideConditionGrid
          ref={gridRef}
          data={gridData}
          view={{ readOnly, activeCategory }}
          callbacks={gridCallbacks}
          pasteStaging={paste?.staging}
        />
      </div>
      {!readOnly ? (
        <ConditionRowManager
          activeLabel={activeRowLabel}
          busy={structBusy}
          error={structError}
          onAddEmpty={handleAddEmpty}
          onDuplicate={handleDuplicate}
          onDelete={handleDelete}
          onClear={clearActive}
        />
      ) : null}
      {paste !== null ? (
        <PasteStagingPanel
          result={paste}
          columns={data.columns}
          rows={data.rows}
          applying={applying}
          readOnly={readOnly}
          error={pasteError}
          onApply={commitPaste}
          onCancel={cancelPaste}
        />
      ) : null}
    </div>
  )
}

/**
 * 조건 행 관리 액션 바(T7): 좌측 식별 컬럼 클릭으로 활성화한 행에 대해 빈 행 추가/복제/삭제를
 * 노출한다. 잠금 보유(편집 가능) 상태에서만 렌더된다. 실제 API 호출·재조회는 상위(SheetEditor)가
 * runStructuralChange로 처리하고, 여기서는 버튼과 진행/에러 표시만 담당한다.
 */
function ConditionRowManager({
  activeLabel,
  busy,
  error,
  onAddEmpty,
  onDuplicate,
  onDelete,
  onClear,
}: {
  activeLabel: string | null
  busy: boolean
  error: string | null
  onAddEmpty: () => void
  onDuplicate: () => void
  onDelete: () => void
  onClear: () => void
}) {
  const noSelection = activeLabel === null
  return (
    <div
      className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-sm"
      data-testid="condition-row-manager"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-slate-700">조건 행 관리</span>
        {noSelection ? (
          <span className="text-slate-400">Layer/조건 셀을 클릭해 대상 행을 선택한다</span>
        ) : (
          <span className="text-slate-600">
            선택: <strong>{activeLabel}</strong>
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onAddEmpty}
          disabled={busy || noSelection}
          data-testid="condition-add"
          className="rounded-md bg-cyan-600 px-3 py-1 font-medium text-white hover:bg-cyan-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          빈 행 추가
        </button>
        <button
          type="button"
          onClick={onDuplicate}
          disabled={busy || noSelection}
          data-testid="condition-duplicate"
          className="rounded-md border border-cyan-600 px-3 py-1 font-medium text-cyan-700 hover:bg-cyan-50 disabled:cursor-not-allowed disabled:border-slate-300 disabled:text-slate-400"
        >
          복제
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={busy || noSelection}
          data-testid="condition-delete"
          className="rounded-md border border-rose-300 px-3 py-1 font-medium text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:border-slate-300 disabled:text-slate-400"
        >
          삭제
        </button>
        {!noSelection ? (
          <button
            type="button"
            onClick={onClear}
            disabled={busy}
            className="rounded-md border border-slate-300 px-3 py-1 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            선택 해제
          </button>
        ) : null}
        {busy ? <span className="text-slate-500">처리 중...</span> : null}
      </div>
      {error !== null ? (
        <p className="text-rose-600" data-testid="condition-error">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** 하단 붙여넣기 스테이징 패널: 대기/유효/불일치 개수 + 잘림 안내 + 불일치 목록 + 적용/취소. */
const MAX_MISMATCH_ROWS = 6

function PasteStagingPanel({
  result,
  columns,
  rows,
  applying,
  readOnly,
  error,
  onApply,
  onCancel,
}: {
  result: PasteStagingResult
  columns: readonly ConditionGridColumn[]
  rows: readonly ConditionGridRow[]
  applying: boolean
  readOnly: boolean
  error: string | null
  onApply: () => void
  onCancel: () => void
}) {
  const columnNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const column of columns) map.set(column.key, column.headerName)
    return map
  }, [columns])
  const rowLabels = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of rows) map.set(row.id, `${row.layerLabel} · ${row.conditionLabel}`)
    return map
  }, [rows])

  const total = result.staging.length
  const invalid = result.staging.filter((cell) => !cell.valid)
  const validCount = total - invalid.length
  const truncated = result.truncatedRows > 0 || result.truncatedCols > 0

  return (
    <div
      className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm"
      data-testid="paste-staging-panel"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold text-slate-700">붙여넣기 미리보기</span>
        <span>
          대기 <strong>{total}</strong>
        </span>
        <span className="text-emerald-700">적용 {validCount}</span>
        {invalid.length > 0 ? <span className="text-rose-700">불일치 {invalid.length}</span> : null}
      </div>

      {truncated ? (
        <p className="text-amber-700">
          시트 경계를 넘는 데이터는 잘렸다
          {result.truncatedRows > 0 ? ` · 행 ${result.truncatedRows}` : ''}
          {result.truncatedCols > 0 ? ` · 컬럼 ${result.truncatedCols}` : ''}
        </p>
      ) : null}

      {invalid.length > 0 ? (
        <ul className="space-y-0.5 text-rose-700">
          {invalid.slice(0, MAX_MISMATCH_ROWS).map((cell) => (
            <li key={`${cell.conditionId} ${cell.parameterCode}`}>
              {rowLabels.get(cell.conditionId) ?? cell.conditionId} ·{' '}
              {columnNames.get(cell.parameterCode) ?? cell.parameterCode}:{' '}
              <span className="font-mono">{cell.value ?? ''}</span>
              {cell.message !== undefined ? ` — ${cell.message}` : ''}
            </li>
          ))}
          {invalid.length > MAX_MISMATCH_ROWS ? (
            <li className="text-rose-500">외 {invalid.length - MAX_MISMATCH_ROWS}건…</li>
          ) : null}
        </ul>
      ) : null}

      {invalid.length > 0 ? <p className="text-slate-500">불일치 셀은 적용에서 제외된다.</p> : null}

      {error !== null ? <p className="text-rose-600">적용 실패: {error}</p> : null}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onApply}
          disabled={applying || readOnly || validCount === 0}
          className="rounded-md bg-cyan-600 px-3 py-1 font-medium text-white hover:bg-cyan-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {applying ? '적용 중...' : `적용 (${validCount})`}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={applying}
          className="rounded-md border border-slate-300 px-3 py-1 text-slate-600 hover:bg-slate-100 disabled:opacity-50"
        >
          취소
        </button>
        {readOnly ? (
          <span className="text-amber-700">읽기 전용 — 잠금을 확보해야 적용할 수 있다</span>
        ) : null}
      </div>
    </div>
  )
}

/** 상단 상태 표시줄: 행/컬럼 수 + 잠금 상태 + 저장 상태 + 더티/재시도/재획득 액션. */
function StatusBar({
  editing,
  lock,
  rowCount,
  colCount,
}: {
  editing: SheetEditing
  lock: SheetLockView
  rowCount: number
  colCount: number
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
      <span>
        행 <strong>{rowCount}</strong>
      </span>
      <span>
        컬럼 <strong>{colCount}</strong>
      </span>
      <LockChip editing={editing} lock={lock} />
      {editing.lockStatus === 'held' ? <SaveStatus editing={editing} /> : null}
    </div>
  )
}

function LockChip({ editing, lock }: { editing: SheetEditing; lock: SheetLockView }) {
  switch (editing.lockStatus) {
    case 'acquiring':
      return <span className="rounded-full bg-slate-100 px-2 py-0.5">잠금 획득 중...</span>
    case 'held':
      return (
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">편집 중 (내 잠금)</span>
      )
    case 'readonly':
      return (
        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">
          {lock.editingBy !== null ? `읽기 전용 · 편집 중: ${lock.editingBy}` : '읽기 전용 (잠금 획득 실패)'}
        </span>
      )
    case 'lost':
      return (
        <span className="flex items-center gap-2">
          <span className="rounded-full bg-rose-50 px-2 py-0.5 text-rose-700">
            잠금을 잃었다 — 재획득이 필요하다
          </span>
          <button
            type="button"
            onClick={editing.reacquire}
            className="rounded-md border border-rose-300 px-2 py-0.5 text-rose-700 hover:bg-rose-50"
          >
            재획득
          </button>
        </span>
      )
  }
}

function SaveStatus({ editing }: { editing: SheetEditing }) {
  const { saveStatus, dirtyCount, discard, retrySave } = editing
  return (
    <span className="flex items-center gap-2">
      {dirtyCount > 0 ? (
        <span className="rounded-full bg-slate-100 px-2 py-0.5">미저장 {dirtyCount}</span>
      ) : null}
      {saveStatus === 'saving' ? <span className="text-slate-500">저장 중...</span> : null}
      {saveStatus === 'saved' && dirtyCount === 0 ? (
        <span className="text-emerald-600">저장됨</span>
      ) : null}
      {saveStatus === 'error' ? (
        <span className="flex items-center gap-2">
          <span className="text-rose-600">저장 실패</span>
          <button
            type="button"
            onClick={retrySave}
            className="rounded-md border border-rose-300 px-2 py-0.5 text-rose-700 hover:bg-rose-50"
          >
            재시도
          </button>
        </span>
      ) : null}
      {dirtyCount > 0 ? (
        <button
          type="button"
          onClick={discard}
          className="rounded-md border border-slate-300 px-2 py-0.5 text-slate-600 hover:bg-slate-50"
        >
          변경 취소
        </button>
      ) : null}
    </span>
  )
}

/** 카테고리 필터 탭 버튼(전체 + 카테고리별). GridDemoPage의 동일 패턴을 실제 시트 화면에 이식. */
function CategoryTab({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-lg px-3 py-1.5 text-sm font-medium transition',
        active ? 'bg-cyan-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

/** 라우트 래퍼: `/projects/:projectId/sheet`. */
export function SheetViewPage() {
  const params = useParams()
  const projectId = Number(params.projectId)
  const valid = Number.isInteger(projectId) && projectId > 0

  return (
    <section className="space-y-4">
      <div>
        <Link to="/projects" className="text-sm text-cyan-700">
          ← 프로젝트 목록
        </Link>
        <h2 className="mt-1 text-2xl font-semibold">조건표 시트 #{valid ? projectId : '?'}</h2>
        <p className="mt-2 text-sm text-slate-500">
          시트 조회 API를 어댑터로 렌더링하고, 잠금을 잡아 셀을 편집·자동저장한다.
        </p>
      </div>
      {valid ? (
        <SheetView projectId={projectId} />
      ) : (
        <ErrorMessage message="잘못된 프로젝트 id다." />
      )}
    </section>
  )
}
