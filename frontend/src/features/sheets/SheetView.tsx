import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'

import { getApiErrorMessage } from '@/api/client'
import { addCondition, deleteCondition, setConditionPor } from '@/api/conditions'
import { invalidateProjectBackboneDiffAfterMutation } from '@/api/backboneDiffCache'
import { invalidateProjectHistoryAfterMutation } from '@/api/historyCache'
import type { HistoryJumpTargetOut } from '@/api/history'
import { getProject } from '@/api/projects'
import {
  createProjectComment,
  deleteProjectComment,
  listProjectComments,
  patchProjectComment,
} from '@/api/projects'
import { getSheet } from '@/api/sheets'
import type {
  CellsPatchOut,
  ProjectOut,
  ChoiceOptionAggregate,
  SheetFrozenChoiceSetOut,
  SheetOut,
} from '@/api/types'
import type { BackboneDiffCountsOut } from '@/api/backboneDiffQuery'
import { GlideConditionGrid } from '@/grid'
import type {
  ConditionGridCallbacks,
  ConditionGridColumn,
  ConditionGridHandle,
  ConditionGridRow,
} from '@/grid'
import { createLiveChoiceResource } from '@/grid/choiceCell'
import type { SheetChoiceResource } from '@/grid/types'
import type { CommentStatusFact } from './validationState'
import {
  commitPasteCallbackRuntime,
  distinctCategories,
  isCurrentPasteCallback,
  layersMissingPor,
  resolveColumnJump,
  visibleParameterColumns,
} from '@/grid/model'
import { Badge } from '@/shared/components/Badge'
import { Button } from '@/shared/components/Button'
import { InlineAlert } from '@/shared/components/InlineAlert'
import { ErrorMessage, LoadingMessage } from '@/shared/components/StatusMessage'
import { cn } from '@/shared/lib/cn'
import { useIsomorphicLayoutEffect } from '@/shared/lib/useIsomorphicLayoutEffect'
import { parsePositiveInt } from '@/shared/navigation/routeState'

import {
  applyDirtyToRows,
  selectDirtyCells,
  useEditStore,
  type DirtyCell,
  type PersistedCell,
} from './editStore'
import {
  buildPasteStaging,
  parseTsv,
  persistablePasteCells,
  revalidatePasteStaging,
  sheetChoiceAuthorizationEpoch,
  type PasteStagingResult,
} from './pasteStaging'
import {
  commitCanonicalSheetCells,
  reconcileSuccessfulPatch,
} from './persistenceReconciliation'
import { resolveSheetInteraction } from './sheetInteraction'
import { SheetFocusFrame } from './SheetFocusFrame'
import { LayerNavigator } from './LayerNavigator'
import {
  buildLayerNavigatorItems,
  updateRecentLayerKeys,
} from './layerNavigatorState'
import { SheetWorkbenchPanel, SheetWorkbenchToggle, useSheetWorkbenchState } from './SheetWorkbench'
import {
  BackboneDiffWorkbench,
  type BackboneDiffConditionItem,
  type BackboneDiffFilter,
  type BackboneDiffJumpTarget,
  type BackboneDiffRoot,
  type BackboneDiffCellItem,
  type BranchState,
} from './BackboneDiffWorkbench'
import { HistoryWorkbench } from './HistoryWorkbench'
import { ValidationWorkbench } from './ValidationWorkbench'
import {
  SheetAdapterError,
  shouldReplaceSheetWithError,
  toConditionGridData,
  toValidationInput,
  type AdaptedConditionGridData,
} from './sheetAdapter'
import { useSheetChoiceSets } from './useSheetChoiceSets'
import { useSheetEditing, type SheetEditing } from './useSheetEditing'
import { useSheetValidation } from './useSheetValidation'
import { VALIDATION_SERVER_FAILURE } from './validationState'
import { useOptionalAuth } from '@/app/AuthContext'
import {
  enrichValidationIssues,
  resolveValidationDefinitionAvailability,
  shouldAutoOpenValidationWorkbench,
  shouldMountValidationWorkbench,
  type ValidationWorkbenchIssue,
} from './validationWorkbenchState'
import {
  resolveWorkbenchCoordinateNavigation,
  type WorkbenchCoordinate,
} from './workbenchCoordinateNavigation'
import { useHistoryWorkbenchController } from './useHistoryWorkbenchController'
import { useBackboneDiffWorkbenchController } from './useBackboneDiffWorkbenchController'

type BackboneDiffFilterPayload = Omit<BackboneDiffFilter, 'layerKey' | 'categoryCode' | 'parameterCode'> & {
  layerKey: string | null
  categoryCode: string | null
  parameterCode: string | null
}

const BACKBONE_DIFF_ROOT_UNAVAILABLE_MESSAGE =
  '저장된 기준 백본이 없어 일부 레이어의 비교 상세를 제공할 수 없습니다'

const BACKBONE_DIFF_EMPTY_COUNTS: BackboneDiffCountsOut = {
  layer_count: 0,
  available_layer_count: 0,
  unavailable_layer_count: 0,
  row_count: 0,
  cell_count: 0,
  full_row_count: 0,
  full_cell_count: 0,
  ambiguous_lineage_count: 0,
  added_count: 0,
  changed_count: 0,
  cleared_count: 0,
  removed_count: 0,
  unchanged_count: 0,
}

function buildReadOnlySheetChoiceResources(
  frozenChoiceSets: readonly SheetFrozenChoiceSetOut[] | null | undefined,
): ReadonlyMap<string, SheetChoiceResource> {
  const resources = new Map<string, SheetChoiceResource>()
  if (frozenChoiceSets === null || frozenChoiceSets === undefined) {
    return resources
  }

  for (const choiceSet of frozenChoiceSets) {
    const aggregate: ChoiceOptionAggregate = {
      set_code: choiceSet.set_code,
      version: choiceSet.version,
      items: choiceSet.items,
    }
    resources.set(
      choiceSet.set_code,
      createLiveChoiceResource({
        setCode: choiceSet.set_code,
        targetVersion: choiceSet.version,
        summaryVersion: choiceSet.version,
        setIsActive: choiceSet.is_active,
        displayAggregate: aggregate,
        selectableAggregate: choiceSet.is_active ? aggregate : null,
        selectionReady: choiceSet.is_active,
        isStale: false,
        loading: false,
        error: null,
        prepareToOpen: async () => undefined,
        retry: async () => undefined,
      }),
    )
  }

  return resources
}

function mapBackboneDiffConditionRowMetadata(
  metadata: {
    readonly label_changed: boolean
    readonly index_changed: boolean
    readonly por_changed: boolean
  },
): {
  readonly labelChanged: boolean
  readonly indexChanged: boolean
  readonly porChanged: boolean
} {
  return {
    labelChanged: metadata.label_changed,
    indexChanged: metadata.index_changed,
    porChanged: metadata.por_changed,
  }
}

function mapBackboneDiffConditionMetadata(
  metadata: {
    readonly condition_id: number | null
    readonly source_condition_id: number | null
    readonly label: string | null
    readonly condition_index: number | null
    readonly is_por: boolean | null
  },
): {
  readonly conditionId: number | null
  readonly sourceConditionId: number | null
  readonly label: string | null
  readonly conditionIndex: number | null
  readonly isPor: boolean | null
} {
  return {
    conditionId: metadata.condition_id,
    sourceConditionId: metadata.source_condition_id,
    label: metadata.label,
    conditionIndex: metadata.condition_index,
    isPor: metadata.is_por,
  }
}

function mapBackboneDiffFilterPayload(
  input: BackboneDiffFilter,
): BackboneDiffFilterPayload {
  return {
    ...input,
    layerKey: input.layerKey === '' ? null : input.layerKey,
    categoryCode: input.categoryCode === '' ? null : input.categoryCode,
    parameterCode: input.parameterCode === '' ? null : input.parameterCode,
  }
}

const COLUMN_SEARCH_STATUS_ID = 'sheet-column-search-status'
const VALIDATION_DEFINITIONS_STATUS_ID = 'validation-definitions-status'

interface CellCommentTarget {
  conditionId: string
  layerKey: string
  parameterCode: string
}

function sheetCommentFacts(sheet: SheetOut): CommentStatusFact[] {
  return (sheet.comment_counts ?? []).map((item) => ({
    conditionId: String(item.condition_id),
    parameterCode: item.parameter_code,
    count: item.count,
  }))
}

function CellCommentPanel({
  projectId,
  target,
}: {
  projectId: number
  target: CellCommentTarget | null
}) {
  const queryClient = useQueryClient()
  const auth = useOptionalAuth()
  const user = auth?.user ?? null
  const canComment = auth?.permissions.canComment ?? false
  const [body, setBody] = useState('')
  const queryKey = [
    'project-comments',
    projectId,
    'target',
    'cell',
    target?.conditionId ?? null,
    target?.parameterCode ?? null,
  ] as const
  const comments = useInfiniteQuery({
    queryKey,
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) =>
      listProjectComments(projectId, {
        target: 'cell',
        conditionId: Number(target!.conditionId),
        layerKey: target!.layerKey,
        parameterCode: target!.parameterCode,
        beforeId: pageParam ?? undefined,
      }),
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled: target !== null,
  })
  const commentItems = comments.data?.pages.flatMap((page) => page.items) ?? []
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['sheet', projectId] })
    return queryClient.invalidateQueries({ queryKey })
  }
  const create = useMutation({
    mutationFn: (text: string) =>
      createProjectComment(projectId, {
        body: text,
        condition_id: Number(target!.conditionId),
        layer_key: target!.layerKey,
        parameter_code: target!.parameterCode,
      }),
    onSuccess: () => {
      setBody('')
      void invalidate()
    },
  })
  const resolve = useMutation({
    mutationFn: ({ id, resolved }: { id: number; resolved: boolean }) =>
      patchProjectComment(projectId, id, { resolved }),
    onSuccess: () => void invalidate(),
  })
  const remove = useMutation({
    mutationFn: (id: number) => deleteProjectComment(projectId, id),
    onSuccess: () => void invalidate(),
  })

  if (target === null) {
    return <p className="text-xs text-muted">셀을 선택하면 해당 좌표의 댓글을 확인할 수 있습니다.</p>
  }
  const error = comments.error || create.error || resolve.error || remove.error
  return (
    <details className="rounded-md border border-border-subtle bg-surface p-2" data-testid="cell-comments-panel">
      <summary className="cursor-pointer text-xs font-semibold text-ink-950">
        셀 댓글 · {target.layerKey} / #{target.conditionId} / {target.parameterCode}
        {comments.data ? ` (${commentItems.length})` : ''}
      </summary>
      <div className="mt-2 max-h-48 space-y-2 overflow-y-auto">
        {canComment ? (
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              const text = body.trim()
              if (text !== '' && !create.isPending) create.mutate(text)
            }}
          >
            <input
              aria-label="선택 셀 댓글"
              className="input min-w-0 flex-1"
              maxLength={4000}
              value={body}
              onChange={(event) => setBody(event.currentTarget.value)}
            />
            <Button disabled={body.trim() === '' || create.isPending} size="compact" type="submit">
              등록
            </Button>
          </form>
        ) : null}
        {error ? <InlineAlert tone="error">{getApiErrorMessage(error)}</InlineAlert> : null}
        {commentItems.map((comment) => (
          <div className="rounded border border-border-subtle p-2 text-xs" key={comment.id}>
            <div className="flex flex-wrap items-center gap-2">
              <strong>#{comment.id} · {comment.author}</strong>
              <span className="text-muted">{comment.resolved ? 'resolved' : 'open'}</span>
              {canComment && !comment.deleted ? (
                <Button
                  size="compact"
                  type="button"
                  variant="secondary"
                  onClick={() => resolve.mutate({ id: comment.id, resolved: !comment.resolved })}
                >
                  {comment.resolved ? '재열기' : '해결'}
                </Button>
              ) : null}
              {!comment.deleted &&
              (comment.author === user?.id || user?.roles.includes('admin')) ? (
                <Button
                  size="compact"
                  type="button"
                  variant="secondary"
                  onClick={() => remove.mutate(comment.id)}
                >
                  삭제
                </Button>
              ) : null}
            </div>
            <p className="mt-1 whitespace-pre-wrap break-words">
              {comment.body ?? '(삭제된 댓글)'}
            </p>
          </div>
        ))}
        {commentItems.length === 0 && !comments.isPending ? (
          <p className="text-xs text-muted">댓글이 없습니다.</p>
        ) : null}
        {comments.hasNextPage ? (
          <Button
            size="compact"
            type="button"
            variant="secondary"
            disabled={comments.isFetchingNextPage}
            onClick={() => void comments.fetchNextPage()}
          >
            {comments.isFetchingNextPage ? '불러오는 중...' : '댓글 더 보기'}
          </Button>
        ) : null}
      </div>
    </details>
  )
}

