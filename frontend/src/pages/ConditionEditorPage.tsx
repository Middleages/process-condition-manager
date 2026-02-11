import { useParams } from 'react-router-dom'

export default function ConditionEditorPage() {
  const { projectId } = useParams()

  return (
    <div style={{ padding: 24 }}>
      <h2>조건표 편집 - Project #{projectId}</h2>
      <p>Sprint 3에서 AG Grid 통합 예정</p>
    </div>
  )
}
