import { type Leg, pnlAtPrice } from '@features/architect';
import type { EnrichedSide, VenueQuote } from '@shared/enriched';
import { describe, expect, it } from 'vitest';
import { easyBuyPreview, fmtTollMove } from './easy-toll';

const now = 1_800_000_000_000;
const venues = new Set(['deribit', 'bybit']);
const quote: VenueQuote = {
  bid: 200,
  ask: 300,
  mid: 999,
  midRaw: null,
  bidSize: null,
  askSize: null,
  markIv: null,
  bidIv: null,
  askIv: null,
  delta: null,
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
  asOfMs: now,
};
const side = (overrides: Partial<VenueQuote> = {}): EnrichedSide => ({
  venues: { deribit: { ...quote, ...overrides } },
  bestIv: null,
  bestVenue: null,
});

describe('Easy Mode underlying toll movement', () => {
  it.each([
    'call',
    'put',
  ] as const)('reconciles the %s ask break-even to zero expiry P&L without adding toll twice', (type) => {
    const preview = easyBuyPreview(type, 64_000, side(), venues, 63_800, now)!;
    const sign = type === 'call' ? 1 : -1;
    expect(preview.breakeven).toBe(64_000 + sign * 300);
    expect(preview.toll?.breakeven).toBe(64_000 + sign * 250);
    expect(preview.toll?.usd).toBe(50);
    expect(preview.toll?.pct).toBe(20);
    expect(preview.toll?.movePct).toBeCloseTo((100 * 50) / 63_800);
    expect(preview.movePct).toBeCloseTo((100 * (preview.breakeven - 63_800)) / 63_800);
    const leg: Leg = {
      id: 'test',
      type,
      direction: 'buy',
      strike: preview.strike,
      entryPrice: preview.ask,
      quantity: 3,
      contractMultiplier: 2,
      venue: preview.venue,
      expiry: '2026-12-18',
      delta: null,
      gamma: null,
      theta: null,
      vega: null,
      iv: null,
    };
    expect(pnlAtPrice([leg], preview.breakeven)).toBe(0);
    expect(pnlAtPrice([leg], preview.toll!.breakeven)).toBe(-50 * 3 * 2);
  });

  it('uses the buy venue midpoint even when another venue has the best bid', () => {
    const market = side();
    market.venues.bybit = { ...quote, bid: 280, ask: 400 };
    const preview = easyBuyPreview('call', 64_000, market, venues, 64_000, now)!;
    expect(preview.venue).toBe('deribit');
    expect(preview.toll?.mid).toBe(250);
    expect(preview.toll?.usd).toBe(50);
    expect(easyBuyPreview('call', 64_000, market, new Set(['bybit']), 64_000, now)?.toll?.usd).toBe(
      60,
    );
  });

  it.each([
    { bid: null },
    { bid: 0 },
    { bid: -1 },
    { bid: NaN },
    { bid: Infinity },
    { bid: 301 },
  ])('preserves ask break-even but withholds unknown toll: %j', (overrides) => {
    const preview = easyBuyPreview('call', 64_000, side(overrides), venues, 64_000, now)!;
    expect(preview.breakeven).toBe(64_300);
    expect(preview.toll).toBeNull();
  });

  it('keeps an absent buy-venue bid unknown even with a bid at another venue', () => {
    const market = side({ bid: null });
    market.venues.bybit = { ...quote, ask: 400 };
    expect(easyBuyPreview('call', 64_000, market, venues, 64_000, now)?.toll).toBeNull();
  });

  it('preserves a valid zero toll', () => {
    const preview = easyBuyPreview('put', 64_000, side({ bid: 300 }), venues, 64_000, now)!;
    expect(preview.toll?.usd).toBe(0);
    expect(preview.toll?.movePct).toBe(0);
    expect(preview.toll?.breakeven).toBe(preview.breakeven);
  });

  it.each([
    { ask: null },
    { ask: 0 },
    { ask: NaN },
    { ask: Infinity },
    { asOfMs: now - 60_001 },
  ])('withholds previews without a usable ask: %j', (overrides) => {
    expect(easyBuyPreview('call', 64_000, side(overrides), venues, 64_000, now)).toBeNull();
  });

  it.each([
    null,
    0,
    -1,
    NaN,
    Infinity,
  ])('withholds movement without a valid reference: %s', (spot) => {
    expect(easyBuyPreview('call', 64_000, side(), venues, spot, now)).toBeNull();
  });

  it('does not display a non-positive put break-even', () => {
    expect(easyBuyPreview('put', 200, side(), venues, 64_000, now)).toBeNull();
  });

  it('does not present a small positive toll as zero movement', () => {
    expect(fmtTollMove(0)).toBe('0.00%');
    expect(fmtTollMove(0.003)).toBe('0.0030%');
    expect(fmtTollMove(0.000001)).toBe('<0.0001%');
  });
});
