import { Navigate, Route, Routes } from 'react-router-dom'

import { ParameterAdminPage } from '@/features/parameters/ParameterAdminPage'
import { ProcessExplorerPage } from '@/features/processes/ProcessExplorerPage'
import { ProjectWorkspacePage } from '@/features/projects/ProjectWorkspacePage'
import { AppLayout } from '@/shared/layout/AppLayout'

export function AppRouter() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/projects" replace />} />
        <Route path="parameters" element={<ParameterAdminPage />} />
        <Route path="processes" element={<ProcessExplorerPage />} />
        <Route path="projects" element={<ProjectWorkspacePage />} />
      </Route>
    </Routes>
  )
}
