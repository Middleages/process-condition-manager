import { Navigate, Route, Routes } from 'react-router-dom'

import { ParameterAdminPage } from '@/features/parameters/ParameterAdminPage'
import { ProcessExplorerPage } from '@/features/processes/ProcessExplorerPage'
import { ProjectWorkspacePage } from '@/features/projects/ProjectWorkspacePage'
import { GridDemoPage } from '@/features/sheets/GridDemoPage'
import { SheetViewPage } from '@/features/sheets/SheetView'
import { AppLayout } from '@/shared/layout/AppLayout'

export function AppRouter() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/projects" replace />} />
        <Route path="parameters" element={<ParameterAdminPage />} />
        <Route path="processes" element={<ProcessExplorerPage />} />
        <Route path="projects" element={<ProjectWorkspacePage />} />
        {/* Phase 2 T2: 조건표 시트(읽기 전용) + 합성 데이터 데모(dev) */}
        <Route path="projects/:projectId/sheet" element={<SheetViewPage />} />
        <Route path="grid-demo" element={<GridDemoPage />} />
      </Route>
    </Routes>
  )
}
