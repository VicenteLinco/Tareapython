import { Suspense, lazy, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { AppLayout } from '@/components/layout/app-layout'
import { ErrorBoundary } from '@/components/ui/error-boundary'
import { AuthInitializer } from '@/components/auth/AuthInitializer'

const LoginPage = lazy(() => import('@/pages/login'))
const DashboardPage = lazy(() => import('@/pages/dashboard'))
const StockPage = lazy(() => import('@/pages/stock'))
const ConsumosPage = lazy(() => import('@/pages/consumos'))
const RecepcionesPage = lazy(() => import('@/pages/recepciones'))
const NuevaRecepcionPage = lazy(() => import('@/pages/recepciones/nueva'))
const RecepcionDetallePage = lazy(() => import('@/pages/recepciones/detalle'))
const MovimientosPage = lazy(() => import('@/pages/movimientos'))
const SolicitudesCompraPage = lazy(() => import('@/pages/solicitudes-compra'))
const CreadorProductosPage = lazy(() => import('@/pages/creador-productos'))
const DescartesPage = lazy(() => import('@/pages/descartes'))
const ConfiguracionPage = lazy(() => import('@/pages/configuracion'))
const SetupPage = lazy(() => import('@/pages/setup'))
const UsuariosPage = lazy(() => import('@/pages/usuarios'))
const ConteoPage = lazy(() => import('@/pages/conteo/index'))
const ConteoDetallePage = lazy(() => import('@/pages/conteo/detalle'))
const AuditLogPage = lazy(() => import('@/pages/audit-log'))
const OrdenesCompraPage = lazy(() => import('@/pages/ordenes-compra'))
const OrdenCompraDetallePage = lazy(() => import('@/pages/ordenes-compra/detalle'))
const ScanPage = lazy(() => import('./pages/scan/index'))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      retry: 1,
    },
  },
})

function PageFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <span className="loading loading-spinner loading-lg text-primary" />
    </div>
  )
}

export default function App() {
  useEffect(() => {
    const handleWheel = () => {
      if (document.activeElement?.getAttribute('type') === 'number') {
        (document.activeElement as HTMLElement).blur()
      }
    }
    window.addEventListener('wheel', handleWheel, { passive: true })
    return () => window.removeEventListener('wheel', handleWheel)
  }, [])

  return (
    <ErrorBoundary>
      <AuthInitializer>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <Suspense fallback={<PageFallback />}>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route element={<AppLayout />}>
                  <Route path="/" element={<DashboardPage />} />
                  <Route path="/stock" element={<StockPage />} />
                  <Route path="/consumos" element={<ConsumosPage />} />
                  <Route path="/descartes" element={<DescartesPage />} />
                  <Route path="/recepciones" element={<RecepcionesPage />} />
                  <Route path="/recepciones/nueva" element={<NuevaRecepcionPage />} />
                  <Route path="/recepciones/:id" element={<RecepcionDetallePage />} />
                  <Route path="/conteo" element={<ConteoPage />} />
                  <Route path="/conteo/:id" element={<ConteoDetallePage />} />
                  <Route path="/movimientos" element={<MovimientosPage />} />
                  <Route path="/solicitudes-compra" element={<SolicitudesCompraPage />} />
                  <Route path="/ordenes-compra" element={<OrdenesCompraPage />} />
                  <Route path="/ordenes-compra/:id" element={<OrdenCompraDetallePage />} />
                  <Route path="/creador-productos" element={<CreadorProductosPage />} />
                  <Route path="/configuracion" element={<ConfiguracionPage />} />
                  <Route path="/usuarios" element={<UsuariosPage />} />
                  <Route path="/audit-log" element={<AuditLogPage />} />
                  <Route path="/setup" element={<SetupPage />} />
                </Route>
                <Route path="/scan/:token" element={<ScanPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
          <Toaster position="top-right" richColors />
        </QueryClientProvider>
      </AuthInitializer>
    </ErrorBoundary>
  )
}