/**
 * 시트 조회 → 편집 가능한 그리드 렌더링 (T3 범위).
 *
 * 조회/빈-상태는 여기서 처리하고, 실제 편집(잠금·자동저장·더티 오버레이)은 시트가 준비된 뒤
 * 마운트되는 `SheetEditor`가 맡는다. `key={projectId}`로 프로젝트 전환 시 편집 세션이 자연히
 * 재시작(잠금 재획득·더티 리셋)되도록 한다.
 */
export function SheetView({ projectId }: { projectId: number }) {
  const sheetQuery = useQuery({
    queryKey: ['sheet', projectId],
    queryFn: () => getSheet(projectId),
  })
  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId),
  })

  const project = projectQuery.isError ? undefined : projectQuery.data
  const projectError = projectQuery.isError ? projectQuery.error : null

  if (sheetQuery.isLoading) {
    return (
      <SheetStateFrame projectId={projectId} project={project} projectError={projectError}>
        <LoadingMessage>시트를 불러오는 중입니다.</LoadingMessage>
      </SheetStateFrame>
    )
  }

  if (shouldReplaceSheetWithError(sheetQuery.data, sheetQuery.isError)) {
    return (
      <SheetStateFrame projectId={projectId} project={project} projectError={projectError}>
        <ErrorMessage message={getApiErrorMessage(sheetQuery.error)} />
      </SheetStateFrame>
    )
  }
  if (!sheetQuery.data) {
    return (
      <SheetStateFrame projectId={projectId} project={project} projectError={projectError}>
        <InlineAlert tone="info">조건표 데이터가 없습니다.</InlineAlert>
      </SheetStateFrame>
    )
  }

  const sheet = sheetQuery.data
  let data: AdaptedConditionGridData
  try {
    data = toConditionGridData(sheet)
  } catch (error) {
    if (!(error instanceof SheetAdapterError)) throw error
    return (
      <SheetStateFrame projectId={projectId} project={project} projectError={projectError}>
        <MalformedSheetState onRefetch={sheetQuery.refetch} />
      </SheetStateFrame>
    )
  }

  if (sheet.columns.length === 0 || sheet.rows.length === 0) {
    return (
      <SheetStateFrame projectId={projectId} project={project} projectError={projectError}>
        <InlineAlert tone="info">
          표시할 컬럼 또는 조건 행이 없습니다. 레지스트리 파라미터와 Layer 조건 행을 확인하세요.
        </InlineAlert>
      </SheetStateFrame>
    )
  }

  const projectIsEditableDraft = project?.status === 'draft'
  if (!projectIsEditableDraft) {
    return (
      <ReadOnlySheet
        key={projectId}
        projectId={projectId}
        project={project}
        projectError={projectError}
        sheet={sheet}
        data={data}
        sheetRefetchError={sheetQuery.isError ? sheetQuery.error : null}
      />
    )
  }

  return (
    <SheetEditor
      key={projectId}
      projectId={projectId}
      project={project}
      projectError={projectError}
      sheet={sheet}
      data={data}
      sheetRefetch={sheetQuery.refetch}
      sheetRefetchError={sheetQuery.isError ? sheetQuery.error : null}
    />
  )
}

function ReadOnlySheet({
  projectId,
  project,
  projectError,
  sheet,
  data,
  sheetRefetchError,
}: {
  projectId: number
  project?: ProjectOut
  projectError?: unknown
  sheet: SheetOut
  data: AdaptedConditionGridData
  sheetRefetchError: unknown
}) {
  const categories = useMemo(() => distinctCategories(data.columns), [data.columns])
  const choiceResources = useMemo(
    () => buildReadOnlySheetChoiceResources(sheet.frozen_choice_sets),
    [sheet.frozen_choice_sets],
  )
  const gridRef = useRef<ConditionGridHandle>(null)
  const columnSearchRef = useRef<HTMLInputElement>(null)

  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [columnQuery, setColumnQuery] = useState('')
  const [columnSearchStatus, setColumnSearchStatus] = useState('')
  const [pendingColumnJump, setPendingColumnJump] = useState<string | null>(null)
  const [selectedCell, setSelectedCell] = useState<CellCommentTarget | null>(null)
  const cellCommentFacts = useMemo(() => sheetCommentFacts(sheet), [sheet])

  const porGaps = useMemo(() => layersMissingPor(data.rows), [data.rows])
  const visibleColumns = useMemo(
    () => visibleParameterColumns(data.columns, activeCategory),
    [data.columns, activeCategory],
  )
  const gridData = useMemo(
    () => ({
      ...data,
      rows: data.rows,
      statuses: cellCommentFacts.map((comment) => ({
        ...comment,
        dirty: false,
        commentCount: comment.count,
      })),
      choiceResources,
    }),
    [cellCommentFacts, data, choiceResources],
  )

  const callbacks = useMemo<ConditionGridCallbacks>(
    () => ({
      onCellEdit: () => undefined,
      onPaste: () => undefined,
      onPorChange: () => undefined,
      onConditionActivate: () => undefined,
      onCellActivate: setSelectedCell,
      onCellHistoryRequest: () => undefined,
    }),
    [],
  )

  const jumpToColumn = useCallback(() => {
    const result = resolveColumnJump(data.columns, activeCategory, columnQuery)
    columnSearchRef.current?.focus()
    if (result.kind === 'empty') {
      setColumnSearchStatus('검색어를 입력하세요.')
      return
    }
    if (result.kind === 'not-found') {
      setColumnSearchStatus(`“${columnQuery.trim()}”에 맞는 컬럼이 없습니다.`)
      return
    }

    const match = data.columns.find((column) => column.key === result.parameterCode)
    setColumnSearchStatus(`${match?.headerName ?? result.parameterCode} 컬럼으로 이동했습니다.`)
    if (result.requiresCategoryChange) {
      setPendingColumnJump(result.parameterCode)
      setActiveCategory(result.categoryCode)
      return
    }
    gridRef.current?.scrollToColumn(result.parameterCode)
  }, [activeCategory, columnQuery, data.columns])

  const selectCategory = useCallback((category: string | null) => {
    setPendingColumnJump(null)
    setColumnSearchStatus('')
    setActiveCategory(category)
  }, [])

  useEffect(() => {
    if (pendingColumnJump === null) return
    if (!visibleColumns.some((column) => column.key === pendingColumnJump)) return
    gridRef.current?.scrollToColumn(pendingColumnJump)
    setPendingColumnJump(null)
  }, [pendingColumnJump, visibleColumns])

  return (
    <SheetFocusFrame
      header={<FocusHeader projectId={projectId} project={project} />}
      controls={
        <div className="space-y-2 border-b border-border-subtle bg-canvas px-3 py-2">
          {projectError != null ? <ProjectMetadataWarning error={projectError} /> : null}
          {sheetRefetchError != null ? (
            <InlineAlert
              className="rounded-md px-2 py-1.5 text-xs"
              data-testid="sheet-refetch-warning"
              tone="warning"
            >
              최신 시트 조회에 실패했습니다. 기존 데이터와 미저장 편집은 유지됩니다:
              {getApiErrorMessage(sheetRefetchError)}
            </InlineAlert>
          ) : null}
          {porGaps.length > 0 ? (
            <InlineAlert
              className="rounded-md px-2 py-1.5 text-xs"
              data-testid="por-warning"
              tone="warning"
            >
              POR 미지정 Layer <strong>{porGaps.length}</strong>개 —
              {porGaps.map((group) => group.layerLabel).join(', ')}
            </InlineAlert>
          ) : null}
          <div className="flex min-w-0 flex-wrap items-center gap-2" data-testid="sheet-category-tabs">
            <SheetMetrics rowCount={gridData.rows.length} colCount={data.columns.length} />
            {categories.length > 0 ? (
              <>
                <CategoryTab
                  active={activeCategory === null}
                  disabled={false}
                  onClick={() => selectCategory(null)}
                >
                  전체
                </CategoryTab>
                {categories.map((category) => (
                  <CategoryTab
                    key={category}
                    active={activeCategory === category}
                    disabled={false}
                    onClick={() => selectCategory(category)}
                  >
                    {category}
                  </CategoryTab>
                  ))}
              </>
            ) : null}
            <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
              <label
                className="shrink-0 text-xs font-semibold text-ink-950"
                htmlFor="sheet-column-search"
              >
                컬럼 검색
              </label>
              <input
                aria-describedby={COLUMN_SEARCH_STATUS_ID}
                className="input w-56 min-w-36"
                id="sheet-column-search"
                placeholder="컬럼 검색 (예: ETCH_P012)"
                ref={columnSearchRef}
                value={columnQuery}
                data-testid="sheet-column-search"
                onChange={(event) => setColumnQuery(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') jumpToColumn()
                }}
              />
              <Button
                className="shrink-0"
                data-testid="sheet-column-jump"
                onClick={jumpToColumn}
                size="compact"
                type="button"
                variant="secondary"
              >
                컬럼 점프
              </Button>
              <span
                aria-atomic="true"
                aria-live="polite"
                className="max-w-64 truncate text-xs text-muted"
                id={COLUMN_SEARCH_STATUS_ID}
                role="status"
              >
                {columnSearchStatus}
              </span>
            </div>
          </div>
          <p className="text-xs text-muted">읽기 전용 모드입니다. 초안 상태에서만 편집이 가능합니다.</p>
          <CellCommentPanel projectId={projectId} target={selectedCell} />
        </div>
      }
    >
      <div className="h-full min-h-0 min-w-0 overflow-hidden bg-surface" data-sheet-read-only>
        <GlideConditionGrid
          ref={gridRef}
          data={gridData}
          view={{ readOnly: true, activeCategory }}
          callbacks={callbacks}
        />
      </div>
    </SheetFocusFrame>
  )
}

