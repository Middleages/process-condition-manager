import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { ParameterAdminPage } from '@/features/parameters/ParameterAdminPage'
import { ProcessExplorerPage } from '@/features/processes/ProcessExplorerPage'
import { ProjectWorkspacePage } from '@/features/projects/ProjectWorkspacePage'
import { SheetViewPage } from '@/features/sheets/SheetView'
import { AppLayout } from '@/shared/layout/AppLayout'

const GridDemoPage = import.meta.env.DEV
  ? lazy(async () => {
      const module = await import('@/features/sheets/GridDemoPage')
      return { default: module.GridDemoPage }
    })
  : null

export function AppRouter() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/projects" replace />} />
        <Route path="parameters" element={<ParameterAdminPage />} />
        <Route path="processes" element={<ProcessExplorerPage />} />
        <Route path="projects" element={<ProjectWorkspacePage />} />
        {/* Phase 2 T2: 조건표 시트 + 개발 환경 전용 합성 데이터 데모 */}
        <Route path="projects/:projectId/sheet" element={<SheetViewPage />} />
        {GridDemoPage !== null ? (
          <Route
            path="grid-demo"
            element={
              <Suspense fallback={<p className="text-sm text-slate-500">그리드 데모 로딩 중...</p>}>
                <GridDemoPage />
              </Suspense>
            }
          />
        ) : null}
      </Route>
    </Routes>
  )
}
