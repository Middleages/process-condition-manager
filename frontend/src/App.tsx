import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom'
import Layout from './components/layout/Layout'
import ProjectListPage from './pages/ProjectListPage'
import ConditionEditorPage from './pages/ConditionEditorPage'
import AdminLayout from './pages/admin/AdminLayout'
import XmlMappingsPage from './pages/admin/XmlMappingsPage'
import ValidationRulesPage from './pages/admin/ValidationRulesPage'
import { ToastContainer } from './components/ui/toast'

const router = createBrowserRouter([
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
        ],
      },
    ],
  },
])

function App() {
  return (
    <>
      <RouterProvider router={router} />
      <ToastContainer />
    </>
  )
}

export default App
