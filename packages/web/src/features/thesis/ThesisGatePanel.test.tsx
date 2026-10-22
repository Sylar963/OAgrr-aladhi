import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ThesisGateCheckResponse, ThesisView } from '@oggregator/protocol';
import { THESIS_FLIP_CONFIRMATION } from '@oggregator/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  keepThesis: vi.fn(),
  waitThesis: vi.fn(),
  flipThesis: vi.fn(),
}));

vi.mock('./api', () => api);
vi.mock('@components/auth/AccountSessionProvider', () => ({
  useAccountSession: () => ({ status: 'ready', accountId: 'acct-1' }),
}));

import ThesisGatePanel from './ThesisGatePanel';
import { invalidationFromBreakevens } from './ThesisSection';

const view: ThesisView = {
  thesis: {
    id: '00000000-0000-4000-8000-000000000001',
    accountId: 'acct-1',
    underlying: 'BTC',
    direction: 'bearish',
    horizonExpiry: '2026-10-23',
    level: 85_105,
    confirmSec: 86400,
    reason: 'Rally into resistance failed; expect 80k before expiry.',
    contextAtCreation: {
      capturedAt: 0,
      spotUsd: 84_500,
      dvol: 0.44,
      atmIv: 0.41,
      skew25d: -0.02,
      netGexUsdMillions: 12,
    },
    linkedSnapshotId: null,
    state: 'active',
    createdAt: Date.now() - 11 * 86_400_000,
    endedAt: null,
    endNote: null,
    share: null,
  },
  status: {
    status: 'INTACT',
    spotUsd: 83_050,
    roomPct: (85_105 - 83_050) / 83_050,
    atRiskBandUsd: 900,
    msToHorizon: 5.6 * 86_400_000,
    firedCandleTs: null,
  },
  diff: {
    rows: [
      { key: 'spot', before: 84_500, after: 83_050, material: false },
      { key: 'dvol', before: 0.44, after: 0.46, material: false },
    ],
    materialCount: 0,
    comparedCount: 2,
  },
  cooldown: null,
  pendingFlip: null,
  waitCompleted: false,
};

const gate: ThesisGateCheckResponse & { view: ThesisView } = {
  decision: 'gate',
  reason: 'opposite',
  proposed: {
    classification: 'bullish',
    bias: 1,
    upPnlUsd: 221,
    downPnlUsd: -164,
    movePct: 4.1,
    note: null,
  },
  combined: null,
  heldBookNote: 'No connected BTC positions found; judged on the structure alone.',
  view,
};

function renderPanel(next: ThesisView = view) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThesisGatePanel
        gate={{ ...gate, view: next }}
        underlying="BTC"
        expiryOptions={['2026-10-23', '2026-10-30']}
        flipLevel="81500"
      />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ThesisGatePanel', () => {
  it('quotes the thesis, the structure and the verdict', () => {
    renderPanel();
    expect(screen.getByText(/Rally into resistance failed/)).toBeTruthy();
    expect(screen.getByText(/11 days ago you wrote/)).toBeTruthy();
    expect(screen.getByText(/a 1D candle closes above 85,105/)).toBeTruthy();
    expect(screen.getByText(/up \+\$221 \/ down −\$164/)).toBeTruthy();
    expect(screen.getByText(/0 of 2 changed materially/)).toBeTruthy();
  });

  it('collapses to "nothing to do" when the thesis is kept', async () => {
    api.keepThesis.mockResolvedValue(view);
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Keep my thesis' }));
    await waitFor(() => expect(screen.getByText(/Thesis intact — nothing to do/)).toBeTruthy());
    expect(api.keepThesis).toHaveBeenCalledWith(view.thesis.id);
  });

  it('demands the reason, the phrase and a new thesis before flipping', async () => {
    api.flipThesis.mockResolvedValue(view);
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Flip now' }));
    fireEvent.click(screen.getByRole('button', { name: 'Flip' }));
    expect(screen.getByText(/Say what changed/)).toBeTruthy();
    expect(api.flipThesis).not.toHaveBeenCalled();

    const [whatChanged, newReason] = screen.getAllByRole('textbox').filter((el) => el.tagName === 'TEXTAREA');
    fireEvent.change(whatChanged!, {
      target: { value: 'Daily close reclaimed 84k with funding reset and spot bid; 80k target no longer valid.' },
    });
    fireEvent.change(newReason!, { target: { value: 'Holding above 84k, wrong below 81.5k.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Flip' }));
    expect(screen.getByText(/Type "I am overriding my thesis" exactly/)).toBeTruthy();

    const phraseInput = screen.getAllByRole('textbox').find((el) => el.tagName === 'INPUT' && !el.getAttribute('inputmode'));
    fireEvent.change(phraseInput!, { target: { value: THESIS_FLIP_CONFIRMATION } });
    fireEvent.click(screen.getByRole('button', { name: 'Flip' }));
    await waitFor(() => expect(api.flipThesis).toHaveBeenCalledOnce());
    expect(api.flipThesis.mock.calls[0]?.[1]).toMatchObject({
      confirmation: THESIS_FLIP_CONFIRMATION,
      newThesis: { direction: 'bullish', level: 81_500, horizonExpiry: '2026-10-23' },
    });
  });

  it('drops the typed phrase once a wait has finished', () => {
    renderPanel({ ...view, waitCompleted: true });
    fireEvent.click(screen.getByRole('button', { name: 'Flip (wait finished)' }));
    expect(screen.queryByText(THESIS_FLIP_CONFIRMATION)).toBeNull();
  });
});

describe('invalidationFromBreakevens', () => {
  it('picks the break-even on the losing side', () => {
    expect(invalidationFromBreakevens('bearish', [78_000, 85_105], 82_000)).toBe(85_105);
    expect(invalidationFromBreakevens('bullish', [78_000, 79_500, 85_105], 82_000)).toBe(79_500);
    expect(invalidationFromBreakevens('bullish', [85_105], 82_000)).toBeNull();
  });
});
