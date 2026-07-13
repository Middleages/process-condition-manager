import { createBrowserRouter, RouterProvider } from 'react-router-dom'

import { appRoutes } from './routes'

const router = createBrowserRouter(appRoutes)

export function AppRouter() {
  return <RouterProvider router={router} />
}
