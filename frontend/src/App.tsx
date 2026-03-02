import { useEffect } from 'react'
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom'
import ErrorBoundary from './components/ErrorBoundary'
import Layout from './components/layout/Layout'
import ProtectedRoute from './components/auth/ProtectedRoute'
import LoginPage from './pages/LoginPage'
import ProjectListPage from './pages/ProjectListPage'
import ConditionEditorPage from './pages/ConditionEditorPage'
import DashboardPage from './pages/DashboardPage'
import NotFoundPage from './pages/NotFoundPage'
import AdminLayout from './pages/admin/AdminLayout'
import XmlMappingsPage from './pages/admin/XmlMappingsPage'
import ValidationRulesPage from './pages/admin/ValidationRulesPage'
import ExportSystemsPage from './pages/admin/ExportSystemsPage'
import UserManagementPage from './pages/admin/UserManagementPage'
import MasterDataPage from './pages/admin/MasterDataPage'
import EnumManagementPage from './pages/admin/EnumManagementPage'
import AuditLogPage from './pages/admin/AuditLogPage'
import ExportDataSourcesPage from './pages/admin/ExportDataSourcesPage'
import DeviceMasterPage from './pages/admin/DeviceMasterPage'
import AnnouncementManagementPage from './pages/admin/AnnouncementManagementPage'
import ConfigChangeListPage from './pages/config-change/ConfigChangeListPage'
import ConfigChangeDetailPage from './pages/config-change/ConfigChangeDetailPage'
import { ToastContainer } from './components/ui/toast'
import { useAuthStore } from './stores/useAuthStore'

/**
 * AppInitializer attempts to restore the auth session on mount.
 * If a valid refresh token cookie exists, it silently refreshes
 * the access token so the user stays logged in after page reload.
 */
function AppInitializer() {
  const restoreSession = useAuthStore((s) => s.restoreSession)

  useEffect(() => {
    restoreSession()
  }, [restoreSession])

  return null
}

const router = createBrowserRouter([
  // Public routes
  {
    path: '/login',
    element: <LoginPage />,
  },

  // Protected routes (require authentication)
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <Layout />,
        children: [
          { path: '/', element: <DashboardPage /> },
          { path: '/projects', element: <ProjectListPage /> },
          { path: '/projects/:projectId/edit', element: <ConditionEditorPage /> },
          { path: '/config-changes', element: <ConfigChangeListPage /> },
          { path: '/config-changes/:id', element: <ConfigChangeDetailPage /> },
          {
            path: '/admin',
            element: <AdminLayout />,
            children: [
              // 기본 리다이렉트는 AdminLayout에서 역할 기반으로 처리
              { index: true, element: <Navigate to="/admin/master-data" replace /> },
              { path: 'users', element: <UserManagementPage /> },
              { path: 'master-data', element: <MasterDataPage /> },
              { path: 'device-masters', element: <DeviceMasterPage /> },
              { path: 'enum-options', element: <EnumManagementPage /> },
              { path: 'xml-mappings', element: <XmlMappingsPage /> },
              { path: 'validations', element: <ValidationRulesPage /> },
              { path: 'data-sources', element: <ExportDataSourcesPage /> },
              { path: 'export-systems', element: <ExportSystemsPage /> },
              { path: 'audit-logs', element: <AuditLogPage /> },
              { path: 'announcements', element: <AnnouncementManagementPage /> },
            ],
          },
        ],
      },
    ],
  },

  // Catch-all 404
  {
    path: '*',
    element: <NotFoundPage />,
  },
])

function App() {
  return (
    <ErrorBoundary>
      <AppInitializer />
      <RouterProvider router={router} />
      <ToastContainer />
    </ErrorBoundary>
  )
}

export default App
