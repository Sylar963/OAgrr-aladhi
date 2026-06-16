import { it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@hooks/useIsMobile', () => ({ useIsMobile: () => false }));

vi.mock('./queries', () => ({
  useTradfiUnderlyings: () => ({ data: { underlyings: ['AAPL'] } }),
  useTradfiExpiries: () => ({ data: { underlying: 'AAPL', expiries: ['2026-06-17'] } }),
  useTradfiChain: () => ({
    data: {
      underlying: 'AAPL', expiry: '2026-06-17', expiryTs: null, dte: 2,
      stats: { indexPriceUsd: 295, forwardPriceUsd: 295, atmIv: 0.27, atmStrike: 295,
        putCallOiRatio: null, skew25d: null, totalOiUsd: 0, basisPct: null },
      strikes: [{
        strike: 295,
        call: { venues: { tastytrade: { bid: 5, ask: 5.4, mid: 5.2, bidSize: 1, askSize: 2,
          markIv: 0.27, bidIv: null, askIv: null, delta: 0.5, gamma: null, theta: null, vega: null,
          spreadPct: null, totalCost: null, estimatedFees: null, openInterest: 0,
          volume24h: null, openInterestUsd: null, volume24hUsd: null } }, bestIv: 0.27, bestVenue: 'tastytrade' },
        put: { venues: { tastytrade: { bid: null, ask: null, mid: null, bidSize: null, askSize: null,
          markIv: null, bidIv: null, askIv: null, delta: null, gamma: null, theta: null, vega: null,
          spreadPct: null, totalCost: null, estimatedFees: null, openInterest: 0,
          volume24h: null, openInterestUsd: null, volume24hUsd: null } }, bestIv: null, bestVenue: null },
      }],
      gex: [],
    },
    isLoading: false, error: null,
  }),
}));

// lightweight-charts createChart does not work in jsdom — stub the chart leaf.
vi.mock('@features/chain/InstrumentChart', () => ({ default: () => <div data-testid="instrument-chart" /> }));
vi.mock('./use-tradfi-candles', () => ({
  useTradfiCandles: () => ({ data: undefined, isLoading: false }),
  parseTradfiCandles: (raw: unknown) => raw,
}));

import TradfiChainView from './TradfiChainView';

afterEach(() => cleanup());

function wrap() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <TradfiChainView />
    </QueryClientProvider>,
  );
}

it('renders a null-heavy tradfi chain without crashing', () => {
  expect(() => wrap()).not.toThrow();
});

it('no longer renders Chain/Price tab buttons (Price tab replaced by per-strike Chart)', () => {
  const { container } = wrap();
  const labels = Array.from(container.querySelectorAll('button')).map((b) => b.textContent);
  expect(labels).not.toContain('Price');
  expect(labels).not.toContain('Chain');
});
