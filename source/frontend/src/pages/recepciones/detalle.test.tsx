// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RecepcionDetallePage from './detalle';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { full_name: 'Test', role: 'admin' }, hasRole: () => true })
}));

vi.mock('@/hooks/useRecepciones', () => ({
  useConfirmarRecepcion: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCancelarRecepcion: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useActualizarLinea: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/lib/api', () => ({
  default: {
    get: vi.fn().mockResolvedValue({
      data: {
        recepcion: {
          id: '1',
          numero_documento: 'REC-1',
          proveedor_id: 1,
          proveedor_nombre: 'Test',
          estado: 'borrador',
          fecha_recepcion: '2023-01-01',
          usuario_nombre: 'Test'
        },
        nota: null,
        foto_documento: null,
        foto_actualizada_at: null,
        detalle: [
          { id: 1, numero_lote: '', fecha_vencimiento: null, producto_nombre: 'Test', area_destino: 'Test', cantidad_unidades_base: '10', cantidad_presentaciones: '1', factor_conversion_usado: '1' }
        ]
      }
    }),
    post: vi.fn().mockResolvedValue({}),
    put: vi.fn().mockResolvedValue({})
  }
}));

describe('Recepciones Detalle Freeze Rules', () => {
  it('UI-RECEPCIONES-FREEZE-001: Confirm button must be disabled when lines are incomplete', () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <RecepcionDetallePage />
        </BrowserRouter>
      </QueryClientProvider>
    );

    const confirmarBtn = screen.getByRole('button', { name: /Confirmar recepción/i });
    expect(confirmarBtn).toBeDisabled();
  });
});
