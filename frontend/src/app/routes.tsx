import { lazy, Suspense } from 'react'
import { Navigate, type RouteObject } from 'react-router-dom'

import { ParameterAdminPage } from '@/features/parameters/ParameterAdminPage'
import { ProcessExplorerPage } from '@/features/processes/ProcessExplorerPage'
import { ProjectCreatePage } from '@/features/projects/ProjectCreatePage'
import { ProjectDetailPage } from '@/features/projects/ProjectDetailPage'
import { ProjectListPage } from '@/features/projects/ProjectListPage'
import { SheetViewPage } from '@/features/sheets/SheetView'
import { AppLayout } from '@/shared/layout/AppLayout'
import { RootLayout } from '@/shared/layout/RootLayout'

const GridDemoPage = import.meta.env.DEV
  ? lazy(async () => {
      const module = await import('@/features/sheets/GridDemoPage')
      return { default: module.GridDemoPage }
    })
  : null

const developmentRoutes: RouteObject[] =
  GridDemoPage === null
    ? []
    : [
        {
          path: 'grid-demo',
          element: (
            <Suspense fallback={<p className="text-sm text-muted">그리드 데모 로딩 중...</p>}>
              <GridDemoPage />
            </Suspense>
          ),
        },
      ]

export const appRoutes: RouteObject[] = [
  {
    element: <RootLayout />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <Navigate to="/projects" replace /> },
          { path: 'projects', element: <ProjectListPage /> },
          { path: 'projects/new', element: <ProjectCreatePage /> },
          { path: 'projects/:projectId', element: <ProjectDetailPage /> },
          { path: 'projects/:projectId/sheet', element: <SheetViewPage /> },
          { path: 'processes', element: <ProcessExplorerPage /> },
          { path: 'parameters', element: <ParameterAdminPage /> },
          ...developmentRoutes,
        ],
      },
    ],
  },
]
