import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ChevronDown, ExternalLink, Pencil } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'

import { getApiErrorMessage } from '@/api/client'
import { getProject } from '@/api/projects'
import type { ChoiceValueOut, ProjectLayerOut, ProjectOut } from '@/api/types'
import { Badge } from '@/shared/components/Badge'
import { Button } from '@/shared/components/Button'
import { InlineAlert } from '@/shared/components/InlineAlert'
import { PageHeader } from '@/shared/components/PageHeader'
import { parsePositiveInt } from '@/shared/navigation/routeState'

import { LayerReplaceModal } from './LayerReplaceModal'
import { ProjectProfileDrawer } from './ProjectProfileDrawer'

export function ProjectDetailPage() {
  const { projectId: rawProjectId } = useParams()
  const projectId = parsePositiveInt(rawProjectId)
  const location = useLocation()
  const from = getProjectListReturnPath(location.state)

  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId as number),
    enabled: projectId !== null,
  })

  return (
    <section className="mx-auto w-full max-w-[1600px] space-y-5">
      <PageHeader
        data-page-title
        tabIndex={-1}
        eyebrow={
          projectQuery.data ? (
            <span className="inline-flex items-center gap-2">
              Project #{projectQuery.data.id}
              <Badge tone="draft">초안</Badge>
            </span>
          ) : (
            '프로젝트'
          )
        }
        title={projectQuery.data?.name ?? '프로젝트 상세'}
        description={
          projectQuery.data
            ? `${projectQuery.data.line_id} / ${projectQuery.data.process_id} / ${projectQuery.data.part_id}`
            : '프로젝트 정보와 Layer 구성을 확인합니다.'
        }
        actions={
          <>
            <Link
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border-control bg-surface px-3 text-sm font-semibold text-ink-950 transition-colors hover:bg-canvas"
              to={from}
            >
              <ArrowLeft aria-hidden="true" size={16} strokeWidth={2} />
              목록으로
            </Link>
            {projectQuery.data ? (
              <Link
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-brand-700 px-4 text-sm font-semibold text-white transition-colors hover:bg-ink-950"
                to={`/projects/${projectQuery.data.id}/sheet`}
              >
                조건표 열기
                <ExternalLink aria-hidden="true" size={16} strokeWidth={2} />
              </Link>
            ) : null}
          </>
        }
      />

      <div>
        {projectId === null ? (
          <InlineAlert tone="error">올바른 프로젝트 ID가 아닙니다. 목록에서 다시 선택하세요.</InlineAlert>
        ) : projectQuery.isPending ? (
          <InlineAlert tone="info">프로젝트 상세를 불러오는 중입니다.</InlineAlert>
        ) : projectQuery.isError ? (
          <InlineAlert className="flex flex-wrap items-center justify-between gap-3" tone="error">
            <span>{getApiErrorMessage(projectQuery.error)}</span>
            <Button size="compact" variant="secondary" onClick={() => projectQuery.refetch()}>
              다시 시도
            </Button>
          </InlineAlert>
        ) : projectQuery.data ? (
          <ProjectDetail project={projectQuery.data} />
        ) : null}
      </div>
    </section>
  )
}

