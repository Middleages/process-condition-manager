import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/layout/Layout'
import ProjectListPage from './pages/ProjectListPage'
import ConditionEditorPage from './pages/ConditionEditorPage'
import AdminLayout from './pages/admin/AdminLayout'
import XmlMappingsPage from './pages/admin/XmlMappingsPage'
import ValidationRulesPage from './pages/admin/ValidationRulesPage'
import { ToastContainer } from './components/ui/toast'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/projects" replace />} />
          <Route path="/projects" element={<ProjectListPage />} />
          <Route path="/projects/:projectId/edit" element={<ConditionEditorPage />} />

          {/* Admin Routes */}
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<Navigate to="/admin/xml-mappings" replace />} />
            <Route path="xml-mappings" element={<XmlMappingsPage />} />
            <Route path="validations" element={<ValidationRulesPage />} />
          </Route>
        </Route>
      </Routes>
      <ToastContainer />
    </BrowserRouter>
  )
}

export default App
