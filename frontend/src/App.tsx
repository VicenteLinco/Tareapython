import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { AppLayout } from '@/components/layout/app-layout'
import LoginPage from '@/pages/login'
import DashboardPage from '@/pages/dashboard'
import StockPage from '@/pages/stock'
import ConsumosPage from '@/pages/consumos'
import RecepcionesPage from '@/pages/recepciones'
import NuevaRecepcionPage from '@/pages/recepciones/nueva'
import MovimientosPage from '@/pages/movimientos'
import CatalogosPage from '@/pages/catalogos'
import PlaceholderPage from '@/pages/placeholder'

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
            <Route path="/movimientos" element={<MovimientosPage />} />
<Route path="/descartes" element={<PlaceholderPage title="Descartes" />} />
            <Route path="/catalogos" element={<CatalogosPage />} />
            <Route path="/usuarios" element={<PlaceholderPage title="Usuarios" />} />
            <Route path="/audit-log" element={<PlaceholderPage title="Audit Log" />} />
            <Route path="/setup" element={<PlaceholderPage title="Setup Inicial" />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-right" richColors />
    </QueryClientProvider>
  )
}
