import { useEffect } from 'react'
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom'
import Layout from './components/layout/Layout'
import ProtectedRoute from './components/auth/ProtectedRoute'
import LoginPage from './pages/LoginPage'
import ProjectListPage from './pages/ProjectListPage'
import ConditionEditorPage from './pages/ConditionEditorPage'
import AdminLayout from './pages/admin/AdminLayout'
import XmlMappingsPage from './pages/admin/XmlMappingsPage'
import ValidationRulesPage from './pages/admin/ValidationRulesPage'
import ExportSystemsPage from './pages/admin/ExportSystemsPage'
import { ToastContainer } from './components/ui/toast'
import { useAuthStore } from './stores/useAuthStore'

/**
 * AppInitializer attempts to restore the auth session on mount.
 * If a valid refresh token cookie exists, fetchCurrentUser will
 * use the token in memory; if the access token is gone (e.g., page
 * reload), the 401 interceptor will trigger a refresh automatically.
 */
function AppInitializer() {
  const { fetchCurrentUser, accessToken } = useAuthStore()

  useEffect(() => {
    // Only attempt to restore session if we have an access token in memory.
    // On a fresh page load the access token is gone (memory storage),
    // so the ProtectedRoute will redirect to /login which will trigger
    // the normal auth flow. If we want silent refresh on page load,
    // we can call refreshToken() here instead.
    if (accessToken) {
      fetchCurrentUser()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
          { path: '/', element: <Navigate to="/projects" replace /> },
          { path: '/projects', element: <ProjectListPage /> },
          { path: '/projects/:projectId/edit', element: <ConditionEditorPage /> },
          {
            path: '/admin',
            element: <AdminLayout />,
            children: [
              { index: true, element: <Navigate to="/admin/xml-mappings" replace /> },
              { path: 'xml-mappings', element: <XmlMappingsPage /> },
              { path: 'validations', element: <ValidationRulesPage /> },
              { path: 'export-systems', element: <ExportSystemsPage /> },
            ],
          },
        ],
      },
    ],
  },
])

function App() {
  return (
    <>
      <AppInitializer />
      <RouterProvider router={router} />
      <ToastContainer />
    </>
  )
}

export default App
