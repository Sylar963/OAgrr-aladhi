import { describe, expect, it } from 'vitest';
import type { VenueId } from '@shared/enriched';
import { input, now } from './spread-scan.fixtures';
import { scanSpreads } from './spread-scanner';
import { black76Price } from '@lib/analytics/blackScholes';
import { clampedStdev, expiryPnl, rankCandidates, type RankedVertical } from './vertical-pricing';

const candidates = (i = input()) => scanSpreads(i)[0]!.candidates;

describe('venue-specific spread scanner', () => {
  it('prices all four structures at bid/ask and actual size with one Thalex combo fee', () => {
    const rows = candidates();
    expect(rows).toHaveLength(4);
    for (const c of rows) {
      expect(c.entryFee).toBeCloseTo(0.12);
      expect(c.maxLoss + c.maxProfit).toBeCloseTo(10);
      if (c.kind.endsWith('credit')) {
        expect(c.grossPremium).toBeCloseTo(3);
        expect(c.maxProfit).toBeCloseTo(2.63);
        expect(c.maxLoss).toBeCloseTo(7.37);
      } else {
        expect(c.grossPremium).toBeCloseTo(-5);
        expect(c.maxLoss).toBeCloseTo(5.37);
        expect(c.maxProfit).toBeCloseTo(4.63);
      }
    }
  });
  it('matches terminal extrema and breakeven for every structure', () => {
    for (const c of candidates()) {
      const values = [0, 79_000, 80_000, 80_500, 81_000, 100_000].map((spot) => expiryPnl(c, spot));
      expect(Math.max(...values)).toBeCloseTo(c.maxProfit);
      expect(Math.min(...values)).toBeCloseTo(-c.maxLoss);
      expect(expiryPnl(c, c.breakeven)).toBeCloseTo(0);
      expect(c.modelEdge).toBeGreaterThanOrEqual(-c.maxLoss);
      expect(c.modelEdge).toBeLessThanOrEqual(c.maxProfit);
    }
  });
  it('scales quantity without confusing per-BTC economics and account risk', () => {
    const i = input();
    i.quantity = 0.1;
    for (const c of candidates(i)) {
      expect(c.entryFee).toBeCloseTo(1.2);
      expect(c.status).toBe('over-budget');
      expect(c.riskPct).toBeCloseTo((c.maxLoss / 1080) * 100);
    }
  });
  it.each([0, -1, NaN, Infinity])('rejects invalid quantity %s', (q) => {
    const i = input();
    i.quantity = q;
    expect(candidates(i)).toHaveLength(0);
  });
  it.each([0.001, 0.015, 2])('rejects below-minimum, off-step or excessive size %s', (q) => {
    const i = input();
    i.quantity = q;
    expect(candidates(i)).toHaveLength(0);
  });
  it('never pairs legs across venues', () => {
    const i = input();
    const row = i.chain.strikes[1]!;
    row.call.venues.bybit = row.call.venues.thalex;
    row.put.venues.bybit = row.put.venues.thalex;
    delete row.call.venues.thalex;
    delete row.put.venues.thalex;
    i.venues = ['thalex', 'bybit'];
    expect(scanSpreads(i).flatMap((r) => r.candidates)).toHaveLength(0);
  });
  it.each([
    'missing',
    'stale',
    'skew',
    'mixed-inverse',
    'fee',
    'settlement',
    'crossed',
  ] as const)('rejects %s data', (issue) => {
    const i = input();
    for (const side of ['call', 'put'] as const) {
      const q = i.chain.strikes[0]![side].venues.thalex!;
      if (issue === 'missing') q.execution = null;
      if (issue === 'stale') q.asOfMs = now - 16_000;
      if (issue === 'skew') q.asOfMs = now - 3_000;
      if (issue === 'mixed-inverse') {
        q.execution!.inverse = true;
        q.execution!.settleCurrency = 'BTC';
      }
      if (issue === 'fee') {
        q.execution!.bidTakerFeeUsd = null;
        q.execution!.askTakerFeeUsd = null;
      }
      if (issue === 'settlement') q.execution!.settleCurrency = 'BTC';
      if (issue === 'crossed') q.execution!.bidUsd = 9999;
    }
    expect(candidates(i)).toHaveLength(0);
    expect(Object.keys(scanSpreads(i)[0]!.rejected).length).toBeGreaterThan(0);
  });
  it('prices coin-settled pairs in forward-hedged USD and reports the coin premium', () => {
    const i = input();
    for (const row of i.chain.strikes)
      for (const side of ['call', 'put'] as const) {
        const q = row[side].venues.thalex!;
        q.execution!.inverse = true;
        q.execution!.settleCurrency = 'BTC';
      }
    const linear = candidates();
    const inverse = candidates(i);
    expect(inverse).toHaveLength(linear.length);
    for (const c of inverse) {
      const twin = linear.find((l) => l.id === c.id)!;
      expect(c.maxLoss).toBeCloseTo(twin.maxLoss);
      expect(c.maxProfit).toBeCloseTo(twin.maxProfit);
      expect(twin.basePremium).toBeNull();
      expect(c.basePremium).toBeCloseTo((c.grossPremium - c.entryFee) / 80_000, 10);
      expect(Math.sign(c.basePremium!)).toBe(c.kind.endsWith('credit') ? 1 : -1);
    }
  });
  it('rejects coin-settled pairs without a conversion price', () => {
    const i = input();
    for (const row of i.chain.strikes)
      for (const side of ['call', 'put'] as const) {
        const q = row[side].venues.thalex!;
        q.execution!.inverse = true;
        q.execution!.settleCurrency = 'BTC';
        q.underlyingPriceUsd = null;
      }
    expect(candidates(i)).toHaveLength(0);
    expect(scanSpreads(i)[0]!.rejected).toHaveProperty('Missing inverse conversion price');
  });
  it('values each leg at its own IV so a steep smile adds no phantom edge', () => {
    const i = input();
    const T = (i.chain.expiryTs! - now) / (365.25 * 86_400_000);
    i.chain.strikes[0]!.strike = 50_000;
    for (const row of i.chain.strikes)
      for (const side of ['call', 'put'] as const) {
        const q = row[side].venues.thalex!;
        q.markIv = row.strike === 50_000 ? 0.95 : 0.34;
        const fair = black76Price(side, 80_000, row.strike, T, q.markIv);
        q.execution!.bidUsd = fair - 0.5;
        q.execution!.askUsd = fair + 0.5;
      }
    const rows = candidates(i);
    expect(rows.length).toBeGreaterThan(0);
    for (const c of rows) expect(c.modelEdge!).toBeCloseTo(-0.01 - c.entryFee - c.costReserve, 6);
  });
  it('computes the clamped lognormal standard deviation in closed form', () => {
    const [F, T, sigma] = [80_000, 0.1, 0.5];
    const v2 = sigma * sigma * T;
    expect(clampedStdev(F, 1e-9, 1e12, T, sigma)).toBeCloseTo(F * Math.sqrt(Math.exp(v2) - 1), 0);
    expect(clampedStdev(F, 80_000, 80_000, T, sigma)).toBeCloseTo(0, 6);
    const steps = 200_000;
    let m1 = 0;
    let m2 = 0;
    for (let i = 0; i < steps; i++) {
      const z = -8 + (16 * (i + 0.5)) / steps;
      const w = (Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI)) * (16 / steps);
      const x = Math.min(Math.max(F * Math.exp(-v2 / 2 + Math.sqrt(v2) * z), 75_000), 90_000);
      m1 += w * x;
      m2 += w * x * x;
    }
    expect(clampedStdev(F, 75_000, 90_000, T, sigma)).toBeCloseTo(Math.sqrt(m2 - m1 * m1), 0);
  });
  it('ranks in-budget pairs by edge per unit of payoff spread, not raw dollars', () => {
    const base = candidates()[0]!;
    const penny: RankedVertical = { ...base, id: 'penny', modelEdge: -1, edgeRatio: -0.05 };
    const balanced: RankedVertical = { ...base, id: 'balanced', modelEdge: -3, edgeRatio: -0.01 };
    const large: RankedVertical = {
      ...base,
      id: 'large',
      status: 'over-budget',
      modelEdge: 5,
      edgeRatio: 0.2,
    };
    const rows = [penny, large, balanced];
    rankCandidates(rows);
    expect(rows.map((r) => r.id)).toEqual(['balanced', 'penny', 'large']);
  });
  it('gives every modeled candidate an edge ratio with the sign of its edge', () => {
    for (const c of candidates()) {
      expect(c.edgeRatio).not.toBeNull();
      expect(Math.sign(c.edgeRatio!)).toBe(Math.sign(c.modelEdge!));
    }
  });
  it('expires cached quotes even if the feed stops updating', () => {
    const i = input();
    i.nowMs += 16_000;
    expect(candidates(i)).toHaveLength(0);
  });
  it('reports unavailable model inputs rather than inferring an edge', () => {
    const i = input();
    for (const row of i.chain.strikes)
      for (const side of ['call', 'put'] as const) row[side].venues.thalex!.markIv = null;
    expect(candidates(i).every((c) => c.status === 'no-model' && c.probability === null)).toBe(
      true,
    );
  });
  it('uses a user forecast only when explicitly supplied', () => {
    const i = input();
    const base = candidates(i).find((c) => c.kind === 'call-debit')!;
    i.forecast = { movePct: 10, volatility: 0.4 };
    const forecast = candidates(i).find((c) => c.kind === 'call-debit')!;
    expect(base.model).toBe('market');
    expect(forecast.model).toBe('forecast');
    expect(forecast.modelEdge!).toBeGreaterThan(base.modelEdge!);
    expect(forecast.probability!).toBeGreaterThan(base.probability!);
  });

  it('applies the delayed-feed freshness window to tastytrade quotes only', () => {
    const scanAged = (venue: 'thalex' | 'tastytrade', ageMs: number) => {
      const i = input();
      const id = venue as VenueId;
      for (const row of i.chain.strikes)
        for (const side of [row.call, row.put]) {
          const q = side.venues.thalex!;
          q.asOfMs = now - ageMs;
          side.venues = { [id]: q };
        }
      i.venues = [id];
      return scanSpreads(i)[0]!;
    };
    expect(scanAged('thalex', 60_000).candidates).toHaveLength(0);
    expect(scanAged('tastytrade', 60_000).candidates.length).toBeGreaterThan(0);
    expect(scanAged('tastytrade', 100_000).rejected).toHaveProperty(['Stale or missing timestamp']);
  });
});
