import { describe, expect, it } from 'vitest';
import { input, now } from './spread-scan.fixtures';
import { scanSpreads } from './spread-scanner';
import { expiryPnl } from './vertical-pricing';

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
    'inverse',
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
      if (issue === 'inverse') q.execution!.inverse = true;
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
});
