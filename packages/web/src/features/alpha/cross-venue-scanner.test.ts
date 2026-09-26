import { describe, expect, it } from 'vitest';
import {
  NOT_BETTER_REASON,
  SINGLE_VENUE_REASON,
  scanCrossVenueSpreads,
} from './cross-venue-scanner';
import { input } from './spread-scan.fixtures';
import { scanSpreads } from './spread-scanner';
import { expiryPnl, type SpreadScanInput } from './vertical-pricing';

describe('cross-venue spread scanner', () => {
  const cross = (i: SpreadScanInput) => scanCrossVenueSpreads(i, scanSpreads(i));
  function twoVenues(): SpreadScanInput {
    const i = input();
    for (const row of i.chain.strikes)
      for (const side of ['call', 'put'] as const) {
        const q = row[side].venues.thalex!;
        row[side].venues.bybit = { ...q, execution: { ...q.execution! } };
      }
    i.venues = ['thalex', 'bybit'];
    return i;
  }

  it('pairs legs across venues with standalone per-leg fees and groups by short venue', () => {
    const i = input();
    const row = i.chain.strikes[1]!;
    row.call.venues.bybit = row.call.venues.thalex;
    row.put.venues.bybit = row.put.venues.thalex;
    delete row.call.venues.thalex;
    delete row.put.venues.thalex;
    i.venues = ['thalex', 'bybit'];
    const [thalex, bybit] = cross(i);
    const all = [...thalex!.candidates, ...bybit!.candidates];
    expect(all).toHaveLength(4);
    for (const c of all) {
      expect(c.buyVenue).not.toBe(c.sellVenue);
      expect(c.entryFee).toBeCloseTo(0.24);
      expect(c.legFees.sell + c.legFees.buy).toBeCloseTo(c.entryFee);
      expect(c.improvement).toBeNull();
      expect(c.sellStrike).toBe(c.sellVenue === 'thalex' ? 80_000 : 81_000);
    }
  });
  it('drops routes that do not beat the best same-venue price', () => {
    const [thalex, bybit] = cross(twoVenues());
    expect([...thalex!.candidates, ...bybit!.candidates]).toHaveLength(0);
    expect(thalex!.rejected[NOT_BETTER_REASON]).toBeGreaterThan(0);
  });
  it('reports the improvement over the best same-venue pair', () => {
    const i = twoVenues();
    i.chain.strikes[1]!.call.venues.bybit!.execution!.bidUsd = 700;
    i.chain.strikes[0]!.call.venues.bybit!.execution!.askUsd = 1200;
    const route = cross(i)
      .find((scan) => scan.sellVenue === 'bybit')!
      .candidates.find((c) => c.kind === 'call-debit' && c.buyVenue === 'thalex')!;
    expect(route.grossPremium).toBeCloseTo(-4);
    expect(route.entryFee).toBeCloseTo(0.24);
    expect(route.improvement).toBeCloseTo(0.88);
    for (let spot = 70_000; spot <= 90_000; spot += 500)
      expect(expiryPnl(route, spot)).toBeLessThanOrEqual(route.maxProfit + 1e-9);
  });
  it('requires a second venue', () => {
    const [scan] = cross(input());
    expect(scan!.candidates).toHaveLength(0);
    expect(scan!.rejected[SINGLE_VENUE_REASON]).toBe(1);
  });
});
