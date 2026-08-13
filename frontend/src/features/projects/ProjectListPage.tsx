import { useInfiniteQuery } from '@tanstack/react-query'
import { Plus, Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  Link,
  useLocation,
  useNavigationType,
  useSearchParams,
} from 'react-router-dom'

import { getApiErrorMessage } from '@/api/client'
import { listProjects } from '@/api/projects'
import { Button } from '@/shared/components/Button'
import { InlineAlert } from '@/shared/components/InlineAlert'

import { ProjectTable } from './ProjectTable'
import {
  mergeDebouncedQuery,
  projectListQueryKey,
} from './projectListQuery'
import {
  parseProjectListSearch,
  serializeProjectListSearch,
  type ProjectListStatus,
} from './urlState'

const RETURN_FOCUS_KEY = 'pcm:project-list:return-focus'

interface ProjectListReturnFocus {
  search: string
  projectId: number
}

const STATUS_FILTERS: ReadonlyArray<{ value: ProjectListStatus; label: string }> = [
  { value: 'all', label: '전체' },
  { value: 'draft', label: '초안' },
  { value: 'review', label: '검토중' },
  { value: 'approved', label: '승인' },
  { value: 'rejected', label: '반려' },
]

export function ProjectListPage() {
  const location = useLocation()
  const navigationType = useNavigationType()
  const [searchParams, setSearchParams] = useSearchParams()
  const routeState = parseProjectListSearch(searchParams)
  const [queryDraft, setQueryDraft] = useState(routeState.query)
  const latestRouteStateRef = useRef(routeState)
  latestRouteStateRef.current = routeState

  useEffect(() => {
    setQueryDraft(routeState.query)
  }, [routeState.query])

  useEffect(() => {
    if (queryDraft === latestRouteStateRef.current.query) return

    const timeout = window.setTimeout(() => {
      setSearchParams(
        serializeProjectListSearch(
          mergeDebouncedQuery(latestRouteStateRef.current, queryDraft),
        ),
        { replace: true },
      )
    }, 250)

    return () => window.clearTimeout(timeout)
  }, [queryDraft, setSearchParams])

  const projectsQuery = useInfiniteQuery({
    queryKey: projectListQueryKey(routeState),
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) =>
      listProjects({
        query: routeState.query || undefined,
        status: routeState.status === 'all' ? undefined : routeState.status,
        deviceTypeCode: routeState.deviceTypeCode ?? undefined,
        projectCategoryCode: routeState.projectCategoryCode ?? undefined,
        cursor: pageParam ?? undefined,
        limit: 50,
      }),
    getNextPageParam: (lastPage) => lastPage.next_cursor,
  })

  const projects = projectsQuery.data?.pages.flatMap((page) => page.items) ?? []
  const from = `${location.pathname}${location.search}`

  useEffect(() => {
    if (navigationType !== 'POP' || projectsQuery.isPending) return

    const remembered = readReturnFocus()
    if (!remembered || remembered.search !== location.search) return

    const frame = window.requestAnimationFrame(() => {
      const projectLink = document.querySelector<HTMLElement>(
        `[data-project-id="${remembered.projectId}"]`,
      )
      const pageTitle = document.querySelector<HTMLElement>('[data-page-title]')

      ;(projectLink ?? pageTitle)?.focus()
      clearReturnFocus()
    })

    return () => window.cancelAnimationFrame(frame)
  }, [location.search, navigationType, projects.length, projectsQuery.isPending])

  function updateStatusFilter(status: ProjectListStatus) {
    setSearchParams(
      serializeProjectListSearch({
        ...latestRouteStateRef.current,
        status,
      }),
    )
  }

  return (
    <section className="w-full space-y-5">
      <header className="space-y-4 border-b-2 border-ink-950 pb-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-700">
              Project command index
            </p>
            <h1
              className="mt-1 text-3xl font-bold tracking-tight text-ink-950 focus:outline-none"
              data-page-title
              tabIndex={-1}
            >
              프로젝트
            </h1>
            <p className="mt-1 text-sm text-muted">
              공정 식별자로 조건표를 찾고 현재 작업 상태를 확인합니다.
            </p>
          </div>
          <Link
            className="btn-primary gap-2"
            to="/projects/new"
          >
            <Plus aria-hidden="true" size={16} strokeWidth={2} />
            새 프로젝트
          </Link>
        </div>

        <label className="grid w-full gap-1.5 text-sm font-semibold text-ink-950">
          식별자 검색
          <span className="relative block">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
              size={16}
              strokeWidth={2}
            />
            <input
              className="input pl-9"
              placeholder="LINE, Process 또는 Part ID"
              type="search"
              value={queryDraft}
              onChange={(event) => setQueryDraft(event.target.value)}
            />
          </span>
        </label>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div
            aria-label="프로젝트 상태 필터"
            className="flex flex-wrap gap-1"
            role="group"
          >
            {STATUS_FILTERS.map((filter) => {
              const active = routeState.status === filter.value

              return (
                <button
                  aria-pressed={active}
                  className={
                    active
                      ? 'h-9 rounded-[2px] border border-brand-700 bg-brand-700 px-3 text-sm font-semibold text-white'
                      : 'h-9 rounded-[2px] border border-border-control bg-surface px-3 text-sm font-semibold text-ink-950 transition-colors hover:border-brand-700 hover:text-brand-700'
                  }
                  key={filter.value}
                  type="button"
                  onClick={() => updateStatusFilter(filter.value)}
                >
                  {filter.label}
                </button>
              )
            })}
          </div>
          {projectsQuery.isSuccess ? (
            <p
              aria-live="polite"
              className="text-sm font-medium tabular-nums text-muted"
              role="status"
            >
              프로젝트 {projects.length}개를 불러왔습니다.
            </p>
          ) : null}
        </div>
      </header>

      {projectsQuery.isPending ? (
        <InlineAlert tone="info">프로젝트 목록을 불러오는 중입니다.</InlineAlert>
      ) : null}

      {projectsQuery.isError ? (
        <InlineAlert className="flex flex-wrap items-center justify-between gap-3" tone="error">
          <span>{getApiErrorMessage(projectsQuery.error)}</span>
          <Button size="compact" variant="secondary" onClick={() => projectsQuery.refetch()}>
            다시 시도
          </Button>
        </InlineAlert>
      ) : null}

      {projects.length > 0 ? (
        <ProjectTable
          projects={projects}
          from={from}
          onProjectOpen={(projectId) => rememberReturnFocus(location.search, projectId)}
        />
      ) : !projectsQuery.isPending && !projectsQuery.isError ? (
        <div className="rounded-xl border border-dashed border-border-control bg-surface px-5 py-8 text-center">
          <p className="font-semibold text-ink-950">조건에 맞는 프로젝트가 없습니다.</p>
          <p className="mt-1 text-sm text-muted">
            검색어를 바꾸거나 상단의 새 프로젝트 버튼으로 시작하세요.
          </p>
        </div>
      ) : null}

      {projectsQuery.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            loading={projectsQuery.isFetchingNextPage}
            variant="secondary"
            onClick={() => projectsQuery.fetchNextPage()}
          >
            더 보기
          </Button>
        </div>
      ) : null}
    </section>
  )
}

function rememberReturnFocus(search: string, projectId: number) {
  try {
    const value: ProjectListReturnFocus = { search, projectId }
    window.sessionStorage.setItem(RETURN_FOCUS_KEY, JSON.stringify(value))
  } catch {
    // sessionStorage가 차단돼도 링크 이동 자체는 계속 가능하다.
  }
}

function readReturnFocus(): ProjectListReturnFocus | null {
  try {
    const raw = window.sessionStorage.getItem(RETURN_FOCUS_KEY)
    if (!raw) return null

    const value: unknown = JSON.parse(raw)
    if (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as ProjectListReturnFocus).search === 'string' &&
      Number.isInteger((value as ProjectListReturnFocus).projectId) &&
      (value as ProjectListReturnFocus).projectId > 0
    ) {
      return value as ProjectListReturnFocus
    }
  } catch {
    // 잘못된 저장 값은 focus 복귀를 건너뛴다.
  }

  clearReturnFocus()
  return null
}

function clearReturnFocus() {
  try {
    window.sessionStorage.removeItem(RETURN_FOCUS_KEY)
  } catch {
    // sessionStorage가 차단된 환경에서는 정리가 필요 없다.
  }
}
