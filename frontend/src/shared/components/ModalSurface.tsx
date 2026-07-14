import { X } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import type { MutableRefObject, ReactNode, RefObject } from 'react'

import { cn } from '../lib/cn'

export type ModalCloseReason = 'escape' | 'backdrop' | 'button'

export interface ModalSurfaceProps {
  open: boolean
  title: string
  variant: 'dialog' | 'drawer'
  onRequestClose: (reason: ModalCloseReason) => void
  initialFocusRef?: RefObject<HTMLElement>
  fallbackFocusRef?: RefObject<HTMLElement>
  returnFocusRef?: RefObject<HTMLElement>
  closeDisabled?: boolean
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
  returnFocusRef,
  closeDisabled = false,
  children,
  footer,
}: ModalSurfaceProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const capturedFocusRef = useRef<HTMLElement | null | undefined>(undefined)
  const fallbackRef = useRef(fallbackFocusRef)
  const titleId = useId()

  fallbackRef.current = fallbackFocusRef

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (open) {
      if (!dialog.open) {
        const activeElement = document.activeElement
        const capturedFocus = activeElement instanceof HTMLElement ? activeElement : null
        dialog.showModal()
        capturedFocusRef.current = capturedFocus
      }

      ;(initialFocusRef?.current ?? titleRef.current)?.focus()
      return
    }

    if (dialog.open) dialog.close()
    restoreModalFocus(capturedFocusRef, fallbackRef.current, returnFocusRef)
  }, [initialFocusRef, open, returnFocusRef])

  useEffect(
    () => () => {
      const dialog = dialogRef.current
      if (dialog?.open) dialog.close()
      restoreModalFocus(capturedFocusRef, fallbackRef.current, returnFocusRef)
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
        if (shouldRequestModalClose('escape', closeDisabled)) {
          onRequestClose('escape')
        }
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return

        // Native <dialog> focus wrapping is inconsistent across browser automation
        // and embedded WebViews. Keep every Tab transition inside the topmost surface.
        event.stopPropagation()
        const focusable = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((element) => element.getClientRects().length > 0)
        const activeIndex = focusable.indexOf(document.activeElement as HTMLElement)
        const targetIndex = resolveModalTabTarget(activeIndex, focusable.length, event.shiftKey)

        if (targetIndex === null) return
        event.preventDefault()
        focusable[targetIndex]?.focus()
      }}
      onPointerDown={(event) => {
        if (
          event.target === event.currentTarget &&
          shouldRequestModalClose('backdrop', closeDisabled)
        ) {
          onRequestClose('backdrop')
        }
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
            disabled={closeDisabled}
            onClick={() => {
              if (shouldRequestModalClose('button', closeDisabled)) {
                onRequestClose('button')
              }
            }}
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

export function restoreModalFocus(
  capturedFocusRef: MutableRefObject<HTMLElement | null | undefined>,
  fallbackFocusRef?: RefObject<HTMLElement>,
  returnFocusRef?: RefObject<HTMLElement>,
) {
  const capturedFocus = capturedFocusRef.current
  if (capturedFocus === undefined) return

  capturedFocusRef.current = undefined
  if (returnFocusRef?.current?.isConnected) {
    returnFocusRef.current.focus()
    return
  }
  if (capturedFocus?.isConnected && capturedFocus !== document.body) {
    capturedFocus.focus()
  } else {
    fallbackFocusRef?.current?.focus()
  }
}

export function resolveModalTabTarget(
  activeIndex: number,
  focusableCount: number,
  backwards: boolean,
): number | null {
  if (focusableCount <= 0) return null
  if (activeIndex < 0) return backwards ? focusableCount - 1 : 0
  if (backwards && activeIndex === 0) return focusableCount - 1
  if (!backwards && activeIndex === focusableCount - 1) return 0
  return null
}

export function shouldRequestModalClose(
  _reason: ModalCloseReason,
  closeDisabled: boolean,
): boolean {
  return !closeDisabled
}
