import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ChevronDown, ExternalLink, Pencil } from 'lucide-react'
import { FormEvent, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'

import { getApiErrorDetails, getApiErrorMessage } from '@/api/client'
import {
  createProjectComment,
  deleteProjectComment,
  createRevision,
  getProject,
  listProjectComments,
  patchProjectComment,
  transitionProject,
} from '@/api/projects'
import type {
  ChoiceValueOut,
  ProjectLayerOut,
  ProjectOut,
  ProjectTransitionAction,
  ProjectTransitionIn,
} from '@/api/types'
import { Badge } from '@/shared/components/Badge'
import { Button } from '@/shared/components/Button'
import { InlineAlert } from '@/shared/components/InlineAlert'
import { PageHeader } from '@/shared/components/PageHeader'
import { parsePositiveInt } from '@/shared/navigation/routeState'

import { LayerReplaceModal } from './LayerReplaceModal'
import { ProjectProfileDrawer } from './ProjectProfileDrawer'
import { useAuth } from '@/app/AuthContext'
import { invalidateProjectBackboneDiffAfterMutation } from '@/api/backboneDiffCache'
import { invalidateProjectHistoryAfterMutation } from '@/api/historyCache'

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
        eyebrow={
          projectQuery.data ? (
            <span className="inline-flex items-center gap-2">
              Project #{projectQuery.data.id}
              <Badge tone={projectStatusBadgeTone(projectQuery.data.status)}>
                {projectStatusLabel(projectQuery.data.status)}
              </Badge>
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
  const queryClient = useQueryClient()
  const {
    user,
    permissions: {
      canApprove,
      canComment,
      canCreateRevision,
      canEditDraft,
      canReject,
      canRequestReview,
      canReturnToDraft,
    },
  } = useAuth()
  const [replaceTarget, setReplaceTarget] = useState<ProjectLayerOut | null>(null)
  const [profileEditorOpen, setProfileEditorOpen] = useState(false)
  const [newComment, setNewComment] = useState('')
  const profileEditTriggerRef = useRef<HTMLButtonElement>(null)
  const isDraft = project.status === 'draft'
  const summary = {
    layerCount: project.layers.length,
    conditionCount: project.layers.reduce((sum, layer) => sum + layer.condition_count, 0),
    cellCount: project.layers.reduce((sum, layer) => sum + layer.cell_count, 0),
  }

  const lineageText = `v${project.version} / root ${project.revision_root_id ?? '-'} / pred ${
    project.predecessor_project_id ?? '-'
  } / succ ${project.successor_project_id ?? '-'} / actions ${project.allowed_actions.length}`

  const commentsQuery = useInfiniteQuery({
    queryKey: ['project-comments', project.id, 'target', 'project'],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) =>
      listProjectComments(project.id, {
        target: 'project',
        beforeId: pageParam ?? undefined,
      }),
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  })
  const projectComments = commentsQuery.data?.pages.flatMap((page) => page.items) ?? []

  const executeTransitionMutation = useMutation({
    mutationFn: async (action: ProjectTransitionAction) => {
      if (action === 'create_revision') {
        return createRevision(project.id)
      }
      const payload: ProjectTransitionIn = { action, expected_status: project.status }
      return transitionProject(project.id, payload)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['project', project.id] })
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
      void queryClient.invalidateQueries({ queryKey: ['sheet', project.id] })
      void invalidateProjectHistoryAfterMutation(queryClient, project.id)
      void invalidateProjectBackboneDiffAfterMutation(queryClient, project.id)
    },
  })

  const createCommentMutation = useMutation({
    mutationFn: (body: string) => createProjectComment(project.id, { body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['project-comments', project.id, 'target', 'project'] })
      setNewComment('')
    },
  })

  const patchCommentMutation = useMutation({
    mutationFn: ({ commentId, resolved }: { commentId: number; resolved: boolean }) =>
      patchProjectComment(project.id, commentId, { resolved }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['project-comments', project.id, 'target', 'project'] })
    },
  })
  const deleteCommentMutation = useMutation({
    mutationFn: (commentId: number) => deleteProjectComment(project.id, commentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['project-comments', project.id] })
    },
  })

  function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = newComment.trim()
    if (text === '' || createCommentMutation.isPending) return
    void createCommentMutation.mutate(text)
  }

  const allowedTransitionActions = project.allowed_actions.filter((action) => {
    if (action === 'request_review') return canRequestReview
    if (action === 'approve') return canApprove
    if (action === 'reject') return canReject
    if (action === 'return_to_draft') return canReturnToDraft
    if (action === 'create_revision') return canCreateRevision

    return false
  })

  const canUseDraftMutations = canEditDraft && isDraft
  const canUseCommentMutations = canComment

  function requestTransition(action: ProjectTransitionAction) {
    if (action === 'approve' || action === 'create_revision') {
      const confirmed = window.confirm(`${actionLabel(action)}를 진행하시겠습니까?`)
      if (!confirmed) return
    }
    executeTransitionMutation.mutate(action)
  }

  return (
    <div className="space-y-5">
      <dl className="grid overflow-hidden rounded-xl border border-border-subtle bg-surface sm:grid-cols-4">
        <SummaryItem label="Layer" value={summary.layerCount} />
        <SummaryItem label="조건 행" value={summary.conditionCount} />
        <SummaryItem label="Cell" value={summary.cellCount} />
        <SummaryItem label="백본" value={backboneSummary(project)} />
      </dl>

      <section aria-labelledby="project-workflow-title" className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="project-workflow-title" className="text-lg font-bold text-ink-950">
              워크플로우
            </h2>
            <p className="mt-0.5 text-sm text-muted">현재 상태와 Lineage, 허용 작업을 확인합니다.</p>
          </div>
          <div className="text-sm text-muted">{lineageText}</div>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border-subtle bg-surface p-4">
          <Badge tone={projectStatusBadgeTone(project.status)} className="h-7 px-3 py-0.5">
            {projectStatusLabel(project.status)}
          </Badge>
          <span className="text-sm text-muted">/</span>
          <span className="text-sm text-ink-950">허용 액션:</span>
          <div className="ml-auto flex flex-wrap gap-2">
            {allowedTransitionActions.length === 0 ? (
              <span className="text-sm text-muted">가능한 액션이 없습니다.</span>
            ) : null}
            {allowedTransitionActions.map((action) => (
              <Button
                size="compact"
                key={action}
                variant="secondary"
                disabled={executeTransitionMutation.isPending}
                onClick={() => requestTransition(action)}
              >
                {actionLabel(action)}
              </Button>
            ))}
            {executeTransitionMutation.isError ? (
              <ReviewGateError projectId={project.id} error={executeTransitionMutation.error} />
            ) : null}
          </div>
        </div>
      </section>

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
          {canUseDraftMutations ? (
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
          ) : null}
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
                      {canUseDraftMutations ? (
                        <Button
                          className="h-9"
                          size="compact"
                          variant="secondary"
                          onClick={() => setReplaceTarget(layer)}
                        >
                          교체
                        </Button>
                      ) : null}
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

      <section aria-labelledby="project-comments-title" className="space-y-3">
        <h2 id="project-comments-title" className="text-lg font-bold text-ink-950">
          댓글
        </h2>
        {canUseCommentMutations ? (
          <form className="space-y-2" onSubmit={submitComment}>
            <textarea
              aria-label="댓글 입력"
              className="min-h-20 w-full rounded-md border border-border-subtle bg-surface p-3 text-sm"
              value={newComment}
              onChange={(event) => setNewComment(event.currentTarget.value)}
            />
            <Button
              size="compact"
              type="submit"
              disabled={newComment.trim() === '' || createCommentMutation.isPending}
            >
              {createCommentMutation.isPending ? '등록 중...' : '댓글 등록'}
            </Button>
          </form>
        ) : null}
        {createCommentMutation.isError ||
        patchCommentMutation.isError ||
        deleteCommentMutation.isError ? (
          <InlineAlert className="mt-3" tone="error">
            {getApiErrorMessage(
              createCommentMutation.error ||
                patchCommentMutation.error ||
                deleteCommentMutation.error,
            )}
          </InlineAlert>
        ) : null}
        {commentsQuery.isError ? (
          <InlineAlert className="mt-3" tone="error">
            <span>{getApiErrorMessage(commentsQuery.error)}</span>
            <Button size="compact" variant="secondary" onClick={() => void commentsQuery.refetch()}>
              다시 시도
            </Button>
          </InlineAlert>
        ) : null}

        <div className="space-y-2">
          {projectComments.map((comment) => (
            <article
              className="rounded-xl border border-border-subtle bg-surface p-3 text-sm"
              key={comment.id}
              aria-label={`comment-${comment.id}`}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold text-muted">#{comment.id} · {comment.author}</p>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${comment.resolved ? 'bg-success-surface text-success' : 'bg-canvas text-muted'}`}
                  >
                    {comment.resolved ? 'resolved' : 'open'}
                  </span>
                  {canUseCommentMutations && !comment.deleted ? (
                    <Button
                      size="compact"
                      variant="secondary"
                      disabled={patchCommentMutation.isPending}
                      onClick={() =>
                        patchCommentMutation.mutate({ commentId: comment.id, resolved: !comment.resolved })
                      }
                    >
                      {comment.resolved ? '재열기' : '해결'}
                    </Button>
                  ) : null}
                  {!comment.deleted &&
                  (comment.author === user?.id || user?.roles.includes('admin')) ? (
                    <Button
                      size="compact"
                      variant="secondary"
                      disabled={deleteCommentMutation.isPending}
                      onClick={() => deleteCommentMutation.mutate(comment.id)}
                    >
                      삭제
                    </Button>
                  ) : null}
                </div>
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-ink-950">
                {comment.body ?? '(삭제된 댓글)'}
              </p>
            </article>
          ))}
          {projectComments.length === 0 && !commentsQuery.isPending ? (
            <p className="text-sm text-muted">표시할 댓글이 없습니다.</p>
          ) : null}
          {commentsQuery.hasNextPage ? (
            <Button
              size="compact"
              variant="secondary"
              disabled={commentsQuery.isFetchingNextPage}
              onClick={() => void commentsQuery.fetchNextPage()}
            >
              {commentsQuery.isFetchingNextPage ? '불러오는 중...' : '댓글 더 보기'}
            </Button>
          ) : null}
        </div>
      </section>

      {replaceTarget && canUseDraftMutations ? (
        <LayerReplaceModal
          project={project}
          targetLayer={replaceTarget}
          onClose={() => setReplaceTarget(null)}
        />
      ) : null}

      {profileEditorOpen && canUseDraftMutations ? (
        <ProjectProfileDrawer
          projectId={project.id}
          fallbackFocusRef={profileEditTriggerRef}
          onClose={() => setProfileEditorOpen(false)}
        />
      ) : null}
    </div>
  )
}

