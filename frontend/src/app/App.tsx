import { QueryClientProvider } from '@tanstack/react-query'

import { AuthGuard } from './AuthGuard'
import { AppRouter } from './router'
import { queryClient } from './queryClient'

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthGuard>
        <AppRouter />
      </AuthGuard>
    </QueryClientProvider>
  )
}