function ProjectDetail({ project }: { project: ProjectOut }) {
  const [replaceTarget, setReplaceTarget] = useState<ProjectLayerOut | null>(null)
  const [profileEditorOpen, setProfileEditorOpen] = useState(false)
  const profileEditTriggerRef = useRef<HTMLButtonElement>(null)
  const summary = {
    layerCount: project.layers.length,
    conditionCount: project.layers.reduce((sum, layer) => sum + layer.condition_count, 0),
    cellCount: project.layers.reduce((sum, layer) => sum + layer.cell_count, 0),
  }
  const backboneProjectIds = new Set(
    project.layers.flatMap((layer) =>
      layer.source_project_id === null ? [] : [layer.source_project_id],
    ),
  )
  const backboneSummary =
    backboneProjectIds.size === 0
      ? '없음'
      : backboneProjectIds.size === 1
        ? `#${[...backboneProjectIds][0]}`
        : `${backboneProjectIds.size}개 프로젝트`

  return (
    <div className="space-y-5">
      <dl className="grid overflow-hidden rounded-xl border border-border-subtle bg-surface sm:grid-cols-4">
        <SummaryItem label="Layer" value={summary.layerCount} />
        <SummaryItem label="조건 행" value={summary.conditionCount} />
        <SummaryItem label="Cell" value={summary.cellCount} />
        <SummaryItem label="백본" value={backboneSummary} />
      </dl>

      <section aria-labelledby="project-profile-title" className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="project-profile-title" className="text-lg font-bold text-ink-950">
              프로젝트 정보
            </h2>
            <p className="mt-0.5 text-sm text-muted">
              업무에 필요한 식별·분류·방향을 먼저 확인합니다.
            </p>
          </div>
          <button
            ref={profileEditTriggerRef}
            type="button"
            aria-haspopup="dialog"
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border-control bg-surface px-3 text-sm font-semibold text-ink-950 transition-colors hover:bg-canvas"
            onClick={() => setProfileEditorOpen(true)}
          >
            <Pencil aria-hidden="true" size={16} strokeWidth={2} />
            기본정보 편집
          </button>
        </div>

        <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface">
          <div className="grid divide-y divide-border-subtle xl:grid-cols-3 xl:divide-x xl:divide-y-0">
            <ProfileGroup group="identity" title="Identity">
              <DefinitionItem label="LINE" value={project.line_id} mono />
              <DefinitionItem label="Process ID" value={project.process_id} mono />
              <DefinitionItem label="PARTID" value={project.part_id} mono />
            </ProfileGroup>
            <ProfileGroup group="product" title="Product">
              <DefinitionItem label="Process Name" value={project.profile.process_name} />
              <ChoiceDefinitionItem label="Device Type" choice={project.profile.device_type} />
              <ChoiceDefinitionItem label="Category" choice={project.profile.project_category} />
              <DefinitionItem label="Comment" value={project.profile.comment} />
            </ProfileGroup>
            <ProfileGroup group="direction" title="Direction">
              <ChoiceDefinitionItem label="Active Direction" choice={project.profile.active_direction} />
              <ChoiceDefinitionItem label="Gate Direction" choice={project.profile.gate_direction} />
            </ProfileGroup>
          </div>
        </div>
      </section>

      <details
        className="group overflow-hidden rounded-xl border border-border-subtle bg-surface"
        data-profile-details=""
      >
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 text-left [&::-webkit-details-marker]:hidden">
          <span>
            <span className="block text-sm font-bold text-ink-950">상세 공정 Profile</span>
            <span className="mt-0.5 block text-xs text-muted">
              Die/Shot, Wafer Position, Layer Summary를 확인합니다.
            </span>
          </span>
          <ChevronDown
            aria-hidden="true"
            className="shrink-0 text-muted transition-transform group-open:rotate-180"
            size={18}
            strokeWidth={2}
          />
        </summary>
        <div className="grid divide-y divide-border-subtle border-t border-border-subtle xl:grid-cols-3 xl:divide-x xl:divide-y-0">
          <ProfileGroup group="die-shot" title="Die/Shot">
            <DefinitionItem label="Gross Die" value={project.profile.gross_die} />
            <DefinitionItem label="Pitch X" value={project.profile.pitch_x} mono />
            <DefinitionItem label="Pitch Y" value={project.profile.pitch_y} mono />
            <DefinitionItem label="Shot X" value={project.profile.shot_x} mono />
            <DefinitionItem label="Shot Y" value={project.profile.shot_y} mono />
            <DefinitionItem label="Slit Occupancy" value={project.profile.slit_occupancy} mono />
            <DefinitionItem label="Lens Occupancy" value={project.profile.lens_occupancy} mono />
            <DefinitionItem label="Shot Count" value={project.profile.shot_count} />
            <DefinitionItem label="Full Shot" value={project.profile.full_shot} />
          </ProfileGroup>
          <ProfileGroup group="wafer-position" title="Wafer Position">
            <DefinitionItem label="Map Offset X" value={project.profile.map_offset_x} mono />
            <DefinitionItem label="Map Offset Y" value={project.profile.map_offset_y} mono />
            <DefinitionItem label="Scribe Lane X" value={project.profile.scribe_lane_x} mono />
            <DefinitionItem label="Scribe Lane Y" value={project.profile.scribe_lane_y} mono />
          </ProfileGroup>
          <ProfileGroup group="layer-summary" title="Layer Summary">
            <DefinitionItem label="Layer Total" value={project.profile.layer_total} />
            <DefinitionItem label="EUV" value={project.profile.euv} />
            <DefinitionItem label="IMM" value={project.profile.imm} />
            <DefinitionItem label="ARF" value={project.profile.arf} />
            <DefinitionItem label="KRF" value={project.profile.krf} />
            <DefinitionItem label="I-line" value={project.profile.iline} />
            <DefinitionItem label="SOH" value={project.profile.soh} />
            <DefinitionItem label="PSPI" value={project.profile.pspi} />
            <DefinitionItem label="Metal Layer Count" value={project.profile.metal_layer_count} />
          </ProfileGroup>
        </div>
      </details>

      <section aria-labelledby="project-layers-title" className="space-y-3">
        <div>
          <h2 id="project-layers-title" className="text-lg font-bold text-ink-950">
            Layer 구성
          </h2>
          <p className="mt-0.5 text-sm text-muted">Layer별 백본 소스와 조건 데이터를 확인합니다.</p>
        </div>

        <div className="max-w-full overflow-x-auto rounded-xl border border-border-subtle bg-surface">
          <table className="w-full min-w-[820px] table-fixed text-left text-sm">
            <thead className="bg-canvas text-xs font-semibold uppercase tracking-wide text-muted">
              <tr className="h-9">
                <th className="w-[22%] whitespace-nowrap px-4 py-0" scope="col">
                  Layer (Step)
                </th>
                <th className="w-[18%] whitespace-nowrap px-4 py-0" scope="col">
                  Area
                </th>
                <th className="w-[28%] whitespace-nowrap px-4 py-0" scope="col">
                  백본 소스
                </th>
                <th className="w-[12%] whitespace-nowrap px-4 py-0 text-right" scope="col">
                  조건 행
                </th>
                <th className="w-[10%] whitespace-nowrap px-4 py-0 text-right" scope="col">
                  Cell
                </th>
                <th className="w-[10%] whitespace-nowrap px-4 py-0 text-right" scope="col">
                  <span className="sr-only">작업</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {project.layers.map((layer) => {
                const layerLabel = `${layer.layer_id} (${layer.step_seq})`
                const areaLabel = layer.area_name ?? '-'
                const sourceLabel = layer.source_layer_key
                  ? `#${layer.source_project_id} · ${layer.source_layer_key}`
                  : '빈 값'

                return (
                  <tr
                    key={layer.id}
                    className="h-9 shadow-[inset_0_1px_0_var(--color-border-subtle)]"
                  >
                    <td className="min-w-0 overflow-hidden px-4 py-0 font-mono text-xs font-semibold text-brand-700">
                      <span
                        className="block min-w-0 truncate whitespace-nowrap"
                        title={layerLabel}
                      >
                        {layerLabel}
                      </span>
                    </td>
                    <td className="min-w-0 overflow-hidden px-4 py-0 text-ink-950">
                      <span
                        className="block min-w-0 truncate whitespace-nowrap"
                        title={areaLabel}
                      >
                        {areaLabel}
                      </span>
                    </td>
                    <td className="min-w-0 overflow-hidden px-4 py-0 font-mono text-xs text-muted">
                      <span
                        className="block min-w-0 truncate whitespace-nowrap"
                        title={sourceLabel}
                      >
                        {sourceLabel}
                      </span>
                    </td>
                    <td className="min-w-0 overflow-hidden whitespace-nowrap px-4 py-0 text-right font-mono text-xs tabular-nums">
                      {layer.condition_count}
                    </td>
                    <td className="min-w-0 overflow-hidden whitespace-nowrap px-4 py-0 text-right font-mono text-xs tabular-nums">
                      {layer.cell_count}
                    </td>
                    <td className="min-w-0 overflow-hidden whitespace-nowrap px-4 py-0 text-right">
                      <Button
                        className="h-9"
                        size="compact"
                        variant="secondary"
                        onClick={() => setReplaceTarget(layer)}
                      >
                        교체
                      </Button>
                    </td>
                  </tr>
                )
              })}
              {project.layers.length === 0 ? (
                <tr className="border-t border-border-subtle">
                  <td className="px-4 py-8 text-center text-sm text-muted" colSpan={6}>
                    표시할 Layer가 없습니다.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {replaceTarget ? (
        <LayerReplaceModal
          project={project}
          targetLayer={replaceTarget}
          onClose={() => setReplaceTarget(null)}
        />
      ) : null}

      {profileEditorOpen ? (
        <ProjectProfileDrawer
          projectId={project.id}
          fallbackFocusRef={profileEditTriggerRef}
          onClose={() => setProfileEditorOpen(false)}
        />
      ) : null}
    </div>
  )
}

function ProfileGroup({
  group,
  title,
  children,
}: {
  group: string
  title: string
  children: ReactNode
}) {
  return (
    <section data-profile-group={group} className="min-w-0 p-4">
      <h3 className="text-sm font-bold text-ink-950">{title}</h3>
      <dl className="mt-3 grid gap-x-4 gap-y-3 sm:grid-cols-2">{children}</dl>
    </section>
  )
}

function DefinitionItem({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string | null
  mono?: boolean
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold text-muted">{label}</dt>
      <dd
        className={`mt-1 min-h-5 break-words text-sm text-ink-950 ${mono ? 'font-mono text-xs' : ''}`}
      >
        {value ?? '—'}
      </dd>
    </div>
  )
}

function ChoiceDefinitionItem({
  label,
  choice,
}: {
  label: string
  choice: ChoiceValueOut | null
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold text-muted">{label}</dt>
      <dd className="mt-1 flex min-h-5 min-w-0 flex-wrap items-center gap-2 text-sm text-ink-950">
        {choice ? (
          <>
            <span className="min-w-0 break-words font-mono text-xs">
              {choice.code} · {choice.label}
            </span>
            {!choice.is_active ? <Badge tone="warning">사용 중지됨</Badge> : null}
          </>
        ) : (
          '—'
        )}
      </dd>
    </div>
  )
}

function SummaryItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="border-b border-border-subtle px-4 py-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-1 font-mono text-xl font-bold tabular-nums text-ink-950">{value}</dd>
    </div>
  )
}

function getProjectListReturnPath(state: unknown): string {
  if (
    typeof state === 'object' &&
    state !== null &&
    'from' in state &&
    typeof state.from === 'string' &&
    (state.from === '/projects' || state.from.startsWith('/projects?'))
  ) {
    return state.from
  }

  return '/projects'
}
