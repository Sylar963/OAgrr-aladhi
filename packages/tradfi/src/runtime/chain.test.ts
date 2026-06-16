import { describe, expect, it } from 'vitest';
import { TradfiStore } from './store.js';
import { TradfiFlowBook } from './flow-book.js';
import { buildChain } from './chain.js';
import type { TradfiInstrument } from '../tastytrade/instrument.js';

function inst(right: 'call' | 'put', strike: number): TradfiInstrument {
  return {
    underlying: 'AAPL', expiry: '2026-04-17', strike, right,
    occSymbol: `AAPL...${strike}${right}`, streamerSymbol: `.AAPL${strike}${right[0]}`,
    canonical: `AAPL/USD:USD-260417-${strike}-${right === 'call' ? 'C' : 'P'}`,
    multiplier: 100, rootSymbol: 'AAPL', settlementType: 'physical', expirationType: 'Regular',
  };
}

describe('buildChain', () => {
  it('returns an enriched chain with the requested underlying/expiry', () => {
    const store = new TradfiStore();
    const c = inst('call', 200);
    const p = inst('put', 200);
    store.setInstruments([c, p]);
    store.setSpot('AAPL', 198);
    store.mergeQuote(c.streamerSymbol, { bid: 5, ask: 5.2, mark: 5.1, iv: 0.4, delta: 0.55, ts: 1 });
    store.mergeQuote(p.streamerSymbol, { bid: 6, ask: 6.2, mark: 6.1, iv: 0.42, delta: -0.45, ts: 1 });

    const enriched = buildChain(store, 'AAPL', '2026-04-17');
    expect(enriched.underlying).toBe('AAPL');
    expect(enriched.expiry).toBe('2026-04-17');
    expect(enriched.strikes.length).toBe(1);
  });

  it('rolls per-strike OI into USD-notional stats (totalOiUsd, put/call ratio)', () => {
    const store = new TradfiStore();
    const c = inst('call', 200);
    const p = inst('put', 200);
    store.setInstruments([c, p]);
    store.setSpot('AAPL', 198);
    store.mergeQuote(c.streamerSymbol, { mark: 5.1, openInterest: 10, ts: 1 });
    store.mergeQuote(p.streamerSymbol, { mark: 6.1, openInterest: 4, ts: 1 });

    const enriched = buildChain(store, 'AAPL', '2026-04-17');
    // OI notional = contracts × multiplier(100) × spot(198); was 0 when openInterestUsd was left null.
    expect(enriched.stats.totalOiUsd).toBe((10 + 4) * 100 * 198);
    expect(enriched.stats.putCallOiRatio).toBeCloseTo(4 / 10);
  });

  it('derives a put-call-parity forward so basis is non-zero', () => {
    const store = new TradfiStore();
    const c = inst('call', 200);
    const p = inst('put', 200);
    store.setInstruments([c, p]);
    store.setSpot('AAPL', 198);
    // ATM strike 200 (closest to spot). Call richer than put → synthetic forward > spot.
    store.mergeQuote(c.streamerSymbol, { mark: 7, ts: 1 });
    store.mergeQuote(p.streamerSymbol, { mark: 4, ts: 1 });

    const enriched = buildChain(store, 'AAPL', '2026-04-17');
    // F = K + (callMark − putMark) = 200 + (7 − 4) = 203.
    expect(enriched.stats.forwardPriceUsd).toBeCloseTo(203);
    expect(enriched.stats.basisPct).toBeCloseTo(((203 - 198) / 198) * 100);
    expect(enriched.stats.basisPct).not.toBe(0);
  });

  it('falls back to spot (basis 0) when ATM marks are missing', () => {
    const store = new TradfiStore();
    const c = inst('call', 200);
    const p = inst('put', 200);
    store.setInstruments([c, p]);
    store.setSpot('AAPL', 198);
    store.mergeQuote(c.streamerSymbol, { openInterest: 5, ts: 1 });
    store.mergeQuote(p.streamerSymbol, { openInterest: 5, ts: 1 });

    const enriched = buildChain(store, 'AAPL', '2026-04-17');
    expect(enriched.stats.basisPct).toBe(0);
  });

  it('realistic chain: both basis-gated regime inputs come out NON-flat', () => {
    // Mirrors the chip's flat bands (RegimeChip BASIS_FLAT 0.01, SKEW_FLAT 0.005)
    // so this proves B×S and B×OI cannot read "flat" given real quotes.
    const store = new TradfiStore();
    const strikes = [90, 95, 100, 105, 110];
    const insts = strikes.flatMap((k) => [inst('call', k), inst('put', k)]);
    store.setInstruments(insts);
    store.setSpot('AAPL', 100);

    // ATM (100): call−put mark = 0.5 → synthetic forward 100.5 → basis +0.5%.
    store.mergeQuote('.AAPL100c', { mark: 3.0, delta: 0.52, iv: 0.22, openInterest: 50, ts: 1 });
    store.mergeQuote('.AAPL100p', { mark: 2.5, delta: -0.48, iv: 0.22, openInterest: 80, ts: 1 });
    // 25Δ wings: put IV (0.27) > call IV (0.20) → skew −0.07 (put-skew, non-flat).
    store.mergeQuote('.AAPL110c', { mark: 0.6, delta: 0.25, iv: 0.2, openInterest: 40, ts: 1 });
    store.mergeQuote('.AAPL90p', { mark: 0.5, delta: -0.25, iv: 0.27, openInterest: 90, ts: 1 });

    const { stats } = buildChain(store, 'AAPL', '2026-04-17');
    expect(stats.basisPct).toBeCloseTo(0.5);
    expect(Math.abs(stats.basisPct!)).toBeGreaterThan(0.01); // not 'flat' for B×S/B×OI
    expect(stats.skew25d).toBeCloseTo(-0.07);
    expect(Math.abs(stats.skew25d!)).toBeGreaterThan(0.005); // not 'flat' for B×S
    expect(stats.putCallOiRatio).toBeGreaterThan(1.1); // 'high' bucket for B×OI
  });
});

