import { useStrategyStore } from '@features/architect';
import type { EnrichedChainResponse, VenueQuote } from '@shared/enriched';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EasyChainView from './EasyChainView';
import type { EasyBuyPreview } from './easy-toll';

vi.mock('./EasyPayoffChart', () => ({
  default: ({ preview }: { preview: EasyBuyPreview | null }) => (
    <div data-testid="chart-preview">
      {preview ? `${preview.type}:${preview.breakeven}` : 'none'}
    </div>
  ),
}));

function chain(overrides: Partial<VenueQuote> = {}): EnrichedChainResponse {
  const quote: VenueQuote = {
    bid: 200,
    ask: 300,
    mid: 999,
    midRaw: null,
    bidSize: null,
    askSize: null,
    markIv: null,
    bidIv: null,
    askIv: null,
    delta: 0.5,
    gamma: null,
    theta: null,
    vega: null,
    spreadPct: null,
    totalCost: null,
    estimatedFees: null,
    openInterest: null,
    volume24h: null,
    openInterestUsd: null,
    volume24hUsd: null,
    ...overrides,
  };
  const side = { venues: { deribit: quote }, bestIv: null, bestVenue: 'deribit' as const };
  return {
    underlying: 'BTC',
    expiry: '2026-12-18',
    expiryTs: null,
    dte: 30,
    stats: {
      indexPriceUsd: 64_000,
      forwardPriceUsd: 64_000,
      basisPct: null,
      atmStrike: 64_000,
      atmIv: 0.5,
      putCallOiRatio: null,
      totalOiUsd: null,
      skew25d: null,
      bfly25d: null,
    },
    strikes: [{ strike: 64_000, call: side, put: side }],
    gex: [],
  };
}

afterEach(cleanup);
beforeEach(() => useStrategyStore.getState().clearLegs());

describe('Easy Mode toll preview', () => {
  it('shows total move separately from toll movement and premium-based toll percentage', () => {
    render(<EasyChainView chain={chain()} underlying="BTC" activeVenues={['deribit']} />);
    const preview = screen.getByRole('region', { name: 'Toll & break-even preview' });
    expect(within(preview).getByText('+0.47%')).toBeTruthy();
    expect(within(preview).getByText('TOLL $50 · 0.08% extra underlying move')).toBeTruthy();
    expect(within(preview).getByText('Target → break-even: $300 premium')).toBeTruthy();
    expect(within(preview).queryByText('20%')).toBeNull();
    expect(within(preview).getByText(/Fees and extra slippage excluded/)).toBeTruthy();
    expect(screen.getByTestId('chart-preview').textContent).toBe('call:64300');
    expect(useStrategyStore.getState().legs).toHaveLength(0);
  });

  it('previews puts by keyboard focus and pointer without adding a position', () => {
    render(<EasyChainView chain={chain()} underlying="BTC" activeVenues={['deribit']} />);
    const put = screen.getByRole('button', {
      name: 'Preview buying put $64,000: break-even and toll',
    });
    fireEvent.focus(put);
    expect(screen.getByTestId('chart-preview').textContent).toBe('put:63700');
    expect(
      within(screen.getByRole('region', { name: 'Toll & break-even preview' })).getByText('-0.47%'),
    ).toBeTruthy();
    const call = screen.getByRole('button', {
      name: 'Preview buying call $64,000: break-even and toll',
    });
    fireEvent.pointerEnter(call.parentElement!);
    expect(screen.getByTestId('chart-preview').textContent).toBe('call:64300');
    fireEvent.click(put);
    expect(screen.getByTestId('chart-preview').textContent).toBe('put:63700');
    expect(useStrategyStore.getState().legs).toHaveLength(0);
  });

  it('keeps the actual purchase at the ask with no extra toll charge', () => {
    render(<EasyChainView chain={chain()} underlying="BTC" activeVenues={['deribit']} />);
    fireEvent.click(screen.getAllByTitle('Buy: pay this premium, risk is limited to it')[0]!);
    expect(useStrategyStore.getState().legs[0]?.entryPrice).toBe(300);
    expect(screen.getAllByText('$64,300')).toHaveLength(2);
    expect(screen.getByTestId('chart-preview').textContent).toBe('call:64300');
  });

  it('refreshes live quotes while keeping the selected target', () => {
    const view = render(
      <EasyChainView chain={chain()} underlying="BTC" activeVenues={['deribit']} />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Preview buying put $64,000: break-even and toll' }),
    );
    view.rerender(
      <EasyChainView
        chain={chain({ bid: 300, ask: 500 })}
        underlying="BTC"
        activeVenues={['deribit']}
      />,
    );
    expect(screen.getByTestId('chart-preview').textContent).toBe('put:63500');
    expect(screen.getByText('TOLL $100 · 0.16% extra underlying move')).toBeTruthy();
    view.rerender(<EasyChainView chain={chain()} underlying="BTC" activeVenues={['bybit']} />);
    expect(screen.getByTestId('chart-preview').textContent).toBe('none');
    expect(screen.queryByText(/extra underlying move/)).toBeNull();
  });

  it('shows unknown toll instead of zero when the bid is missing', () => {
    render(
      <EasyChainView chain={chain({ bid: null })} underlying="BTC" activeVenues={['deribit']} />,
    );
    expect(screen.getByText('TOLL unavailable')).toBeTruthy();
    expect(screen.getByTestId('chart-preview').textContent).toBe('call:64300');
  });

  it('shows zero toll in a locked market and no preview for stale quotes', () => {
    const view = render(
      <EasyChainView chain={chain({ bid: 300 })} underlying="BTC" activeVenues={['deribit']} />,
    );
    expect(screen.getByText('TOLL $0 · 0.00% extra underlying move')).toBeTruthy();
    view.rerender(
      <EasyChainView
        chain={chain({ asOfMs: Date.now() - 120_000 })}
        underlying="BTC"
        activeVenues={['deribit']}
      />,
    );
    expect(screen.getByTestId('chart-preview').textContent).toBe('none');
    expect(screen.queryByText(/extra underlying move/)).toBeNull();
  });
});
