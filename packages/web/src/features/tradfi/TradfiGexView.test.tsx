import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('./queries', () => ({
  useTradfiExpiries: () => ({ data: { underlying: 'SPX', expiries: ['2026-06-18'] } }),
  useTradfiChain: () => ({
    data: {
      stats: { indexPriceUsd: 5000, forwardPriceUsd: 5000 },
      gex: [{ strike: 5000, gexUsdMillions: 12 }],
    },
    isLoading: false,
  }),
  useTradfiAllExpiriesGex: () => ({ data: { gex: [], spotPrice: 5000 }, isLoading: false }),
}));
vi.mock('@stores/app-store', () => ({ useAppStore: (sel: (s: unknown) => unknown) => sel({ tradfiUnderlying: 'SPX' }) }));

import TradfiGexView from './TradfiGexView';

afterEach(cleanup);

it('renders the GEX title and a strike bar', () => {
  render(<TradfiGexView />);
  expect(screen.getByText(/Gamma Exposure/i)).toBeTruthy();
  expect(screen.getByText('5,000')).toBeTruthy(); // strike label
});