function seedStore(): TradfiStore {
  const store = new TradfiStore();
  store.setInstruments([
    {
      canonical: 'SPX/USD:USD-260618-5000-C',
      streamerSymbol: '.C',
      underlying: 'SPX',
      expiry: '2026-06-18',
      strike: 5000,
      right: 'call',
      multiplier: 100,
      occSymbol: 'SPX   260618C05000000',
      rootSymbol: 'SPX',
      settlementType: 'cash',
      expirationType: 'Regular',
    } satisfies TradfiInstrument,
  ]);
  store.setSpot('SPX', 5000);
  store.mergeQuote('.C', { ts: 1, bid: 1, ask: 2, mark: 1.5, gamma: 0.001, openInterest: 1000 });
  return store;
}

describe('buildChain signed GEX', () => {
  it('with no flow book, GEX equals the naive path (unchanged behavior)', () => {
    const a = buildChain(seedStore(), 'SPX', '2026-06-18', 'ws');
    const b = buildChain(seedStore(), 'SPX', '2026-06-18', 'ws', new TradfiFlowBook());
    expect(b.gex).toEqual(a.gex); // empty book ⇒ dealerContracts = +OI ⇒ identical
  });

  it('net customer buying of a call lowers its GEX vs naive', () => {
    const store = seedStore();
    const flow = new TradfiFlowBook();
    flow.recordTrade('SPX/USD:USD-260618-5000-C', 1.9, 400, 1, 2, Date.now()); // +400 buys
    const naive = buildChain(seedStore(), 'SPX', '2026-06-18', 'ws').gex;
    const signed = buildChain(store, 'SPX', '2026-06-18', 'ws', flow).gex;
    const k = 5000;
    const naiveAt = naive.find((g) => g.strike === k)!.gexUsdMillions;
    const signedAt = signed.find((g) => g.strike === k)!.gexUsdMillions;
    expect(signedAt).toBeLessThan(naiveAt); // dealers less long ⇒ less positive GEX
  });
});
