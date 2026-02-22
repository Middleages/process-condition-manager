import { useState, useMemo } from 'react'
import { useComments } from '@/hooks/useComments'
import { CommentThread } from './CommentThread'
import { useEditorStore } from '@/stores/useEditorStore'
import type { Comment, ColumnCategory, ProjectLayerData } from '@/types'
import { MessageSquare, Filter, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  projectId: number
  categories: ColumnCategory[]
  layers: ProjectLayerData[]
  onToggle?: (open: boolean) => void
  isOpen?: boolean
}

export function CommentPanel({ projectId, categories, layers, onToggle, isOpen = true }: Props) {
  const { data, isLoading } = useComments(projectId)
  const [filterUnresolved, setFilterUnresolved] = useState(false)

  const setActiveCategory = useEditorStore((s) => s.setActiveCategory)
  const setActiveLayerId = useEditorStore((s) => s.setActiveLayerId)
  const setActiveColumnName = useEditorStore((s) => s.setActiveColumnName)

  const comments = data?.comments ?? []
  const unresolvedCount = data?.unresolved_count ?? 0

  const filteredComments = useMemo(() => {
    let result = filterUnresolved
      ? comments.filter((c) => !c.is_resolved)
      : comments

    // Sort: unresolved first, then by created_at desc
    result = [...result].sort((a, b) => {
      if (a.is_resolved !== b.is_resolved) return a.is_resolved ? 1 : -1
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })

    return result
  }, [comments, filterUnresolved])

  const handleNavigate = (comment: Comment) => {
    if (!comment.column_name || !comment.project_layer_id) return

    // Clear first to allow re-navigation to the same cell
    setActiveColumnName(null)

    // Find which category this column belongs to
    for (const cat of categories) {
      const col = cat.columns.find((c) => c.column_name === comment.column_name)
      if (col) {
        setActiveCategory(cat.category_code)
        break
      }
    }

    // Map project_layer_id -> layer_id for correct grid scroll
    const layer = layers.find(l => l.id === comment.project_layer_id)
    if (layer) {
      setActiveLayerId(layer.layer_id)
      requestAnimationFrame(() => setActiveColumnName(comment.column_name!))
    }
  }

  return (
    <div className="border-t bg-background">
      {/* Header */}
      <button
        className="w-full flex items-center justify-between px-4 py-2 text-sm font-medium hover:bg-muted/50"
        onClick={() => onToggle?.(!isOpen)}
      >
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4" />
          <span>댓글</span>
          {unresolvedCount > 0 && (
            <span className="bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 leading-none">
              {unresolvedCount}
            </span>
          )}
        </div>
        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
      </button>

      {isOpen && (
        <div className="px-4 pb-3 max-h-[300px] overflow-y-auto">
          {/* Filter */}
          <div className="flex items-center gap-2 mb-3">
            <Button
              variant={filterUnresolved ? 'default' : 'outline'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setFilterUnresolved(!filterUnresolved)}
            >
              <Filter className="h-3 w-3 mr-1" />
              {filterUnresolved ? '미해결만' : '전체'}
            </Button>
            <span className="text-xs text-muted-foreground">
              {filteredComments.length}건
              {!filterUnresolved && unresolvedCount > 0 && ` (미해결 ${unresolvedCount}건)`}
            </span>
          </div>

          {/* Content */}
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              댓글 로딩 중...
            </div>
          ) : filteredComments.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center">
              {filterUnresolved ? '미해결 댓글이 없습니다.' : '댓글이 없습니다.'}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredComments.map((comment) => (
                <CommentThread
                  key={comment.id}
                  comment={comment}
                  projectId={projectId}
                  onNavigate={handleNavigate}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
