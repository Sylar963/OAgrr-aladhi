import type { PositionLeg } from '@oggregator/protocol';
import { describe, expect, it, vi } from 'vitest';

import type { OrderBookSnapshot } from '../../liquidity/types.js';
import { ThalexExitBooks, type ExitBookRuntime } from './exit-books.js';
import { OrderBookCapacityError } from './order-book-runtime.js';

function makeLeg(strike: number, overrides: Partial<PositionLeg> = {}): PositionLeg {
  return {
    legId: `leg-${strike}`,
    underlying: 'BTC',
    expiry: '2026-11-27',
    strike,
    optionRight: 'put',
    size: 1,
    entryPriceUsd: 100,
    entryIv: null,
    entryTs: 0,
    venueHint: 'thalex',
    source: 'thalex',
    realizedPnlUsd: 0,
    ...overrides,
  };
}

function fakeRuntime(overrides: Partial<ExitBookRuntime> = {}) {
  const releases = new Map<string, ReturnType<typeof vi.fn>>();
  const runtime: ExitBookRuntime = {
    acquire: vi.fn((instrument: string) => {
      const release = vi.fn();
      releases.set(instrument, release);
      return { release };
    }),
    getBook: vi.fn(() => null),
    isRejected: vi.fn(() => false),
    ...overrides,
  };
  return { runtime, releases };
}

describe('ThalexExitBooks', () => {
  it('leases books only for held Thalex legs and releases legs that went away', () => {
    const { runtime, releases } = fakeRuntime();
    const books = new ThalexExitBooks(runtime);
    const deribit = makeLeg(90_000, { venueHint: 'deribit', source: 'deribit' });

    books.sync([makeLeg(100_000), makeLeg(95_000), deribit]);
    expect(runtime.acquire).toHaveBeenCalledTimes(2);
    expect(runtime.acquire).toHaveBeenCalledWith('BTC-27NOV26-100000-P');
    expect(books.lookup(deribit)).toEqual({ kind: 'unsupported' });

    books.sync([makeLeg(100_000)]);
    expect(runtime.acquire).toHaveBeenCalledTimes(2);
    expect(releases.get('BTC-27NOV26-95000-P')).toHaveBeenCalledOnce();

    books.dispose();
    expect(releases.get('BTC-27NOV26-100000-P')).toHaveBeenCalledOnce();
  });

  it('reports loading, rejected, capacity and a ready book', () => {
    const book = { instrument: 'BTC-27NOV26-100000-P' } as OrderBookSnapshot;
    const { runtime } = fakeRuntime({
      acquire: vi.fn((instrument: string) => {
        if (instrument.includes('80000')) throw new OrderBookCapacityError(40);
        return { release: vi.fn() };
      }),
      getBook: vi.fn((instrument: string) => (instrument === book.instrument ? book : null)),
      isRejected: vi.fn((instrument: string) => instrument.includes('85000')),
    });
    const books = new ThalexExitBooks(runtime);
    const legs = [makeLeg(100_000), makeLeg(95_000), makeLeg(85_000), makeLeg(80_000)];
    books.sync(legs);

    expect(books.lookup(legs[0]!)).toEqual({ kind: 'book', book });
    expect(books.lookup(legs[1]!)).toEqual({ kind: 'unavailable', reason: 'loading' });
    expect(books.lookup(legs[2]!)).toEqual({ kind: 'unavailable', reason: 'rejected' });
    expect(books.lookup(legs[3]!)).toEqual({ kind: 'unavailable', reason: 'capacity' });
  });

  it('serves a book that arrived after its subscribe was refused', () => {
    const book = { instrument: 'BTC-27NOV26-100000-P' } as OrderBookSnapshot;
    const { runtime } = fakeRuntime({ getBook: vi.fn(() => book), isRejected: vi.fn(() => true) });
    const books = new ThalexExitBooks(runtime);
    books.sync([makeLeg(100_000)]);
    expect(books.lookup(makeLeg(100_000))).toEqual({ kind: 'book', book });
  });
});
