import type { ReactNode } from 'react'

import { InlineAlert } from './InlineAlert'

export function LoadingMessage({ children = '불러오는 중...' }: { children?: ReactNode }) {
  return <InlineAlert tone="info">{children}</InlineAlert>
}

export function ErrorMessage({ message }: { message: string }) {
  return <InlineAlert tone="error">{message}</InlineAlert>
}
