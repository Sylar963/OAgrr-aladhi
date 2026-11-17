import { TradfiAnalyticsResponseSchema, TradfiParityResponseSchema } from '@oggregator/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp, type TradfiDeps } from '../app.js';
import { TradfiStore } from '../runtime/store.js';
import { applyEvent } from '../tastytrade/state.js';
import type { TradfiInstrument } from '../tastytrade/instrument.js';
import type { ChainTier } from '../tastytrade/planner.js';

const NOW = Date.parse('2026-11-17T17:00:00Z');
const DAY = 86_400_000;
const DAY_ID = Math.floor(Date.parse('2026-11-17') / DAY);
const EXPIRIES = ['2026-11-20', '2026-12-18'];

function fixture() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  const store = new TradfiStore();
  const insts: TradfiInstrument[] = EXPIRIES.flatMap((expiry) => [90, 100, 110].flatMap((strike) =>
    (['call', 'put'] as const).map((right) => {
      const symbol = `${expiry}:${strike}:${right}`;
      return { underlying: 'SPX', expiry, strike, right, expiryTs: Date.parse(`${expiry}T21:00:00Z`),
        multiplier: 100, rootSymbol: 'SPXW', settlementType: 'cash' as const, expirationType: 'Weekly',
        canonical: symbol, streamerSymbol: symbol, occSymbol: symbol, tickSizes: [] };
    })));
  store.setInstruments(insts);
  store.setSpot('SPX', 100);
  for (const i of insts) {
    applyEvent(store, { eventType: 'Trade', eventSymbol: i.streamerSymbol, price: 20, dayVolume: i.right === 'call' ? 10 : 20, dayId: DAY_ID }, NOW);
    applyEvent(store, { eventType: 'Summary', eventSymbol: i.streamerSymbol, openInterest: 100 }, NOW);
    const mid = i.right === 'call' ? 120 - i.strike : 20;
    applyEvent(store, { eventType: 'Quote', eventSymbol: i.streamerSymbol, bidPrice: mid - 0.1, askPrice: mid + 0.1,
      bidSize: 5, askSize: 5, bidTime: NOW - 900_000, askTime: NOW - 900_000 }, NOW);
  }
  const feed = {
    readiness: () => ({ catalogLoaded: true, quoteTokenAcquired: true, streaming: true, lastDataTs: NOW, underlyings: 1, instruments: insts.length }),
    ensureChainSubscribed: vi.fn(), refreshChainQuotes: async () => 0,
    hasChainTier: (_u: string, _e: string, _tier: ChainTier) => true,
  };
  const deps: TradfiDeps = { store, feed };
  return { store, feed, app: buildApp(deps), deps };
}

afterEach(() => vi.useRealTimers());

describe('TradFi analytics routes', () => {
  it('aggregates every live expiry with analytics-only subscriptions and reuses the snapshot', async () => {
    const { app, feed } = fixture();
    try {
      const response = await app.inject('/analytics?underlying=spx');
      expect(response.statusCode).toBe(200);
      const body = TradfiAnalyticsResponseSchema.parse(response.json());
      expect(body.sessionDate).toBe('2026-11-17');
      expect(body.summary.call.volume).toBe(60);
      expect(body.summary.put.volume).toBe(120);
      expect(body.summary.putCallVolumeRatio).toBe(2);
      expect(body.cells).toHaveLength(6);
      expect(body.byExpiry.reduce((s, r) => s + (r.call.volume ?? 0), 0)).toBe(60);
      expect(feed.ensureChainSubscribed.mock.calls).toEqual(EXPIRIES.map((e) => ['SPX', e, 'analytics']));
      expect((await app.inject('/analytics?underlying=SPX')).json()).toEqual(body);
    } finally { await app.close(); }
  });

  it('filters the entire response while retaining the available expiry choices', async () => {
    const { app } = fixture();
    try {
      const body = TradfiAnalyticsResponseSchema.parse((await app.inject(`/analytics?underlying=SPX&expiry=${EXPIRIES[0]}`)).json());
      expect(body.expiries).toEqual(EXPIRIES);
      expect(body.byExpiry).toHaveLength(1);
      expect(body.summary.call.volume).toBe(30);
      expect(body.byStrike.reduce((s, r) => s + (r.call.volume ?? 0), 0)).toBe(30);
    } finally { await app.close(); }
  });

  it('does not mix trading days or treat missing coverage as zero', async () => {
    const { app, store } = fixture();
    const inst = store.instrumentsFor('SPX', EXPIRIES[0]!)[0]!;
    applyEvent(store, { eventType: 'Trade', eventSymbol: inst.streamerSymbol, dayVolume: 0, dayId: DAY_ID + 1, price: 20 }, NOW);
    try {
      const body = TradfiAnalyticsResponseSchema.parse((await app.inject('/analytics?underlying=SPX')).json());
      expect(body.sessionDate).toBe('2026-11-18');
      expect(body.summary.call.volume).toBe(0);
      expect(body.summary.call.volumeObserved).toBe(1);
      expect(body.summary.put.volume).toBeNull();
      expect(body.summary.putCallVolumeRatio).toBeNull();
      expect(body.summary.putCallOiRatio).toBe(1);
    } finally { await app.close(); }
  });

  it('exposes subscription deferral without presenting frozen values as coverage', async () => {
    const { app, feed } = fixture();
    feed.hasChainTier = (_u, e) => e !== EXPIRIES[1];
    try {
      const body = TradfiAnalyticsResponseSchema.parse((await app.inject('/analytics?underlying=SPX')).json());
      expect(body.deferredExpiries).toEqual([EXPIRIES[1]]);
      expect(body.summary.call.volumeObserved).toBe(3);
      expect(body.summary.call.contracts).toBe(6);
      expect(body.summary.putCallVolumeRatio).toBeNull();
    } finally { await app.close(); }
  });

  it('prices matching pairs with a separate quotes-only lease and excludes the target from the benchmark', async () => {
    const { app, feed } = fixture();
    try {
      const body = TradfiParityResponseSchema.parse((await app.inject(`/analytics/parity?underlying=SPX&expiry=${EXPIRIES[0]}`)).json());
      expect(feed.ensureChainSubscribed).toHaveBeenCalledWith('SPX', EXPIRIES[0], 'parity');
      expect(body.europeanConsistency).toBe(true);
      expect(body.rows[1]!.referenceStrikes).toEqual([90, 110]);
      expect(body.rows[1]!.consistencyResidual).toBeCloseTo(0);
      expect(body.rows[1]!.quoteAgeMs).toBe(900_000);
    } finally { await app.close(); }
  });

  it('rejects invalid queries, missing catalogs, unknown tickers and expired dates', async () => {
    const { app, feed } = fixture();
    try {
      expect((await app.inject('/analytics')).statusCode).toBe(400);
      expect((await app.inject('/analytics?underlying=SPX&expiry=bad')).statusCode).toBe(400);
      expect((await app.inject('/analytics/parity?underlying=SPX')).statusCode).toBe(400);
      expect((await app.inject('/analytics?underlying=NOPE')).statusCode).toBe(404);
      expect((await app.inject('/analytics?underlying=SPX&expiry=2020-01-01')).statusCode).toBe(404);
      feed.readiness = () => ({ catalogLoaded: false, quoteTokenAcquired: false, streaming: false, lastDataTs: 0, underlyings: 0, instruments: 0 });
      expect((await app.inject('/analytics?underlying=SPX')).statusCode).toBe(503);
      expect(feed.ensureChainSubscribed).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});
