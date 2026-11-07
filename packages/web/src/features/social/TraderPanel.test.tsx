import type { PublicTraderDto } from '@oggregator/protocol';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./EquityChart', () => ({ default: () => null }));
vi.mock('@hooks/useSpots', () => ({ useSpots: () => ({ data: [] }) }));

import TraderPanel from './TraderPanel';

const TRADER: PublicTraderDto = {
  handle: 'theta',
  venue: 'thalex',
  isMe: true,
  equityUsd: 10_000,
  equityAsOf: '2026-11-07T12:00:00.000Z',
  pnlUsd: 0,
  returnPct: 0,
  startedAt: '2026-11-01T00:00:00.000Z',
  sharingSince: '2026-11-01T00:00:00.000Z',
  equityHistory: [],
  openPositions: [],
  closedTrades: [],
  closedTradesAvailable: true,
  generatedAt: '2026-11-07T12:00:00.000Z',
};

describe('TraderPanel', () => {
  afterEach(cleanup);

  it('renders a perp-only book and includes perps in the open-position count', () => {
    render(
      <TraderPanel
        handle="theta"
        unavailable={null}
        onClose={() => {}}
        trader={{
          ...TRADER,
          linearPositions: [
            {
              instrumentName: 'BTC-PERPETUAL',
              underlying: 'BTC',
              kind: 'perpetual',
              expiry: null,
              sizeCoin: -0.1,
              entryPriceUsd: 90_000,
              markPriceUsd: 89_000,
              source: 'thalex',
            },
          ],
        }}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Open positions · 1' })).toBeDefined();
    expect(screen.getByText('BTC-PERPETUAL')).toBeDefined();
    expect(screen.queryByText('No open positions.')).toBeNull();
  });

  it('accepts older snapshots without linear positions', () => {
    render(<TraderPanel handle="theta" trader={TRADER} unavailable={null} onClose={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Open positions · 0' })).toBeDefined();
    expect(screen.getByText('No open positions.')).toBeDefined();
  });
});
