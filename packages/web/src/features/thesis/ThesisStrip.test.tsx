import { ThesisViewSchema, type ThesisView } from '@oggregator/protocol';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ tightenThesis: vi.fn(), endThesis: vi.fn(), shareThesis: vi.fn() }));
vi.mock('./api', () => api);
vi.mock('@components/auth/AccountSessionProvider', () => ({
  useAccountSession: () => ({ status: 'ready', accountId: 'acct-1' }),
}));

import ThesisStrip from './ThesisStrip';

const view = ThesisViewSchema.parse({
  thesis: {
    id: '00000000-0000-4000-8000-000000000001', accountId: 'acct-1', underlying: 'BTC',
    direction: 'bearish', horizonExpiry: '2026-10-30', level: 85_000, confirmSec: 86400,
    reason: 'Resistance held; expect downside before expiry.',
    contextAtCreation: { capturedAt: 0, spotUsd: 84_000, dvol: null, atmIv: null, skew25d: null, netGexUsdMillions: null },
    linkedSnapshotId: null, state: 'active', createdAt: 0, endedAt: null, endNote: null,
  },
  status: { status: 'INTACT', spotUsd: 83_000, roomPct: 0.02, atRiskBandUsd: 830, msToHorizon: 86_400_000, firedCandleTs: null },
  diff: null, cooldown: null, pendingFlip: null, waitCompleted: false,
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function renderStrip(active: ThesisView | null = view, recentlyEnded?: ThesisView['thesis']) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ThesisStrip underlying="BTC" active={active} reversal={null} recentlyEnded={recentlyEnded ?? null} onSetThesis={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe('ThesisStrip', () => {
  it('shows closed positions while keeping the thesis and its end action', () => {
    renderStrip({ ...view, books: [{ source: 'thalex', state: 'closed', openLegCount: 0 }] });
    expect(screen.getByText('thalex: positions closed · thesis still active')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'End' })).toBeTruthy();
    expect(screen.queryByText('No BTC thesis.')).toBeNull();
  });

  it('shows a lost connection without claiming the position closed', () => {
    renderStrip({ ...view, books: [{ source: 'thalex', state: 'unavailable', openLegCount: 0 }] });
    expect(screen.getByText('thalex: position status unavailable')).toBeTruthy();
    expect(screen.queryByText(/positions closed/)).toBeNull();
  });

  it('explains invalidation instead of showing no thesis', () => {
    renderStrip(null, { ...view.thesis, state: 'invalidated', endedAt: 1 });
    expect(screen.getByText('BTC thesis invalidated by a confirmation candle.')).toBeTruthy();
    expect(screen.queryByText('No BTC thesis.')).toBeNull();
  });

  it('shows tightening errors and keeps the current thesis visible', async () => {
    api.tightenThesis.mockRejectedValue(new Error('A bearish invalidation level must be above spot'));
    renderStrip();
    fireEvent.click(screen.getByRole('button', { name: 'Tighten' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Tighten' }), { target: { value: '82000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByText('A bearish invalidation level must be above spot')).toBeTruthy());
    expect(api.tightenThesis).toHaveBeenCalledWith(view.thesis.id, 82_000);
    expect(screen.getByRole('button', { name: 'End' })).toBeTruthy();
  });

  it('does not reuse a tightened price as the end note', async () => {
    api.endThesis.mockResolvedValue({});
    renderStrip();
    fireEvent.click(screen.getByRole('button', { name: 'Tighten' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Tighten' }), { target: { value: '84500' } });
    fireEvent.click(screen.getByRole('button', { name: 'End' }));
    expect((screen.getByPlaceholderText('Note (optional)') as HTMLInputElement).value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'End thesis' }));
    await waitFor(() => expect(api.endThesis).toHaveBeenCalledWith(view.thesis.id, undefined));
  });
});
