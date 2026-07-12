import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'

import { getApiErrorMessage } from '@/api/client'
import { getSheet } from '@/api/sheets'
import { GlideConditionGrid } from '@/grid'
import { ErrorMessage, LoadingMessage } from '@/shared/components/StatusMessage'

import { toConditionGridData, toLockView } from './sheetAdapter'

/**
 * 시트 조회 → 어댑터 읽기 전용 렌더링 (T2 범위).
 *
 * `getSheet(projectId)` 응답을 `toConditionGridData`로 그리드 계약으로 바꿔 렌더링만 한다.
 * 편집/저장/붙여넣기는 T3/T4의 몫이라 여기서는 항상 읽기 전용이다.
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
  const data = toConditionGridData(sheet)
  const lock = toLockView(sheet.lock)

  if (data.columns.length === 0 || data.rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
        표시할 컬럼 또는 조건 행이 없다 (레지스트리 파라미터 또는 layer/조건 행 확인).
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
        <span>
          행 <strong>{data.rows.length}</strong>
        </span>
        <span>
          컬럼 <strong>{data.columns.length}</strong>
        </span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5">읽기 전용 (T2 — 편집은 T3/T4)</span>
        {lock.editingBy !== null ? (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">
            편집 중: {lock.editingBy}
          </span>
        ) : null}
      </div>
      <div
        className="h-[70vh] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
        data-testid="sheet-view-grid"
      >
        <GlideConditionGrid data={data} view={{ readOnly: true }} />
      </div>
    </div>
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
          시트 조회 API를 어댑터로 읽기 전용 렌더링한다.
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
