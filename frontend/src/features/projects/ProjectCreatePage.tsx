import { ArrowLeft } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'

import { PageHeader } from '@/shared/components/PageHeader'

import { ProjectCreateWizard } from './ProjectCreateWizard'

export function ProjectCreatePage() {
  const navigate = useNavigate()

  return (
    <section className="mx-auto w-full max-w-[1440px] space-y-5">
      <PageHeader
        actions={
          <Link className="btn-secondary gap-2" to="/projects">
            <ArrowLeft aria-hidden="true" size={16} />
            제품 목록
          </Link>
        }
        eyebrow="제품 공정조건"
        title="공정조건 등록"
        description="LINE·Process를 선택하고 Part ID별 공정조건을 등록합니다."
      />
      <ProjectCreateWizard
        onCreated={(projectId) => navigate(`/projects/${projectId}/sheet`, { replace: true })}
      />
    </section>
  )
}
