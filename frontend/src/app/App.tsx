import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'

import { AuthGuard } from './AuthGuard'
import { AppRouter } from './router'
import { queryClient } from './queryClient'

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthGuard>
          <AppRouter />
        </AuthGuard>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
