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
import CatalogosPage from '@/pages/catalogos'
import ConfiguracionPage from '@/pages/configuracion'
import PlaceholderPage from '@/pages/placeholder'
import SetupPage from '@/pages/setup'
import UsuariosPage from '@/pages/usuarios'
import ConteoPage from '@/pages/conteo/index'
import ConteoDetallePage from '@/pages/conteo/detalle'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      retry: 1,
    },
  },
})

export default function App() {
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
            <Route path="/recepciones" element={<RecepcionesPage />} />
            <Route path="/recepciones/nueva" element={<NuevaRecepcionPage />} />
            <Route path="/recepciones/:id" element={<RecepcionDetallePage />} />
            <Route path="/conteo" element={<ConteoPage />} />
            <Route path="/conteo/:id" element={<ConteoDetallePage />} />
            <Route path="/movimientos" element={<MovimientosPage />} />
<Route path="/descartes" element={<PlaceholderPage title="Descartes" />} />
            <Route path="/catalogos" element={<CatalogosPage />} />
            <Route path="/configuracion" element={<ConfiguracionPage />} />
            <Route path="/usuarios" element={<UsuariosPage />} />
            <Route path="/audit-log" element={<PlaceholderPage title="Audit Log" />} />
            <Route path="/setup" element={<SetupPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-right" richColors />
    </QueryClientProvider>
    </ErrorBoundary>
  )
}
