import { it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
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

// lightweight-charts createChart does not work in jsdom — stub InstrumentChart
vi.mock('@features/chain/InstrumentChart', () => ({
  default: () => <div data-testid="instrument-chart" />,
}));

// Stub useTradfiCandles so TradfiPriceChart doesn't make real fetch calls
vi.mock('./use-tradfi-candles', () => ({
  useTradfiCandles: () => ({ data: undefined, isLoading: false }),
  parseTradfiCandles: (raw: unknown) => raw,
}));

import TradfiChainView from './TradfiChainView';

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

it('shows Chain and Price tab buttons', () => {
  const { container } = wrap();
  const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.textContent);
  expect(buttons).toContain('Chain');
  expect(buttons).toContain('Price');
});

it('Chain tab is active by default', () => {
  const { container } = wrap();
  const chainBtn = Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent === 'Chain',
  ) as HTMLButtonElement;
  expect(chainBtn.dataset['active']).toBe('true');
});

it('clicking Price tab renders the price chart container', () => {
  const { container } = wrap();
  const priceBtn = Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent === 'Price',
  )!;
  fireEvent.click(priceBtn);
  // TradfiPriceChart renders a panel with controls; assert the panel is present
  // by checking for the strike selector or any button for call/put toggle
  const afterClick = container.querySelectorAll('button');
  const labels = Array.from(afterClick).map((b) => b.textContent);
  // CALL/PUT buttons are rendered by TradfiPriceChart
  expect(labels).toContain('CALL');
  expect(labels).toContain('PUT');
});

it('switching back to Chain tab shows chain content again', () => {
  const { container } = wrap();
  const priceBtn = Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent === 'Price',
  )!;
  fireEvent.click(priceBtn);
  const chainBtn = Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent === 'Chain',
  )!;
  fireEvent.click(chainBtn);
  // CALL/PUT from TradfiPriceChart should be gone
  const labels = Array.from(container.querySelectorAll('button')).map((b) => b.textContent);
  expect(labels).not.toContain('CALL');
});
