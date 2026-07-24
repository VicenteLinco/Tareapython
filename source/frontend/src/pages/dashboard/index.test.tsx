// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DashboardPage from './index';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { full_name: 'Test', role: 'admin' } })
}));

describe('Dashboard Page Freeze Rules', () => {
  it('UI-SCAN-FREEZE-001: Mobile scanner must be disabled/hidden', () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <DashboardPage />
        </BrowserRouter>
      </QueryClientProvider>
    );

    const scannerText = screen.getByText('Escanear QR');
    expect(scannerText).toBeDefined();
    const descriptionText = screen.getByText('Temporalmente deshabilitado');
    expect(descriptionText).toBeDefined();
  });
});
