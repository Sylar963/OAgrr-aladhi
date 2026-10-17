import { describe, expect, it } from 'vitest';
import { type HeatmapInstrument, selectHeatmapInstruments } from './select.js';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 17, 12);
const at = (days: number) => NOW + days * DAY;

function chain(expiry: number, strikes: number[]): HeatmapInstrument[] {
  return strikes.flatMap((strike) =>
    (['call', 'put'] as const).map((right) => ({
      name: `BTC-${expiry}-${strike}-${right === 'call' ? 'C' : 'P'}`,
      strike,
      right,
      expiry,
    })),
  );
}

const STRIKES = [60_000, 70_000, 74_000, 76_000, 78_000, 80_000, 81_000, 82_000, 84_000, 86_000, 90_000, 100_000];

describe('selectHeatmapInstruments', () => {
  it('picks the two expiries bracketing 30 days, skipping ones about to settle', () => {
    const all = [at(1), at(9), at(20), at(41), at(70)].flatMap((e) => chain(e, STRIKES));
    const { expiries } = selectHeatmapInstruments(all, { now: NOW, spot: 81_000, atmVol: 0.4 });
    expect(expiries).toEqual([at(20), at(41)]);
  });

  it('keeps OTM legs inside the band, both legs at the ATM strike, and the ATM call as forward source', () => {
    const expiry = at(41);
    const { instruments, forwardSources } = selectHeatmapInstruments(chain(expiry, STRIKES), {
      now: NOW,
      spot: 81_000,
      atmVol: 0.4,
      minStrikesPerExpiry: 1,
    });
    // band = 0.5 × 0.4 × sqrt(41/365) ≈ 6.7% → 76k..86k
    expect(instruments.map((i) => i.name).sort()).toEqual(
      [
        `BTC-${expiry}-76000-P`,
        `BTC-${expiry}-78000-P`,
        `BTC-${expiry}-80000-P`,
        `BTC-${expiry}-81000-C`,
        `BTC-${expiry}-81000-P`,
        `BTC-${expiry}-82000-C`,
        `BTC-${expiry}-84000-C`,
        `BTC-${expiry}-86000-C`,
      ].sort(),
    );
    expect(forwardSources.get(expiry)).toBe(`BTC-${expiry}-81000-C`);
  });

  it('falls back to the nearest strikes when the band is narrower than the strike grid', () => {
    const expiry = at(41);
    const { instruments } = selectHeatmapInstruments(chain(expiry, [60_000, 80_000, 100_000, 120_000]), {
      now: NOW,
      spot: 81_000,
      atmVol: 0.1,
      minStrikesPerExpiry: 2,
    });
    expect(new Set(instruments.map((i) => i.strike))).toEqual(new Set([80_000, 100_000]));
  });
});