function MalformedSheetState({ onRefetch }: { onRefetch: () => Promise<unknown> }) {
  const requestedRefetch = useRef(false)
  useEffect(() => {
    if (requestedRefetch.current) return
    requestedRefetch.current = true
    void onRefetch()
  }, [onRefetch])

  return (
    <InlineAlert tone="error">
      <div className="flex flex-wrap items-center gap-2">
        <span>시트 컬럼 정보가 완전하지 않습니다. 최신 시트를 다시 조회하세요.</span>
        <Button onClick={() => void onRefetch()} size="compact" type="button" variant="secondary">
          다시 조회
        </Button>
      </div>
    </InlineAlert>
  )
}

function SheetStateFrame({
  projectId,
  project,
  projectError,
  children,
}: {
  projectId: number | null
  project?: ProjectOut
  projectError?: unknown
  children: ReactNode
}) {
  return (
    <SheetFocusFrame
      header={<FocusHeader projectId={projectId} project={project} />}
      controls={
        projectError != null ? <ProjectMetadataWarning error={projectError} /> : null
      }
    >
      <div className="h-full min-h-0 min-w-0 p-3">{children}</div>
    </SheetFocusFrame>
  )
}

/** 편집 세션. 시트가 준비된 뒤에만 마운트된다(잠금/자동저장 훅 규칙 준수). */
function SheetEditor({
  projectId,
  project,
  projectError,
  sheet,
  data,
  sheetRefetch,
  sheetRefetchError,
}: {
  projectId: number
  project?: ProjectOut
  projectError: unknown
  sheet: SheetOut
  data: AdaptedConditionGridData
  sheetRefetch: () => Promise<unknown>
  sheetRefetchError: unknown
}) {
  const queryClient = useQueryClient()
  const liveTitleRef = useRef<HTMLHeadingElement>(null)
  const [historyMutationRevision, setHistoryMutationRevision] = useState(0)
  const [backboneDiffMutationRevision, setBackboneDiffMutationRevision] = useState(0)

  const invalidateProjectHistory = useCallback(() => {
    setHistoryMutationRevision((current) => current + 1)
    void invalidateProjectHistoryAfterMutation(queryClient, projectId)
  }, [queryClient, projectId])
  const invalidateProjectBackboneDiff = useCallback(() => {
    setBackboneDiffMutationRevision((current) => current + 1)
    void invalidateProjectBackboneDiffAfterMutation(queryClient, projectId)
  }, [queryClient, projectId])

  const choiceResources = useSheetChoiceSets(sheet.columns)
  const dirtyCells = useEditStore(selectDirtyCells)

  // 저장 성공분을 서버 스냅샷(캐시)에 확정 반영 → 더티 제거 후에도 저장값 유지.
  const commitSaved = useCallback(
    (cells: readonly PersistedCell[]) => commitCanonicalSheetCells(queryClient, projectId, cells),
    [queryClient, projectId],
  )

  const handlePersisted = useCallback(
    async (response: CellsPatchOut, requestSnapshot: readonly DirtyCell[]) => {
      await reconcileSuccessfulPatch(
        response,
        requestSnapshot,
        commitSaved,
        (snapshot) => useEditStore.getState().markSaved(snapshot),
      )
      invalidateProjectHistory()
      invalidateProjectBackboneDiff()
    },
    [commitSaved, invalidateProjectHistory, invalidateProjectBackboneDiff],
  )

  const editing = useSheetEditing(projectId, {
    onPersisted: handlePersisted,
    heartbeatMs: sheet.lock.heartbeat_seconds * 1000,
    initialEditingBy: sheet.lock.locked_by,
  })

  // Loading/error headers are replaced without a pathname change, so RootLayout's pathname-only
  // focus effect does not run again. Restore focus once only when replacement left it on body (or
  // on a detached fallback); never steal focus from a connected control on metadata/status rerenders.
  useEffect(() => {
    if (
      typeof document !== 'undefined' &&
      shouldFocusLiveSheetTitle(document.activeElement, document.body)
    ) {
      liveTitleRef.current?.focus()
    }
  }, [])

  // 컬럼 가독성(T6): 카테고리 탭으로 파라미터 컬럼 부분집합을 고르고, 컬럼 검색-점프로 특정
  // 컬럼으로 스크롤한다. 좌측 식별 컬럼 고정·헤더 hover 툴팁은 어댑터가 내부에서 처리한다.
  const gridRef = useRef<ConditionGridHandle>(null)
  const columnSearchRef = useRef<HTMLInputElement>(null)
  const categories = useMemo(() => distinctCategories(data.columns), [data.columns])
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [columnQuery, setColumnQuery] = useState('')
  const [columnSearchStatus, setColumnSearchStatus] = useState('')
  const [pendingColumnJump, setPendingColumnJump] = useState<string | null>(null)
  const [pendingCoordinateJump, setPendingCoordinateJump] = useState<WorkbenchCoordinate | null>(
    null,
  )
  const [coordinateNavigationStatus, setCoordinateNavigationStatus] = useState<string | null>(null)
  const sortedProjectLayers = useMemo(
    () => [...(project?.layers ?? [])].sort((left, right) => left.sort_order - right.sort_order),
    [project?.layers],
  )
  const [activeLayerKey, setActiveLayerKey] = useState(
    () => sortedProjectLayers[0]?.layer_key ?? data.rows[0]?.layerKey ?? '',
  )
  const [recentLayerKeys, setRecentLayerKeys] = useState<readonly string[]>([])
  const [layerQuery, setLayerQuery] = useState('')
  const [navigatorCollapsed, setNavigatorCollapsed] = useState(false)

  useEffect(() => {
    if (activeLayerKey === '' || !data.rows.some((row) => row.layerKey === activeLayerKey)) {
      setActiveLayerKey(sortedProjectLayers[0]?.layer_key ?? data.rows[0]?.layerKey ?? '')
    }
  }, [activeLayerKey, data.rows, sortedProjectLayers])

  // 서버 행 위에 더티 값을 얹어 표시(편집값 즉시 반영) + 더티 셀 상태 오버레이.
  const displayRows = useMemo(() => applyDirtyToRows(data.rows, dirtyCells), [data.rows, dirtyCells])
  const choiceAuthorizationEpoch = useMemo(
    () => sheetChoiceAuthorizationEpoch(choiceResources),
    [choiceResources],
  )
  const validationDefinitions = useMemo(() => {
    if (project === undefined) return null
    try {
      return toValidationInput(project, sheet, choiceResources)
    } catch (error) {
      if (error instanceof SheetAdapterError) return null
      throw error
    }
  }, [project, sheet, choiceResources, choiceAuthorizationEpoch])
  const validationDefinitionAvailability = resolveValidationDefinitionAvailability({
    projectAvailable: project !== undefined,
    projectError,
    resources: choiceResources.values(),
    definitionsAvailable: validationDefinitions !== null,
  })
  const validationDefinitionsPending = validationDefinitionAvailability === 'pending'
  const validationDefinitionAuthority = useMemo(
    () => Symbol('sheet-validation-definitions'),
    [
      project?.id,
      project?.line_id,
      project?.process_id,
      project?.layers,
      sheet.columns,
      sheet.validation_rules,
      sheet.validation_basis_hash,
      choiceAuthorizationEpoch,
    ],
  )
  const dirtyStatusFacts = useMemo(() => [...dirtyCells.values()], [dirtyCells])
  const cellCommentFacts = useMemo(() => sheetCommentFacts(sheet), [sheet])
  const refetchSheetForValidation = useCallback(async () => {
    await sheetRefetch()
  }, [sheetRefetch])
  const validation = useSheetValidation({
    projectId,
    definitions: validationDefinitions,
    definitionAuthority: validationDefinitionAuthority,
    validationBasisHash: sheet.validation_basis_hash,
    displayRows,
    displayGeneration: editing.displayGeneration,
    persistedGeneration: editing.persistedGeneration,
    persistenceIdle: editing.persistenceIdle,
    dirtyCells: dirtyStatusFacts,
    comments: cellCommentFacts,
    getPersistenceSnapshot: editing.getPersistenceSnapshot,
    waitForPersistence: editing.waitForPersistence,
    refetchSheet: refetchSheetForValidation,
  })
  const gridData = useMemo(
    () => ({
      ...data,
      rows: displayRows.filter((row) => row.layerKey === activeLayerKey),
      statuses: validation.statuses,
      choiceResources,
    }),
    [activeLayerKey, data, displayRows, validation.statuses, choiceResources],
  )

  // 붙여넣기 대상 매핑 기준 컬럼 순서 — 그리드가 view.activeCategory로 거르는 것과 동일한
  // 부분집합이어야 대상 셀 해석이 어긋나지 않는다(같은 activeCategory·같은 함수).
  const visibleColumns = useMemo(
    () => visibleParameterColumns(data.columns, activeCategory),
    [data.columns, activeCategory],
  )
  const validationIssues = useMemo(
    () => enrichValidationIssues(validation.issues, data.columns, displayRows),
    [validation.issues, data.columns, displayRows],
  )
  const issueCountsByLayer = useMemo(() => {
    const counts = new Map<string, number>()
    for (const issue of validation.issues) {
      counts.set(issue.layer_key, (counts.get(issue.layer_key) ?? 0) + 1)
    }
    return counts
  }, [validation.issues])
  const dirtyLayerKeys = useMemo(() => {
    const layerByCondition = new Map(data.rows.map((row) => [row.id, row.layerKey]))
    const keys = new Set<string>()
    for (const cell of dirtyCells.values()) {
      const layerKey = layerByCondition.get(cell.conditionId)
      if (layerKey !== undefined) keys.add(layerKey)
    }
    return keys
  }, [data.rows, dirtyCells])
  const layerItems = useMemo(
    () => buildLayerNavigatorItems(sortedProjectLayers, issueCountsByLayer, dirtyLayerKeys),
    [dirtyLayerKeys, issueCountsByLayer, sortedProjectLayers],
  )
  const showValidationWorkbench = shouldMountValidationWorkbench(
    validation.issues,
    validation.explicitValidationCompleted,
  )
  const workbenchState = useSheetWorkbenchState()
  const historyWorkbench = useHistoryWorkbenchController(
    projectId,
    workbenchState.mode === 'history',
    historyMutationRevision,
  )
  useEffect(() => {
    if (
      workbenchState.mode === 'history' &&
      activeLayerKey !== '' &&
      historyWorkbench.state.filters.layerKey !== activeLayerKey
    ) {
      historyWorkbench.onFiltersChange({
        ...historyWorkbench.state.filters,
        layerKey: activeLayerKey,
      })
    }
  }, [activeLayerKey, historyWorkbench, workbenchState.mode])
  const backboneDiffWorkbench = useBackboneDiffWorkbenchController(
    projectId,
    workbenchState.mode === 'backbone-diff',
    backboneDiffMutationRevision,
  )
  const { onClearNavigationAnnouncement: onClearBackboneNavigationAnnouncement } =
    backboneDiffWorkbench
  const [backboneDiffRefreshAnnouncement, setBackboneDiffRefreshAnnouncement] = useState<string | null>(
    null,
  )

  useEffect(() => {
    setBackboneDiffRefreshAnnouncement(backboneDiffWorkbench.state.navigationAnnouncement)
  }, [backboneDiffWorkbench.state.navigationAnnouncement])
  const onBackboneRefreshAnnouncementReset = useCallback(() => {
    setBackboneDiffRefreshAnnouncement(null)
    onClearBackboneNavigationAnnouncement?.()
  }, [onClearBackboneNavigationAnnouncement])

  const previousValidationIssueCountRef = useRef(0)

  useEffect(() => {
    const issueCount = validationIssues.length
    if (
      shouldAutoOpenValidationWorkbench(
        previousValidationIssueCountRef.current,
        issueCount,
        workbenchState.mode !== null,
      )
    ) {
      workbenchState.selectMode('validation')
    }
    previousValidationIssueCountRef.current = issueCount
  }, [validationIssues.length, workbenchState.mode, workbenchState.selectMode])

  // 붙여넣기 스테이징(적용 전 미리보기). null = 대기 중인 붙여넣기 없음.
  const [paste, setPasteState] = useState<PasteStagingResult | null>(null)
  const pasteRef = useRef<PasteStagingResult | null>(null)
  const pasteIdentityRef = useRef<symbol | null>(null)
  const [pasteError, setPasteError] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const applyingRef = useRef(false)
  const activateLayer = useCallback((layerKey: string) => {
    if (pasteRef.current !== null) {
      setCoordinateNavigationStatus('붙여넣기를 적용 또는 취소한 뒤 이동해 주세요.')
      return
    }
    setActiveLayerKey(layerKey)
    setRecentLayerKeys((current) => updateRecentLayerKeys(current, layerKey))
    setCoordinateNavigationStatus(null)
  }, [])

  const {
    readOnly,
    writeBusy,
    setCell,
    applyPaste,
    abandonPaste,
    runStructuralChange,
  } = editing
  const interaction = resolveSheetInteraction({
    readOnly,
    writeBusy,
    hasPaste: paste !== null,
  })

  // 클립보드 읽기는 비동기로 끝날 수 있으므로, 시작 시점의 좌표/권한 문맥을 generation으로
  // 캡처한다. 권한·카테고리·보이는 컬럼·행 중 하나라도 바뀐 뒤 도착한 콜백은 스테이징 전에
  // 폐기한다. ref는 layout effect에서만 게시해 concurrent WIP/aborted render가 현재 문맥을
  // 오염시키지 않으며, commit 뒤 브라우저가 다음 callback을 실행하기 전에는 최신화된다.
  const pasteCallbackGeneration = useMemo(
    () => Symbol('sheet-paste-context'),
    [
      interaction.canStagePaste,
      activeCategory,
      visibleColumns,
      displayRows,
      choiceAuthorizationEpoch,
    ],
  )
  const pasteCallbackRuntimeRef = useRef({
    generation: pasteCallbackGeneration,
    canStagePaste: interaction.canStagePaste,
  })
  useIsomorphicLayoutEffect(() => {
    commitPasteCallbackRuntime(pasteCallbackRuntimeRef, {
      generation: pasteCallbackGeneration,
      canStagePaste: interaction.canStagePaste,
    })
  }, [pasteCallbackGeneration, interaction.canStagePaste])

  const setPaste = useCallback((next: PasteStagingResult | null) => {
    pasteRef.current = next
    setPasteState(next)
  }, [])
  const pasteCommitRuntimeRef = useRef({
    generation: pasteCallbackGeneration,
    columns: data.columns,
    rows: displayRows,
    choiceResources,
  })
  useIsomorphicLayoutEffect(() => {
    commitPasteCallbackRuntime(pasteCommitRuntimeRef, {
      generation: pasteCallbackGeneration,
      columns: data.columns,
      rows: displayRows,
      choiceResources,
    })
  }, [pasteCallbackGeneration, data.columns, displayRows, choiceResources])

  // 숨겨진 category 결과는 category state가 실제 commit되어 visibleColumns가 바뀐 뒤에만
  // 스크롤한다. setActiveCategory 직후의 오래된 adapter ref에는 명령하지 않는다.
  useEffect(() => {
    if (pendingColumnJump === null) return
    if (!visibleColumns.some((column) => column.key === pendingColumnJump)) return
    gridRef.current?.scrollToColumn(pendingColumnJump)
    setPendingColumnJump(null)
  }, [pendingColumnJump, visibleColumns])

  // A hidden validation target is published only after its category state is requested. This
  // effect observes committed visibleColumns and then crosses the domain-only grid adapter once.
  useEffect(() => {
    if (pendingCoordinateJump === null) return
    if (!visibleColumns.some((column) => column.key === pendingCoordinateJump.parameterCode)) return
    const conditionId = String(pendingCoordinateJump.conditionId)
    const parameterCode = String(pendingCoordinateJump.parameterCode)
    if (!displayRows.some((row) => row.id === conditionId)) {
      setCoordinateNavigationStatus('이동할 대상 셀을 찾지 못했습니다.')
      setPendingCoordinateJump(null)
      return
    }
    gridRef.current?.scrollToCell(conditionId, parameterCode)
    setCoordinateNavigationStatus('대상 셀로 이동했습니다.')
    setPendingCoordinateJump(null)
  }, [pendingCoordinateJump, visibleColumns, displayRows])

  // 조건 행 관리(T7): 추가/복제/삭제 대상은 좌측 식별 컬럼 클릭으로 활성화한 행 하나다.
  // POR 이양은 활성 행과 무관하게 POR 컬럼 클릭으로 바로 실행한다. 구조 변경은 더티 셀 버퍼와
  // 분리된 즉시 API 호출(runStructuralChange)이고, 성공하면 시트 쿼리를 무효화해 다시 조회한다
  // (행 수/POR 지정이 바뀌는 구조적 변화라 부분 캐시 반영보다 재조회가 안전·단순).
  const [activeRow, setActiveRow] = useState<{ conditionId: string; layerKey: string } | null>(null)
  const [selectedCell, setSelectedCell] = useState<CellCommentTarget | null>(null)
  const [structError, setStructError] = useState<string | null>(null)
  const [structBusy, setStructBusy] = useState(false)
  const structInFlightRef = useRef(false) // 구조 변경 중복 실행(빠른 연타) 방지 — 동기 가드.

  const porGaps = useMemo(() => layersMissingPor(data.rows), [data.rows])
  const activeRowLabel = useMemo(() => {
    if (activeRow === null) return null
    const row = data.rows.find((candidate) => candidate.id === activeRow.conditionId)
    return row === undefined ? null : `${row.layerLabel} · ${row.conditionLabel}`
  }, [activeRow, data.rows])

  // 활성 행이 (삭제·외부 변경으로) 시트에서 사라지면 선택을 정리한다 — 없는 행에 대한 조작 방지.
  useEffect(() => {
    if (activeRow !== null && !data.rows.some((row) => row.id === activeRow.conditionId)) {
      setActiveRow(null)
    }
  }, [activeRow, data.rows])

  const refreshSheet = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['sheet', projectId] })
    // Structural mutations also change Project layer condition_count metadata consumed by the
    // exact validation adapter; refresh both halves before provisional evaluation resumes.
    void queryClient.invalidateQueries({ queryKey: ['project', projectId] })
  }, [queryClient, projectId])

  const retryValidationDefinitions = useCallback(() => {
    refreshSheet()
    for (const resource of choiceResources.values()) void resource.retry()
  }, [refreshSheet, choiceResources])

  // 구조 변경 공용 실행: 잠금 검사·더티 flush·잠금 상실 처리(runStructuralChange)를 감싸
  // UI 상태(진행 중/에러)와 재조회를 얹는다. 성공하면 true, 실패하면 에러를 표시하고 false.
  const performStructural = useCallback(
    async (fn: (token: string) => Promise<unknown>): Promise<boolean> => {
      if (structInFlightRef.current) return false
      structInFlightRef.current = true
      setStructBusy(true)
      setStructError(null)
      try {
        await runStructuralChange(fn)
        invalidateProjectHistory()
        invalidateProjectBackboneDiff()
        refreshSheet()
        return true
      } catch (error) {
        setStructError(getApiErrorMessage(error))
        return false
      } finally {
        structInFlightRef.current = false
        setStructBusy(false)
      }
    },
    [
      runStructuralChange,
      invalidateProjectHistory,
      invalidateProjectBackboneDiff,
      refreshSheet,
    ],
  )

  const handleAddEmpty = useCallback(() => {
    if (!interaction.canManageConditions) return
    if (pasteRef.current !== null) return
    if (activeRow === null) return
    const layerKey = activeRow.layerKey
    void performStructural((token) => addCondition(projectId, layerKey, null, token))
  }, [activeRow, interaction.canManageConditions, performStructural, projectId])

  const handleDuplicate = useCallback(() => {
    if (!interaction.canManageConditions) return
    if (pasteRef.current !== null) return
    if (activeRow === null) return
    const { layerKey } = activeRow
    const sourceId = Number(activeRow.conditionId)
    void performStructural((token) => addCondition(projectId, layerKey, sourceId, token))
  }, [activeRow, interaction.canManageConditions, performStructural, projectId])

  const handleDelete = useCallback(async () => {
    if (!interaction.canManageConditions) return
    if (pasteRef.current !== null) return
    if (activeRow === null) return
    // 하드 삭제(셀 값까지 캐스케이드)라 되돌릴 수 없다 — 실행 전 한 번 확인한다.
    if (!window.confirm('이 조건 행을 삭제한다. 되돌릴 수 없다. 계속할까?')) return
    const conditionId = Number(activeRow.conditionId)
    const ok = await performStructural((token) => deleteCondition(projectId, conditionId, token))
    if (ok) setActiveRow(null)
  }, [activeRow, interaction.canManageConditions, performStructural, projectId])

  const clearActive = useCallback(() => {
    setActiveRow(null)
    setStructError(null)
  }, [])

  const gridCallbacks = useMemo<ConditionGridCallbacks>(
    () => ({
      onCellEdit: (cell) => {
        if (!interaction.canEditCells) return
        if (pasteRef.current !== null) return
        setCell(cell.conditionId, cell.parameterCode, cell.value)
      },
      onPaste: (target, tsv) => {
        // ref 가드는 첫 paste setState가 commit되기 전 들어오는 두 번째 Canvas callback도 막는다.
        if (!interaction.canStagePaste) return
        const current = pasteCallbackRuntimeRef.current
        if (
          !isCurrentPasteCallback(
            pasteCallbackGeneration,
            current.generation,
            current.canStagePaste,
          ) ||
          pasteRef.current !== null
        ) {
          return
        }
        const result = buildPasteStaging(
          target,
          parseTsv(tsv),
          visibleColumns,
          displayRows,
          choiceResources,
        )
        // 매핑되는 셀도 없고 잘린 것도 없으면(대상 밖 등) 무시.
        if (result.staging.length === 0 && result.truncatedRows === 0 && result.truncatedCols === 0) {
          return
        }
        setPasteError(null)
        pasteIdentityRef.current = Symbol('sheet-paste-review')
        setPaste(result)
      },
      // POR 이양: 클릭된 행을 POR로. 성공 시 두 행(기존/신규)의 is_por가 바뀌므로 재조회한다.
      onPorChange: (_layerKey, conditionId) => {
        if (!interaction.canTransferPor) return
        if (pasteRef.current !== null) return
        void performStructural((token) => setConditionPor(projectId, Number(conditionId), token))
      },
      // 좌측 식별 컬럼 클릭 → 그 행을 추가/복제/삭제 대상으로 활성화(하단 액션 바에 노출).
      onConditionActivate: (payload) => {
        if (!interaction.canManageConditions || pasteRef.current !== null) return
        setStructError(null)
        setActiveRow(payload)
      },
      onCellActivate: setSelectedCell,
      onCellHistoryRequest: (payload) => {
        if (historyWorkbench.onCellHistoryRequest(payload)) {
          workbenchState.selectMode('history')
        }
      },
    }),
    [
      interaction,
      setCell,
      visibleColumns,
      displayRows,
      choiceResources,
      performStructural,
      projectId,
      setPaste,
      pasteCallbackGeneration,
      historyWorkbench.onCellHistoryRequest,
      workbenchState.selectMode,
    ],
  )

  const cancelPaste = useCallback(() => {
    if (!interaction.canCancelPaste || applyingRef.current) return
    const pasteIdentity = pasteIdentityRef.current
    if (pasteIdentity !== null) abandonPaste(pasteIdentity)
    pasteIdentityRef.current = null
    setPaste(null)
    setPasteError(null)
  }, [interaction.canCancelPaste, abandonPaste, setPaste])

  const commitPaste = useCallback(async () => {
    if (!interaction.canApplyPaste || pasteRef.current === null || applyingRef.current) return
    const pasteIdentity = pasteIdentityRef.current
    if (pasteIdentity === null) return
    applyingRef.current = true
    setApplying(true)
    setPasteError(null)
    try {
      const saved = await applyPaste(pasteIdentity, () => {
        const currentPaste = pasteRef.current
        if (currentPaste === null) return []
        const current = pasteCommitRuntimeRef.current
        const latestPaste = revalidatePasteStaging(
          currentPaste,
          current.columns,
          current.rows,
          current.choiceResources,
        )
        setPaste(latestPaste)
        // 현재 권한으로 다시 검증한 유효 셀만 첫 revision snapshot에 포함한다.
        const validCells: PersistedCell[] = persistablePasteCells(latestPaste, current.rows)
        return validCells
      })
      if (saved) {
        pasteIdentityRef.current = null
        setPaste(null) // 성공 → 스테이징 종료(서버 스냅샷에 반영됨)
      }
    } catch (error) {
      // 실패(네트워크/409 등): 스테이징 유지 + 에러 표시 → 사용자가 다시 "적용" 가능.
      setPasteError(getApiErrorMessage(error))
    } finally {
      applyingRef.current = false
      setApplying(false)
    }
  }, [interaction.canApplyPaste, applyPaste, setPaste])

  const jumpToColumn = useCallback(() => {
    if (!interaction.canSwitchCategory || pasteRef.current !== null) return
    const result = resolveColumnJump(data.columns, activeCategory, columnQuery)
    columnSearchRef.current?.focus()
    if (result.kind === 'empty') {
      setColumnSearchStatus('검색어를 입력하세요.')
      return
    }
    if (result.kind === 'not-found') {
      setColumnSearchStatus(`“${columnQuery.trim()}”에 맞는 컬럼이 없습니다.`)
      return
    }

    const match = data.columns.find((column) => column.key === result.parameterCode)
    setColumnSearchStatus(`${match?.headerName ?? result.parameterCode} 컬럼으로 이동했습니다.`)
    if (result.requiresCategoryChange) {
      setPendingCoordinateJump(null)
      setPendingColumnJump(result.parameterCode)
      setActiveCategory(result.categoryCode)
      return
    }
    gridRef.current?.scrollToColumn(result.parameterCode)
  }, [interaction.canSwitchCategory, columnQuery, data.columns, activeCategory])

  const selectCategory = useCallback(
    (category: string | null) => {
      if (!interaction.canSwitchCategory || pasteRef.current !== null) return
      setPendingColumnJump(null)
      setPendingCoordinateJump(null)
      setColumnSearchStatus('')
      setActiveCategory(category)
    },
    [interaction.canSwitchCategory],
  )

  const activateWorkbenchCoordinate = useCallback(
    (coordinate: WorkbenchCoordinate) => {
      if (!interaction.canSwitchCategory || pasteRef.current !== null) {
        setCoordinateNavigationStatus('붙여넣기를 적용 또는 취소한 뒤 이동해 주세요.')
        return
      }
      const navigation = resolveWorkbenchCoordinateNavigation(
        coordinate,
        data.columns,
        displayRows,
        activeCategory,
      )
      setPendingColumnJump(null)
      setPendingCoordinateJump(null)
      if (navigation.kind === 'missing-target') {
        setCoordinateNavigationStatus('이동할 대상 셀을 찾지 못했습니다.')
        return
      }
      if (navigation.kind === 'reveal-category') {
        setActiveCategory(navigation.categoryCode)
        setPendingCoordinateJump(navigation.target)
        return
      }
      gridRef.current?.scrollToCell(
        String(navigation.target.conditionId),
        String(navigation.target.parameterCode),
      )
      setCoordinateNavigationStatus('대상 셀로 이동했습니다.')
    },
    [interaction.canSwitchCategory, data.columns, displayRows, activeCategory],
  )

  const activateWorkbenchJumpTarget = useCallback(
    (target: { readonly condition_id: string | number | null; readonly parameter_code: string | null }) => {
      if (target.condition_id === null || target.parameter_code === null) {
        return
      }
      activateWorkbenchCoordinate({
        conditionId: target.condition_id,
        parameterCode: target.parameter_code,
      })
    },
    [activateWorkbenchCoordinate],
  )

  const activateValidationIssue = useCallback(
    (issue: ValidationWorkbenchIssue) => {
      activateWorkbenchJumpTarget({
        condition_id: issue.conditionId,
        parameter_code: issue.parameterCode,
      })
    },
    [activateWorkbenchJumpTarget],
  )

  const activateHistoryJumpTarget = useCallback(
    (target: HistoryJumpTargetOut) => {
      activateWorkbenchJumpTarget(target)
    },
    [activateWorkbenchJumpTarget],
  )

  const backboneDiffWorkbenchState = backboneDiffWorkbench.state
  const backboneDiffRootCounts = backboneDiffWorkbenchState.rootCounts ?? BACKBONE_DIFF_EMPTY_COUNTS
  const backboneDiffRoot = useMemo<BackboneDiffRoot | null>(() => {
    if (
      backboneDiffWorkbenchState.rootScope === null ||
      backboneDiffWorkbenchState.rootBasisHash === null ||
      backboneDiffWorkbenchState.rootCounts === null
    ) {
      return null
    }
    return {
      scope: backboneDiffWorkbenchState.rootScope,
      basisHash: backboneDiffWorkbenchState.rootBasisHash,
      counts: {
        layerCount: backboneDiffRootCounts.layer_count,
        availableLayerCount: backboneDiffRootCounts.available_layer_count,
        unavailableLayerCount: backboneDiffRootCounts.unavailable_layer_count,
        rowCount: backboneDiffRootCounts.row_count,
        cellCount: backboneDiffRootCounts.cell_count,
        fullRowCount: backboneDiffRootCounts.full_row_count,
        fullCellCount: backboneDiffRootCounts.full_cell_count,
        ambiguousLineageCount: backboneDiffRootCounts.ambiguous_lineage_count,
        addedCount: backboneDiffRootCounts.added_count,
        changedCount: backboneDiffRootCounts.changed_count,
        clearedCount: backboneDiffRootCounts.cleared_count,
        removedCount: backboneDiffRootCounts.removed_count,
        unchangedCount: backboneDiffRootCounts.unchanged_count,
      },
      changedPreview: backboneDiffWorkbenchState.previewItems.map((preview) => ({
        itemKind: preview.item_kind,
        classification: preview.classification,
        layerKey: preview.layer_key,
        effectiveConditionIndex: preview.effective_condition_index,
        itemSortKey: preview.item_sort_key,
        rowRef: preview.row_ref,
        cellScope: preview.cell_scope,
        rowStatus: preview.row_status,
        parameterCode: preview.parameter_code,
      })),
      layerSummaries: backboneDiffWorkbenchState.layerSummaries.map((summary) => ({
        layerKey: summary.layer_key,
        layerStatus: summary.layer_status,
        baselineConditionCount: summary.baseline_condition_count,
        currentConditionCount: summary.current_condition_count,
        rowCount: summary.row_count,
        cellCount: summary.cell_count,
        fullRowCount: summary.full_row_count,
        fullCellCount: summary.full_cell_count,
        ambiguousLineageCount: summary.ambiguous_lineage_count,
        changedCount: summary.changed_count,
      })),
    }
  }, [backboneDiffWorkbenchState])
  const backboneDiffLayerScopeByLayer = useMemo(() => {
    const byLayer = new Map<string, string | null>()
    for (const summary of backboneDiffWorkbenchState.layerSummaries) {
      byLayer.set(summary.layer_key, summary.branch_scope)
    }
    return byLayer
  }, [backboneDiffWorkbenchState.layerSummaries])

  const backboneDiffBranchConditionItems = useMemo(
    () =>
      backboneDiffWorkbenchState.branchPages.flatMap((page) =>
        page.items.map((condition) => ({
          rowRef: condition.row_ref,
          rowStatus: condition.row_status,
          effectiveConditionIndex: condition.effective_condition_index,
          identity: condition.identity,
          baselineCondition:
            condition.baseline_condition === null
              ? null
              : mapBackboneDiffConditionMetadata(condition.baseline_condition),
          currentCondition:
            condition.current_condition === null
              ? null
              : mapBackboneDiffConditionMetadata(condition.current_condition),
          rowMetadata: mapBackboneDiffConditionRowMetadata(condition.row_metadata),
          filteredCellCount: condition.filtered_cell_count,
          fullCellCount: condition.full_cell_count,
          jumpStatus: condition.jump_status,
          cellScope: condition.cell_scope,
        })),
      ),
    [backboneDiffWorkbenchState.branchPages],
  )
  const backboneDiffCellItems = useMemo(
    () =>
      backboneDiffWorkbenchState.cellPages.flatMap((page) =>
        page.items.map((cell) => ({
          classification: cell.classification,
          reason: cell.reason,
          parameterCode: cell.parameter_code,
          parameterSort: cell.parameter_sort,
          baselineValue: cell.baseline_value,
          currentValue: cell.current_value,
          jumpStatus: cell.jump_status,
        })),
      ),
    [backboneDiffWorkbenchState.cellPages],
  )
  const backboneDiffLayerConditionBranches = useMemo<Record<string, BranchState<BackboneDiffConditionItem>>>(() => {
    if (backboneDiffWorkbenchState.openLayerKey === null) return {}
    if (backboneDiffWorkbenchState.rootBasisHash === null) return {}
    if (backboneDiffWorkbenchState.branchScope === null) return {}

    return {
      [backboneDiffWorkbenchState.openLayerKey]: {
        status: backboneDiffWorkbench.branchStatus,
        basisHash: backboneDiffWorkbenchState.rootBasisHash,
        scope: backboneDiffWorkbenchState.branchScope,
        items: backboneDiffBranchConditionItems,
        nextCursor: backboneDiffWorkbenchState.branchNextCursor,
        error: backboneDiffWorkbench.branchError,
        nextPageError: backboneDiffWorkbench.branchNextPageError,
      },
    }
  }, [
    backboneDiffWorkbenchState.branchNextCursor,
    backboneDiffWorkbenchState.branchScope,
    backboneDiffWorkbench.branchStatus,
    backboneDiffWorkbenchState.openLayerKey,
    backboneDiffWorkbenchState.rootBasisHash,
    backboneDiffWorkbench.branchError,
    backboneDiffWorkbench.branchNextPageError,
    backboneDiffBranchConditionItems,
  ])
  const branchRowCellScopeByRef = useMemo(() => {
    const byRowRef = new Map<string, string | null>()
    for (const condition of backboneDiffBranchConditionItems) {
      byRowRef.set(condition.rowRef, condition.cellScope)
    }
    return byRowRef
  }, [backboneDiffBranchConditionItems])
  const backboneDiffCellBranches = useMemo<Record<string, BranchState<BackboneDiffCellItem>>>(() => {
    if (backboneDiffWorkbenchState.openCellRowRef === null) return {}
    if (backboneDiffWorkbenchState.rootBasisHash === null) return {}
    if (backboneDiffWorkbenchState.openCellScope === null) return {}

    return {
      [backboneDiffWorkbenchState.openCellRowRef]: {
        status: backboneDiffWorkbench.cellStatus,
        basisHash: backboneDiffWorkbenchState.rootBasisHash,
        scope: backboneDiffWorkbenchState.openCellScope,
        items: backboneDiffCellItems,
        nextCursor: backboneDiffWorkbenchState.cellNextCursor,
        error: backboneDiffWorkbench.cellError,
        nextPageError: backboneDiffWorkbench.cellNextPageError,
      },
    }
  }, [
    backboneDiffWorkbenchState.openCellRowRef,
    backboneDiffWorkbenchState.openCellScope,
    backboneDiffWorkbenchState.rootBasisHash,
    backboneDiffWorkbenchState.cellNextCursor,
    backboneDiffWorkbench.cellError,
    backboneDiffWorkbench.cellNextPageError,
    backboneDiffWorkbench.cellStatus,
    backboneDiffCellItems,
  ])

  const onBackboneFiltersChange = useCallback(
    (nextFilters: BackboneDiffFilter) => {
      const payload = mapBackboneDiffFilterPayload(nextFilters)
      backboneDiffWorkbench.onFiltersChange({
        classification: payload.classification,
        layerKey: payload.layerKey,
        categoryCode: payload.categoryCode,
        parameterCode: payload.parameterCode,
        includeUnchanged: payload.includeUnchanged,
        previewLimit: backboneDiffWorkbenchState.filters.previewLimit,
      })
    },
    [backboneDiffWorkbench, backboneDiffWorkbenchState.filters.previewLimit],
  )
  const onBackboneOpenLayer = useCallback((layerKey: string) => {
    const branchScope = backboneDiffLayerScopeByLayer.get(layerKey)
    if (branchScope === undefined || branchScope === null) return
    backboneDiffWorkbench.onOpenBranch(layerKey, branchScope)
  }, [backboneDiffWorkbench, backboneDiffLayerScopeByLayer])
  const onBackboneLoadMoreConditions = useCallback(
    (layerKey: string, cursor: string | null) => {
      if (backboneDiffWorkbenchState.openLayerKey !== layerKey) return
      backboneDiffWorkbench.onLoadMoreConditions(cursor)
    },
    [backboneDiffWorkbench, backboneDiffWorkbenchState.openLayerKey],
  )
  const onBackboneRetryConditions = useCallback(
    (_layerKey: string) => {
      backboneDiffWorkbench.onRetryBranch()
    },
    [backboneDiffWorkbench],
  )
  const onBackboneOpenCells = useCallback(
    (rowRef: string) => {
      if (backboneDiffWorkbenchState.openLayerKey === null) return
      const scope = branchRowCellScopeByRef.get(rowRef)
      if (scope === undefined || scope === null) return
      backboneDiffWorkbench.onOpenCell(backboneDiffWorkbenchState.openLayerKey, rowRef, scope)
    },
    [backboneDiffWorkbench, backboneDiffWorkbenchState.openLayerKey, branchRowCellScopeByRef],
  )
  const onBackboneLoadMoreCells = useCallback(
    (rowRef: string, cursor: string | null) => {
      if (backboneDiffWorkbenchState.openCellRowRef !== rowRef) return
      backboneDiffWorkbench.onLoadMoreCells(cursor)
    },
    [backboneDiffWorkbench, backboneDiffWorkbenchState.openCellRowRef],
  )
  const onBackboneRetryCells = useCallback(
    (_rowRef: string) => {
      backboneDiffWorkbench.onRetryCell()
    },
    [backboneDiffWorkbench],
  )
  const onBackboneActivateTarget = useCallback(
    (target: BackboneDiffJumpTarget) => {
      activateWorkbenchJumpTarget({
        condition_id: target.conditionId,
        parameter_code: target.parameterCode,
      })
    },
    [activateWorkbenchJumpTarget],
  )
  const onBackboneRetryRoot = useCallback(() => {
    backboneDiffWorkbench.onRetryRoot()
  }, [backboneDiffWorkbench])

  const backboneDiffFilters: BackboneDiffFilter = useMemo(
    () => ({
      classification: backboneDiffWorkbenchState.filters.classification,
      layerKey: backboneDiffWorkbenchState.filters.layerKey ?? '',
      categoryCode: backboneDiffWorkbenchState.filters.categoryCode ?? '',
      parameterCode: backboneDiffWorkbenchState.filters.parameterCode ?? '',
      includeUnchanged: backboneDiffWorkbenchState.filters.includeUnchanged,
    }),
    [backboneDiffWorkbenchState.filters],
  )
  const backboneDiffRootUnavailableCopy = useMemo(() => {
    if (backboneDiffRootCounts.unavailable_layer_count <= 0) return null
    return BACKBONE_DIFF_ROOT_UNAVAILABLE_MESSAGE
  }, [backboneDiffRootCounts.unavailable_layer_count])

  return (
    <SheetFocusFrame
      header={
        <FocusHeader
          projectId={projectId}
          project={project}
          editing={editing}
          titleRef={liveTitleRef}
        />
      }
      controls={
        <div className="space-y-2 border-b border-border-subtle bg-canvas px-3 py-2">
          {projectError != null ? <ProjectMetadataWarning error={projectError} /> : null}
          {sheetRefetchError != null ? (
            <InlineAlert
              className="rounded-md px-2 py-1.5 text-xs"
              data-testid="sheet-refetch-warning"
              tone="warning"
            >
              최신 시트 조회에 실패했습니다. 기존 데이터와 미저장 편집은 유지됩니다:{' '}
              {getApiErrorMessage(sheetRefetchError)}
            </InlineAlert>
          ) : null}
          {porGaps.length > 0 ? (
            <InlineAlert
              className="rounded-md px-2 py-1.5 text-xs"
              data-testid="por-warning"
              tone="warning"
            >
              POR 미지정 Layer <strong>{porGaps.length}</strong>개 —{' '}
              {porGaps.map((group) => group.layerLabel).join(', ')}
              {interaction.canTransferPor ? ' — 빈 원(○)을 선택하면 POR 이양' : null}
            </InlineAlert>
          ) : null}
          {validationDefinitionsPending ? (
            <InlineAlert
              className="rounded-md px-2 py-1.5 text-xs"
              data-testid="validation-definitions-pending"
              id={VALIDATION_DEFINITIONS_STATUS_ID}
              tone="info"
            >
              검증 규칙을 불러오는 중
            </InlineAlert>
          ) : null}
          {validationDefinitionAvailability === 'unavailable' ? (
            <InlineAlert
              className="rounded-md px-2 py-1.5 text-xs"
              data-testid="validation-configuration-alert"
              tone="error"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span>{validation.provisional.failure}</span>
                <Button
                  onClick={retryValidationDefinitions}
                  size="compact"
                  type="button"
                  variant="secondary"
                >
                  다시 조회
                </Button>
              </div>
            </InlineAlert>
          ) : null}
          {!showValidationWorkbench &&
          validationDefinitionAvailability === 'ready' &&
          validation.issueAuthority !== 'unavailable' &&
          validation.serverFailure !== null ? (
            <InlineAlert
              className="rounded-md px-2 py-1.5 text-xs"
              data-testid="validation-action-failure"
              tone="warning"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span>{validation.serverFailure}</span>
                {validation.serverConfirmation === 'failed' &&
                validation.serverFailure === VALIDATION_SERVER_FAILURE ? (
                  <Button
                    onClick={() => void validation.retry()}
                    size="compact"
                    type="button"
                    variant="secondary"
                  >
                    다시 시도
                  </Button>
                ) : null}
              </div>
            </InlineAlert>
          ) : null}
          <div className="flex min-w-0 flex-wrap items-center gap-2" data-testid="sheet-category-tabs">
            <SheetMetrics rowCount={gridData.rows.length} colCount={data.columns.length} />
            {categories.length > 0 ? (
              <>
                <CategoryTab
                  active={activeCategory === null}
                  disabled={!interaction.canSwitchCategory}
                  onClick={() => selectCategory(null)}
                >
                  전체
                </CategoryTab>
                {categories.map((category) => (
                  <CategoryTab
                    key={category}
                    active={activeCategory === category}
                    disabled={!interaction.canSwitchCategory}
                    onClick={() => selectCategory(category)}
                  >
                    {category}
                  </CategoryTab>
                ))}
              </>
            ) : null}
            <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
              <Button
                aria-describedby={
                  validationDefinitionsPending ? VALIDATION_DEFINITIONS_STATUS_ID : undefined
                }
                data-testid="sheet-explicit-validation"
                disabled={paste !== null || validationDefinitionAvailability !== 'ready'}
                loading={
                  validationDefinitionsPending ||
                  validation.serverConfirmation === 'waiting-for-persistence' ||
                  validation.serverConfirmation === 'validating'
                }
                onClick={() => void validation.explicitlyValidate()}
                size="compact"
                type="button"
              >
                검증
              </Button>
              <SheetWorkbenchToggle
                expanded={workbenchState.mode !== null}
                onToggle={workbenchState.toggle}
              />
              <label
                className="shrink-0 text-xs font-semibold text-ink-950"
                htmlFor="sheet-column-search"
              >
                컬럼 검색
              </label>
              <input
                aria-describedby={COLUMN_SEARCH_STATUS_ID}
                className="input w-56 min-w-36"
                disabled={!interaction.canSwitchCategory}
                id="sheet-column-search"
                placeholder="컬럼 검색 (예: ETCH_P012)"
                ref={columnSearchRef}
                value={columnQuery}
                data-testid="sheet-column-search"
                onChange={(event) => setColumnQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') jumpToColumn()
                }}
              />
              <Button
                className="shrink-0"
                data-testid="sheet-column-jump"
                disabled={!interaction.canSwitchCategory}
                onClick={jumpToColumn}
                size="compact"
                type="button"
                variant="secondary"
              >
                컬럼 점프
              </Button>
              <span
                aria-atomic="true"
                aria-live="polite"
                className="max-w-64 truncate text-xs text-muted"
                id={COLUMN_SEARCH_STATUS_ID}
                role="status"
              >
                {columnSearchStatus}
              </span>
            </div>
          </div>
          {paste !== null ? (
            <PasteStagingPanel
              result={paste}
              columns={data.columns}
              rows={data.rows}
              applying={applying}
              canApply={interaction.canApplyPaste}
              canCancel={interaction.canCancelPaste}
              error={pasteError}
              onApply={commitPaste}
              onCancel={cancelPaste}
            />
          ) : null}
          {interaction.canManageConditions ? (
            <ConditionRowManager
              activeLabel={activeRowLabel}
              busy={structBusy}
              error={structError}
              onAddEmpty={handleAddEmpty}
              onDuplicate={handleDuplicate}
              onDelete={handleDelete}
              onClear={clearActive}
            />
          ) : null}
          <CellCommentPanel projectId={projectId} target={selectedCell} />
          <InteractionGuide editing={editing} mode={interaction.mode} />
        </div>
      }
      navigator={
        <LayerNavigator
          items={layerItems}
          activeLayerKey={activeLayerKey}
          recentLayerKeys={recentLayerKeys}
          query={layerQuery}
          collapsed={navigatorCollapsed}
          onQueryChange={setLayerQuery}
          onActivate={activateLayer}
          onCollapsedChange={setNavigatorCollapsed}
        />
      }
      inspector={
        workbenchState.mode !== null ? (
          <SheetWorkbenchPanel
            mode={workbenchState.mode}
            onModeChange={workbenchState.selectMode}
            onResizeBy={workbenchState.resizeBy}
            onSetWidth={workbenchState.setInspectorWidth}
            inspectorWidth={workbenchState.inspectorWidth}
            validationIssueCount={validationIssues.length}
            validationContent={
              <ValidationWorkbench
                definitionsPending={validationDefinitionsPending}
                issues={validationIssues}
                summary={validation.summary}
                issueAuthority={validation.issueAuthority}
                serverConfirmation={validation.serverConfirmation}
                serverFailure={validation.serverFailure}
                navigationStatus={coordinateNavigationStatus}
                onIssueActivate={activateValidationIssue}
                onRetry={() => void validation.retry()}
              />
            }
            historyContent={
              <HistoryWorkbench
                projectId={projectId}
                state={historyWorkbench.state}
                coverage={historyWorkbench.coverage}
                cellHistory={historyWorkbench.cellHistory}
                timelineStatus={historyWorkbench.timelineStatus}
                timelineError={historyWorkbench.timelineError}
                nextPageError={historyWorkbench.nextPageError}
                cellStatus={historyWorkbench.cellStatus}
                cellError={historyWorkbench.cellError}
                cellNextPageError={historyWorkbench.cellNextPageError}
                batchDetailStatus={historyWorkbench.batchDetailStatus}
                batchDetailError={historyWorkbench.batchDetailError}
                batchDetailIsFetchingNextPage={historyWorkbench.batchDetailIsFetchingNextPage}
                batchDetailNextPageError={historyWorkbench.batchDetailNextPageError}
                navigationStatus={coordinateNavigationStatus}
                onFiltersChange={historyWorkbench.onFiltersChange}
                onModeChange={historyWorkbench.onModeChange}
                onBatchToggle={historyWorkbench.onBatchToggle}
                onRetryBatchDetail={historyWorkbench.onRetryBatchDetail}
                onLoadMoreBatchDetail={historyWorkbench.onLoadMoreBatchDetail}
                onActivateTarget={activateHistoryJumpTarget}
                onLoadMoreTimeline={historyWorkbench.onLoadMoreTimeline}
                onLoadMoreCell={historyWorkbench.onLoadMoreCell}
                onRetryTimeline={historyWorkbench.onRetryTimeline}
                onRetryCell={historyWorkbench.onRetryCell}
              />
            }
            backboneDiffContent={
              <BackboneDiffWorkbench
                root={backboneDiffRoot}
                rootStatus={backboneDiffWorkbench.rootStatus}
                rootError={backboneDiffWorkbench.rootError}
                onRetryRoot={onBackboneRetryRoot}
                onRefreshAnnouncementReset={onBackboneRefreshAnnouncementReset}
                refreshAnnouncement={backboneDiffRefreshAnnouncement}
                filters={backboneDiffFilters}
                onFiltersChange={onBackboneFiltersChange}
                preview={{
                  status: backboneDiffWorkbench.rootStatus,
                  items: backboneDiffRoot?.changedPreview ?? [],
                  nextCursor: null,
                  error: backboneDiffWorkbench.rootError,
                  nextPageError: backboneDiffWorkbench.rootNextPageError,
                }}
                onLoadMorePreview={() => undefined}
                onRetry={onBackboneRetryRoot}
                layerConditionBranches={backboneDiffLayerConditionBranches}
                onOpenLayer={onBackboneOpenLayer}
                onLoadMoreConditions={onBackboneLoadMoreConditions}
                onRetryConditions={onBackboneRetryConditions}
                cellBranches={backboneDiffCellBranches}
                onOpenCells={onBackboneOpenCells}
                onLoadMoreCells={onBackboneLoadMoreCells}
                onRetryCells={onBackboneRetryCells}
                onCloseBranch={backboneDiffWorkbench.onCloseBranch}
                onCloseCell={backboneDiffWorkbench.onCloseCell}
                onActivateTarget={onBackboneActivateTarget}
                baselineUnavailableCopy={backboneDiffRootUnavailableCopy}
              />
            }
          />
        ) : undefined
      }
    >
      <div
        className="h-full min-h-0 min-w-0 overflow-hidden bg-surface"
        data-sheet-editor
        data-testid="sheet-view-grid"
      >
        <GlideConditionGrid
          ref={gridRef}
          data={gridData}
          view={{ readOnly: !interaction.canEditCells, activeCategory }}
          callbacks={gridCallbacks}
          pasteStaging={paste?.staging}
        />
      </div>
    </SheetFocusFrame>
  )
}

