import type { ReactNode } from 'react'

export function LoadingMessage({ children = '불러오는 중...' }: { children?: ReactNode }) {
  return <div className="rounded-lg border border-slate-800 bg-slate-900 p-4 text-slate-300">{children}</div>
}

export function ErrorMessage({ message }: { message: string }) {
  return <div className="rounded-lg border border-red-900 bg-red-950/60 p-4 text-red-100">{message}</div>
}
