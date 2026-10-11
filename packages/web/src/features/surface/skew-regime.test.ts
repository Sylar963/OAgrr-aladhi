import { describe, expect, it } from 'vitest';

import {
  computeRegime,
  currentRun,
  describeRegime,
  flowSeries,
  formatRegimeValue,
  type RegimeParams,
  regimeShare,
  rrSeries,
} from './skew-regime';

const H = 3600;
const params: RegimeParams = { smoothSec: 1, bandSec: 10 * H, k: 1.5, exitFraction: 0.5 };

function hourly(values: number[]) {
  return values.map((value, i) => ({ time: i * H, value }));
}

const calm = Array.from({ length: 12 }, (_, i) => (i % 2 === 0 ? 1 : -1));

describe('computeRegime', () => {
  it('warms up until a full zone window of earlier points exists', () => {
    const points = computeRegime(hourly([...calm, 0]), params);
    expect(points.slice(0, 10).every((p) => p.regime == null && p.upper == null)).toBe(true);
    expect(points[10]!.regime).toBe('neutral');
    expect(points[10]!.mid).toBeCloseTo(0);
    expect(points[10]!.upper).toBeCloseTo(1.5);
  });

  it('enters risk-on above the zone and holds it until halfway back to the mid-line', () => {
    const points = computeRegime(hourly([...calm, 5, 3, 0.5]), params);
    expect(points[12]!.regime).toBe('risk-on');
    expect(points[13]!.regime).toBe('risk-on');
    expect(points[14]!.regime).toBe('neutral');
  });

  it('enters risk-off below the zone', () => {
    const points = computeRegime(hourly([...calm, -5]), params);
    expect(points.at(-1)!.regime).toBe('risk-off');
  });

  it('never uses the current or later points for the zone', () => {
    const base = computeRegime(hourly([...calm, 0]), params);
    const withFuture = computeRegime(hourly([...calm, 0, 100, -100]), params);
    expect(withFuture[12]).toEqual(base[12]);
  });

  it('smooths with a trailing mean before classifying', () => {
    const points = computeRegime(hourly([2, 4, 6]), { ...params, smoothSec: 2 * H });
    expect(points.map((p) => p.value)).toEqual([2, 3, 5]);
    expect(points.map((p) => p.raw)).toEqual([2, 4, 6]);
  });
});

describe('currentRun and regimeShare', () => {
  it('reports when the latest regime started and the time spent in each', () => {
    const points = computeRegime(hourly([...calm, 5, 6, 7]), params);
    expect(currentRun(points)).toEqual({ regime: 'risk-on', since: 12 * H });
    expect(regimeShare(points)).toEqual({ riskOn: 60, riskOff: 0 });
  });
});

describe('flowSeries', () => {
  const bucket = (ts: number, calls: number, puts: number) => ({
    ts,
    callCount: 1,
    putCount: 1,
    callContracts: calls,
    putContracts: puts,
    callNotionalUsd: calls * 1000,
    putNotionalUsd: puts * 1000,
    callPremiumUsd: calls * 10,
    putPremiumUsd: puts * 10,
  });

  it('fills empty buckets with zero and drops the bucket still in progress', () => {
    const series = flowSeries(
      [bucket(0, 5, 2), bucket(2 * H, 1, 4), bucket(3 * H, 9, 0)],
      'contracts',
      0,
      H,
      3 * H + 120,
    );
    expect(series).toEqual([
      { time: 0, value: 3 },
      { time: H, value: 0 },
      { time: 2 * H, value: -3 },
    ]);
  });

  it('reads the notional and premium splits', () => {
    expect(flowSeries([bucket(0, 5, 2)], 'notional', 0, H, H)[0]!.value).toBe(3000);
    expect(flowSeries([bucket(0, 5, 2)], 'premium', 0, H, H)[0]!.value).toBe(30);
  });
});

describe('rrSeries', () => {
  it('converts RR to vol points and skips gaps', () => {
    expect(
      rrSeries([
        { ts: 1_000, atmIv: 0.5, rr25d: -0.024, bfly25d: 0.01, rr10d: null, bfly10d: null },
        { ts: 2_000, atmIv: 0.5, rr25d: null, bfly25d: 0.01, rr10d: null, bfly10d: null },
      ]),
    ).toEqual([{ time: 1, value: -2.4 }]);
  });
});

describe('formatting', () => {
  it('formats each source in its own unit', () => {
    expect(formatRegimeValue(-2.345, 'rr', 'BTC')).toBe('-2.35vp');
    expect(formatRegimeValue(123.4, 'contracts', 'BTC')).toBe('+123 BTC');
    expect(formatRegimeValue(-4.25, 'contracts', 'ETH')).toBe('-4.3 ETH');
    expect(formatRegimeValue(12_340_000, 'notional', 'BTC')).toBe('+$12.3M');
    expect(formatRegimeValue(-45_000, 'premium', 'BTC')).toBe('-$45k');
  });

  it('describes a break with its duration and zones', () => {
    const points = computeRegime(hourly([...calm, -5, -6]), params);
    expect(describeRegime(points, 'rr', 'BTC', '10h')).toBe(
      'Risk-off for 1h: 1h avg RR -6.00vp broke below the lower zone (10h zones -3.22vp … +2.02vp).',
    );
  });
});