function ReviewGateError({ projectId, error }: { projectId: number; error: unknown }) {
  const details = getApiErrorDetails(error, 'review_gate_failed')
  if (details === null) {
    return (
      <InlineAlert className="mt-3" tone="error">
        {getApiErrorMessage(error)}
      </InlineAlert>
    )
  }
  const validation = isRecord(details.validation) ? details.validation : null
  const summary = validation !== null && isRecord(validation.summary) ? validation.summary : null
  const issues = validation !== null && Array.isArray(validation.issues) ? validation.issues : []
  const missingPor = Array.isArray(details.missing_por_layers) ? details.missing_por_layers : []
  return (
    <InlineAlert className="mt-3 w-full" tone="error">
      <div className="space-y-2" data-testid="review-gate-panel">
        <strong>Review 게이트를 통과하지 못했습니다.</strong>
        <p>
          오류 {numberOrZero(summary?.error_count)}개 · 경고 {numberOrZero(summary?.warning_count)}개
          · POR 누락 {numberOrZero(details.total_missing_por_count)}개
        </p>
        <ul className="list-disc space-y-1 pl-5">
          {issues.slice(0, 20).map((issue, index) => {
            const item = isRecord(issue) ? issue : {}
            const condition = numberOrZero(item.condition_id)
            const parameter = typeof item.parameter_code === 'string' ? item.parameter_code : '-'
            const layer = typeof item.layer_key === 'string' ? item.layer_key : '-'
            return (
              <li key={`${String(item.key ?? index)}`}>
                <Link to={`/projects/${projectId}/sheet`}>
                  {layer} / #{condition} / {parameter}
                </Link>
              </li>
            )
          })}
          {missingPor.slice(0, 20).map((entry, index) => {
            const item = isRecord(entry) ? entry : {}
            return <li key={`por-${index}`}>POR 누락 · {String(item.layer_label ?? item.layer_key ?? '-')}</li>
          })}
        </ul>
      </div>
    </InlineAlert>
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
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

function projectStatusBadgeTone(status: ProjectOut['status']) {
  if (status === 'draft') return 'draft'
  if (status === 'approved') return 'neutral'
  if (status === 'rejected') return 'error'
  return 'read-only'
}

function projectStatusLabel(status: ProjectOut['status']) {
  if (status === 'draft') return '초안'
  if (status === 'review') return '검토중'
  if (status === 'approved') return '승인'
  if (status === 'rejected') return '반려'
  return '보존'
}

function actionLabel(action: ProjectTransitionAction) {
  switch (action) {
    case 'request_review':
      return '검토요청'
    case 'approve':
      return '승인'
    case 'reject':
      return '반려'
    case 'return_to_draft':
      return '초안복귀'
    case 'create_revision':
      return '리비전 생성'
    default:
      return action
  }
}

function backboneSummary(project: ProjectOut) {
  if (project.layers.length === 0) {
    return '없음'
  }
  const sourceProjectIds = new Set(
    project.layers.flatMap((layer) => (layer.source_project_id === null ? [] : [layer.source_project_id])),
  )
  if (sourceProjectIds.size === 0) return '없음'
  return sourceProjectIds.size === 1 ? `#${[...sourceProjectIds][0]}` : `${sourceProjectIds.size}개 프로젝트`
}
