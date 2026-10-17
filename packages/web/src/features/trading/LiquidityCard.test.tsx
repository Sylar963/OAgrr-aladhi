import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fetchJson = vi.fn();
vi.mock('@lib/http', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));

import LiquidityCard from './LiquidityCard';
import { thalexOptionSymbol } from './liquidity';

function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const response = {
  venue: 'thalex',
  instrument: 'BTC-PERPETUAL',
  priceUnit: 'usd',
  quantityUnit: 'base',
  state: 'synced',
  crossed: false,
  asOf: 1,
  bookAgeMs: 120,
  exchangeTs: 1,
  mark: { markPrice: 100.5, indexPrice: 100.4, delta: 1, iv: null, ageMs: 10 },
  bestBid: 100,
  bestAsk: 101,
  spread: 1,
  spreadPct: 0.995,
  fill: {
    side: 'buy',
    requested: 3,
    filled: 2,
    fullyFilled: false,
    vwap: 101.5,
    worstPrice: 102,
    notional: 203,
    levelsUsed: 2,
    slippageVsTouch: 0.5,
    slippageVsTouchPct: 0.495,
    slippageVsMark: 1,
    slippageVsMarkPct: 0.995,
  },
  depth: [{ pct: 0.5, bidAmount: 1, askAmount: 1, bidNotional: 100, askNotional: 101 }],
  bids: [{ price: 100, amount: 1, outrightAmount: 1 }],
  asks: [{ price: 101, amount: 1, outrightAmount: 1 }],
};

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

describe('LiquidityCard', () => {
  it('fetches nothing until asked, then shows the estimate', async () => {
    fetchJson.mockResolvedValue(response);
    render(wrap(<LiquidityCard positions={[]} />));
    expect(fetchJson).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('BTC-PERPETUAL'), {
      target: { value: 'btc-perpetual' },
    });
    fireEvent.change(screen.getByDisplayValue('1'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Estimate' }));

    await waitFor(() => expect(screen.getByText('$101.5')).toBeDefined());
    expect(fetchJson).toHaveBeenCalledWith('/liquidity?instrument=BTC-PERPETUAL&side=buy&size=3');
    expect(screen.getByText('2.0000 / 3.0000')).toBeDefined();
    expect(screen.getByText(/live · 120ms/)).toBeDefined();
  });

  it('explains an unknown instrument', async () => {
    fetchJson.mockRejectedValue(new Error('GET /liquidity failed: 404'));
    render(wrap(<LiquidityCard positions={[]} />));
    fireEvent.change(screen.getByPlaceholderText('BTC-PERPETUAL'), {
      target: { value: 'BTC-01JAN20-1000-C' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Estimate' }));
    await waitFor(() => expect(screen.getByText(/no book for that instrument/i)).toBeDefined());
  });

  it('has no order-entry control', () => {
    render(wrap(<LiquidityCard positions={[]} />));
    expect(screen.queryByRole('button', { name: /place order|buy|sell/i })).toBeNull();
  });
});

describe('thalexOptionSymbol', () => {
  it('formats a portfolio leg as a Thalex option name', () => {
    expect(
      thalexOptionSymbol({ underlying: 'btc', expiry: '2026-10-23', strike: 84000, optionRight: 'call' }),
    ).toBe('BTC-23OCT26-84000-C');
    expect(
      thalexOptionSymbol({ underlying: 'ETH', expiry: '2027-01-05', strike: 3200, optionRight: 'put' }),
    ).toBe('ETH-05JAN27-3200-P');
  });
});
