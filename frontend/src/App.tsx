import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { AppLayout } from '@/components/layout/app-layout'
import { ErrorBoundary } from '@/components/ui/error-boundary'
import LoginPage from '@/pages/login'
import DashboardPage from '@/pages/dashboard'
import StockPage from '@/pages/stock'
import ConsumosPage from '@/pages/consumos'
import RecepcionesPage from '@/pages/recepciones'
import NuevaRecepcionPage from '@/pages/recepciones/nueva'
import RecepcionDetallePage from '@/pages/recepciones/detalle'
import MovimientosPage from '@/pages/movimientos'
import SolicitudesCompraPage from '@/pages/solicitudes-compra'
import CreadorProductosPage from '@/pages/creador-productos'
import DescartesPage from '@/pages/descartes'
import ConfiguracionPage from '@/pages/configuracion'
import SetupPage from '@/pages/setup'
import UsuariosPage from '@/pages/usuarios'
import ConteoPage from '@/pages/conteo/index'
import ConteoDetallePage from '@/pages/conteo/detalle'
import KioskPage from '@/pages/kiosk'
import ModoQrPage from '@/pages/modo-qr'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      retry: 1,
    },
  },
})

import AuditLogPage from '@/pages/audit-log'

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
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
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
            <Route path="/creador-productos" element={<CreadorProductosPage />} />
            <Route path="/configuracion" element={<ConfiguracionPage />} />
            <Route path="/usuarios" element={<UsuariosPage />} />
            <Route path="/audit-log" element={<AuditLogPage />} />
            <Route path="/setup" element={<SetupPage />} />
          </Route>
          {/* Standalone routes (no sidebar/header) */}
          <Route path="/kiosk" element={<KioskPage />} />
          <Route path="/qr" element={<ModoQrPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-right" richColors />
    </QueryClientProvider>
    </ErrorBoundary>
  )
}