/**
 * 조건 행 관리 액션 바(T7): 좌측 식별 컬럼 클릭으로 활성화한 행에 대해 빈 행 추가/복제/삭제를
 * 노출한다. 잠금 보유(편집 가능) 상태에서만 렌더된다. 실제 API 호출·재조회는 상위(SheetEditor)가
 * runStructuralChange로 처리하고, 여기서는 버튼과 진행/에러 표시만 담당한다.
 */
function ConditionRowManager({
  activeLabel,
  busy,
  error,
  onAddEmpty,
  onDuplicate,
  onDelete,
  onClear,
}: {
  activeLabel: string | null
  busy: boolean
  error: string | null
  onAddEmpty: () => void
  onDuplicate: () => void
  onDelete: () => void
  onClear: () => void
}) {
  const noSelection = activeLabel === null
  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm shadow-sm"
      data-testid="condition-row-manager"
    >
      <span className="shrink-0 font-semibold text-ink-950">조건 행 관리</span>
      {noSelection ? (
        <span className="min-w-0 flex-1 truncate text-muted">
          Layer/조건 셀을 클릭해 대상 행을 선택합니다.
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate text-muted" title={activeLabel}>
          선택: <strong className="text-ink-950">{activeLabel}</strong>
        </span>
      )}
      <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={onAddEmpty}
          disabled={busy || noSelection}
          data-testid="condition-add"
          size="compact"
        >
          빈 행 추가
        </Button>
        <Button
          type="button"
          onClick={onDuplicate}
          disabled={busy || noSelection}
          data-testid="condition-duplicate"
          size="compact"
          variant="secondary"
        >
          복제
        </Button>
        <Button
          type="button"
          onClick={onDelete}
          disabled={busy || noSelection}
          data-testid="condition-delete"
          size="compact"
          variant="danger"
        >
          삭제
        </Button>
        {!noSelection ? (
          <Button
            type="button"
            onClick={onClear}
            disabled={busy}
            size="compact"
            variant="secondary"
          >
            선택 해제
          </Button>
        ) : null}
        {busy ? (
          <span aria-live="polite" className="text-xs text-muted" role="status">
            처리 중...
          </span>
        ) : null}
      </div>
      {error !== null ? (
        <InlineAlert
          className="basis-full rounded-md px-2 py-1.5 text-xs"
          data-testid="condition-error"
          tone="error"
        >
          {error}
        </InlineAlert>
      ) : null}
    </div>
  )
}

