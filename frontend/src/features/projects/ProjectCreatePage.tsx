import { useNavigate } from 'react-router-dom'

import { PageHeader } from '@/shared/components/PageHeader'

import { ProjectCreateWizard } from './ProjectCreateWizard'

export function ProjectCreatePage() {
  const navigate = useNavigate()

  return (
    <section className="space-y-5">
      <PageHeader
        data-page-title
        tabIndex={-1}
        eyebrow="프로젝트"
        title="새 프로젝트"
        description="Process 구조와 백본을 확인해 새 조건표 프로젝트를 만듭니다."
      />
      <div className="max-w-5xl">
        <ProjectCreateWizard
          onCreated={(projectId) => navigate(`/projects/${projectId}`, { replace: true })}
        />
      </div>
    </section>
  )
}
