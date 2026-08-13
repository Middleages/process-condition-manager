import type { ButtonHTMLAttributes } from 'react'

import { cn } from '../lib/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'compact' | 'default'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-brand-700 text-white hover:bg-ink-950',
  secondary: 'border border-border-control bg-surface text-ink-950 hover:bg-canvas',
  ghost: 'bg-transparent text-brand-700 hover:bg-brand-100',
  danger: 'border border-error bg-error-surface text-error hover:bg-error hover:text-white',
}

const SIZE_CLASSES: Record<ButtonSize, string> = {
  compact: 'h-[34px] px-3 text-xs',
  default: 'h-9 px-4 text-sm',
}

export function Button({
  variant = 'primary',
  size = 'default',
  loading = false,
  disabled,
  className,
  children,
  ...buttonProps
}: ButtonProps) {
  const ariaBusy = loading ? true : buttonProps['aria-busy']

  return (
    <button
      {...buttonProps}
      aria-busy={ariaBusy}
      className={cn(
        'relative inline-flex min-w-0 items-center justify-center rounded-[3px] font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      disabled={disabled || loading}
    >
      <span className={cn('inline-flex min-w-0 items-center gap-2', loading && 'opacity-0')}>{children}</span>
      {loading ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
        </span>
      ) : null}
    </button>
  )
}