function CategoryTab({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      aria-pressed={active}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md border px-3 font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60',
        'h-[34px] text-xs',
        active
          ? 'border-brand-700 bg-brand-700 text-white hover:bg-ink-950'
          : 'border-border-control bg-surface text-ink-950 hover:bg-canvas',
      )}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  )
}

/** 상단 붙여넣기 스테이징 패널: 대기/유효/불일치 개수 + 잘림 안내 + 불일치 목록 + 적용/취소. */
const MAX_MISMATCH_ROWS = 6

function PasteStagingPanel({
  result,
  columns,
  rows,
  applying,
  canApply,
  canCancel,
  error,
  onApply,
  onCancel,
}: {
  result: PasteStagingResult
  columns: readonly ConditionGridColumn[]
  rows: readonly ConditionGridRow[]
  applying: boolean
  canApply: boolean
  canCancel: boolean
  error: string | null
  onApply: () => void
  onCancel: () => void
}) {
  const columnNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const column of columns) map.set(column.key, column.headerName)
    return map
  }, [columns])
  const rowLabels = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of rows) map.set(row.id, `${row.layerLabel} · ${row.conditionLabel}`)
    return map
  }, [rows])

  const total = result.staging.length
  const invalid = result.staging.filter((cell) => !cell.valid)
  const validCount = total - invalid.length
  const truncated = result.truncatedRows > 0 || result.truncatedCols > 0

  return (
    <div
      className="space-y-2 rounded-lg border border-border-subtle bg-surface p-3 text-sm text-ink-950"
      data-testid="paste-staging-panel"
    >
      <div
        aria-atomic="true"
        aria-live="polite"
        className="flex flex-wrap items-center gap-2"
        role="status"
      >
        <span className="font-semibold text-ink-950">붙여넣기 미리보기</span>
        <Badge tone="neutral">대기 {total}</Badge>
        <Badge className="border-success bg-success-surface text-success" tone="neutral">
          적용 {validCount}
        </Badge>
        {invalid.length > 0 ? <Badge tone="error">불일치 {invalid.length}</Badge> : null}
      </div>

      {truncated ? (
        <InlineAlert className="rounded-md px-2 py-1.5 text-xs" tone="warning">
          시트 경계를 넘는 데이터는 잘렸다
          {result.truncatedRows > 0 ? ` · 행 ${result.truncatedRows}` : ''}
          {result.truncatedCols > 0 ? ` · 컬럼 ${result.truncatedCols}` : ''}
        </InlineAlert>
      ) : null}

      {invalid.length > 0 ? (
        <ul className="space-y-0.5 text-error">
          {invalid.slice(0, MAX_MISMATCH_ROWS).map((cell) => (
            <li key={`${cell.conditionId} ${cell.parameterCode}`}>
              {rowLabels.get(cell.conditionId) ?? cell.conditionId} ·{' '}
              {columnNames.get(cell.parameterCode) ?? cell.parameterCode}:{' '}
              <span className="font-mono">{cell.value ?? ''}</span>
              {cell.message !== undefined ? ` — ${cell.message}` : ''}
            </li>
          ))}
          {invalid.length > MAX_MISMATCH_ROWS ? (
            <li>외 {invalid.length - MAX_MISMATCH_ROWS}건…</li>
          ) : null}
        </ul>
      ) : null}

      {invalid.length > 0 ? <p className="text-muted">불일치 셀은 적용에서 제외된다.</p> : null}

      {error !== null ? (
        <InlineAlert className="rounded-md px-2 py-1.5 text-xs" tone="error">
          적용 실패: {error}
        </InlineAlert>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={onApply}
          disabled={!canApply || validCount === 0}
          loading={applying}
          size="compact"
        >
          {applying ? '적용 중...' : `적용 (${validCount})`}
        </Button>
        <Button
          type="button"
          onClick={onCancel}
          disabled={applying || !canCancel}
          size="compact"
          variant="secondary"
        >
          취소
        </Button>
        {!canApply && !applying ? (
          <span aria-live="polite" className="text-xs text-warning" role="status">
            현재 잠금 상태에서는 적용할 수 없습니다. 취소하거나 헤더에서 잠금을 다시 확보하세요.
          </span>
        ) : null}
      </div>
    </div>
  )
}

function InteractionGuide({
  editing,
  mode,
}: {
  editing: SheetEditing
  mode: 'editable' | 'read-only' | 'write-busy' | 'paste-review'
}) {
  let message: string
  switch (mode) {
    case 'paste-review':
      message = '적용 또는 취소 후 계속'
      break
    case 'write-busy':
      message = '변경사항을 처리 중입니다. 완료되면 편집을 계속할 수 있습니다.'
      break
    case 'read-only':
      switch (editing.lockStatus) {
        case 'acquiring':
          message = '잠금을 확인 중입니다. 확보되면 셀 편집을 시작할 수 있습니다.'
          break
        case 'readonly':
          message =
            editing.editingBy === null
              ? '현재 읽기 전용입니다. 잠금이 풀리면 자동으로 다시 확인하며, 헤더의 재시도로 바로 확인할 수 있습니다.'
              : `${editing.editingBy} 사용자가 편집 중입니다. 잠금이 풀리면 자동으로 다시 확인하며, 헤더의 재시도로 바로 확인할 수 있습니다.`
          break
        case 'lost':
          message = '편집 잠금을 잃어 읽기 전용입니다. 헤더의 재획득으로 다시 시도하세요.'
          break
        case 'held':
          message = '현재 읽기 전용입니다. 잠금 상태가 갱신되면 편집을 다시 시작할 수 있습니다.'
          break
      }
      break
    case 'editable':
      message =
        '범위 복사 Ctrl+C · 붙여넣기 Ctrl+V · 조건 행은 왼쪽 Layer/조건 셀 선택 · 빈 원(○)을 선택하면 POR 이양'
      break
  }

  return (
    <p
      aria-atomic="true"
      aria-live="polite"
      className="text-xs text-muted"
      data-testid="sheet-interaction-guide"
      role="status"
    >
      {message}
    </p>
  )
}

function FocusHeader({
  projectId,
  project,
  editing,
  titleRef,
}: {
  projectId: number | null
  project?: ProjectOut
  editing?: SheetEditing
  titleRef?: RefObject<HTMLHeadingElement>
}) {
  const title = project?.name ?? `프로젝트 #${projectId ?? '?'}`
  const detailPath = projectId === null ? '/projects' : `/projects/${projectId}`

  return (
    <header
      className="focus-surface-dark flex h-10 min-w-0 items-center justify-between gap-3 overflow-hidden bg-ink-950 px-2 text-white sm:px-3"
      data-sheet-focus-header
    >
      <div className="flex min-w-0 items-center gap-2">
        <Link
          aria-label={projectId === null ? '프로젝트 목록으로 돌아가기' : '프로젝트 상세로 돌아가기'}
          className="inline-flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-semibold text-brand-100 hover:bg-white/10"
          to={detailPath}
        >
          ← 상세
        </Link>
        <Link
          aria-label="PCM 프로젝트 목록"
          className="inline-flex h-8 shrink-0 items-center rounded-md px-1 font-bold tracking-[0.12em] text-white hover:bg-white/10"
          to="/projects"
        >
          PCM
        </Link>
        <span aria-hidden="true" className="h-4 w-px shrink-0 bg-white/25" />
        <h1
          ref={titleRef}
          className="min-w-0 truncate text-sm font-semibold focus:outline-none"
          data-page-title
          tabIndex={-1}
          title={title}
        >
          {title}
        </h1>
        {project?.status === 'draft' ? (
          <span className="shrink-0 rounded-full border border-brand-500/70 bg-brand-500/15 px-2 py-0.5 text-[11px] font-semibold leading-4 text-brand-100">
            초안
          </span>
        ) : null}
      </div>
      {editing ? (
        <div
          aria-label="편집 및 저장 상태"
          aria-atomic="false"
          aria-live="polite"
          className="flex min-w-0 shrink-0 items-center gap-2 text-xs"
          data-sheet-editing-status
          role="status"
        >
          <LockChip editing={editing} />
          {editing.lockStatus === 'held' ? <SaveStatus editing={editing} /> : null}
        </div>
      ) : null}
    </header>
  )
}

export function shouldFocusLiveSheetTitle(
  activeElement: Element | null,
  body: HTMLElement,
): boolean {
  return activeElement === null || activeElement === body || !activeElement.isConnected
}

function ProjectMetadataWarning({ error }: { error: unknown }) {
  return (
    <InlineAlert
      className="rounded-none border-x-0 border-t-0 px-3 py-1.5 text-xs"
      data-testid="project-metadata-warning"
      tone="warning"
    >
      프로젝트 정보 조회에 실패했습니다. ID 기반 제목으로 계속 편집할 수 있습니다:{' '}
      {getApiErrorMessage(error)}
    </InlineAlert>
  )
}

function SheetMetrics({ rowCount, colCount }: { rowCount: number; colCount: number }) {
  return (
    <div className="flex shrink-0 items-center gap-3 text-xs text-muted">
      <span>
        행 <strong>{rowCount}</strong>
      </span>
      <span>
        컬럼 <strong>{colCount}</strong>
      </span>
    </div>
  )
}

function LockChip({ editing }: { editing: SheetEditing }) {
  switch (editing.lockStatus) {
    case 'acquiring':
      return <span className="rounded-full bg-white/10 px-2 py-0.5 text-white">잠금 확인 중</span>
    case 'held':
      return (
        <span className="rounded-full bg-brand-500/20 px-2 py-0.5 text-brand-100">편집 잠금</span>
      )
    case 'readonly':
      return (
        <span className="flex min-w-0 items-center gap-2">
          <span className="max-w-64 truncate rounded-full bg-warning-surface px-2 py-0.5 text-warning">
            {editing.editingBy !== null
              ? `읽기 전용 · 편집 중: ${editing.editingBy}`
              : '읽기 전용 · 잠금 필요'}
          </span>
          <button
            type="button"
            onClick={editing.reacquire}
            className="h-7 shrink-0 rounded-md border border-brand-500 px-2 font-semibold text-brand-100 hover:bg-white/10"
          >
            재시도
          </button>
        </span>
      )
    case 'lost':
      return (
        <span className="flex items-center gap-2">
          <span className="rounded-full bg-error-surface px-2 py-0.5 text-error">
            잠금 상실
          </span>
          <button
            type="button"
            onClick={editing.reacquire}
            className="h-7 shrink-0 rounded-md border border-brand-500 px-2 font-semibold text-brand-100 hover:bg-white/10"
          >
            재획득
          </button>
        </span>
      )
  }
}

function SaveStatus({ editing }: { editing: SheetEditing }) {
  const { saveStatus, dirtyCount, discard, retrySave } = editing
  return (
    <span className="flex min-w-0 items-center gap-2">
      {dirtyCount > 0 ? (
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-white">미저장 {dirtyCount}</span>
      ) : null}
      {saveStatus === 'saving' ? <span className="text-brand-100">저장 중...</span> : null}
      {saveStatus === 'saved' && dirtyCount === 0 ? (
        <span className="text-brand-100">저장됨</span>
      ) : null}
      {saveStatus === 'error' ? (
        <span className="flex items-center gap-2">
          <span className="text-error-surface">저장 실패</span>
          <button
            type="button"
            onClick={retrySave}
            className="h-7 rounded-md border border-brand-500 px-2 font-semibold text-brand-100 hover:bg-white/10"
          >
            재시도
          </button>
        </span>
      ) : null}
      {dirtyCount > 0 ? (
        <button
          type="button"
          onClick={discard}
          className="h-7 rounded-md border border-white/40 px-2 font-semibold text-white hover:bg-white/10"
        >
          변경 취소
        </button>
      ) : null}
    </span>
  )
}

/** 라우트 래퍼: `/projects/:projectId/sheet`. */
export function SheetViewPage() {
  const params = useParams()
  const projectId = parsePositiveInt(params.projectId)

  return projectId === null ? (
    <SheetStateFrame projectId={null}>
      <ErrorMessage message="올바른 프로젝트 ID가 아닙니다. 프로젝트 목록에서 다시 선택하세요." />
    </SheetStateFrame>
  ) : (
    <SheetView projectId={projectId} />
  )
}
