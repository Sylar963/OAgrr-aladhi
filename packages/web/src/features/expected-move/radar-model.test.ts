import { describe, expect, it } from 'vitest';
import {
  buildRadarTrail,
  coneBounds,
  expiryCone,
  liveCone,
  openingCone,
  radarEvents,
  radarRatios,
  straddleLevels,
} from './radar-model';
import { radarCandles, radarQuote, radarReport, TEST_NOW, TEST_START } from './test-fixtures';

describe('Radar time and pricing model', () => {
  it('preserves full-day calculations while separating elapsed-time pace', () => {
    const session = radarReport().current!;
    const point = { time: TEST_NOW, price: session.last, gap: false };
    const ratios = radarRatios(session, point);
    expect(ratios.daily).toBeCloseTo(0.03 / session.expectedFraction!);
    expect(ratios.pace).toBeCloseTo(ratios.daily! / Math.sqrt(0.5));
    const cone = openingCone(session)!;
    expect(coneBounds(cone, session.startMs)).toEqual([session.open, session.open]);
    expect(coneBounds(cone, session.endMs)).toEqual([session.lower, session.upper]);
    expect(coneBounds(cone, TEST_NOW)![1] - session.open).toBeCloseTo(
      session.expectedUsd! * Math.sqrt(0.5),
    );
    expect(radarRatios(session, { ...point, time: session.startMs }).pace).toBeNull();
    expect(openingCone({ ...session, expectedUsd: null })).toBeNull();
  });

  it('uses calendar time and selected expiry IV without redrawing the opening cone', () => {
    const quote = radarQuote();
    const cone = expiryCone(quote, 'surface')!;
    expect(cone.start).toBe(quote.quoteAsOfMs);
    expect(cone.end).toBe(quote.expiryTs);
    expect(cone.center).toBe(quote.forward);
    const width =
      quote.surfaceIv! * Math.sqrt((quote.expiryTs! - quote.quoteAsOfMs!) / (365 * 86_400_000));
    expect(coneBounds(cone, cone.end)![1]).toBeCloseTo(quote.forward! * Math.exp(width));
    expect(coneBounds(cone, cone.start - 1)).toBeNull();
    expect(expiryCone({ ...quote, surfaceIv: null }, 'surface')).toBeNull();
    expect(expiryCone({ ...quote, expiryTs: TEST_NOW }, 'index')).toBeNull();
    expect(straddleLevels(quote)).toEqual([
      { kind: 'buy', lower: 97600, upper: 102400 },
      { kind: 'sell', lower: 97700, upper: 102300 },
    ]);
  });

  it('reanchors live dispersion from the latest price and remaining time', () => {
    const session = radarReport().current!;
    const cone = liveCone(session, { time: TEST_NOW, price: 103000, gap: false }, 0.7, 365)!;
    expect(coneBounds(cone, TEST_NOW)).toEqual([103000, 103000]);
    expect(coneBounds(cone, session.endMs)![1] - cone.center).toBeCloseTo(
      ((103000 * 0.7) / Math.sqrt(365)) * Math.sqrt(0.5),
    );
    expect(
      liveCone(session, { time: session.endMs, price: 103000, gap: false }, 0.7, 365),
    ).toBeNull();
  });

  it('plots completed candle closes at their end, preserves gaps and excludes future closes', () => {
    const session = radarReport().current!;
    const candles = radarCandles();
    const trail = buildRadarTrail(
      session,
      candles.filter((_, i) => i !== 10),
      300000,
      TEST_START + 20 * 300000,
    );
    expect(trail[0]?.time).toBe(TEST_START);
    expect(trail[1]?.time).toBe(TEST_START + 300000);
    expect(trail.at(-1)?.time).toBe(TEST_START + 20 * 300000);
    expect(trail.some((p) => p.price === session.last)).toBe(false);
    expect(trail.find((p) => p.time === TEST_START + 12 * 300000)?.gap).toBe(true);
  });

  it('creates close-observation milestones, never crossings inferred through a data gap', () => {
    const session = radarReport().current!;
    const cone = openingCone(session)!;
    const points = [
      { time: TEST_START + 3_600_000, price: 100000, gap: false },
      { time: TEST_NOW, price: 104000, gap: false },
      { time: TEST_NOW + 300000, price: 100000, gap: false },
    ];
    expect(radarEvents(points, cone, false).map((e) => e.kind)).toEqual(['cross', 'return']);
    expect(radarEvents([points[0]!, { ...points[1]!, gap: true }], cone, true)).toEqual([]);
    expect(radarEvents(points, null, true)).toEqual([]);
  });
});
