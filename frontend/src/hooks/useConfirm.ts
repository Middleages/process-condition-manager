import { useState, useCallback } from 'react'
import * as React from 'react'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

interface UseConfirmOptions {
  title: string
  description: string
  confirmText?: string
  cancelText?: string
  variant?: 'default' | 'destructive'
}

interface UseConfirmReturn {
  confirm: () => Promise<boolean>
  ConfirmDialogElement: React.ReactNode
}

export function useConfirm(options: UseConfirmOptions): UseConfirmReturn {
  const [open, setOpen] = useState(false)
  const [resolveRef, setResolveRef] = useState<((value: boolean) => void) | null>(null)

  const confirm = useCallback((): Promise<boolean> => {
    return new Promise((resolve) => {
      setResolveRef(() => resolve)
      setOpen(true)
    })
  }, [])

  const handleConfirm = useCallback(() => {
    resolveRef?.(true)
    setResolveRef(null)
  }, [resolveRef])

  const handleCancel = useCallback(() => {
    resolveRef?.(false)
    setResolveRef(null)
  }, [resolveRef])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        resolveRef?.(false)
        setResolveRef(null)
      }
      setOpen(nextOpen)
    },
    [resolveRef]
  )

  const ConfirmDialogElement = React.createElement(ConfirmDialog, {
    open,
    onOpenChange: handleOpenChange,
    title: options.title,
    description: options.description,
    confirmText: options.confirmText,
    cancelText: options.cancelText,
    variant: options.variant,
    onConfirm: handleConfirm,
    onCancel: handleCancel,
  })

  return { confirm, ConfirmDialogElement }
}
