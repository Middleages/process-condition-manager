import { X } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import type { ReactNode, RefObject } from 'react'

import { cn } from '../lib/cn'

export type ModalCloseReason = 'escape' | 'backdrop' | 'button'

export interface ModalSurfaceProps {
  open: boolean
  title: string
  variant: 'dialog' | 'drawer'
  onRequestClose: (reason: ModalCloseReason) => void
  initialFocusRef?: RefObject<HTMLElement>
  fallbackFocusRef?: RefObject<HTMLElement>
  children: ReactNode
  footer?: ReactNode
}

type ModalVariantProps = Omit<ModalSurfaceProps, 'variant'>

export function ModalSurface({
  open,
  title,
  variant,
  onRequestClose,
  initialFocusRef,
  fallbackFocusRef,
  children,
  footer,
}: ModalSurfaceProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const capturedFocusRef = useRef<HTMLElement | null>(null)
  const fallbackRef = useRef(fallbackFocusRef)
  const titleId = useId()

  fallbackRef.current = fallbackFocusRef

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (open) {
      if (!dialog.open) {
        const activeElement = document.activeElement
        capturedFocusRef.current = activeElement instanceof HTMLElement ? activeElement : null
        dialog.showModal()
      }

      ;(initialFocusRef?.current ?? titleRef.current)?.focus()
      return
    }

    if (dialog.open) dialog.close()
    restoreCapturedFocus(capturedFocusRef, fallbackRef.current)
  }, [initialFocusRef, open])

  useEffect(
    () => () => {
      const dialog = dialogRef.current
      if (dialog?.open) dialog.close()
      restoreCapturedFocus(capturedFocusRef, fallbackRef.current)
    },
    [],
  )

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-modal="true"
      className={cn(
        'overflow-hidden border border-border-subtle bg-surface p-0 text-ink-950 shadow-2xl backdrop:bg-ink-950/60',
        variant === 'dialog'
          ? 'm-auto max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-lg rounded-xl'
          : 'inset-y-0 left-auto right-0 m-0 ml-auto h-[100dvh] max-h-[100dvh] w-full max-w-none border-y-0 border-r-0 lg:w-[clamp(420px,36vw,480px)] lg:max-w-[40vw]',
      )}
      onCancel={(event) => {
        event.preventDefault()
        onRequestClose('escape')
      }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onRequestClose('backdrop')
      }}
    >
      <div
        className={cn(
          'flex min-h-0 flex-col bg-surface',
          variant === 'dialog' ? 'max-h-[calc(100dvh-2rem)]' : 'h-full',
        )}
      >
        <header className="flex shrink-0 items-start gap-4 border-b border-border-subtle px-5 py-4">
          <h2
            ref={titleRef}
            id={titleId}
            className="min-w-0 flex-1 rounded-sm text-lg font-bold tracking-tight text-ink-950 focus:outline-2 focus:outline-offset-2 focus:outline-brand-700"
            tabIndex={-1}
          >
            {title}
          </h2>
          <button
            aria-label="닫기"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted transition-colors duration-150 hover:bg-canvas hover:text-ink-950"
            title="닫기"
            type="button"
            onClick={() => onRequestClose('button')}
          >
            <X aria-hidden="true" size={18} strokeWidth={2} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>

        {footer ? (
          <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border-subtle bg-canvas px-5 py-4">
            {footer}
          </footer>
        ) : null}
      </div>
    </dialog>
  )
}

export function Dialog(props: ModalVariantProps) {
  return <ModalSurface {...props} variant="dialog" />
}

export function Drawer(props: ModalVariantProps) {
  return <ModalSurface {...props} variant="drawer" />
}

function restoreCapturedFocus(
  capturedFocusRef: RefObject<HTMLElement | null>,
  fallbackFocusRef?: RefObject<HTMLElement>,
) {
  const capturedFocus = capturedFocusRef.current
  if (capturedFocus?.isConnected && capturedFocus !== document.body) {
    capturedFocus.focus()
  } else {
    fallbackFocusRef?.current?.focus()
  }
}
