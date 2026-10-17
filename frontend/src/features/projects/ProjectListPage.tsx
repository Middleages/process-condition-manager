import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'

import { getApiErrorMessage } from '@/api/client'
import { listProjectLines, listProjects } from '@/api/projects'
import { Button } from '@/shared/components/Button'
import { InlineAlert } from '@/shared/components/InlineAlert'

import { ProjectTable } from './ProjectTable'
import { projectListQueryKey } from './projectListQuery'
import { parseProjectListSearch, serializeProjectListSearch, type ProjectListRouteState } from './urlState'

const RETURN_FOCUS_KEY = 'pcm:project-list:return-focus'
interface ProjectListReturnFocus {
  search: string
  projectId: number
}

export function ProjectListPage() {
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const routeState = parseProjectListSearch(searchParams)
  const [queryDraft, setQueryDraft] = useState(routeState.query)
  const resultHeading = useRef<HTMLHeadingElement>(null)
  const initiatedPage = useRef<string | null>(null)
  const { lineId, query, cursor, cursorTrail = [] } = routeState

  useEffect(() => {
    setQueryDraft(query)
  }, [query, lineId, location.key])

  const linesQuery = useQuery({ queryKey: ['projects', 'lines'], queryFn: listProjectLines })
  const projectsQuery = useQuery({
    queryKey: projectListQueryKey(routeState),
    enabled: Boolean(lineId),
    queryFn: () => listProjects({
      lineId: lineId!,
      query: query || undefined,
      status: routeState.status === 'all' ? undefined : routeState.status,
      deviceTypeCode: routeState.deviceTypeCode ?? undefined,
      projectCategoryCode: routeState.projectCategoryCode ?? undefined,
      cursor: cursor ?? undefined,
      limit: 25,
    }),
  })
  const projects = projectsQuery.data?.items ?? []
  const from = `${location.pathname}${location.search}`

  useEffect(() => {
    if (projectsQuery.isPending || projectsQuery.isFetching || !lineId) return
    const remembered = readReturnFocus()
    if (remembered?.search === location.search) {
      const frame = window.requestAnimationFrame(() => {
        const projectLink = document.querySelector<HTMLElement>(`[data-project-id="${remembered.projectId}"]`)
        ;(projectLink ?? resultHeading.current)?.focus()
        clearReturnFocus()
      })
      return () => window.cancelAnimationFrame(frame)
    }
    if (initiatedPage.current === location.search && projectsQuery.isSuccess) {
      resultHeading.current?.scrollIntoView?.({ block: 'start' })
      resultHeading.current?.focus({ preventScroll: true })
      initiatedPage.current = null
    }
  }, [location.search, lineId, projectsQuery.isPending, projectsQuery.isFetching, projectsQuery.isSuccess])

  function resetPage(change: Partial<ProjectListRouteState>) {
    initiatedPage.current = null
    setSearchParams(serializeProjectListSearch({ ...routeState, ...change, cursor: null, cursorTrail: [] }))
  }
  function selectLine(nextLine: string) {
    setQueryDraft(query)
    if (nextLine !== lineId) resetPage({ lineId: nextLine })
  }
  function submitSearch(event: FormEvent) {
    event.preventDefault()
    const submitted = queryDraft.trim()
    setQueryDraft(submitted)
    resetPage({ query: submitted })
  }
  function changePage(direction: 'previous' | 'next') {
    const nextCursor = direction === 'next' ? projectsQuery.data?.next_cursor : (cursorTrail[cursorTrail.length - 1] ?? null)
    if (direction === 'next' && nextCursor == null) return
    const trail = direction === 'next'
      ? (cursor && !cursorTrail.length ? [] : [...cursorTrail, cursor ?? null])
      : cursorTrail.slice(0, -1)
    const params = serializeProjectListSearch({ ...routeState, cursor: nextCursor ?? null, cursorTrail: trail })
    initiatedPage.current = `?${params.toString()}`
    setSearchParams(params)
  }
  // A shared cursor URL without a trail has no trustworthy ordinal range.
  const range = projects.length === 0
    ? '0개 표시'
    : cursor && !cursorTrail.length
      ? `현재 ${projects.length}개 표시`
      : `${cursorTrail.length * 25 + 1}–${cursorTrail.length * 25 + projects.length} 표시`
  const renderPager = (position: string) => (
    <nav aria-label={`${position} 페이지 이동`} className="flex flex-wrap items-center justify-between gap-3 py-3">
      <p className="text-sm tabular-nums text-muted">{projectsQuery.isSuccess ? range : '25개씩 표시'} <span className="ml-2 text-xs">25개씩 · 최신 버전</span></p>
      <div className="flex gap-2">
        <Button variant="secondary" disabled={!cursor || projectsQuery.isFetching} onClick={() => changePage('previous')}>{cursor && !cursorTrail.length ? '처음' : '이전'}</Button>
        <Button variant="secondary" disabled={!projectsQuery.isSuccess || !projectsQuery.data.next_cursor || projectsQuery.isFetching} onClick={() => changePage('next')}>다음</Button>
      </div>
    </nav>
  )

  return (
    <section className="w-full space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-ink-950 pb-5">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" data-page-title tabIndex={-1}>제품 목록</h1>
          <p className="mt-2 text-sm text-muted">LINE을 선택하고 Process 또는 Part ID로 찾아보세요.</p>
        </div>
        <Link className="btn-primary gap-2" to="/projects/new"><Plus aria-hidden="true" size={16} />공정조건 등록</Link>
      </header>
      <div className="grid items-start gap-6 md:grid-cols-[148px_minmax(0,1fr)] xl:grid-cols-[184px_minmax(0,1fr)]">
        <aside aria-label="LINE 선택" className="rounded-[3px] border border-border-subtle bg-surface p-3">
          <h2 className="mb-3 text-xs font-bold tracking-widest text-muted">LINE</h2>
          {linesQuery.isPending ? <p role="status" className="text-sm text-muted">LINE을 불러오는 중입니다.</p> : null}
          {linesQuery.isError ? <InlineAlert tone="error"><p>LINE 목록을 불러오지 못했습니다.</p><Button className="mt-2" variant="secondary" onClick={() => linesQuery.refetch()}>LINE 다시 시도</Button></InlineAlert> : null}
          {linesQuery.isSuccess && linesQuery.data.length === 0 ? <p className="text-sm text-muted">등록된 LINE이 없습니다.</p> : null}
          <div className="flex flex-wrap gap-2 md:flex-col">
            {linesQuery.data?.map(line => (
              <button
                key={line}
                aria-pressed={line === lineId}
                type="button"
                onClick={() => selectLine(line)}
                className={`min-h-11 break-words rounded-[3px] border px-3 py-2 text-left font-mono text-sm font-bold [overflow-wrap:anywhere] ${line === lineId ? 'border-brand-700 bg-brand-700 text-white' : 'border-transparent hover:border-border-control hover:bg-canvas'}`}
              >
                {line}
              </button>
            ))}
          </div>
        </aside>
        <div className="min-w-0">
          {!lineId ? <div className="border border-dashed border-border-control px-5 py-10 text-center"><h2 className="font-bold">LINE을 선택해 주세요.</h2><p className="mt-2 text-sm text-muted">선택한 LINE의 최신 공정조건을 25개씩 표시합니다.</p></div> : <>
            <h2 ref={resultHeading} tabIndex={-1} className="break-words text-2xl font-bold tracking-tight focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-700">{lineId}</h2>
            <form className="mt-5 flex flex-wrap items-end gap-2" onSubmit={submitSearch}>
              <label className="grid min-w-0 flex-1 gap-1.5 text-sm font-semibold" htmlFor="product-search">Process / Part ID
                <input id="product-search" className="input" placeholder="Process 또는 Part ID" type="search" value={queryDraft} onChange={event => setQueryDraft(event.target.value)} />
              </label>
              <Button type="submit">검색</Button>
              <Button type="button" variant="secondary" onClick={() => { setQueryDraft(''); resetPage({ query: '' }) }}>검색 초기화</Button>
            </form>
            <p aria-live="polite" role="status" className="sr-only">{projectsQuery.isSuccess ? `${lineId}${query ? `, 검색어 ${query}` : ''}, ${range}` : ''}</p>
            {renderPager('상단')}
            {projectsQuery.isFetching ? <InlineAlert tone="info">제품 목록을 불러오는 중입니다.</InlineAlert> : null}
            {projectsQuery.isError ? (
              <InlineAlert tone="error" className="flex flex-wrap items-center justify-between gap-3">
                <span>{getApiErrorMessage(projectsQuery.error)}</span>
                <Button variant="secondary" onClick={() => projectsQuery.refetch()}>다시 시도</Button>
              </InlineAlert>
            ) : null}
            {projectsQuery.isSuccess && projects.length > 0 ? (
              <ProjectTable
                projects={projects}
                from={from}
                onProjectOpen={projectId => rememberReturnFocus(location.search, projectId)}
              />
            ) : null}
            {projectsQuery.isSuccess && projects.length === 0 ? (
              <div className="border border-dashed border-border-control bg-surface px-5 py-10 text-center">
                <p className="font-bold">{query ? '검색 결과가 없습니다.' : '이 LINE에 등록된 공정조건이 없습니다.'}</p>
                <p className="mt-2 text-sm text-muted">
                  {query ? 'Process 또는 Part ID를 확인하거나 검색을 초기화하세요.' : '공정조건 등록 버튼으로 시작하세요.'}
                </p>
              </div>
            ) : null}
            {renderPager('하단')}
          </>}
        </div>
      </div>
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
