import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'

import { getApiErrorMessage } from '@/api/client'
import { getSheet } from '@/api/sheets'
import type { SheetOut } from '@/api/types'
import { GlideConditionGrid } from '@/grid'
import type { ConditionGridCallbacks } from '@/grid'
import { ErrorMessage, LoadingMessage } from '@/shared/components/StatusMessage'

import {
  applyDirtyToRows,
  selectDirtyCells,
  toCellStatuses,
  useEditStore,
  type DirtyCell,
} from './editStore'
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

  // 서버 행 위에 더티 값을 얹어 표시(편집값 즉시 반영) + 더티 셀 상태 오버레이.
  const displayRows = useMemo(() => applyDirtyToRows(data.rows, dirtyCells), [data.rows, dirtyCells])
  const statuses = useMemo(() => toCellStatuses(dirtyCells), [dirtyCells])
  const gridData = useMemo(
    () => ({ ...data, rows: displayRows, statuses }),
    [data, displayRows, statuses],
  )

  const setCell = editing.setCell
  const gridCallbacks = useMemo<ConditionGridCallbacks>(
    () => ({
      onCellEdit: (cell) => setCell(cell.conditionId, cell.parameterCode, cell.value),
      // onPaste는 T4(붙여넣기 스테이징)의 몫 — 지금은 미연결(그리드가 기본 붙여넣기만 막는다).
    }),
    [setCell],
  )

  return (
    <div className="space-y-3">
      <StatusBar
        editing={editing}
        lock={lock}
        rowCount={data.rows.length}
        colCount={data.columns.length}
      />
      <div
        className="h-[70vh] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
        data-testid="sheet-view-grid"
      >
        <GlideConditionGrid
          data={gridData}
          view={{ readOnly: editing.readOnly }}
          callbacks={gridCallbacks}
        />
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
