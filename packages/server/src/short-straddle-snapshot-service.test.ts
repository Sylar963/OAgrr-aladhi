import type { EnrichedStrike, SurfaceGridEntry, VenueQuote } from '@oggregator/core';
import type { PersistedShortStraddleSnapshot, ShortStraddleSnapshotStore } from '@oggregator/db';
import { describe, expect, it } from 'vitest';
import {
  ShortStraddleSnapshotService,
  selectShortStraddleSnapshot,
  utcHourlySlotMs,
} from './short-straddle-snapshot-service.js';

const NOW = Date.parse('2026-07-13T08:05:00.000Z');
const SPOT = 60_000;

function quote(overrides: Partial<VenueQuote> = {}): VenueQuote {
  return {
    bid: 1_000,
    ask: 1_020,
    mid: 1_010,
    midRaw: 0.0168,
    bidSize: 2,
    askSize: 3,
    markIv: 0.51,
    bidIv: 0.5,
    askIv: 0.52,
    delta: 0.5,
    gamma: 0.0001,
    theta: -10,
    vega: 123.45,
    spreadPct: 1.98,
    totalCost: 1_023,
    estimatedFees: { maker: 2, taker: 3 },
    openInterest: 500,
    volume24h: 100,
    openInterestUsd: 50_000,
    volume24hUsd: 10_000,
    asOfMs: NOW - 1_000,
    underlyingPriceUsd: 60_200,
    inverse: true,
    ...overrides,
  };
}

function strike(
  strikePrice: number,
  call: VenueQuote | null = quote(),
  put: VenueQuote | null = quote({ delta: -0.5, markIv: 0.52 }),
): EnrichedStrike {
  return {
    strike: strikePrice,
    call: {
      bestIv: call?.markIv ?? null,
      bestVenue: call == null ? null : 'deribit',
      venues: call == null ? {} : { deribit: call },
    },
    put: {
      bestIv: put?.markIv ?? null,
      bestVenue: put == null ? null : 'deribit',
      venues: put == null ? {} : { deribit: put },
    },
  };
}

function entry(expiry: string, strikes: EnrichedStrike[]): SurfaceGridEntry {
  return {
    expiry,
    dte: 7,
    surfaceRow: {
      expiry,
      dte: 7,
      delta10p: null,
      delta25p: null,
      atm: 0.5,
      delta25c: null,
      delta10c: null,
    },
    surfaceFineRow: { expiry, dte: 7, ivs: [] },
    surfaceFineSmoothedRow: { expiry, dte: 7, ivs: [] },
    venueSurfaceFineRow: {},
    venueSurfaceFineSmoothedRow: {},
    atmStrike: strikes[0] ?? null,
    strikes,
    basisPct: null,
  };
}

function selected(
  entries: SurfaceGridEntry[],
  spotPriceUsd = SPOT,
  now = NOW,
  quoteMaxAgeMs = 60_000,
): PersistedShortStraddleSnapshot | null {
  return selectShortStraddleSnapshot(entries, spotPriceUsd, now, quoteMaxAgeMs).snapshot;
}

class FakeStore implements ShortStraddleSnapshotStore {
  readonly enabled = true;
  readonly writes: PersistedShortStraddleSnapshot[][] = [];
  failures = 0;

  async writeMany(rows: PersistedShortStraddleSnapshot[]): Promise<void> {
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error('local append failed');
    }
    this.writes.push(rows);
  }

  async dispose(): Promise<void> {}
}

describe('utcHourlySlotMs', () => {
  it('floors timestamps to the UTC hourly slot', () => {
    expect(utcHourlySlotMs(Date.parse('2026-07-13T23:59:59.999Z'))).toBe(
      Date.parse('2026-07-13T23:00:00.000Z'),
    );
  });
});

