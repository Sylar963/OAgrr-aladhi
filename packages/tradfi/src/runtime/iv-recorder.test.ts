import { describe, expect, it, vi } from 'vitest';
import type { TradfiInstrument } from '../tastytrade/instrument.js';
import { expiryCloseTs } from '../tastytrade/instrument.js';
import { bracketExpiries, inRegularSession, TradfiIvRecorder } from './iv-recorder.js';
import { TradfiStore } from './store.js';

const DAY = 86_400_000;
// Wednesday 2026-10-14 11:00 New York (EDT).
const OPEN = Date.parse('2026-10-14T15:00:00Z');
const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

describe('inRegularSession', () => {
  it('is open 9:30–16:00 New York time on weekdays only', () => {
    expect(inRegularSession(Date.parse('2026-10-14T13:29:00Z'))).toBe(false);
    expect(inRegularSession(Date.parse('2026-10-14T13:30:00Z'))).toBe(true);
    expect(inRegularSession(Date.parse('2026-10-14T19:59:00Z'))).toBe(true);
    expect(inRegularSession(Date.parse('2026-10-14T20:00:00Z'))).toBe(false);
    expect(inRegularSession(Date.parse('2026-10-17T15:00:00Z'))).toBe(false);
    expect(inRegularSession(Date.parse('2026-01-14T14:30:00Z'))).toBe(true);
  });
});

describe('bracketExpiries', () => {
  const at = (days: number) => ({ expiry: `d${days}`, expiryTs: OPEN + days * DAY });

  it('keeps the expiry on each side of every tenor and drops the rest', () => {
    const listed = [-1, 1, 2, 5, 9, 14, 28, 35, 45, 58, 63, 88, 120, 400].map(at);
    expect(bracketExpiries(listed, OPEN).sort()).toEqual(
      ['d5', 'd9', 'd28', 'd35', 'd58', 'd63', 'd88', 'd120'].sort(),
    );
  });

  it('falls back to the nearest or furthest expiry when a tenor is outside the listing', () => {
    expect(bracketExpiries([at(10), at(20)], OPEN).sort()).toEqual(['d10', 'd20']);
    expect(bracketExpiries([], OPEN)).toEqual([]);
  });
});

function seed(store: TradfiStore, days: number[]) {
  const insts: TradfiInstrument[] = [];
  for (const d of days) {
    const expiry = isoDate(OPEN + d * DAY);
    for (const strike of [95, 100, 105])
      for (const right of ['call', 'put'] as const) {
        const symbol = `.SPY${expiry}${strike}${right}`;
        insts.push({
          underlying: 'SPY', expiry, expiryTs: expiryCloseTs(expiry), strike, right, multiplier: 100,
          occSymbol: symbol, streamerSymbol: symbol,
          canonical: `SPY-${expiry}-${strike}-${right}`, rootSymbol: 'SPY', settlementType: 'physical',
          expirationType: 'Regular', tickSizes: [],
        });
        const moneyness = (100 - strike) / 20;
        store.mergeQuote(symbol, {
          ts: 1, bid: 1, ask: 1.2, mark: 1.1, iv: 0.3,
          delta: right === 'call' ? 0.5 + moneyness : -0.5 + moneyness,
        });
      }
  }
  store.setInstruments(insts);
}

function recorder() {
  const store = new TradfiStore();
  seed(store, [3, 10, 25, 40, 65, 95, 200]);
  const ensureChainSubscribed = vi.fn();
  const rec = new TradfiIvRecorder({
    store, feed: { ensureChainSubscribed },
    persistence: { enabled: false, writeMany: async () => {}, loadSince: async () => [] },
    underlyings: ['SPY'],
  });
  return { store, rec, ensureChainSubscribed };
}

describe('TradfiIvRecorder', () => {
  it('subscribes only bracketing expiries during the session', () => {
    const { store, rec, ensureChainSubscribed } = recorder();
    store.setSpot('SPY', 100);
    rec.keepWarm(OPEN - 2 * 60 * 60_000);
    expect(ensureChainSubscribed).not.toHaveBeenCalled();

    rec.keepWarm(OPEN);
    const expiries = ensureChainSubscribed.mock.calls.map((c) => c[1]).sort();
    expect(expiries).toEqual([3, 10, 25, 40, 65, 95].map((d) => isoDate(OPEN + d * DAY)).sort());
  });

  it('samples only once warm and while the spot is moving', async () => {
    const { store, rec } = recorder();
    store.setSpot('SPY', 100);
    rec.keepWarm(OPEN);
    expect(await rec.surfaceRows('SPY', OPEN + 30_000)).toEqual([]);
    // The first spot seen after a restart might be a holiday's frozen print.
    expect(await rec.surfaceRows('SPY', OPEN + 2 * 60_000)).toEqual([]);

    store.setSpot('SPY', 100.5);
    rec.keepWarm(OPEN + 2 * 60_000);
    const rows = await rec.surfaceRows('SPY', OPEN + 3 * 60_000);
    expect(rows.map((r) => r.expiry)).toHaveLength(6);
    expect(rows.every((r) => r.atm != null)).toBe(true);

    expect(await rec.surfaceRows('SPY', OPEN + 20 * 60_000)).toEqual([]);
  });
});
