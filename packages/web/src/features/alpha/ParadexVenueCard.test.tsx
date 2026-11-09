import type { ParadexRfq, ParadexRfqsResponse } from '@oggregator/protocol';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ParadexVenueCard from './ParadexVenueCard';

const mocks = vi.hoisted(() => ({
  useRfqs: vi.fn(),
  next: vi.fn(),
  session: { status: 'ready' },
}));
vi.mock('@components/auth/AccountSessionProvider', () => ({
  useAccountSession: () => mocks.session,
}));
vi.mock('@features/portfolio', () => ({ useParadexRfqs: mocks.useRfqs }));

function rfq(overrides: Partial<ParadexRfq> = {}): ParadexRfq {
  return {
    id: 'r_one',
    state: 'OPEN',
    quantity: 2,
    filledQuantity: 0,
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    legs: [{ market: 'BTC-USD-27NOV26-80000-C', side: 'BUY', ratio: 1, price: null }],
    quote: {
      bidPrice: -10,
      askPrice: 0,
      bidQuantity: 1,
      askQuantity: 2,
      markPrice: 100,
      createdAt: null,
      fetchedAt: Date.now(),
    },
    ...overrides,
  };
}
function result(rfqs: ParadexRfq[], overrides = {}) {
  const page: ParadexRfqsResponse = {
    accountId: 'alice',
    venue: 'paradex',
    fetchedAt: Date.now(),
    next: null,
    rfqs,
  };
  return {
    data: { pages: [page] },
    isPending: false,
    isError: false,
    isFetching: false,
    hasNextPage: false,
    fetchNextPage: mocks.next,
    ...overrides,
  };
}
function open() {
  render(<ParadexVenueCard underlying="BTC" screen={<div>Original screen opportunities</div>} />);
  fireEvent.click(screen.getByRole('button', { name: 'RFQ' }));
}
beforeEach(() => {
  mocks.session.status = 'ready';
  mocks.useRfqs.mockReturnValue(result([rfq()]));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Paradex RFQ card', () => {
  it('enables private reads only in RFQ mode and preserves the screen card', () => {
    open();
    expect(mocks.useRfqs).toHaveBeenLastCalledWith('BTC', true);
    expect(screen.queryByText('Original screen opportunities')).toBeNull();
    expect(screen.getByText('-$10.00 × 1')).toBeTruthy();
    expect(screen.getByText('$0.00 × 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Screen' }));
    expect(mocks.useRfqs).toHaveBeenLastCalledWith('BTC', false);
    expect(screen.getByText('Original screen opportunities')).toBeTruthy();
  });

  it('offers the next page even when the current page is empty', () => {
    mocks.useRfqs.mockReturnValue(result([], { hasNextPage: true }));
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Load next RFQ page' }));
    expect(mocks.next).toHaveBeenCalledTimes(1);
  });

  it('removes expired prices as time passes without a response', () => {
    vi.useFakeTimers();
    const quote = rfq({ expiresAt: Date.now() + 1_500 });
    mocks.useRfqs.mockReturnValue(result([quote]));
    open();
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(screen.queryByText('-$10.00 × 1')).toBeNull();
    expect(screen.getByText('Quote stale or expired · refresh required')).toBeTruthy();
  });

  it('does not substitute a mark for a missing quote', () => {
    mocks.useRfqs.mockReturnValue(result([rfq({ quote: null })]));
    open();
    expect(screen.getByText('Waiting for a quote, or RFQ no longer available.')).toBeTruthy();
    expect(screen.queryByText('$100.00')).toBeNull();
  });

  it('does not display a cached price as usable after a failed refresh', () => {
    mocks.useRfqs.mockReturnValue(result([rfq()], { isError: true }));
    open();
    expect(screen.queryByText('-$10.00 × 1')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('RFQs unavailable');
  });

  it('explains the required connection for signed-out users', () => {
    mocks.session.status = 'signed_out';
    mocks.useRfqs.mockReturnValue(result([]));
    open();
    expect(screen.getByText('Connect Paradex in Portfolio to read your RFQ quotes.')).toBeTruthy();
  });
});
