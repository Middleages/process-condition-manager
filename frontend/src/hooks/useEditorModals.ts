import { useState, useCallback } from 'react'
import type { ProjectLayerData } from '@/types'

interface CommentTarget {
  projectLayerId: number
  layerName: string
  columnName: string
  columnDisplayName: string
}

export function useEditorModals() {
  const [backboneReplaceLayer, setBackboneReplaceLayer] = useState<ProjectLayerData | null>(null)
  const [showBackboneModal, setShowBackboneModal] = useState(false)
  const [showLayerAddModal, setShowLayerAddModal] = useState(false)
  const [showRecipeModal, setShowRecipeModal] = useState(false)
  const [showRevisionModal, setShowRevisionModal] = useState(false)
  const [showReviewModal, setShowReviewModal] = useState(false)
  const [showCommentPanel, setShowCommentPanel] = useState(true)
  const [commentDialogOpen, setCommentDialogOpen] = useState(false)
  const [commentTarget, setCommentTarget] = useState<CommentTarget | null>(null)

  const handleBackboneReplace = useCallback((layer: ProjectLayerData) => {
    setBackboneReplaceLayer(layer)
    setShowBackboneModal(true)
  }, [])

  const handleCellRightClick = useCallback(
    (projectLayerId: number, layerName: string, columnName: string, columnDisplayName: string) => {
      setCommentTarget({ projectLayerId, layerName, columnName, columnDisplayName })
      setCommentDialogOpen(true)
    },
    []
  )

  return {
    backboneReplaceLayer,
    showBackboneModal, setShowBackboneModal,
    showLayerAddModal, setShowLayerAddModal,
    showRecipeModal, setShowRecipeModal,
    showRevisionModal, setShowRevisionModal,
    showReviewModal, setShowReviewModal,
    showCommentPanel, setShowCommentPanel,
    commentDialogOpen, setCommentDialogOpen,
    commentTarget,
    handleBackboneReplace,
    handleCellRightClick,
  }
}
