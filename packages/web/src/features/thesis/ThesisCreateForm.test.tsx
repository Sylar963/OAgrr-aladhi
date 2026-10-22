import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ createThesis: vi.fn() }));

vi.mock('./api', () => api);
vi.mock('@components/auth/AccountSessionProvider', () => ({
  useAccountSession: () => ({ status: 'ready', accountId: 'acct-1' }),
}));

import ThesisCreateForm from './ThesisCreateForm';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderForm(onClose = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ThesisCreateForm
        underlying="BTC"
        expiryOptions={['2026-10-23']}
        spotUsd={82_000}
        initial={{ direction: 'bearish', horizonExpiry: '2026-10-23', level: '85105', confirmSec: 86400, reason: '' }}
        onClose={onClose}
      />
    </QueryClientProvider>,
  );
  return onClose;
}

describe('ThesisCreateForm', () => {
  it('requires a reason and a level on the losing side before saving', async () => {
    api.createThesis.mockResolvedValue({});
    const onClose = renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Save thesis' }));
    expect(screen.getByText(/Write the reason/)).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('level'), { target: { value: '80000' } });
    fireEvent.change(screen.getByRole('textbox', { name: /Because/ }), {
      target: { value: 'Failed rally, expect 80k before expiry.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save thesis' }));
    expect(screen.getByText(/set the level above 82,000/)).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('level'), { target: { value: '85105' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save thesis' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.createThesis).toHaveBeenCalledWith({
      underlying: 'BTC',
      direction: 'bearish',
      horizonExpiry: '2026-10-23',
      level: 85_105,
      confirmSec: 86400,
      reason: 'Failed rally, expect 80k before expiry.',
      share: false,
    });
  });
});