describe('selectShortStraddleSnapshot', () => {
  it('selects the Deribit expiry nearest exactly seven DTE', () => {
    const snapshot = selected([
      entry('2026-07-19', [strike(SPOT)]),
      entry('2026-07-20', [strike(SPOT)]),
      entry('2026-07-21', [strike(SPOT)]),
    ]);

    expect(snapshot?.expiry).toBe('2026-07-20');
    expect(snapshot?.expiryTs).toEqual(new Date('2026-07-20T08:00:00.000Z'));
  });

  it('rejects the nearest expiry outside the two-day window', () => {
    const result = selectShortStraddleSnapshot([entry('2026-07-23', [strike(SPOT)])], SPOT, NOW);

    expect(result).toEqual({ snapshot: null, reason: 'expiry_outside_window' });
  });

  it('requires call and put quotes at the same strike', () => {
    const snapshot = selected([
      entry('2026-07-20', [strike(59_000, quote(), null), strike(60_000, null, quote())]),
    ]);

    expect(snapshot).toBeNull();
  });

  it('selects only paired Deribit quotes', () => {
    const okxOnly = strike(SPOT, null, null);
    okxOnly.call.venues.okx = quote();
    okxOnly.put.venues.okx = quote({ delta: -0.5 });
    const snapshot = selected([entry('2026-07-20', [okxOnly, strike(61_000)])]);

    expect(snapshot?.strike).toBe(61_000);
  });

  it.each([
    ['missing timestamp', { asOfMs: null }],
    ['stale timestamp', { asOfMs: NOW - 60_001 }],
    ['future timestamp', { asOfMs: NOW + 1 }],
  ] satisfies Array<
    [string, Partial<VenueQuote>]
  >)('rejects a quote with %s', (_name, overrides) => {
    const snapshot = selected([entry('2026-07-20', [strike(SPOT, quote(overrides))])]);

    expect(snapshot).toBeNull();
  });

  it.each([
    ['zero bid', { bid: 0 }],
    ['negative ask', { ask: -1 }],
    ['ask below bid', { bid: 1_020, ask: 1_000 }],
  ] satisfies Array<[string, Partial<VenueQuote>]>)('rejects %s', (_name, overrides) => {
    const snapshot = selected([entry('2026-07-20', [strike(SPOT, quote(overrides))])]);

    expect(snapshot).toBeNull();
  });

  it.each([
    ['mark IV', { markIv: null }],
    ['delta', { delta: null }],
    ['vega', { vega: null }],
    ['open interest', { openInterest: null }],
    ['bid size', { bidSize: null }],
    ['ask size', { askSize: null }],
    ['positive bid size', { bidSize: 0 }],
    ['positive ask size', { askSize: 0 }],
    ['fees', { estimatedFees: null }],
  ] satisfies Array<
    [string, Partial<VenueQuote>]
  >)('rejects missing or invalid %s', (_name, overrides) => {
    const snapshot = selected([entry('2026-07-20', [strike(SPOT, quote(overrides))])]);

    expect(snapshot).toBeNull();
  });

  it('selects the strike nearest current spot', () => {
    const snapshot = selected([
      entry('2026-07-20', [strike(58_000), strike(60_100), strike(61_000)]),
    ]);

    expect(snapshot?.strike).toBe(60_100);
  });

  it('breaks equal-distance ties by combined spread and then lower strike', () => {
    const wide = quote({ bid: 900, ask: 1_100 });
    const tight = quote({ bid: 990, ask: 1_010 });
    const tighterHigher = selected([
      entry('2026-07-20', [strike(59_000, wide, wide), strike(61_000, tight, tight)]),
    ]);
    const equalSpreads = selected([
      entry('2026-07-20', [strike(59_000, tight, tight), strike(61_000, tight, tight)]),
    ]);

    expect(tighterHigher?.strike).toBe(61_000);
    expect(equalSpreads?.strike).toBe(59_000);
  });

  it('preserves wide valid spreads without filtering them', () => {
    const snapshot = selected([
      entry('2026-07-20', [strike(SPOT, quote({ bid: 100, ask: 2_000 }))]),
    ]);

    expect(snapshot?.callBidUsd).toBe(100);
    expect(snapshot?.callAskUsd).toBe(2_000);
  });

  it('preserves fractional IV and canonical venue vega units', () => {
    const snapshot = selected([
      entry('2026-07-20', [strike(SPOT, quote({ markIv: 0.6543, vega: 17.25 }))]),
    ]);

    expect(snapshot?.callMarkIv).toBe(0.6543);
    expect(snapshot?.callVega).toBe(17.25);
  });

  it('stores spot and the selected Deribit forward separately', () => {
    const snapshot = selected([
      entry('2026-07-20', [strike(SPOT, quote({ underlyingPriceUsd: 60_250 }))]),
    ]);

    expect(snapshot?.spotPriceUsd).toBe(60_000);
    expect(snapshot?.forwardPriceUsd).toBe(60_250);
  });
});

describe('ShortStraddleSnapshotService', () => {
  it('writes at most one successful snapshot per UTC hour', async () => {
    const store = new FakeStore();
    const service = new ShortStraddleSnapshotService(store, {
      log: console,
      quoteMaxAgeMs: 2 * 3_600_000,
    });
    const entries = [entry('2026-07-20', [strike(SPOT)])];

    await service.collect(entries, SPOT, NOW);
    await service.collect(entries, SPOT, NOW + 5 * 60_000);
    await service.collect(entries, SPOT, NOW + 3_600_000);

    expect(store.writes).toHaveLength(2);
    expect(store.writes[0]?.[0]?.sampleSlotTs).toEqual(new Date('2026-07-13T08:00:00.000Z'));
    expect(store.writes[1]?.[0]?.sampleSlotTs).toEqual(new Date('2026-07-13T09:00:00.000Z'));
  });

  it('retries within the hour after a local write failure', async () => {
    const store = new FakeStore();
    store.failures = 1;
    const service = new ShortStraddleSnapshotService(store, { log: console });
    const entries = [entry('2026-07-20', [strike(SPOT)])];

    const failed = await service.collect(entries, SPOT, NOW);
    const retried = await service.collect(entries, SPOT, NOW + 5_000);

    expect(failed).toBe(false);
    expect(retried).toBe(true);
    expect(store.writes).toHaveLength(1);
  });
});
