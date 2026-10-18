import type { ReactNode } from 'react'
import { useProductWorkspace } from '@/features/projects/ProductWorkspace'
import { ProjectDetail } from '@/features/projects/ProjectDetailPage'
import { useUnsavedChanges } from '@/shared/navigation/useUnsavedChanges'
import { InlineAlert } from '@/shared/components/InlineAlert'
import { useHistoryWorkbenchController } from './useHistoryWorkbenchController'
import { HistoryWorkbench } from './HistoryWorkbench'

export interface SheetFocusFrameProps {
  header: ReactNode
  controls: ReactNode
  children: ReactNode
  navigator?: ReactNode
  inspector?: ReactNode
  workbench?: ReactNode
  history?: ReactNode
  guardWhen?: boolean
  guardFreezeWhen?: boolean
}

export function SheetFocusFrame({ header, controls, children, navigator, inspector, workbench, history, guardWhen = false, guardFreezeWhen = false }: SheetFocusFrameProps) {
  const workspace = useProductWorkspace()
  const evidence = inspector ?? workbench
  const tab = workspace?.tab ?? 'sheet'
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden" data-sheet-focus-frame>
      {workspace && workspace.mutation !== 'profile' && typeof document !== 'undefined' ? <WorkspaceGuard when={guardWhen} freezeWhen={guardFreezeWhen || workspace.mutation !== 'none'} /> : null}
      <div className="h-10 shrink-0">{header}</div>
      {workspace ? <>
        <div role="tablist" aria-label="제품 공정조건" className="flex shrink-0 gap-1 border-b border-border-subtle bg-surface px-3 py-2">
          {(['sheet', 'profile', 'history'] as const).map((item, index, items) => <button key={item} type="button" role="tab" id={`workspace-tab-${item}`} aria-controls={`workspace-panel-${item}`} aria-selected={tab === item} tabIndex={tab === item ? 0 : -1}
            className={`rounded-md px-4 py-2 text-sm font-bold ${tab === item ? 'bg-brand-700 text-white' : 'text-muted hover:bg-canvas'}`}
            onClick={() => workspace.setTab(item)} onKeyDown={(event) => {
              const next = event.key === 'ArrowRight' ? items[(index + 1) % 3] : event.key === 'ArrowLeft' ? items[(index + 2) % 3] : event.key === 'Home' ? items[0] : event.key === 'End' ? items[2] : null
              if (next) { event.preventDefault(); workspace.setTab(next); document.getElementById(`workspace-tab-${next}`)?.focus() }
            }}>{({ sheet: '조건표', profile: '기본정보', history: '이력' })[item]}</button>)}
        </div>
        {workspace.error ? <InlineAlert tone="warning">{workspace.error}{workspace.releaseFailed ? <button type="button" className="ml-3 underline" disabled={workspace.mutation !== 'none'} onClick={() => void workspace.recoverEditing()}>잠금 해제 재시도</button> : null}{workspace.mutation === 'refresh' ? <button type="button" className="ml-3 underline" onClick={() => void workspace.endMutation()}>다시 불러오기</button> : null}</InlineAlert> : null}
      </> : null}
      <div role={workspace ? 'tabpanel' : undefined} id="workspace-panel-sheet" aria-labelledby="workspace-tab-sheet" hidden={tab !== 'sheet'} className={tab === 'sheet' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
        <div className="min-w-0 shrink-0" data-sheet-controls>{controls}</div>
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden" data-sheet-work-row>
          {navigator != null ? <aside className="min-h-0 shrink-0 overflow-hidden" data-sheet-layer-navigator>{navigator}</aside> : null}
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden" data-sheet-grid-host>{children}</div>
          {evidence != null && tab === 'sheet' ? <aside className="min-h-0 shrink-0 overflow-hidden" data-sheet-evidence-inspector>{evidence}</aside> : null}
        </div>
      </div>
      {workspace ? <div hidden={tab !== 'profile'} role="tabpanel" id="workspace-panel-profile" aria-labelledby="workspace-tab-profile" className={tab === 'profile' ? "min-h-0 flex-1 overflow-auto p-4" : "hidden"}>
        {workspace.project ? <ProjectDetail project={workspace.project} /> : <p>기본정보를 불러오는 중입니다.</p>}
      </div> : null}
      {workspace ? <div hidden={tab !== 'history'} role="tabpanel" id="workspace-panel-history" aria-labelledby="workspace-tab-history" className={tab === 'history' ? "min-h-0 flex-1 overflow-auto p-4" : "hidden"}>
        {history ? (tab === 'history' ? history : null) : (workspace.project ? <EmptySheetHistory projectId={workspace.project.id} enabled={tab === 'history'} /> : <p>이력을 불러오는 중입니다.</p>)}
      </div> : null}
    </div>
  )
}

/** Empty/malformed sheets still expose the existing history query contract. */
function EmptySheetHistory({ projectId, enabled }: { projectId: number; enabled: boolean }) {
  const history = useHistoryWorkbenchController(projectId, enabled, 0)
  return enabled ? <HistoryWorkbench {...history} projectId={projectId} currentLayerLabel="전체" selectedCellAvailable={false} navigationStatus="현재 조건표에서 좌표를 표시할 수 없습니다." /> : null
}

function WorkspaceGuard({ when, freezeWhen }: { when: boolean; freezeWhen: boolean }) {
  useUnsavedChanges({ when, freezeWhen, message: '저장되지 않은 입력이 있습니다. 조건표를 나갈까요?' })
  return null
}
