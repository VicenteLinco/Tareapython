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
  useRecepcion: () => ({
    data: {
      id: 1,
      estado: 'borrador',
      detalles: [
        { id: 1, cantidad_esperada: 10, cantidad_recibida: 5, linea_completada: false }
      ]
    },
    isLoading: false
  }),
  useConfirmarRecepcion: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCancelarRecepcion: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useActualizarLinea: () => ({ mutateAsync: vi.fn(), isPending: false }),
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
