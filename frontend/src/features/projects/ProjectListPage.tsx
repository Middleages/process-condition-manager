import { useInfiniteQuery } from '@tanstack/react-query'
import { Plus, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
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
import { PageHeader } from '@/shared/components/PageHeader'

import { ProjectTable } from './ProjectTable'
import { parseProjectListSearch, serializeProjectListSearch } from './urlState'

const RETURN_FOCUS_KEY = 'pcm:project-list:return-focus'

interface ProjectListReturnFocus {
  search: string
  projectId: number
}

export function ProjectListPage() {
  const location = useLocation()
  const navigationType = useNavigationType()
  const [searchParams, setSearchParams] = useSearchParams()
  const routeState = parseProjectListSearch(searchParams)
  const [queryDraft, setQueryDraft] = useState(routeState.query)

  useEffect(() => {
    setQueryDraft(routeState.query)
  }, [routeState.query])

  useEffect(() => {
    if (queryDraft === routeState.query) return

    const timeout = window.setTimeout(() => {
      setSearchParams(
        serializeProjectListSearch({ query: queryDraft, status: routeState.status }),
        { replace: true },
      )
    }, 250)

    return () => window.clearTimeout(timeout)
  }, [queryDraft, routeState.query, routeState.status, setSearchParams])

  const projectsQuery = useInfiniteQuery({
    queryKey: ['projects', 'list', { query: routeState.query, status: routeState.status }],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) =>
      listProjects({
        query: routeState.query || undefined,
        status: routeState.status === 'all' ? undefined : routeState.status,
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

  return (
    <section className="space-y-5">
      <PageHeader
        data-page-title
        tabIndex={-1}
        title="프로젝트"
        description="프로젝트를 검색하고 조건표 작업으로 이동합니다."
        actions={
          <Link
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-brand-700 px-4 text-sm font-semibold text-white transition-colors hover:bg-ink-950"
            to="/projects/new"
          >
            <Plus aria-hidden="true" size={16} strokeWidth={2} />
            새 프로젝트
          </Link>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <label className="grid w-full max-w-xl gap-1.5 text-sm font-semibold text-ink-950">
          프로젝트 검색
          <span className="relative block">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
              size={16}
              strokeWidth={2}
            />
            <input
              className="input pl-9"
              placeholder="프로젝트명 또는 Part ID"
              type="search"
              value={queryDraft}
              onChange={(event) => setQueryDraft(event.target.value)}
            />
          </span>
        </label>
        <p className="shrink-0 text-sm font-medium tabular-nums text-muted">불러온 {projects.length}개</p>
      </div>

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
