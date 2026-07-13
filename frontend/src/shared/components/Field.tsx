import { cloneElement, type AriaAttributes, type HTMLAttributes, type ReactElement, type ReactNode } from 'react'

import { cn } from '../lib/cn'

interface FieldControlProps {
  id?: string
  'aria-describedby'?: string
  'aria-invalid'?: AriaAttributes['aria-invalid']
}

export interface FieldProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  label: ReactNode
  help?: ReactNode
  error?: ReactNode
  inputId: string
  children: ReactElement<FieldControlProps>
}

export function Field({ label, help, error, inputId, children, className, ...fieldProps }: FieldProps) {
  const helpId = help ? `${inputId}-help` : undefined
  const errorId = error ? `${inputId}-error` : undefined
  const describedBy = [children.props['aria-describedby'], helpId, errorId].filter(Boolean).join(' ') || undefined
  const control = cloneElement(children, {
    id: inputId,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : children.props['aria-invalid'],
  })

  return (
    <div {...fieldProps} className={cn('grid gap-1.5', className)}>
      <label className="text-sm font-semibold text-ink-950" htmlFor={inputId}>
        {label}
      </label>
      {control}
      {help ? (
        <p className="text-xs text-muted" id={helpId}>
          {help}
        </p>
      ) : null}
      {error ? (
        <p className="text-xs font-medium text-error" id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  )
}
