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
        description="Process와 백본을 차례로 확인하고 새 조건표를 만듭니다."
      />
      <ProjectCreateWizard
        onCreated={(projectId) => navigate(`/projects/${projectId}`, { replace: true })}
      />
    </section>
  )
}
