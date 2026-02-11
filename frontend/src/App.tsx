import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/layout/Layout'
import ProjectListPage from './pages/ProjectListPage'
import ConditionEditorPage from './pages/ConditionEditorPage'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/projects" replace />} />
          <Route path="/projects" element={<ProjectListPage />} />
          <Route path="/projects/:projectId/edit" element={<ConditionEditorPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
