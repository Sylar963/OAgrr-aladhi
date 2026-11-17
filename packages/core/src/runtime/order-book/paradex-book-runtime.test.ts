import { afterEach, describe, expect, it, vi } from 'vitest';
import { ParadexBookRuntime } from './paradex-book-runtime.js';
import { ParadexExitBooks } from './exit-books.js';
import { CloseNowTracker } from '../../portfolio/close-now.js';
import type { PositionLeg } from '@oggregator/protocol';
import type { MarkContext } from '../../portfolio/types.js';

const symbol = 'BTC-USD-4DEC26-80000-P';
const market = {
  symbol,
  base_currency: 'BTC',
  quote_currency: 'USD',
  asset_kind: 'OPTION',
  fee_config: {
    api_fee: { taker_fee: { fee: '0.0001', fee_cap: '0.125' } },
    interactive_fee: { taker_fee: { fee: '0', fee_cap: '0.125' } },
  },
};
const depth = {
  market: symbol,
  seq_no: 1,
  last_updated_at: 1000,
  bids: [
    ['900', '0.5'],
    ['800', '0.5'],
  ],
  asks: [
    ['1100', '0.5'],
    ['1200', '0.5'],
  ],
};
const leg: PositionLeg = {
  legId: 'p',
  underlying: 'BTC',
  expiry: '2026-12-04',
  strike: 80000,
  optionRight: 'put',
  size: 1,
  entryPriceUsd: 700,
  entryIv: 0.5,
  entryTs: 1,
  realizedPnlUsd: 0,
  source: 'paradex',
  venueHint: 'paradex',
};
const mark: MarkContext = {
  underlyingPriceUsd: 80000,
  forwardPriceUsd: 80000,
  markPriceUsd: 1000,
  iv: 0.5,
  delta: -0.5,
  gamma: 0.01,
  vega: 10,
  theta: -10,
  yearsToExpiry: 0.1,
};
const response = (data: unknown) => new Response(JSON.stringify(data));

describe('Paradex observed API depth', () => {
  const runtimes: ParadexBookRuntime[] = [];
  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((r) => r.dispose()));
  });
  const create = (fetchImpl: typeof fetch, maxInstruments = 40) => {
    const runtime = new ParadexBookRuntime({
      fetchImpl,
      now: () => 1000,
      maxInstruments,
      access: 'api',
    });
    runtimes.push(runtime);
    return runtime;
  };

  it('uses interactive liquidity and its own fee schedule by default without substituting API liquidity', async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(
          response(
            url.endsWith('/markets')
              ? { results: [market] }
              : url.includes('/interactive?')
                ? depth
                : { ...depth, bids: [], asks: [] },
          ),
        ),
      );
    const runtime = new ParadexBookRuntime({ fetchImpl, now: () => 1000 });
    runtimes.push(runtime);
    runtime.acquire(symbol);
    await runtime.refresh();
    const result = new CloseNowTracker().compute(
      [{ leg, mark }],
      [],
      () => ({ kind: 'book', book: runtime.getBook(symbol)! }),
      1000,
    );
    expect(result.legs[0]).toMatchObject({
      status: 'ok',
      closeNowPnlUsd: 150,
      feesUsd: 0,
      liquidityAccess: 'interactive',
    });
    expect(
      fetchImpl.mock.calls.some(([url]) => String(url).includes('/interactive?depth=100')),
    ).toBe(true);
  });

  it('walks the holding venue depth with API fees and preserves thin-short uncertainty', async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(response(url.endsWith('/markets') ? { results: [market] } : depth)),
      );
    const runtime = create(fetchImpl);
    const source = new ParadexExitBooks(runtime);
    source.sync([leg]);
    await runtime.refresh();
    const tracker = new CloseNowTracker();
    const long = tracker.compute([{ leg, mark }], [], () => source.lookup(leg), 1000);
    expect(long.legs[0]).toMatchObject({
      status: 'ok',
      exitVwapUsd: 850,
      feesUsd: 8,
      closeNowPnlUsd: 142,
    });
    const short = { ...leg, size: -2 };
    const result = tracker.compute([{ leg: short, mark }], [], () => source.lookup(short), 1000);
    expect(result.legs[0]).toMatchObject({
      status: 'partial',
      filledSize: 1,
      closeNowPnlUsd: null,
    });
    expect(fetchImpl.mock.calls.every(([, options]) => options.headers == null)).toBe(true);
    source.dispose();
  });

  it('retains the previous estimate as stale when a snapshot fails', async () => {
    let fail = false;
    const runtime = create(
      vi.fn().mockImplementation((url: string) => {
        if (fail) return Promise.resolve(new Response('{}', { status: 500 }));
        return Promise.resolve(response(url.endsWith('/markets') ? { results: [market] } : depth));
      }),
    );
    const lease = runtime.acquire(symbol);
    await runtime.refresh();
    const tracker = new CloseNowTracker();
    tracker.compute(
      [{ leg, mark }],
      [],
      () => ({ kind: 'book', book: runtime.getBook(symbol)! }),
      1000,
    );
    fail = true;
    await runtime.refresh();
    const stale = tracker.compute(
      [{ leg, mark }],
      [],
      () => ({ kind: 'book', book: runtime.getBook(symbol)! }),
      2000,
    );
    expect(stale.legs[0]).toMatchObject({
      stale: true,
      unavailableReason: 'unsynchronized',
      closeNowPnlUsd: 142,
    });
    lease.release();
  });

  it('refuses wrong-market snapshots, crossed books, and unknown fee schedules', async () => {
    const runtime = create(
      vi
        .fn()
        .mockImplementation((url: string) =>
          Promise.resolve(
            response(
              url.endsWith('/markets') ? { results: [market] } : { ...depth, market: 'another' },
            ),
          ),
        ),
    );
    runtime.acquire(symbol);
    await runtime.refresh();
    expect(runtime.getBook(symbol)).toBeNull();
    const noFee = create(
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(response({ results: [{ ...market, fee_config: undefined }] })),
        ),
    );
    noFee.acquire(symbol);
    await noFee.refresh();
    expect(noFee.isRejected(symbol)).toBe(true);
    const crossed = create(
      vi
        .fn()
        .mockImplementation((url: string) =>
          Promise.resolve(
            response(
              url.endsWith('/markets')
                ? { results: [market] }
                : { ...depth, bids: [['1300', '1']] },
            ),
          ),
        ),
    );
    crossed.acquire(symbol);
    await crossed.refresh();
    const result = new CloseNowTracker().compute(
      [{ leg, mark }],
      [],
      () => ({ kind: 'book', book: crossed.getBook(symbol)! }),
      1000,
    );
    expect(result.legs[0]).toMatchObject({
      status: 'book_unavailable',
      unavailableReason: 'crossed',
    });
  });

  it('shares leases, caps held instruments, and releases idempotently', async () => {
    const runtime = create(
      vi.fn().mockImplementation(() => Promise.resolve(response({ results: [] }))),
      1,
    );
    const one = runtime.acquire(symbol);
    const two = runtime.acquire(symbol);
    expect(() => runtime.acquire('other')).toThrow('limit');
    one.release();
    one.release();
    expect(() => runtime.acquire('other')).toThrow('limit');
    two.release();
    const other = runtime.acquire('other');
    other.release();
    await runtime.refresh();
    expect(runtime.getBook(symbol)).toBeNull();
  });
});
