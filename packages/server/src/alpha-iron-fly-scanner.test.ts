import type { EnrichedStrike, SpotCandle, VenueQuote } from '@oggregator/core';
import { AlphaIronFlyScannerQuerySchema, type AlphaIronFlyWindowSet } from '@oggregator/protocol';
import { describe, expect, it } from 'vitest';

import {
  comparableWindows,
  computeIronFlyCandidates,
  ironFlyHistoryStats,
  ironFlyPnl,
  ironFlyVerdict,
  selectWingWidths,
} from './alpha-iron-fly-scanner.js';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
// Friday 2027-01-15 08:00 UTC.
const FRIDAY_0800 = 1_800_000_000_000;
const NOW = FRIDAY_0800 + 6 * HOUR_MS + 25 * 60_000;
const EXPIRY = FRIDAY_0800 + 2 * DAY_MS;
const FORWARD = 82_000;
const FEE = 2;
const config = AlphaIronFlyScannerQuerySchema.parse({ equity: 100_000, riskPct: 1 });

function hourlyCandles(weeks: number, priceAt: (hourTs: number) => number): SpotCandle[] {
  const first = NOW - weeks * WEEK_MS - 2 * DAY_MS;
  const candles: SpotCandle[] = [];
  for (let ts = Math.floor(first / HOUR_MS) * HOUR_MS; ts + HOUR_MS <= NOW; ts += HOUR_MS) {
    const close = priceAt(ts + HOUR_MS);
    candles.push({ timestamp: ts, open: close, high: close, low: close, close });
  }
  return candles;
}

function quote(bid: number, ask: number, delta: number): VenueQuote {
  return {
    bid,
    ask,
    mid: (bid + ask) / 2,
    midRaw: null,
    bidSize: 5,
    askSize: 5,
    markIv: 0.4,
    bidIv: null,
    askIv: null,
    delta,
    gamma: null,
    theta: null,
    vega: null,
    spreadPct: null,
    totalCost: null,
    estimatedFees: null,
    openInterest: null,
    volume24h: null,
    openInterestUsd: null,
    volume24hUsd: null,
    asOfMs: NOW - 1_000,
    underlyingPriceUsd: FORWARD,
    inverse: false,
    execution: {
      exchangeSymbol: `TEST-${bid}`,
      settleCurrency: 'USDC',
      inverse: false,
      quantityUnit: 'base',
      contractMultiplierBase: 1,
      nativeMinQuantity: 0.01,
      nativeQuantityStep: 0.01,
      nativePriceTick: 1,
      minQuantity: 0.01,
      quantityStep: 0.01,
      bidSize: 5,
      askSize: 5,
      bidUsd: bid,
      askUsd: ask,
      markUsd: (bid + ask) / 2,
      bidMakerFeeUsd: 1,
      bidTakerFeeUsd: FEE,
      askMakerFeeUsd: 1,
      askTakerFeeUsd: FEE,
    },
  };
}

function strike(value: number, call: VenueQuote | null, put: VenueQuote | null): EnrichedStrike {
  return {
    strike: value,
    call: { venues: call ? { thalex: call } : {}, bestIv: null, bestVenue: null },
    put: { venues: put ? { thalex: put } : {}, bestIv: null, bestVenue: null },
  };
}

// 80k / 82k / 84k fly: body bids 700 + 690, wing asks 120 + 110 → gross credit 1,160.
const CHAIN: EnrichedStrike[] = [
  strike(78_000, quote(300, 320, 0.85), quote(40, 50, -0.08)),
  strike(80_000, quote(2_150, 2_200, 0.7), quote(100, 110, -0.2)),
  strike(82_000, quote(700, 720, 0.5), quote(690, 710, -0.5)),
  strike(84_000, quote(110, 120, 0.2), quote(2_100, 2_150, -0.7)),
  strike(86_000, quote(45, 55, 0.08), quote(3_900, 4_000, -0.9)),
];

function windowsFrom(ratios: number[], holdoutFrom = Math.max(0, ratios.length - 26)): AlphaIronFlyWindowSet {
  return {
    expiryTs: EXPIRY,
    horizonHours: (EXPIRY - NOW) / HOUR_MS,
    startTs: ratios.map((_, index) => NOW - (ratios.length - index) * WEEK_MS),
    ratios,
    holdoutFrom,
  };
}

describe('comparableWindows', () => {
  it('pairs the same hour of the week at entry and at the settlement hour', () => {
    const entryHour = Math.floor(NOW / HOUR_MS) * HOUR_MS;
    const candles = hourlyCandles(4, (hourTs) => {
      const weekAgo = Math.round((entryHour - hourTs) / WEEK_MS);
      if (hourTs === entryHour - weekAgo * WEEK_MS) return 80_000;
      if (hourTs === EXPIRY - weekAgo * WEEK_MS) return 80_000 * (1 + weekAgo / 100);
      return 1;
    });
    const windows = comparableWindows(candles, NOW, EXPIRY, 4, 2);
    expect(windows.ratios).toHaveLength(4);
    expect(windows.ratios[0]).toBeCloseTo(1.04, 10);
    expect(windows.ratios[3]).toBeCloseTo(1.01, 10);
    expect(windows.startTs[3]).toBe(entryHour - WEEK_MS);
    expect(windows.horizonHours).toBe((EXPIRY - entryHour) / HOUR_MS);
    expect(windows.holdoutFrom).toBe(2);
  });

  it('drops windows whose settlement hour has not closed yet or has no candle', () => {
    const windows = comparableWindows(hourlyCandles(3, () => 80_000), NOW, NOW + 10 * DAY_MS, 3);
    expect(windows.ratios).toHaveLength(2);
    expect(comparableWindows([], NOW, EXPIRY, 3).ratios).toEqual([]);
  });
});

describe('ironFlyPnl', () => {
  it('keeps the credit at the body and caps the loss at the wing width', () => {
    expect(ironFlyPnl(1_000, 82_000, 2_000, 82_000)).toBe(1_000);
    expect(ironFlyPnl(1_000, 82_000, 2_000, 81_000)).toBe(0);
    expect(ironFlyPnl(1_000, 82_000, 2_000, 90_000)).toBe(-1_000);
  });
});

describe('ironFlyHistoryStats', () => {
  it('reports profit rate, mean, tails and a confidence interval', () => {
    const stats = ironFlyHistoryStats([100, 100, 100, -500], 48);
    expect(stats.profitRate).toBe(0.75);
    expect(stats.meanPnl).toBe(-50);
    expect(stats.worstPnl).toBe(-500);
    expect(stats.ciLow).toBeLessThan(-50);
    expect(stats.ciHigh).toBeGreaterThan(-50);
  });

  it('shrinks the independent count for windows longer than a week', () => {
    expect(ironFlyHistoryStats([1, 2, 3, 4], 14 * 24).independentN).toBe(2);
    expect(ironFlyHistoryStats([], 48).meanPnl).toBeNull();
  });
});

describe('selectWingWidths', () => {
  it('uses only symmetric listed wings, nearest each width target', () => {
    expect(selectWingWidths(CHAIN, 'thalex', 82_000, FORWARD)).toEqual([2_000, 4_000]);
  });
});

describe('computeIronFlyCandidates', () => {
  it('sells the body at the bids and buys the wings at the asks, net of four taker fees', () => {
    const results = computeIronFlyCandidates(
      { venue: 'thalex', underlying: 'BTC', expiry: '2027-01-17', expiryTs: EXPIRY },
      CHAIN,
      windowsFrom(Array.from({ length: 120 }, () => 1)),
      config,
      NOW,
    );
    const fly = results.find((result) => result.candidate?.width === 2_000)?.candidate;
    expect(fly).toBeDefined();
    expect(fly!.grossCredit).toBe(700 + 690 - 120 - 110);
    expect(fly!.entryFees).toBe(4 * FEE);
    expect(fly!.netCredit).toBe(1_152);
    expect(fly!.maxLoss).toBe(848);
    expect(fly!.breakevenLow).toBe(82_000 - 1_152);
    expect(fly!.breakevenHigh).toBe(82_000 + 1_152);
    expect(fly!.netDelta).toBeCloseTo(-(0.5 - 0.5) + 0.2 - 0.2, 10);
  });

  it('scores the full payoff on fit and holdout windows separately', () => {
    // Fit: 100 flat weekends then 20 that land on a wing. Holdout: 26 wing hits.
    const ratios = [
      ...Array.from({ length: 100 }, () => 1),
      ...Array.from({ length: 20 }, () => 84_000 / FORWARD),
      ...Array.from({ length: 26 }, () => 80_000 / FORWARD),
    ];
    const fly = computeIronFlyCandidates(
      { venue: 'thalex', underlying: 'BTC', expiry: '2027-01-17', expiryTs: EXPIRY },
      CHAIN,
      windowsFrom(ratios, 120),
      config,
      NOW,
    ).find((result) => result.candidate?.width === 2_000)!.candidate!;
    expect(fly.fit.n).toBe(120);
    expect(fly.fit.profitRate).toBeCloseTo(100 / 120, 10);
    expect(fly.fit.meanPnl).toBeCloseTo((100 * 1_152 - 20 * 848) / 120, 6);
    expect(fly.holdout.meanPnl).toBeCloseTo(-848, 6);
    expect(fly.holdout.worstPnl).toBeCloseTo(-848, 6);
    expect(fly.flags).toContain('holdout_mean_negative');
    expect(fly.verdict).toBe('watch');
  });

  it('sizes so that the max loss fits the budget, capped by top of book', () => {
    const fly = computeIronFlyCandidates(
      { venue: 'thalex', underlying: 'BTC', expiry: '2027-01-17', expiryTs: EXPIRY },
      CHAIN,
      windowsFrom(Array.from({ length: 120 }, () => 1)),
      config,
      NOW,
    ).find((result) => result.candidate?.width === 2_000)!.candidate!;
    expect(fly.riskBudgetQuantity).toBe(1.17);
    expect(fly.suggestedQuantity).toBe(1.17);
  });

  it('skips a fly whose wings cost more than the body pays', () => {
    const cheapBody = CHAIN.map((row) =>
      row.strike === 82_000 ? strike(82_000, quote(60, 70, 0.5), quote(60, 70, -0.5)) : row,
    );
    const results = computeIronFlyCandidates(
      { venue: 'thalex', underlying: 'BTC', expiry: '2027-01-17', expiryTs: EXPIRY },
      cheapBody,
      windowsFrom([]),
      config,
      NOW,
    );
    expect(results.every((result) => result.candidate == null)).toBe(true);
  });
});

describe('ironFlyVerdict', () => {
  it('needs enough history before judging, then the fit mean, then the watch flags', () => {
    expect(ironFlyVerdict(['thin_history', 'fit_mean_negative'])).toBe('thin-history');
    expect(ironFlyVerdict(['fit_mean_negative', 'ci_includes_zero'])).toBe('historically-negative');
    expect(ironFlyVerdict(['ci_includes_zero'])).toBe('watch');
    expect(ironFlyVerdict([])).toBe('historically-positive');
  });
});
